export const getClampedLimit = ({
  limit,
  fallback,
  max,
}: {
  limit: number | undefined;
  fallback: number;
  max: number;
}) => {
  const value = typeof limit === "number" ? Math.trunc(limit) : fallback;
  return Math.min(Math.max(1, value), max);
};
