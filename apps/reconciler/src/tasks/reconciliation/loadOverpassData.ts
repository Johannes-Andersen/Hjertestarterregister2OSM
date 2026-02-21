import type { Logger } from "pino";
import { syncStore } from "../../clients/syncStore.ts";
import { getOsmAeds } from "../../utils/getOsmAeds.ts";
import { isOverpassNode } from "../../utils/isOverpassNode.ts";

interface LoadOverpassDataOptions {
  logger: Logger;
  runId: string;
}

export const loadOverpassData = async ({
  logger,
  runId,
}: LoadOverpassDataOptions) => {
  const log = logger.child({ task: "loadOverpassData" });
  log.info("Loading Overpass data...");

  const { elements, ...apiDetails } = await getOsmAeds();

  const metrics = {
    osmAeds: elements.length,
    linkedAeds: elements.filter(
      (element) =>
        isOverpassNode(element) && element.tags?.["ref:hjertestarterregister"],
    ).length,
  };

  log.trace({ metrics }, "Adding Overpass data metrics to database");
  await syncStore.addRunMetric({
    runId,
    metrics,
  });
  log.debug({ metrics }, "Overpass data metrics added to database");

  const filteredElements = elements.filter((element) => {
    const isNode = isOverpassNode(element);

    if (!isNode) {
      log.warn(
        { element },
        "Overpass element is not a node and will be skipped",
      );

      syncStore.addRunIssue({
        runId,
        issue: {
          type: "osm_not_a_node",
          severity: "error",
          message: `OSM element with id ${element.id} is of type ${element.type} and will be skipped.`,
          osmNodeId: element.id,
          details: {
            osmElementType: element.type,
          },
        },
      });
    }

    return isNode;
  });

  log.info(
    {
      apiDetails,
      elementsCount: elements.length,
      filteredElementsCount: filteredElements.length,
    },
    "Loaded Overpass data",
  );

  return filteredElements;
};
