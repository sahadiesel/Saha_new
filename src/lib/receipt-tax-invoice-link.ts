import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type { Document, AccountingObligation } from "@/lib/types";
import { isReceiptPaymentConfirmed } from "@/lib/reverse-confirmed-receipt";

export type TaxInvoiceReceiptUi = {
  key: string;
  label: string;
  description: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

/** ใบกำกับ/ใบเพิ่มหนี้มีใบเสร็จที่ยังไม่ยกเลิกผูกอยู่ */
export function sourceDocHasActiveReceiptLink(
  doc: Pick<Document, "receiptDocId" | "receiptStatus">,
  editingReceiptId?: string | null
): boolean {
  if (!doc.receiptDocId) return false;
  if (editingReceiptId && doc.receiptDocId === editingReceiptId) return false;
  return true;
}

/** ห้ามออกใบเสร็จใหม่จากเอกสารต้นทางนี้ */
export function sourceDocBlocksNewReceipt(
  doc: Pick<Document, "receiptDocId" | "receiptStatus">,
  editingReceiptId?: string | null
): boolean {
  return sourceDocHasActiveReceiptLink(doc, editingReceiptId);
}

export async function isReceiptLinkActive(
  db: Firestore,
  receiptDocId: string
): Promise<boolean> {
  const snap = await getDoc(doc(db, "documents", receiptDocId));
  if (!snap.exists()) return false;
  const r = snap.data() as Document;
  return r.docType === "RECEIPT" && r.status !== "CANCELLED";
}

export function receiptCashbookEntryId(receiptId: string): string {
  return `RECEIPT_${receiptId}`;
}

/** มีรายการ cashbook ของใบเสร็จนี้แล้วหรือไม่ */
export async function receiptHasCashbookEntry(
  db: Firestore,
  receipt: Pick<Document, "id" | "accountingEntryId">
): Promise<boolean> {
  if (receipt.accountingEntryId) {
    const byField = await getDoc(doc(db, "accountingEntries", receipt.accountingEntryId));
    if (byField.exists()) return true;
  }
  const canonical = await getDoc(doc(db, "accountingEntries", receiptCashbookEntryId(receipt.id)));
  return canonical.exists();
}

/** สถานะแสดงบนรายการใบกำกับ/ใบเพิ่มหนี้ — คำนึง receiptDocId/receiptStatus */
export function taxInvoiceReceiptDisplayMeta(
  doc: Pick<
    Document,
    "docType" | "status" | "receiptDocId" | "receiptDocNo" | "receiptStatus"
  >
): TaxInvoiceReceiptUi | null {
  if (doc.docType !== "TAX_INVOICE" && doc.docType !== "DEBIT_NOTE") return null;

  const statusKey = String(doc.status ?? "").toUpperCase();
  if (statusKey === "CANCELLED") return null;

  if (
    doc.receiptStatus === "CONFIRMED" ||
    statusKey === "PAID" ||
    (doc.receiptDocId && doc.receiptStatus === "CONFIRMED")
  ) {
    return {
      key: "PAID",
      label: "รับเงินแล้ว",
      description: doc.receiptDocNo
        ? `ยืนยันรับเงินตามใบเสร็จ ${doc.receiptDocNo} แล้ว`
        : "บันทึกรับเงินเข้าสมุดบัญชีเรียบร้อยแล้ว",
      variant: "default",
    };
  }

  if (doc.receiptDocId) {
    const no = doc.receiptDocNo?.trim();
    return {
      key: "RECEIPT_ISSUED",
      label: "ตรวจสอบการรับเงินจากใบเสร็จ",
      description: no
        ? `มีใบเสร็จ ${no} แล้ว — รอยืนยันรับเงินเข้าบัญชีจริง (ยังไม่บันทึก cashbook)`
        : "มีใบเสร็จแล้ว — รอยืนยันรับเงินเข้าบัญชีจริง (ยังไม่บันทึก cashbook)",
      variant: "secondary",
    };
  }

  return null;
}

export function receiptAwaitingPaymentConfirm(
  receipt: Pick<Document, "docType" | "status" | "receiptStatus" | "accountingEntryId">
): boolean {
  if (receipt.docType !== "RECEIPT" || receipt.status === "CANCELLED") return false;
  if (isReceiptPaymentConfirmed(receipt)) return false;
  if (receipt.accountingEntryId) return false;
  return (
    receipt.receiptStatus === "ISSUED_NOT_CONFIRMED" ||
    receipt.status === "ISSUED" ||
    !receipt.receiptStatus
  );
}

const SOURCE_RECEIPT_LINK = {
  receiptStatus: "ISSUED_NOT_CONFIRMED" as const,
};

function collectInvoiceIdsFromRefs(
  refs: Document[]
): string[] {
  const ids = new Set<string>();
  for (const ref of refs) {
    if (ref.docType === "TAX_INVOICE" || ref.docType === "DEBIT_NOTE") {
      ids.add(ref.id);
    }
    if (ref.docType === "BILLING_NOTE" && Array.isArray(ref.invoiceIds)) {
      for (const id of ref.invoiceIds) {
        if (id) ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

/**
 * ซ่อมใบเสร็จที่มีเงินใน cashbook แล้วแต่สถานะเอกสารค้าง
 * (เช่น ยืนยันแล้ว แต่แก้ใบเสร็จแล้วสถานะถูกรีเซ็ต / ลบลิงก์ใบกำกับ)
 */
export async function resyncConfirmedReceiptState(
  db: Firestore,
  receiptId: string
): Promise<{ fixed: boolean; reason: string }> {
  const receiptRef = doc(db, "documents", receiptId);
  const receiptSnap = await getDoc(receiptRef);
  if (!receiptSnap.exists()) {
    return { fixed: false, reason: "ไม่พบใบเสร็จ" };
  }

  const receipt = { id: receiptSnap.id, ...receiptSnap.data() } as Document;
  if (receipt.docType !== "RECEIPT" || receipt.status === "CANCELLED") {
    return { fixed: false, reason: "ไม่ใช่ใบเสร็จที่ใช้งานได้" };
  }

  const entryId = receipt.accountingEntryId || receiptCashbookEntryId(receipt.id);
  const entrySnap = await getDoc(doc(db, "accountingEntries", entryId));
  const hasCash =
    entrySnap.exists() ||
    (await receiptHasCashbookEntry(db, receipt)) ||
    isReceiptPaymentConfirmed(receipt);

  if (!hasCash) {
    // ยังไม่เคยเข้าบัญชี — แค่ผูกใบกำกับเป็นรอตรวจสอบรับเงิน
    const batch = writeBatch(db);
    let ops = 0;
    for (const refId of receipt.referencesDocIds || []) {
      const refSnap = await getDoc(doc(db, "documents", refId));
      if (!refSnap.exists()) continue;
      const refData = refSnap.data() as Document;
      if (
        refData.receiptDocId !== receipt.id ||
        refData.receiptDocNo !== receipt.docNo ||
        refData.receiptStatus !== "ISSUED_NOT_CONFIRMED"
      ) {
        batch.update(refSnap.ref, {
          receiptDocId: receipt.id,
          receiptDocNo: receipt.docNo,
          receiptStatus: SOURCE_RECEIPT_LINK.receiptStatus,
          updatedAt: serverTimestamp(),
        });
        ops++;
      }
    }
    if (ops > 0) await batch.commit();
    return {
      fixed: ops > 0,
      reason:
        ops > 0
          ? "ผูกใบกำกับเป็นตรวจสอบการรับเงินจากใบเสร็จแล้ว"
          : "ยังไม่มีรายการในบัญชี และลิงก์ใบกำกับครบแล้ว",
    };
  }

  const resolvedEntryId = entrySnap.exists()
    ? entryId
    : receipt.accountingEntryId || receiptCashbookEntryId(receipt.id);
  const entryData = entrySnap.exists()
    ? (entrySnap.data() as {
        amount?: number;
        accountId?: string;
        entryDate?: string;
        paymentMethod?: string;
      })
    : null;

  const batch = writeBatch(db);
  batch.update(receiptRef, {
    status: "CONFIRMED",
    receiptStatus: "CONFIRMED",
    accountingEntryId: resolvedEntryId,
    ...(entryData
      ? {
          confirmedPayment: {
            accountId: entryData.accountId || receipt.receivedAccountId || "",
            method: entryData.paymentMethod || receipt.paymentMethod || "TRANSFER",
            receivedDate: entryData.entryDate || receipt.paymentDate || receipt.docDate,
            netReceivedTotal: entryData.amount ?? receipt.grandTotal ?? 0,
            withholdingTotal: receipt.confirmedPayment?.withholdingTotal ?? 0,
            arPaymentId: receipt.confirmedPayment?.arPaymentId ?? `ARPAY_${receipt.id}`,
          },
        }
      : {}),
    updatedAt: serverTimestamp(),
  });

  const refDocs: Document[] = [];
  for (const refId of receipt.referencesDocIds || []) {
    const refSnap = await getDoc(doc(db, "documents", refId));
    if (!refSnap.exists()) continue;
    const refData = { id: refSnap.id, ...refSnap.data() } as Document;
    refDocs.push(refData);
    batch.update(refSnap.ref, {
      receiptDocId: receipt.id,
      receiptDocNo: receipt.docNo,
      receiptStatus: "CONFIRMED",
      ...(refData.docType === "TAX_INVOICE" || refData.docType === "DEBIT_NOTE" || refData.docType === "BILLING_NOTE"
        ? { status: "PAID", arStatus: "PAID" }
        : {}),
      updatedAt: serverTimestamp(),
    });
  }

  const invoiceIds = collectInvoiceIdsFromRefs(refDocs);
  for (const invoiceId of invoiceIds) {
    if (refDocs.some((r) => r.id === invoiceId)) {
      // already updated above if it was a direct ref
    } else {
      const invRef = doc(db, "documents", invoiceId);
      const invSnap = await getDoc(invRef);
      if (invSnap.exists()) {
        batch.update(invRef, {
          status: "PAID",
          arStatus: "PAID",
          receiptDocId: receipt.id,
          receiptDocNo: receipt.docNo,
          receiptStatus: "CONFIRMED",
          updatedAt: serverTimestamp(),
        });
      }
    }

    const obRef = doc(db, "accountingObligations", `AR_${invoiceId}`);
    const obSnap = await getDoc(obRef);
    if (obSnap.exists()) {
      const ob = obSnap.data() as AccountingObligation;
      const total = typeof ob.amountTotal === "number" ? ob.amountTotal : 0;
      batch.update(obRef, {
        status: "PAID",
        amountPaid: total,
        balance: 0,
        paidOffDate: entryData?.entryDate || receipt.paymentDate || receipt.docDate,
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch.commit();
  return {
    fixed: true,
    reason: `ซ่อมสถานะใบเสร็จ ${receipt.docNo} และใบกำกับที่เกี่ยวข้องเป็น「รับเงินแล้ว」`,
  };
}

/** ซิงก์ใบกำกับกับใบเสร็จที่ยังไม่ยกเลิก + แก้ receipt ที่มี cashbook แต่สถานะค้าง */
export async function repairActiveReceiptTaxInvoiceLinks(
  db: Firestore
): Promise<number> {
  let fixed = 0;
  const receiptSnap = await getDocs(
    query(collection(db, "documents"), where("docType", "==", "RECEIPT"), limit(400))
  );

  for (const rDoc of receiptSnap.docs) {
    const receipt = { id: rDoc.id, ...rDoc.data() } as Document;
    if (receipt.status === "CANCELLED") continue;

    const hasCash = await receiptHasCashbookEntry(db, receipt);
    const confirmed = isReceiptPaymentConfirmed(receipt) || hasCash;

    if (confirmed) {
      const result = await resyncConfirmedReceiptState(db, receipt.id);
      if (result.fixed) fixed += 1;
      continue;
    }

    const refIds = receipt.referencesDocIds || [];
    if (!refIds.length) continue;

    const batch = writeBatch(db);
    let batchOps = 0;

    for (const refId of refIds) {
      const refSnap = await getDoc(doc(db, "documents", refId));
      if (!refSnap.exists()) continue;
      const refData = refSnap.data() as Document;

      const needsLink =
        refData.receiptDocId !== receipt.id ||
        refData.receiptDocNo !== receipt.docNo ||
        refData.receiptStatus !== "ISSUED_NOT_CONFIRMED";

      if (needsLink) {
        batch.update(refSnap.ref, {
          receiptDocId: receipt.id,
          receiptDocNo: receipt.docNo,
          receiptStatus: SOURCE_RECEIPT_LINK.receiptStatus,
          updatedAt: serverTimestamp(),
        });
        batchOps++;
      }
    }

    if (batchOps > 0) {
      await batch.commit();
      fixed += batchOps;
    }
  }

  return fixed;
}
