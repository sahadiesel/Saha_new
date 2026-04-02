import { addDays, format, isValid, parseISO, startOfDay } from "date-fns";
import { normalizeGregorianDateOnlyString } from "@/lib/date-utils";

/** วันที่รายการเดินบัญชีตั้งแต่ปีนี้เป็นต้นไป (รับย้อนหลังได้มาก) */
export const ACCOUNTING_ENTRY_DATE_MIN = "1990-01-01";

/**
 * วันที่ตัดเงินเข้า–ออกบัญชีห้ามล่วงหน้าเกินนี้จากวันนี้ (กันพิมพ์ปี/วันที่ผิดเช่น ค.ศ. จาก พ.ศ. สลับ)
 * ~2 เดือน พอสำหรับจองล่วงหน้าเล็กน้อย
 */
export const ACCOUNTING_ENTRY_MAX_LEAD_DAYS = 62;

/** วันครบกำหนดเช็คอนุญาตล่วงหน้าได้นานกว่า */
export const CHECK_DUE_DATE_MAX_LEAD_DAYS = 800;

export type EntryDateValidation = { ok: true; normalized: string } | { ok: false; message: string };

/** ใช้ตอนสร้าง/แก้รายการเดินบัญชีทั่วไป */
export function validateAccountingEntryDate(input: string): EntryDateValidation {
  const normalized = normalizeGregorianDateOnlyString(String(input || "").trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { ok: false, message: "รูปแบบวันที่ไม่ถูกต้อง ใช้ ค.ศ. แบบ yyyy-mm-dd" };
  }
  const d = parseISO(normalized);
  if (!isValid(d)) {
    return { ok: false, message: "วันที่ไม่มีในปฏิทิน" };
  }
  if (normalized < ACCOUNTING_ENTRY_DATE_MIN) {
    return { ok: false, message: `วันที่ต้องไม่ก่อน ${ACCOUNTING_ENTRY_DATE_MIN}` };
  }
  const today = startOfDay(new Date());
  const maxDay = addDays(today, ACCOUNTING_ENTRY_MAX_LEAD_DAYS);
  const maxStr = format(maxDay, "yyyy-MM-dd");
  if (normalized > maxStr) {
    return {
      ok: false,
      message: `วันที่ทำรายการในบัญชีห้ามเกิน ${maxStr} (ล่วงหน้าได้ไม่เกิน ${ACCOUNTING_ENTRY_MAX_LEAD_DAYS} วัน) — ตรวจว่าไม่ได้ใส่ปี พ.ศ. แทน ค.ศ.`,
    };
  }
  return { ok: true, normalized };
}

/** Admin แก้ entryDate — อนุญาตย้อนหลัง/ข้ามปีได้ แต่กันอนาคตไกลเกินจริง (พิมพ์ปีผิด) */
export function validateAccountingEntryDateAdminCorrection(input: string): EntryDateValidation {
  const normalized = normalizeGregorianDateOnlyString(String(input || "").trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { ok: false, message: "รูปแบบวันที่ไม่ถูกต้อง ใช้ yyyy-mm-dd (ค.ศ.)" };
  }
  const d = parseISO(normalized);
  if (!isValid(d)) {
    return { ok: false, message: "วันที่ไม่มีในปฏิทิน" };
  }
  if (normalized < ACCOUNTING_ENTRY_DATE_MIN) {
    return { ok: false, message: `วันที่ต้องไม่ก่อน ${ACCOUNTING_ENTRY_DATE_MIN}` };
  }
  const farCap = format(addDays(startOfDay(new Date()), 365 * 15), "yyyy-MM-dd");
  if (normalized > farCap) {
    return { ok: false, message: `วันที่ไกลเกินไปในอนาคต (เกิน ~15 ปี) — ตรวจรูปแบบปี ค.ศ.` };
  }
  return { ok: true, normalized };
}

/** วันครบกำหนดเช็ค (อนุญาตล่วงหน้าได้มากกว่าวันตัดบัญชี) */
export function validateCheckDueDate(input: string): EntryDateValidation {
  const normalized = normalizeGregorianDateOnlyString(String(input || "").trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { ok: false, message: "รูปแบบวันที่ครบกำหนดเช็คไม่ถูกต้อง" };
  }
  if (!isValid(parseISO(normalized))) {
    return { ok: false, message: "วันที่ไม่มีในปฏิทิน" };
  }
  if (normalized < ACCOUNTING_ENTRY_DATE_MIN) {
    return { ok: false, message: `วันที่ต้องไม่ก่อน ${ACCOUNTING_ENTRY_DATE_MIN}` };
  }
  const maxStr = format(addDays(startOfDay(new Date()), CHECK_DUE_DATE_MAX_LEAD_DAYS), "yyyy-MM-dd");
  if (normalized > maxStr) {
    return { ok: false, message: `วันครบกำหนดเช็คห้ามเกิน ${maxStr}` };
  }
  return { ok: true, normalized };
}
