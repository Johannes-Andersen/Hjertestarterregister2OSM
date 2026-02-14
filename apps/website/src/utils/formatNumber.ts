export const formatNumber = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US").format(value);
};
