const monthNames = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export const formatRegistryDate = (date: Date): string => {
  const month = monthNames[date.getUTCMonth()];
  if (!month || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid registry cursor date: ${date.toString()}`);
  }
  return `${String(date.getUTCDate()).padStart(2, "0")}-${month}-${date.getUTCFullYear()}`;
};
