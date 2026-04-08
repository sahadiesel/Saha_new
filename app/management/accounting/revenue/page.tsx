import { redirect } from "next/navigation";

/** เดิมซ้ำกับ cashbook รายรับ — ส่งต่อไปแท็บรายรับ */
export default function ManagementAccountingRevenuePage() {
  redirect("/app/management/accounting/cashbook?tab=IN");
}
