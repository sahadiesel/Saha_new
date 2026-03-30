export function getYearFromDateOnly(dateStr: string): number {
  const y = Number(String(dateStr || "").slice(0, 4));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

/**
 * ปี ค.ศ. สำหรับชื่อ collection `jobsArchive_{year}` — ต้องสอดคล้องกับ `archiveAndCloseJob` (ถ้าเลขปีในวันที่เป็น พ.ศ. > 2400 ให้ลบ 543)
 */
export function getGregorianArchiveYearFromDateString(dateStr: string): number {
  const rawYear = Number(String(dateStr || "").slice(0, 4));
  if (!Number.isFinite(rawYear)) return new Date().getFullYear();
  return rawYear > 2400 ? rawYear - 543 : rawYear;
}

export function archiveCollectionNameByYear(year: number): string {
  return `jobsArchive_${year}`;
}
