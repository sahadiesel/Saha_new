import { Timestamp } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';

/**
 * Standard Date Formats for the application (Thai Standard)
 * Unified to dd/MM/yyyy as requested.
 */
export const APP_DATE_FORMAT = 'dd/MM/yyyy';
export const APP_DATE_TIME_FORMAT = 'dd/MM/yyyy HH:mm';
export const APP_FULL_DATE_FORMAT = 'dd/MM/yyyy';

/**
 * แปลงสตริงวันที่แบบ YYYY-MM-DD ที่อาจบันทึกปีเป็น พ.ศ. (เช่น 2569-xx-xx) ให้เป็นปี ค.ศ. ก่อนเปรียบเทียบ/เรียงลำดับ
 * ใช้กฎเดียวกับ archive/jobs: ถ้าเลขปี 4 หลักแรก > 2400 ให้ลบ 543
 */
export function normalizeGregorianDateOnlyString(dateStr: string): string {
  const m = String(dateStr || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr || "").trim();
  let y = Number(m[1]);
  const mo = m[2];
  const d = m[3];
  if (!Number.isFinite(y)) return `${m[1]}-${mo}-${d}`;
  if (y > 2400) y -= 543;
  return `${String(y).padStart(4, "0")}-${mo}-${d}`;
}

/**
 * Safely formats a Firestore Timestamp or a JS Date object into a string.
 * Returns 'N/A' if the input is null, undefined, or not a recognizable date type.
 * @param timestamp The Firestore Timestamp or Date object (or null/undefined).
 * @param formatString The date-fns format string.
 * @returns The formatted date string or 'N/A'.
 */
export function safeFormat(timestamp: Timestamp | Date | null | undefined, formatString: string = APP_DATE_FORMAT): string {
  if (!timestamp) {
    return 'N/A';
  }

  try {
    // Firestore Timestamps have a toDate() method.
    if (timestamp instanceof Timestamp) {
      return format(timestamp.toDate(), formatString);
    }
    
    // If it's already a Date object and it's valid.
    if (timestamp instanceof Date && !isNaN(timestamp.getTime())) {
        return format(timestamp, formatString);
    }
    
    // If it's a string, try to parse it
    if (typeof timestamp === 'string') {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) return format(d, formatString);
    }
  } catch (error) {
    console.error("Error formatting timestamp:", error);
    return 'N/A';
  }

  return 'N/A';
}

/** กันค่าวันที่ผิดรูปแบบ / null / Timestamp ทำให้ format() และ Calendar ได้ RangeError: Invalid time value */
export function dateFromYyyyMmDdField(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return isValid(d) ? d : undefined;
  }
  if (value instanceof Date) {
    return isValid(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const s = normalizeGregorianDateOnlyString(value.trim());
    if (!s) return undefined;
    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (ymd) {
      const y = Number(ymd[1]);
      const mo = Number(ymd[2]);
      const day = Number(ymd[3]);
      const d = new Date(y, mo - 1, day);
      if (
        !isValid(d) ||
        d.getFullYear() !== y ||
        d.getMonth() !== mo - 1 ||
        d.getDate() !== day
      ) {
        return undefined;
      }
      return d;
    }
    const d = parseISO(s);
    return isValid(d) ? d : undefined;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return d instanceof Date && isValid(d) ? d : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function formatDdMmYyyySafe(value: unknown): string | null {
  try {
    const d = dateFromYyyyMmDdField(value);
    if (!d) return null;
    return format(d, "dd/MM/yyyy");
  } catch {
    return null;
  }
}

export function toYyyyMmDdOrNull(value: unknown): string | null {
  try {
    const d = dateFromYyyyMmDdField(value);
    if (!d) return null;
    return format(d, "yyyy-MM-dd");
  } catch {
    return null;
  }
}
