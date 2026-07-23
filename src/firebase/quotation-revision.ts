import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { Document, UserProfile } from "@/lib/types";
import { sanitizeForFirestore } from "@/lib/utils";
import { createDocument } from "@/firebase/documents";
import {
  formatQuotationRevisionDocNo,
  getQuotationRevisionNo,
  parseQuotationBaseDocNo,
} from "@/lib/quotation-revision";

type QuotationRevisionData = Omit<
  Document,
  "id" | "docNo" | "docType" | "createdAt" | "updatedAt" | "status"
>;

/** สร้างใบเสนอราคาฉบับแก้ไขใหม่ (R1, R2, …) โดยเก็บฉบับเดิมไว้ค้นหาได้ */
export async function createQuotationRevision(
  db: Firestore,
  sourceDocId: string,
  sourceDoc: Document,
  data: QuotationRevisionData,
  userProfile: UserProfile
): Promise<{ docId: string; docNo: string; revisionNo: number }> {
  const { baseDocNo } = parseQuotationBaseDocNo(sourceDoc.docNo);
  const rootDocId = sourceDoc.quotationRootDocId || sourceDocId;
  const rootDocNo = sourceDoc.quotationRootDocNo || baseDocNo;

  let nextRevisionNo = getQuotationRevisionNo(sourceDoc) + 1;

  if (sourceDoc.jobId) {
    const chainSnap = await getDocs(
      query(
        collection(db, "documents"),
        where("jobId", "==", sourceDoc.jobId),
        where("docType", "==", "QUOTATION"),
        limit(50)
      )
    );
    for (const d of chainSnap.docs) {
      const rev = getQuotationRevisionNo(d.data() as Document);
      if (rev >= nextRevisionNo) nextRevisionNo = rev + 1;
    }
  }

  const newDocNo = formatQuotationRevisionDocNo(rootDocNo, nextRevisionNo);
  const newStatus =
    sourceDoc.status === "OFFERED" || sourceDoc.status === "DRAFT"
      ? "FINAL"
      : sourceDoc.status;

  const { docId, docNo } = await createDocument(db, "QUOTATION", data, userProfile, undefined, {
    manualDocNo: newDocNo,
    initialStatus: newStatus,
    skipJobAttachment: true,
  });

  await updateDoc(
    doc(db, "documents", docId),
    sanitizeForFirestore({
      quotationRootDocId: rootDocId,
      quotationRootDocNo: rootDocNo,
      quotationRevisionNo: nextRevisionNo,
      revisedFromDocId: sourceDocId,
      updatedAt: serverTimestamp(),
    })
  );

  await updateDoc(
    doc(db, "documents", sourceDocId),
    sanitizeForFirestore({
      supersededByDocId: docId,
      updatedAt: serverTimestamp(),
    })
  );

  if (sourceDoc.jobId) {
    const jobRef = doc(db, "jobs", sourceDoc.jobId);
    const jobSnap = await getDoc(jobRef);
    if (jobSnap.exists()) {
      const batch = writeBatch(db);
      batch.update(
        jobRef,
        sanitizeForFirestore({
          salesDocId: docId,
          salesDocNo: docNo,
          salesDocType: "QUOTATION",
          salesDocStatus: newStatus,
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      batch.set(doc(collection(jobRef, "activities")), {
        text: `แก้ไขใบเสนอราคาเป็น ${docNo} (ฉบับแก้ไขครั้งที่ ${nextRevisionNo})`,
        userName: userProfile.displayName,
        userId: userProfile.uid,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }
  }

  return { docId, docNo, revisionNo: nextRevisionNo };
}
