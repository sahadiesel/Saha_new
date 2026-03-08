
"use client";

import { PageHeader } from "@/components/page-header";
import PartWithdrawalForm from "@/components/part-withdrawal-form";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

function NewWithdrawalContent() {
  const searchParams = useSearchParams();
  const editDocId = searchParams.get('editDocId');

  return (
    <div className="space-y-6">
      <PageHeader 
        title={editDocId ? "แก้ไขใบเบิกอะไหล่ (ฉบับร่าง)" : "บันทึกการเบิกอะไหล่"} 
        description="หักยอดสต็อกออกจากคลังเพื่อนำไปใช้งานในใบงานหรือบิลขาย" 
      />
      <PartWithdrawalForm editDocId={editDocId} />
    </div>
  );
}

export default function NewWithdrawalPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>}>
      <NewWithdrawalContent />
    </Suspense>
  );
}
