export function formatFailureDetail(
  errors: string[],
  maxLines = 3,
): string {
  if (errors.length === 0) return "";
  const shown = errors.slice(0, maxLines);
  const remainder = errors.length - shown.length;
  const body = shown.join("; ");
  return remainder > 0 ? `${body}; +${remainder} more` : body;
}
