import type { Job } from "@/lib/types";

/** Human-facing job reference: assigned job number when present, else legacy Firestore doc id. */
export function jobDisplayRef(job: Pick<Job, "id" | "jobNo">): string {
  const jn = job.jobNo?.trim();
  if (jn) return jn;
  return job.id;
}
