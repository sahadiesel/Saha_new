import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  deleteField,
  type Firestore,
  type DocumentSnapshot,
} from "firebase/firestore";
import { format } from "date-fns";
import type { Document, AccountingObligation } from "@/lib/types";
import { sanitizeForFirestore } from "@/lib/utils";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";

type ReceiptActor = { uid: string; displayName: string };

type ArAllocation = {
  invoiceId: string;
  invoiceDocNo?: string;
  grossApplied?: number;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ใบเสร็จที่ยืนยันรับเงินเข้าบัญชีแล้ว (มีรายการใน cashbook) */
export function isReceiptPaymentConfirmed(receipt: Document): boolean {
  if (receipt.docType !== "RECEIPT") return false;
  if (receipt.status === "CANCELLED") return false;
  return (
    receipt.receiptStatus === "CONFIRMED" ||
    receipt.status === "CONFIRMED" ||
    Boolean(receipt.accountingEntryId) ||
    Boolean(receipt.confirmedPayment?.arPaymentId)
  );
}

/**
 * ยกเลิกใบเสร็จที่ confirm แล้ว:
 * - เก็บใบเสร็จ + รายการรับเดิม + arPayment ไว้
 * - สร้างรายการ CASH_OUT ตัดรายรับใน cashbook
 * - คืน AR / ใบกำกับเป็นรอออกใบเสร็จใหม่
 */
export async function reverseConfirmedReceipt(
  db: Firestore,
  receipt: Document,
  profile: ReceiptActor
): Promise<void> {
  const arPaymentId = receipt.confirmedPayment?.arPaymentId ?? `ARPAY_${receipt.id}`;
  const reversalEntryId = `RECEIPT_REV_${receipt.id}`;
  const noteLine = `\n[System] ยกเลิกหลังยืนยันรับเงิน ${safeFormat(new Date(), APP_DATE_FORMAT + " HH:mm")} โดย ${profile.displayName}`;

  await runTransaction(db, async (transaction) => {
    const receiptRef = doc(db, "documents", receipt.id);
    const reversalRef = doc(db, "accountingEntries", reversalEntryId);
    const arPaymentRef = doc(db, "arPayments", arPaymentId);

    const receiptSnap = await transaction.get(receiptRef);
    const reversalSnap = await transaction.get(reversalRef);
    const arPaymentSnap = await transaction.get(arPaymentRef);

    if (!receiptSnap.exists()) throw new Error("ไม่พบใบเสร็จในระบบ");

    const rData = { id: receiptSnap.id, ...receiptSnap.data() } as Document;
    if (rData.status === "CANCELLED") throw new Error("ใบเสร็จนี้ถูกยกเลิกแล้ว");
    if (rData.reversalEntryId) throw new Error("ใบเสร็จนี้ถูกตัดรายรับไปแล้ว");
    if (!isReceiptPaymentConfirmed(rData)) {
      throw new Error("ใบเสร็จนี้ยังไม่ได้ยืนยันรับเงิน — ใช้การยกเลิกแบบปกติ");
    }
    if (reversalSnap.exists()) throw new Error("มีรายการตัดรายรับสำหรับใบเสร็จนี้แล้ว");

    const confirmed = rData.confirmedPayment;
    const netAmount = confirmed?.netReceivedTotal ?? rData.grandTotal ?? 0;
    const accountId = confirmed?.accountId ?? rData.receivedAccountId;
    if (!accountId || netAmount <= 0) {
      throw new Error("ไม่พบข้อมูลบัญชี/ยอดรับเงิน — ไม่สามารถตัดรายรับได้");
    }

    const allocations: ArAllocation[] = arPaymentSnap.exists()
      ? ((arPaymentSnap.data() as { allocations?: ArAllocation[] }).allocations ?? [])
      : [];

    const refIds = rData.referencesDocIds || [];
    const invoiceIds = allocations.map((a) => a.invoiceId).filter(Boolean);
    const allDocIds = Array.from(new Set([...refIds, ...invoiceIds]));

    const relatedSnaps = new Map<string, DocumentSnapshot>();
    for (const id of allDocIds) {
      relatedSnaps.set(id, await transaction.get(doc(db, "documents", id)));
    }

    const obSnaps = new Map<string, DocumentSnapshot>();
    for (const invoiceId of invoiceIds) {
      obSnaps.set(invoiceId, await transaction.get(doc(db, "accountingObligations", `AR_${invoiceId}`)));
    }

    const jobIdsToCheck = new Set<string>();
    for (const invoiceId of invoiceIds) {
      const obSnap = obSnaps.get(invoiceId);
      if (obSnap?.exists()) {
        const jobId = (obSnap.data() as AccountingObligation).jobId;
        if (jobId) jobIdsToCheck.add(jobId);
      }
    }
    const jobSnaps = new Map<string, DocumentSnapshot>();
    for (const jobId of jobIdsToCheck) {
      jobSnaps.set(jobId, await transaction.get(doc(db, "jobs", jobId)));
    }

    const customerName =
      rData.customerSnapshot?.taxName || rData.customerSnapshot?.name || "ลูกค้าทั่วไป";
    const receiptDocNo = rData.docNo || receipt.id;
    const payMethod = confirmed?.method === "CASH" ? "CASH" : "TRANSFER";

    transaction.set(
      reversalRef,
      sanitizeForFirestore({
        entryType: "CASH_OUT",
        entryDate: format(new Date(), "yyyy-MM-dd"),
        amount: netAmount,
        accountId,
        paymentMethod: payMethod,
        categoryMain: "เก็บเงินลูกหนี้",
        categorySub: "ตัดรายรับ (ยกเลิกใบเสร็จ)",
        description: `ตัดรายรับจากใบเสร็จ ${receiptDocNo} (${customerName}) — ยืนยันรับเงินผิดพลาด`,
        sourceDocType: "RECEIPT",
        sourceDocId: receipt.id,
        sourceDocNo: receiptDocNo,
        customerNameSnapshot: customerName,
        createdAt: serverTimestamp(),
      })
    );

    if (arPaymentSnap.exists()) {
      transaction.update(arPaymentRef, {
        reversedAt: serverTimestamp(),
        reversedByName: profile.displayName,
        reversedByUid: profile.uid,
        reversalEntryId,
      });
    }

    const reversedInvoiceIds = new Set<string>();

    for (const alloc of allocations) {
      const invoiceId = alloc.invoiceId;
      const gross = Number(alloc.grossApplied ?? 0);
      if (!invoiceId || gross <= 0) continue;
      reversedInvoiceIds.add(invoiceId);

      const obSnap = obSnaps.get(invoiceId);
      const invSnap = relatedSnaps.get(invoiceId);
      if (!invSnap?.exists()) continue;

      let newAmountPaid = 0;
      let newBalance = 0;
      let payStatus: "UNPAID" | "PARTIAL" | "PAID" = "UNPAID";
      let jobId: string | undefined;

      if (obSnap?.exists()) {
        const ob = obSnap.data() as AccountingObligation;
        jobId = ob.jobId;
        const total = typeof ob.amountTotal === "number" ? ob.amountTotal : 0;
        newAmountPaid = Math.max(0, roundMoney((ob.amountPaid || 0) - gross));
        newBalance = Math.max(0, roundMoney(total - newAmountPaid));
        payStatus = newBalance <= 0.05 ? "PAID" : newAmountPaid > 0 ? "PARTIAL" : "UNPAID";

        transaction.update(obSnap.ref, {
          amountPaid: newAmountPaid,
          balance: newBalance,
          status: payStatus,
          ...(payStatus === "UNPAID"
            ? { lastPaymentDate: deleteField(), paidOffDate: deleteField() }
            : {}),
          updatedAt: serverTimestamp(),
        });
      } else {
        newBalance = (invSnap.data() as Document).grandTotal ?? 0;
      }

      transaction.update(invSnap.ref, {
        status: payStatus === "UNPAID" ? "APPROVED" : payStatus,
        arStatus: payStatus,
        paymentSummary: {
          paidTotal: newAmountPaid,
          balance: newBalance,
          paymentStatus: payStatus,
        },
        receiptStatus: deleteField(),
        receiptDocId: deleteField(),
        receiptDocNo: deleteField(),
        accountingEntryId: deleteField(),
        receivedAccountId: deleteField(),
        updatedAt: serverTimestamp(),
      });

      if (payStatus === "UNPAID" && jobId) {
        const jobSnap = jobSnaps.get(jobId);
        if (jobSnap?.exists() && jobSnap.data()?.status === "CLOSED") {
          transaction.update(jobSnap.ref, {
            status: "DONE",
            updatedAt: serverTimestamp(),
            lastActivityAt: serverTimestamp(),
          });
          transaction.set(doc(collection(jobSnap.ref, "activities")), {
            text: `[System] ยกเลิกใบเสร็จ ${receiptDocNo} — คืนสถานะงานเป็น "ทำเสร็จ" (รอออกใบเสร็จ/รับเงินใหม่)`,
            userName: profile.displayName,
            userId: profile.uid,
            createdAt: serverTimestamp(),
          });
        }
      }
    }

    for (const refId of refIds) {
      const refSnap = relatedSnaps.get(refId);
      if (!refSnap?.exists()) continue;
      const refData = refSnap.data() as Document;

      const updates: Record<string, unknown> = {
        receiptStatus: deleteField(),
        receiptDocId: deleteField(),
        receiptDocNo: deleteField(),
        accountingEntryId: deleteField(),
        receivedAccountId: deleteField(),
        updatedAt: serverTimestamp(),
      };

      if (refData.docType === "BILLING_NOTE" && refData.status === "PAID") {
        updates.status = "APPROVED";
      }

      if (
        (refData.docType === "TAX_INVOICE" || refData.docType === "DEBIT_NOTE") &&
        !reversedInvoiceIds.has(refId) &&
        refData.status === "PAID"
      ) {
        const total = refData.grandTotal ?? 0;
        updates.status = "APPROVED";
        updates.arStatus = "UNPAID";
        updates.paymentSummary = {
          paidTotal: 0,
          balance: total,
          paymentStatus: "UNPAID",
        };
      }

      transaction.update(refSnap.ref, updates);
    }

    transaction.update(
      receiptRef,
      sanitizeForFirestore({
        status: "CANCELLED",
        reversalEntryId,
        cancelledAt: serverTimestamp(),
        cancelledByName: profile.displayName,
        cancelledByUid: profile.uid,
        notes: (rData.notes || "") + noteLine,
        updatedAt: serverTimestamp(),
      })
    );
  });
}

/** ยกเลิกใบเสร็จที่ยังไม่ confirm — ไม่กระทบ cashbook */
export async function cancelUnconfirmedReceipt(
  db: Firestore,
  receipt: Document,
  profile: ReceiptActor
): Promise<void> {
  const noteLine = `\n[System] ยกเลิกเมื่อ ${safeFormat(new Date(), APP_DATE_FORMAT + " HH:mm")} โดย ${profile.displayName}`;

  await runTransaction(db, async (transaction) => {
    const receiptRef = doc(db, "documents", receipt.id);
    const receiptSnap = await transaction.get(receiptRef);
    if (!receiptSnap.exists()) throw new Error("ไม่พบใบเสร็จในระบบ");
    const rData = receiptSnap.data() as Document;
    if (rData.status === "CANCELLED") throw new Error("ใบเสร็จนี้ถูกยกเลิกแล้ว");
    if (isReceiptPaymentConfirmed({ ...rData, id: receipt.id })) {
      throw new Error("ใบเสร็จนี้ยืนยันรับเงินแล้ว — ใช้การยกเลิกแบบตัดรายรับ");
    }

    const refIds = rData.referencesDocIds || [];
    for (const refId of refIds) {
      await transaction.get(doc(db, "documents", refId));
    }

    transaction.update(receiptRef, {
      status: "CANCELLED",
      updatedAt: serverTimestamp(),
      notes: (rData.notes || "") + noteLine,
    });

    for (const refId of refIds) {
      transaction.update(doc(db, "documents", refId), {
        receiptStatus: deleteField(),
        receiptDocId: deleteField(),
        receiptDocNo: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}
