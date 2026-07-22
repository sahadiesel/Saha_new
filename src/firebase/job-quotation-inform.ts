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
