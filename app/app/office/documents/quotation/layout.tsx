import { RequireDepartment } from "@/components/require-department";

export default function OfficeQuotationLayout({ children }: { children: React.ReactNode }) {
  // Allow Office (Full access) and Purchasing/Accounting (View only)
  return <RequireDepartment allow={['OFFICE', 'PURCHASING', 'ACCOUNTING_HR']}>{children}</RequireDepartment>;
}
