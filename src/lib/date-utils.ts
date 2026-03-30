import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';

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
