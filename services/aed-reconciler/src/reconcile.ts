import type {
  ChangePlan,
  OsmNode,
  PlannedDeleteChange,
  PlannedModifyChange,
  PlannedNode,
} from "@repo/osm-sdk";
import type { Logger } from "pino";
import { env } from "./config.ts";
import type { AedEvent, RegistryAed } from "./events.ts";
import { distanceMeters, type LatLon } from "./geo.ts";
import { fetchLiveNode, nodeIsInUse, nodeLocation, osm } from "./osm.ts";
import {
  findByRef,
  findLocationOwner,
  findNearbyUnmanaged,
  type OsmAedNode,
} from "./osmAedRepository.ts";
import { writePreview } from "./preview.ts";
import { cancelDeferredDelete, scheduleDeferredDelete } from "./queue.ts";
import {
  applyManagedTags,
  hasNoteOrFixme,
  hasStrippableAedTags,
  isAedOnlyNode,
  registryAedToTags,
  stripAedTags,
} from "./tags.ts";

const emptyPlan = (): ChangePlan => ({ create: [], modify: [], delete: [] });

const isEmptyPlan = (plan: ChangePlan): boolean =>
  plan.create.length === 0 &&
  plan.modify.length === 0 &&
  plan.delete.length === 0;

const registryLocation = (aed: RegistryAed): LatLon => ({
  lat: aed.siteLatitude,
  lon: aed.siteLongitude,
});

const toPlanned = (node: OsmNode): PlannedNode => ({
  id: node.id,
  lat: node.lat,
  lon: node.lon,
  version: node.version,
  tags: { ...(node.tags ?? {}) },
});

/** Plan a modify (or return null when the node is gone, opted-out, or unchanged). */
const planEdit = async (
  stored: OsmAedNode,
  aed: RegistryAed,
  { allowMove }: { allowMove: boolean },
  log: Logger,
): Promise<PlannedModifyChange | null> => {
  const nodeId = stored.elementId;
  if (hasNoteOrFixme(stored.tags)) {
    log.info("Skipping node tagged with note/fixme in local OSM data");
    return null;
  }

  const managedTags = registryAedToTags(aed);
  const storedTagChange = applyManagedTags(stored.tags, managedTags).changed;
  const storedDistance = distanceMeters(
    { lat: stored.latitude, lon: stored.longitude },
    registryLocation(aed),
  );
  // Ownership is only worth resolving when a move is actually possible: the
  // caller allows it, the stored position is far enough away, and we have an
  // account to attribute the most recent move to.
  const mayMove =
    allowMove &&
    storedDistance > env.MOVE_DISTANCE_METERS &&
    Boolean(env.OSM_SERVICE_USERNAME);
  const storedOwner = mayMove ? await findLocationOwner(nodeId) : null;
  const storedMove = mayMove && storedOwner === env.OSM_SERVICE_USERNAME;

  if (!storedTagChange && !storedMove) {
    log.debug(
      { storedVersion: stored.version },
      "Local OSM data shows node is already up to date",
    );
    return null;
  }

  const live = await fetchLiveNode(nodeId);
  if (!live) {
    log.warn("Node not found in OSM; skipping edit");
    return null;
  }
  if (hasNoteOrFixme(live.tags)) {
    log.info("Skipping node tagged with note/fixme");
    return null;
  }

  const { tags, changed } = applyManagedTags(live.tags ?? {}, managedTags);

  let { lat, lon } = live;
  let moved = false;
  if (allowMove) {
    const distance = distanceMeters(nodeLocation(live), registryLocation(aed));
    if (distance > env.MOVE_DISTANCE_METERS) {
      // Only trust the stored history when the latest-state row is the same
      // version as the final live check. A newer live version may contain a
      // community move that minute replication has not stored yet.
      if (
        storedMove &&
        stored.version !== null &&
        stored.version === live.version
      ) {
        lat = aed.siteLatitude;
        lon = aed.siteLongitude;
        moved = true;
      } else {
        log.info(
          {
            distance: Math.round(distance),
            storedOwner,
            storedVersion: stored.version,
            liveVersion: live.version,
          },
          "Registry location differs but ownership cannot be safely attributed to this service; not moving",
        );
      }
    }
  }

  if (!changed && !moved) {
    log.debug("Node already up to date");
    return null;
  }
  return {
    before: toPlanned(live),
    after: { id: nodeId, lat, lon, version: live.version, tags },
  };
};

/**
 * Plan the removal of a managed node. An AED-only, standalone node is deleted;
 * a mixed feature or a node that is part of a way/relation only has its AED tags
 * stripped so geometry and host features are preserved.
 */
