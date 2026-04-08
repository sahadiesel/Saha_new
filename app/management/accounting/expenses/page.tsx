import { redirect } from "next/navigation";

/** เดิมซ้ำกับ cashbook รายจ่าย — ส่งต่อไปแท็บรายจ่าย */
export default function ManagementAccountingExpensesPage() {
  redirect("/app/management/accounting/cashbook?tab=OUT");
}
