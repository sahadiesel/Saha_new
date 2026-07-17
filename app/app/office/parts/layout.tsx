
import { RequireDepartment } from "@/components/require-department";

export default function OfficePartsLayout({ children }: { children: React.ReactNode }) {
  // Office and Purchasing can manage parts/stock (plus Admins/Managers via RequireDepartment)
  return <RequireDepartment allow={['OFFICE', 'PURCHASING', 'ACCOUNTING_HR']}>{children}</RequireDepartment>;
}
