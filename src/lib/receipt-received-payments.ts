import type { Document } from "@/lib/types";

export type ReceiptPaymentLine = {
  method: "CASH" | "TRANSFER";
  accountId: string;
  amount: number;
  accountName?: string;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function formatMoney2(value: number): string {
  return round2(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function normalizePaymentLines(
  lines:
    | Array<{ accountId?: string; amount?: number; method?: string; accountName?: string }>
    | undefined
): ReceiptPaymentLine[] {
  return (lines || [])
    .filter((p) => p.accountId && round2(p.amount || 0) > 0.009)
    .map((p) => ({
      accountId: String(p.accountId),
      amount: round2(p.amount || 0),
      method: p.method === "CASH" ? "CASH" : "TRANSFER",
      accountName: p.accountName?.trim() || undefined,
    }));
}

export function sumPaymentLines(lines: Array<{ amount?: number }> | undefined): number {
  return round2((lines || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

function invoiceDefaultAmount(doc: Pick<Document, "paymentSummary" | "grandTotal">): number {
  const balance = doc.paymentSummary?.balance;
  if (typeof balance === "number" && balance > 0.009) return round2(balance);
  return round2(doc.grandTotal || 0);
}

/** รวมบัญชีที่ออฟฟิศระบุบนใบกำกับ/ใบส่งของที่เลือกออกใบเสร็จ */
export function mergeSuggestedPaymentsFromDocs(
  docs: Array<
    Pick<
      Document,
      "suggestedPayments" | "suggestedAccountId" | "suggestedPaymentMethod" | "paymentSummary" | "grandTotal"
    >
  >
): ReceiptPaymentLine[] {
  const byAccount = new Map<string, ReceiptPaymentLine>();
  for (const d of docs) {
    let lines = normalizePaymentLines(d.suggestedPayments);
    if (lines.length === 0 && d.suggestedAccountId) {
      lines = [
        {
          accountId: d.suggestedAccountId,
          amount: invoiceDefaultAmount(d),
          method: d.suggestedPaymentMethod === "CASH" ? "CASH" : "TRANSFER",
        },
      ];
    }
    for (const line of lines) {
      const prev = byAccount.get(line.accountId);
      if (prev) {
        prev.amount = round2(prev.amount + line.amount);
        if (!prev.accountName && line.accountName) prev.accountName = line.accountName;
      } else {
        byAccount.set(line.accountId, { ...line });
      }
    }
  }
  return Array.from(byAccount.values());
}

export function receiptPaymentsFromDocument(
  doc: Pick<Document, "receivedPayments" | "receivedAccountId" | "suggestedPayments" | "suggestedAccountId" | "suggestedPaymentMethod" | "paymentSummary" | "grandTotal" | "paymentMethod" | "paymentInstrument">
): ReceiptPaymentLine[] {
  const received = normalizePaymentLines(doc.receivedPayments);
  if (received.length > 0) return received;
  const suggested = mergeSuggestedPaymentsFromDocs([doc]);
  if (suggested.length > 0) return suggested;
  if (doc.receivedAccountId) {
    return [
      {
        accountId: doc.receivedAccountId,
        amount: invoiceDefaultAmount(doc),
        method:
          doc.paymentInstrument === "CASH" || doc.paymentMethod === "CASH" ? "CASH" : "TRANSFER",
      },
    ];
  }
  return [];
}

export function scalePaymentLinesToTotal(
  lines: ReceiptPaymentLine[],
  target: number
): ReceiptPaymentLine[] {
  const goal = round2(target);
  if (goal <= 0.009 || lines.length === 0) return lines;
  const current = sumPaymentLines(lines);
  if (current <= 0.009 || Math.abs(current - goal) <= 0.06) return lines;
  const scaled = lines.map((line) => ({
    ...line,
    amount: round2((line.amount / current) * goal),
  }));
  const drift = round2(goal - sumPaymentLines(scaled));
  if (Math.abs(drift) >= 0.01 && scaled.length > 0) {
    scaled[scaled.length - 1] = {
      ...scaled[scaled.length - 1],
      amount: round2(scaled[scaled.length - 1].amount + drift),
    };
  }
  return scaled;
}

export function formatReceiptPaymentLineLabel(
  line: ReceiptPaymentLine,
  accountName?: string
): string {
  const name = (line.accountName || accountName || "").trim();
  const amount = formatMoney2(line.amount);
  if (line.method === "CASH") return `เงินสด ${amount}`;
  return name ? `โอนเข้าบัญชี${name} ${amount}` : `โอน ${amount}`;
}

export function methodFromAccountType(type?: string): "CASH" | "TRANSFER" {
  return type === "CASH" ? "CASH" : "TRANSFER";
}

export function receiptCashbookLineId(receiptId: string, index: number): string {
  return index <= 0 ? `RECEIPT_${receiptId}` : `RECEIPT_${receiptId}_${index}`;
}

export function receiptReversalLineId(receiptId: string, index: number): string {
  return index <= 0 ? `RECEIPT_REV_${receiptId}` : `RECEIPT_REV_${receiptId}_${index}`;
}
