import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { format } from "date-fns";
import type { Document } from "@/lib/types";
import { sanitizeForFirestore } from "@/lib/utils";

type TransferActor = { uid: string; displayName: string };

/**
 * ย้ายรายรับใบเสร็จจากบัญชีเดิมไปบัญชีใหม่ใน cashbook
 * — ตัดออกจากบัญชีเดิม + รับเข้าบัญชีใหม่ พร้อมคำอธิบายตรวจสอบได้
 */
export async function transferConfirmedReceiptAccount(
  db: Firestore,
  receipt: Document,
  newAccountId: string,
  profile: TransferActor
): Promise<{ transferred: boolean; amount: number }> {
  const oldAccountId =
    receipt.confirmedPayment?.accountId || receipt.receivedAccountId || "";
  if (!oldAccountId || !newAccountId || oldAccountId === newAccountId) {
    return { transferred: false, amount: 0 };
  }

  let amount =
    receipt.confirmedPayment?.netReceivedTotal ??
    receipt.grandTotal ??
    0;

  const entryId = receipt.accountingEntryId || `RECEIPT_${receipt.id}`;
  const entrySnap = await getDoc(doc(db, "accountingEntries", entryId));
  if (entrySnap.exists()) {
    const entryAmount = Number(entrySnap.data()?.amount);
    if (Number.isFinite(entryAmount) && entryAmount > 0) {
      amount = entryAmount;
    }
  }

  amount = Math.round(amount * 100) / 100;
  if (amount < 0.01) {
    throw new Error("ไม่พบยอดเงินที่ต้องย้ายบัญชี");
  }

  const receiptDocNo = receipt.docNo || receipt.id;
  const customerName =
    receipt.customerSnapshot?.taxName ||
    receipt.customerSnapshot?.name ||
    "ลูกค้าทั่วไป";
  const entryDate = format(new Date(), "yyyy-MM-dd");
  const payMethod =
    receipt.confirmedPayment?.method === "CASH" || receipt.paymentMethod === "CASH"
      ? "CASH"
      : "TRANSFER";
  const stamp = Date.now();

  const batch = writeBatch(db);
  const outRef = doc(db, "accountingEntries", `RECEIPT_MOVE_OUT_${receipt.id}_${stamp}`);
  const inRef = doc(db, "accountingEntries", `RECEIPT_MOVE_IN_${receipt.id}_${stamp}`);

  batch.set(
    outRef,
    sanitizeForFirestore({
      entryType: "CASH_OUT",
      entryDate,
      amount,
      accountId: oldAccountId,
      paymentMethod: payMethod,
      categoryMain: "เก็บเงินลูกหนี้",
      categorySub: "ย้ายบัญชีใบเสร็จ",
      description: `ย้ายเงินออกจากการเปลี่ยนแปลงใบเสร็จ: ${receiptDocNo} (${customerName})`,
      sourceDocType: "RECEIPT",
      sourceDocId: receipt.id,
      sourceDocNo: receiptDocNo,
      customerNameSnapshot: customerName,
      createdByUid: profile.uid,
      createdByName: profile.displayName,
      createdAt: serverTimestamp(),
    })
  );

  batch.set(
    inRef,
    sanitizeForFirestore({
      entryType: "CASH_IN",
      entryDate,
      amount,
      accountId: newAccountId,
      paymentMethod: payMethod,
      categoryMain: "เก็บเงินลูกหนี้",
      categorySub: "ย้ายบัญชีใบเสร็จ",
      description: `ย้ายเงินเข้าจากการเปลี่ยนแปลงใบเสร็จ: ${receiptDocNo} (${customerName})`,
      sourceDocType: "RECEIPT",
      sourceDocId: receipt.id,
      sourceDocNo: receiptDocNo,
      customerNameSnapshot: customerName,
      createdByUid: profile.uid,
      createdByName: profile.displayName,
      createdAt: serverTimestamp(),
    })
  );

  const receiptRef = doc(db, "documents", receipt.id);
  batch.update(
    receiptRef,
    sanitizeForFirestore({
      receivedAccountId: newAccountId,
      confirmedPayment: {
        ...(receipt.confirmedPayment || {}),
        accountId: newAccountId,
        method: payMethod,
        receivedDate:
          receipt.confirmedPayment?.receivedDate ||
          receipt.paymentDate ||
          receipt.docDate ||
          entryDate,
        netReceivedTotal: amount,
        withholdingTotal: receipt.confirmedPayment?.withholdingTotal ?? 0,
        arPaymentId: receipt.confirmedPayment?.arPaymentId ?? `ARPAY_${receipt.id}`,
      },
      accountTransferHistory: [
        ...((receipt as Document & { accountTransferHistory?: unknown[] }).accountTransferHistory ||
          []),
        {
          fromAccountId: oldAccountId,
          toAccountId: newAccountId,
          amount,
          at: entryDate,
          byUid: profile.uid,
          byName: profile.displayName,
          outEntryId: outRef.id,
          inEntryId: inRef.id,
        },
      ],
      updatedAt: serverTimestamp(),
    })
  );

  await batch.commit();
  return { transferred: true, amount };
}
