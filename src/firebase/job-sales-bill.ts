import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { Document, Job, UserProfile } from "@/lib/types";
import {
  documentMatchesJobCustomer,
  isSalesBillDocType,
  jobHasSalesBillFields,
} from "@/lib/job-sales-bill";

function actorName(profile?: Pick<UserProfile, "displayName" | "uid"> | null) {
  return profile?.displayName?.trim() || "System";
}

function actorUid(profile?: Pick<UserProfile, "displayName" | "uid"> | null) {
  return profile?.uid || "system";
}

export function clearJobSalesBillFieldsInBatch(
  batch: ReturnType<typeof writeBatch>,
  jobRef: ReturnType<typeof doc>,
  opts?: { setStatusDone?: boolean }
) {
  batch.update(jobRef, {
    ...(opts?.setStatusDone ? { status: "DONE" } : {}),
    salesDocId: deleteField(),
    salesDocNo: deleteField(),
    salesDocType: deleteField(),
    salesDocStatus: deleteField(),
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** ล้างลิงก์บิลบนงานเดิมเมื่อเอกสารถูกย้ายไปงานอื่น */
export async function unlinkPreviousJobIfBillMoved(
  db: Firestore,
  opts: {
    batch: ReturnType<typeof writeBatch>;
    documentId: string;
    previousJobId?: string | null;
    nextJobId?: string | null;
    profile?: Pick<UserProfile, "displayName" | "uid"> | null;
  }
) {
  const prev = String(opts.previousJobId || "").trim();
  const next = String(opts.nextJobId || "").trim();
  if (!prev || prev === next) return;
  const jobRef = doc(db, "jobs", prev);
  const snap = await getDoc(jobRef);
  if (!snap.exists()) return;
  if (String(snap.data().salesDocId || "") !== opts.documentId) return;
  const status = String(snap.data().status || "").toUpperCase();
  clearJobSalesBillFieldsInBatch(opts.batch, jobRef, {
    setStatusDone: status === "WAITING_CUSTOMER_PICKUP" || status === "DONE",
  });
  opts.batch.set(doc(collection(jobRef, "activities")), {
    text: `[System] ล้างลิงก์บิลที่ถูกย้ายไปงานอื่นแล้ว — งานนี้สามารถออกบิลใหม่ได้`,
    userName: actorName(opts.profile),
    userId: actorUid(opts.profile),
    createdAt: serverTimestamp(),
  });
}

/**
 * ถ้า salesDocId ชี้บิลที่ยกเลิก / ไม่มี / คนละงาน / คนละลูกค้า — ล้างลิงก์
 * คืน true เมื่อมีการแก้ข้อมูล
 */
export async function healStaleJobSalesBillLink(
  db: Firestore,
  job: Job,
  profile?: Pick<UserProfile, "displayName" | "uid"> | null
): Promise<boolean> {
  if (!job?.id || job.isArchived || !jobHasSalesBillFields(job)) return false;
  const salesId = String(job.salesDocId || "").trim();
  if (!salesId) return false;

  const jobRef = doc(db, "jobs", job.id);
  const salesRef = doc(db, "documents", salesId);
  const salesSnap = await getDoc(salesRef);

  let stale = false;
  let reason = "";
  if (!salesSnap.exists()) {
    stale = true;
    reason = "ไม่พบเอกสารบิลที่ผูกไว้";
  } else {
    const data = { id: salesSnap.id, ...salesSnap.data() } as Document;
    if (!isSalesBillDocType(data.docType)) return false;
    if (String(data.status ?? "").toUpperCase() === "CANCELLED") {
      stale = true;
      reason = `บิล ${data.docNo} ถูกยกเลิกแล้ว`;
    } else if (data.jobId && data.jobId !== job.id) {
      stale = true;
      reason = `บิล ${data.docNo} ถูกย้ายไปงานอื่นแล้ว`;
    } else if (!documentMatchesJobCustomer(data, job)) {
      stale = true;
      reason = `บิล ${data.docNo} เป็นของลูกค้าอื่น`;
    }
  }

  if (!stale) return false;

  const status = String(job.status || "").toUpperCase();
  const batch = writeBatch(db);
  clearJobSalesBillFieldsInBatch(batch, jobRef, {
    setStatusDone: status === "WAITING_CUSTOMER_PICKUP",
  });
  batch.set(doc(collection(jobRef, "activities")), {
    text: `[System] ล้างลิงก์บิลค้าง (${reason}) — สามารถออกบิลให้งานนี้ได้`,
    userName: actorName(profile),
    userId: actorUid(profile),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return true;
}