const planRemoval = async (
  stored: OsmAedNode,
  log: Logger,
): Promise<{ modify?: PlannedModifyChange; delete?: PlannedDeleteChange }> => {
  const nodeId = stored.elementId;
  if (hasNoteOrFixme(stored.tags)) {
    log.info("Skipping node tagged with note/fixme in local OSM data");
    return {};
  }
  // A mixed node with no strippable AED tags can never produce a change.
  if (!isAedOnlyNode(stored.tags) && !hasStrippableAedTags(stored.tags)) {
    log.debug("Local OSM data shows no removable AED tags");
    return {};
  }

  const live = await fetchLiveNode(nodeId);
  if (!live) {
    log.debug("Node already gone; nothing to remove");
    return {};
  }
  if (hasNoteOrFixme(live.tags)) {
    log.info("Skipping node tagged with note/fixme");
    return {};
  }

  const tags = live.tags ?? {};
  const aedOnly = isAedOnlyNode(tags);
  // Only pay for the membership lookup when a delete is otherwise possible.
  const inUse = aedOnly ? await nodeIsInUse(nodeId) : true;

  if (aedOnly && !inUse) {
    return { delete: { node: toPlanned(live) } };
  }

  const stripped = stripAedTags(tags);
  if (Object.keys(stripped).length === Object.keys(tags).length) {
    log.info("Node has no AED tags to strip; leaving it untouched");
    return {};
  }
  log.info(
    { aedOnly, inUse },
    "Node is a mixed feature or part of a way/relation; stripping AED tags instead of deleting",
  );
  return {
    modify: {
      before: toPlanned(live),
      after: {
        id: nodeId,
        lat: live.lat,
        lon: live.lon,
        version: live.version,
        tags: stripped,
      },
    },
  };
};

const planCreate = (aed: RegistryAed): ChangePlan["create"][number] => ({
  node: {
    id: -1,
    lat: aed.siteLatitude,
    lon: aed.siteLongitude,
    version: 0,
    tags: registryAedToTags(aed),
  },
});

/**
 * Strip the AED tags off a mixed host node (a shop/fuel/office/… that also
 * carries `emergency=defibrillator`), keeping its other feature tags. Returns
 * `null` when the host is gone, opted-out, or is actually AED-only in live OSM.
 */
const planExtractFromHost = async (
  stored: OsmAedNode,
  log: Logger,
): Promise<PlannedModifyChange | null> => {
  const nodeId = stored.elementId;
  if (hasNoteOrFixme(stored.tags)) {
    log.info("Host node tagged with note/fixme in local OSM data");
    return null;
  }
  if (isAedOnlyNode(stored.tags)) {
    log.info("Host node is AED-only in local OSM data; not stripping");
    return null;
  }
  if (!hasStrippableAedTags(stored.tags)) {
    log.debug("Local OSM data shows no AED tags to strip from host");
    return null;
  }

  const live = await fetchLiveNode(nodeId);
  if (!live) {
    log.debug("Host node gone; nothing to strip");
    return null;
  }
  if (hasNoteOrFixme(live.tags)) {
    log.info("Host node tagged with note/fixme; leaving it untouched");
    return null;
  }
  const tags = live.tags ?? {};
  if (isAedOnlyNode(tags)) {
    log.info("Host node is AED-only in live OSM; not stripping");
    return null;
  }
  const stripped = stripAedTags(tags);
  if (Object.keys(stripped).length === Object.keys(tags).length) {
    log.info("Host node has no AED tags to strip; leaving it untouched");
    return null;
  }
  return {
    before: toPlanned(live),
    after: {
      id: nodeId,
      lat: live.lat,
      lon: live.lon,
      version: live.version,
      tags: stripped,
    },
  };
};

/** aed.created / aed.updated: adopt, edit, de-duplicate, merge, or create. */
const handleUpsert = async (
  aed: RegistryAed,
  log: Logger,
): Promise<ChangePlan> => {
  const plan = emptyPlan();
  const matches = await findByRef(aed.assetGuid);

  if (matches.length > 0) {
    const center = registryLocation(aed);
    const byDistance = [...matches].sort(
      (a, b) =>
        distanceMeters(center, { lat: a.latitude, lon: a.longitude }) -
        distanceMeters(center, { lat: b.latitude, lon: b.longitude }),
    );
    const [keeper, ...duplicates] = byDistance;

    // Requirement 4: keep the closest node, remove the rest (never delete a
    // mixed feature or a node used by a way/relation — strip its AED tags).
    for (const duplicate of duplicates) {
      const removal = await planRemoval(
        duplicate,
        log.child({ duplicateOf: aed.assetGuid, node: duplicate.elementId }),
      );
      if (removal.delete) plan.delete.push(removal.delete);
      if (removal.modify) plan.modify.push(removal.modify);
    }

    if (keeper) {
      const modify = await planEdit(
        keeper,
        aed,
        { allowMove: true },
        log.child({ node: keeper.elementId }),
      );
      if (modify) plan.modify.push(modify);
    }
    return plan;
  }

  // No managed node: merge into the closest unmanaged community AED, else create.
  const [target] = await findNearbyUnmanaged(
    registryLocation(aed),
    env.MERGE_DISTANCE_METERS,
  );
  if (target) {
    if (isAedOnlyNode(target.tags)) {
      // Standalone community AED — adopt it in place.
      const modify = await planEdit(
        target,
        aed,
        { allowMove: false },
        log.child({
          mergeInto: target.elementId,
          distance: Math.round(target.distance),
        }),
      );
      if (modify) {
        plan.modify.push(modify);
        return plan;
      }
      // Adoption declined. If the nearby AED opted out (note/fixme), do not
      // create a duplicate right next to it — leave it for a human to reconcile.
      if (hasNoteOrFixme(target.tags)) {
        log.info(
          {
            optedOut: target.elementId,
            distance: Math.round(target.distance),
          },
          "Nearest AED opted out (note/fixme); not creating a duplicate",
        );
        return plan;
      }
      // Otherwise the node was gone — create a fresh node instead.
    } else {
      // Mixed node (AED tagged onto a shop/fuel/office/…): an AED belongs on its
      // own node. Strip the AED tags off the host and create a standalone node
      // at the registry coordinates (community consensus — the St1 case).
      const strip = await planExtractFromHost(
        target,
        log.child({
          extractFrom: target.elementId,
          distance: Math.round(target.distance),
        }),
      );
      if (strip) plan.modify.push(strip);
      plan.create.push(planCreate(aed));
      return plan;
    }
  }

  plan.create.push(planCreate(aed));
  return plan;
};

