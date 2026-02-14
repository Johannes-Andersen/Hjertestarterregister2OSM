export const formatDuration = (
  startedAt: Date | string | null | undefined,
  finishedAt: Date | string | null | undefined,
): string => {
  if (!startedAt || !finishedAt) return "-";

  const startDate = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const endDate =
    finishedAt instanceof Date ? finishedAt : new Date(finishedAt);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate.getTime() < startDate.getTime()
  )
    return "-";

  const totalSeconds = Math.round(
    (endDate.getTime() - startDate.getTime()) / 1000,
  );

  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
};
