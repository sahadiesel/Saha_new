import { parseISO } from "date-fns";
import type { AccountingAccount, AccountingEntry } from "@/lib/types";
import { normalizeGregorianDateOnlyString } from "@/lib/date-utils";

/** ปัดทศนิยม 2 ตำแหน่ง — ใช้ให้ตรงกันทุกที่ */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** แปลง entryDate ทุกรายการเป็น ค.ศ. ก่อนคำนวณ/เรียง (กันปี พ.ศ. ปนใน DB) */
export function normalizeAccountingEntriesForComputation<T extends AccountingEntry>(entries: T[]): T[] {
  return entries.map((e) => ({
    ...e,
    entryDate: normalizeGregorianDateOnlyString(e.entryDate),
  }));
}

/** เรียงรายการตามวันที่ entryDate แล้วตามเวลา createdAt (เดียวกับหน้ารายการบัญชี / เดินบัญชี) */
export function sortAccountingEntriesByDateAsc<T extends AccountingEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const dateA = parseISO(a.entryDate).getTime();
    const dateB = parseISO(b.entryDate).getTime();
    if (dateA !== dateB) return dateA - dateB;
    const timeA = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
    const timeB = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
    return timeA - timeB;
  });
}

/**
 * แยกเงินเข้า/ออกจาก amount — บังคับ Number() เพื่อกัน Firestore ส่งเป็นสตริงแล้วบวกผิด
 */
export function entryIncomeExpense(entry: AccountingEntry): { income: number; expense: number } {
  const amt = Number(entry.amount ?? 0);
  if (entry.entryType === "RECEIPT" || entry.entryType === "CASH_IN") {
    return { income: amt, expense: 0 };
  }
  if (entry.entryType === "CASH_OUT") {
    return { income: 0, expense: amt };
  }
  return { income: 0, expense: 0 };
}

/**
 * ยอดคงเหลือปัจจุบันของบัญชีเงินสด/ธนาคาร (ยอดยกมาหลัก + เฉพาะรายการวันที่ ≥ วันยกมา)
 * ต้องตรงกับคอลัมน์ "ยอดคงเหลือปัจจุบัน" ในหน้ารายการบัญชี
 */
export function computeCashAccountCurrentBalance(
  account: Pick<AccountingAccount, "openingBalance" | "openingBalanceDate">,
  accountEntries: AccountingEntry[]
): number {
  const openingBalanceDateStr = normalizeGregorianDateOnlyString(account.openingBalanceDate || "1970-01-01");
  const openingBalanceValue = Number(account.openingBalance ?? 0);
  const sorted = sortAccountingEntriesByDateAsc(normalizeAccountingEntriesForComputation(accountEntries));
  const postOpening = sorted.filter((e) => e.entryDate >= openingBalanceDateStr);
  let currentBalance = openingBalanceValue;
  for (const e of postOpening) {
    const { income, expense } = entryIncomeExpense(e);
    currentBalance = roundMoney(currentBalance + income - expense);
  }
  return currentBalance;
}
