const standaloneConflictTagKeys = new Set([
  "amenity",
  "leisure",
  "tourism",
  "shop",
  "office",
  "craft",
  "club",
]);

const aedTagsToStripFromMixedNode = new Set([
  "emergency",
  "emergency:phone",
  "defibrillator:location",
  "defibrillator:code",
  "defibrillator:cabinet",
  "defibrillator:cabinet:manufacturer",
  "defibrillator:cabinet:colour",
  "ref:hjertestarterregister",
]);

export const hasStandaloneConflictTags = (
  tags: Record<string, string> | undefined,
) => {
  if (!tags) return false;
  return Object.keys(tags).some((key) => standaloneConflictTagKeys.has(key));
};

export const buildStandaloneStripTagUpdates = (
  tags: Record<string, string> | undefined,
) => {
  const updates: Record<string, string | undefined> = {};
  if (!tags) return updates;

  for (const key of aedTagsToStripFromMixedNode) {
    if (!(key in tags)) continue;
    updates[key] = undefined;
  }

  return updates;
};

export const applyTagUpdates = ({
  currentTags,
  tagUpdates,
}: {
  currentTags: Record<string, string> | undefined;
  tagUpdates: Record<string, string | undefined>;
}) => {
  const nextTags: Record<string, string | undefined> = {
    ...(currentTags ?? {}),
  };

  for (const [key, value] of Object.entries(tagUpdates)) {
    if (value === undefined) {
      delete nextTags[key];
      continue;
    }

    nextTags[key] = value;
  }

  return nextTags;
};
