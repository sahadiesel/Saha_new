"use client";

import { PageHeader } from "@/components/page-header";
import { DocumentList } from "@/components/document-list";

export function WithholdingTaxListPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="ใบหัก ณ ที่จ่าย"
        description="ค้นหาและจัดการใบหัก ณ ที่จ่ายทั้งหมด (งานจ้าง/บริการและรายการจากบัญชี)"
      />
      <DocumentList
        docType="WITHHOLDING_TAX"
        baseContext="accounting"
        orderByField="updatedAt"
        orderByDirection="desc"
      />
    </div>
  );
}
