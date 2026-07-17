
import { RequireDepartment } from "@/components/require-department";

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  // Allow both departments in the parent layout, sub-layouts will specialize
  return <RequireDepartment allow={['OFFICE', 'PURCHASING', 'ACCOUNTING_HR']}>{children}</RequireDepartment>;
}