/** aed.deleted: remove managed OSM nodes for this ref. */
const handleDelete = async (
  aed: RegistryAed,
  log: Logger,
): Promise<ChangePlan> => {
  const plan = emptyPlan();
  const matches = await findByRef(aed.assetGuid);
  if (matches.length === 0) {
    log.info("Registry AED deleted but no managed OSM node found");
    return plan;
  }
  for (const match of matches) {
    const removal = await planRemoval(
      match,
      log.child({ node: match.elementId }),
    );
    if (removal.delete) plan.delete.push(removal.delete);
    if (removal.modify) plan.modify.push(removal.modify);
  }
  return plan;
};

const describePlan = (plan: ChangePlan) => ({
  create: plan.create.map((c) => ({ tags: c.node.tags })),
  modify: plan.modify.map((m) => ({ id: m.after.id, tags: m.after.tags })),
  delete: plan.delete.map((d) => ({ id: d.node.id })),
});

const executePlan = async (
  plan: ChangePlan,
  changeId: string,
  log: Logger,
): Promise<void> => {
  if (isEmptyPlan(plan)) {
    log.info("No OSM changes needed");
    return;
  }
  const counts = {
    create: plan.create.length,
    modify: plan.modify.length,
    delete: plan.delete.length,
  };

  if (env.PREVIEW_DIR) {
    const paths = await writePreview(env.PREVIEW_DIR, changeId, plan);
    log.info({ counts, ...paths }, "Wrote preview artifacts");
  }

  if (env.DRY) {
    log.info(
      { counts, plan: describePlan(plan) },
      "DRY run — not uploading to OSM",
    );
    return;
  }

  const result = await osm.applyBatchedChanges({
    changePlan: plan,
    changesetTags: { "source:date": new Date().toISOString() },
    commentSubject: "defibrillator import in Norway",
  });
  log.info({ counts, changesets: result.changesets }, "Uploaded OSM changes");
};

export const reconcile = async (
  event: AedEvent,
  log: Logger,
): Promise<void> => {
  // Mobile AEDs (e.g. carried in vehicles) are not mapped as stationary nodes.
  if (event.aed.isMobile) {
    log.info("Skipping mobile AED");
    return;
  }

  if (event.type === "aed.deleted") {
    // Deactivations are frequently temporary (expired pads/battery). Defer the
    // OSM removal by a grace period so a reactivation within the window reuses
    // the same node instead of delete-then-recreate churn.
    await scheduleDeferredDelete(event);
    log.info(
      { graceMs: env.DELETION_GRACE_PERIOD_MS },
      "Registry AED deleted; deferred OSM removal until after the grace period",
    );
    return;
  }

  // aed.created / aed.updated: the AED is active. Cancel any pending deferred
  // removal so a reactivation keeps (and updates) the existing node in place.
  if (await cancelDeferredDelete(event.assetGuid)) {
    log.info("AED reactivated within grace period; cancelled pending removal");
  }

  const plan = await handleUpsert(event.aed, log);
  await executePlan(plan, event.eventId, log);
};

/**
 * Runs when a deferred-delete job fires: the AED stayed deleted through the
 * whole grace period (no reactivation cancelled it), so remove it for real.
 */
export const runDeferredDelete = async (
  event: AedEvent,
  log: Logger,
): Promise<void> => {
  log.info("Grace period elapsed; removing AED from OSM");
  const plan = await handleDelete(event.aed, log);
  await executePlan(plan, event.eventId, log);
};
