"use client";

import { PageHeader } from "@/components/page-header";
import { PurchaseServiceForm } from "@/components/purchase-service-form";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export default function NewPurchaseServicePage() {
    return (
        <>
            <PageHeader title="สร้างรายการซื้องานบริการ(งานจ้าง)" description="บันทึกบิลค่าจ้างหรือค่าบริการที่ได้รับจากร้านค้าภายนอก" />
            <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
                <PurchaseServiceForm />
            </Suspense>
        </>
    );
}
