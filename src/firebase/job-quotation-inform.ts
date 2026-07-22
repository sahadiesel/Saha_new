import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

/** แจ้งราคา/เสนอราคาลูกค้าแล้ว — เปลี่ยนงานเป็นรอลูกค้าอนุมัติ */
export async function informCustomerOfJobQuotation(
  db: Firestore,
  params: {
    jobId: string;
    quotationDocId?: string;
    actorName: string;
    actorUid: string;
    activityText?: string;
  }
): Promise<void> {
  const { jobId, quotationDocId, actorName, actorUid, activityText } = params;
  const jobRef = doc(db, "jobs", jobId);

  if (quotationDocId) {
    await updateDoc(doc(db, "documents", quotationDocId), {
      status: "OFFERED",
      updatedAt: serverTimestamp(),
    });
  }

  await updateDoc(jobRef, {
    status: "WAITING_APPROVE",
    salesDocStatus: "OFFERED",
    quotationAwaitingOfficeResubmit: false,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(jobRef, "activities"), {
    text:
      activityText ??
      `ส่งเอกสาร/แจ้งลูกค้าแล้ว (โดย ${actorName}) — สถานะเป็นรอลูกค้าอนุมัติ`,
    userName: actorName,
    userId: actorUid,
    createdAt: serverTimestamp(),
  });
}

/** ลูกค้าไม่อนุมัติ — กลับไปแก้ไขใบเสนอราคา */
export async function reviseQuotationAfterCustomerReject(
  db: Firestore,
  params: {
    jobId: string;
    actorName: string;
    actorUid: string;
  }
): Promise<void> {
  const { jobId, actorName, actorUid } = params;
  const jobRef = doc(db, "jobs", jobId);
  await updateDoc(jobRef, {
    status: "WAITING_QUOTATION",
    quotationAwaitingOfficeResubmit: false,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await addDoc(collection(jobRef, "activities"), {
    text: `ลูกค้าไม่อนุมัติ — ส่งกลับรอเสนอราคาเพื่อแก้ไขใบเสนอราคา (โดย ${actorName})`,
    userName: actorName,
    userId: actorUid,
    createdAt: serverTimestamp(),
  });
}

/** ลูกค้าไม่อนุมัติ — ยกเลิกไม่ซ่อม ส่งไปรอทำบิล */
export async function cancelJobAfterCustomerReject(
  db: Firestore,
  params: {
    jobId: string;
    actorName: string;
    actorUid: string;
  }
): Promise<void> {
  const { jobId, actorName, actorUid } = params;
  const jobRef = doc(db, "jobs", jobId);
  await updateDoc(jobRef, {
    status: "DONE",
    quotationAwaitingOfficeResubmit: false,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await addDoc(collection(jobRef, "activities"), {
    text: `ลูกค้าไม่อนุมัติ / ยกเลิกงานไม่ซ่อม — ปรับสถานะเป็น "รอทำบิล" (DONE) (โดย ${actorName})`,
    userName: actorName,
    userId: actorUid,
    createdAt: serverTimestamp(),
  });
}
