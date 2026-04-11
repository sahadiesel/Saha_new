"use client";

import { PageHeader } from "@/components/page-header";
import PartWithdrawalForm from "@/components/part-withdrawal-form";
import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFirebase } from "@/firebase";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import type { Document as DocumentType } from "@/lib/types";

function tsMs(t: unknown): number {
  if (t && typeof t === "object" && "toMillis" in t && typeof (t as { toMillis: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function NewWithdrawalContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { db } = useFirebase();
  const jobId = searchParams.get("jobId");
  const editDocId = searchParams.get("editDocId");
  const mustResolveExisting = !!(jobId && !editDocId);
  const [resolverFinished, setResolverFinished] = useState(!mustResolveExisting);

  useEffect(() => {
    if (!mustResolveExisting) {
      setResolverFinished(true);
      return;
    }
    if (!db) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "documents"), where("jobId", "==", jobId), limit(40)));
        if (cancelled) return;
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as DocumentType))
          .filter((d) => d.docType === "WITHDRAWAL" && d.status !== "CANCELLED");
        list.sort((a, b) => tsMs(b.updatedAt ?? b.createdAt) - tsMs(a.updatedAt ?? a.createdAt));
        const existing = list[0];
        if (existing) {
          const p = new URLSearchParams(searchParams.toString());
          p.set("editDocId", existing.id);
          router.replace(`/app/office/parts/withdraw/new?${p.toString()}`);
        }
      } catch {
        /* ให้เปิดฟอร์มสร้างใหม่ได้ */
      } finally {
        if (!cancelled) setResolverFinished(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, mustResolveExisting, jobId, editDocId, router, searchParams]);

  if (!resolverFinished) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-16 text-muted-foreground">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
        <p className="text-sm">กำลังตรวจสอบว่ามีใบเบิกของงานนี้อยู่แล้วหรือไม่…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={editDocId ? "แก้ไขใบเบิกอะไหล่ (ฉบับร่าง)" : "บันทึกการเบิกอะไหล่"}
        description="หักยอดสต็อกออกจากคลังเพื่อนำไปใช้งานในใบงานหรือบิลขาย — ถ้ามีใบเบิกเดิมของงานเดียวกัน ระบบจะเปิดใบเดิมให้แก้ไข"
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
