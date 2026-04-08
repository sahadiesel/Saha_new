/**
 * When archiving, persist a display job number: existing jobNo, or legacy Firestore doc id
 * shaped like SJ2026-0001 (so counters / queries can see closed jobs).
 */
export function resolveJobNoForArchivedDocument(
  jobDocId: string,
  existingJobNo?: string | null
): string | undefined {
  const jn = existingJobNo?.trim();
  if (jn) return jn;
  if (/^[A-Za-z]{1,8}\d{4}-\d{4,}$/.test(jobDocId)) return jobDocId;
  return undefined;
}
