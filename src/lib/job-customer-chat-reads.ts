import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import type { Job } from "@/lib/types";

export const JOB_CUSTOMER_CHAT_READS_DOC_ID = "summary";

export function jobCustomerChatReadsSummaryRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "jobCustomerChatReads", JOB_CUSTOMER_CHAT_READS_DOC_ID);
}

function timestampToMillis(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "object" && v !== null && "toMillis" in v && typeof (v as Timestamp).toMillis === "function") {
    return (v as Timestamp).toMillis();
  }
  return 0;
}

/** มีข้อความจากลูกค้าหลังเวลาอ่านล่าสุดของผู้ใช้ (หรือยังไม่เคยอ่าน) */
export function isJobCustomerChatUnreadForStaff(job: Job, readsMap: Record<string, unknown> | undefined): boolean {
  const lastCust = job.customerChatLastCustomerMessageAt as unknown;
  const lastMs = timestampToMillis(lastCust);
  if (lastMs <= 0) return false;

  const readRaw = readsMap?.[job.id];
  const readMs = timestampToMillis(readRaw);
  if (readMs <= 0) return true;
  return readMs < lastMs;
}

export function subscribeJobCustomerChatReadsMap(
  db: Firestore,
  uid: string,
  onReads: (reads: Record<string, unknown>) => void
): () => void {
  const ref = jobCustomerChatReadsSummaryRef(db, uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onReads({});
        return;
      }
      const data = snap.data();
      const reads = data?.reads;
      onReads(typeof reads === "object" && reads !== null && !Array.isArray(reads) ? (reads as Record<string, unknown>) : {});
    },
    (err) => console.error("jobCustomerChatReads subscribe", err)
  );
}

export async function markJobCustomerChatRead(db: Firestore, uid: string, jobId: string): Promise<void> {
  const ref = jobCustomerChatReadsSummaryRef(db, uid);
  await setDoc(
    ref,
    {
      reads: { [jobId]: serverTimestamp() },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
