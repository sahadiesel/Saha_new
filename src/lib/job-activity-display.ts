/** ข้อความกิจกรรมที่ไม่ต้องแสดงในไทม์ไลน์ (เลิกบันทึกแล้ว แต่เอกสารเก่าอาจยังมีใน Firestore) */
const HIDDEN_JOB_ACTIVITY_TEXTS = new Set([
  "แก้ไขสมุดบันทึก",
  "แก้ไขรายละเอียดรถ/ชิ้นส่วน",
]);

export function isJobActivityHiddenFromTimeline(text: string | undefined | null): boolean {
  const t = String(text ?? "").trim();
  return HIDDEN_JOB_ACTIVITY_TEXTS.has(t);
}
