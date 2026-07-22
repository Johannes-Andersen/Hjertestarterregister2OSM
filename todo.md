## 🔴 Critical — data-damaging or import-blocking

**5. Duplicate creation from replication lag**
`findByRef` reads `osm_aed`, which lags behind live OSM by a replication cycle (minutes). Sequence: `aed.created` → we create node → registry edits it → `aed.updated` arrives before osm-ingestor has ingested our new node → `findByRef` returns nothing → **we create a second node**. Same risk on BullMQ retry after a lost upload ack. Needs a short-lived "recently created ref → node id" cache (e.g., Redis) and/or an authoritative existence check (Overpass/`getFeatures`) before create.

## 🧵 From community forum thread

**17. Graceful handling of deactivated/reactivated AEDs.**
AEDs get temporarily deactivated in the registry (expired pads/battery) and later reactivated. Avoid delete-then-recreate churn — add a grace period before deleting (or soft-retain the node) so a reactivated AED reuses the same OSM node/id instead of being recreated.

## Other:

Replace this line of code
// TODO: Replace this with description
// const description = normalizeCaps(aed.siteName);
// if (description) setTag(tags, "description", description);
const description = normalizeCaps(aed.siteName);
if (description) setTag(tags, "name", description);
