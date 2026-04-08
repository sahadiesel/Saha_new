
"use client";

import { useEffect, useMemo, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, type DocumentReference } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import type { Document as DocumentType } from "@/lib/types";

function RouterInner() {
  const { docId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { db } = useFirebase();

  const docRef = useMemo((): DocumentReference<DocumentType> | null => {
    if (!db || typeof docId !== "string") return null;
    return doc(db, "documents", docId) as DocumentReference<DocumentType>;
  }, [db, docId]);
  const { data: document, isLoading, error } = useDoc<DocumentType>(docRef);

  useEffect(() => {
    if (document && !isLoading) {
      const type = document.docType;
      const baseParams = searchParams.toString() ? `?${searchParams.toString()}` : "";
      
      switch (type) {
        case 'QUOTATION':
          router.replace(`/app/office/documents/quotation/${document.id}${baseParams}`);
          break;
        case 'DELIVERY_NOTE':
          router.replace(`/app/office/documents/delivery-note/${document.id}${baseParams}`);
          break;
        case 'TAX_INVOICE':
          router.replace(`/app/office/documents/tax-invoice/${document.id}${baseParams}`);
          break;
        case 'BILLING_NOTE':
          router.replace(`/app/office/documents/${document.id}${baseParams}`);
          break;
        case 'RECEIPT':
          router.replace(`/app/office/documents/${document.id}${baseParams}`);
          break;
        case 'WITHHOLDING_TAX':
          router.replace(`/app/office/documents/${document.id}${baseParams}`);
          break;
        case 'CREDIT_NOTE':
          router.replace(`/app/office/documents/${document.id}${baseParams}`);
          break;
        case 'WITHDRAWAL':
          // Redirect to the universal viewer for withdrawals
          router.replace(`/app/office/documents/${document.id}${baseParams}`);
          break;
        default:
          // Keep showing the type error if unknown
          break;
      }
    }
  }, [document, isLoading, router, searchParams]);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm font-medium">กำลังค้นหาเอกสาร...</p>
      </div>
    );
  }

  if (error || (document === null && !isLoading)) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <PageHeader title="ไม่พบเอกสาร" description="เอกสารที่ต้องการอาจถูกลบหรือไม่มีอยู่ในระบบ" />
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> ย้อนกลับ
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-muted-foreground text-sm font-medium">กำลังนำทางไปยังเอกสาร...</p>
    </div>
  );
}

export default function CentralDocumentRouterPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin"/></div>}>
            <RouterInner />
        </Suspense>
    )
}
