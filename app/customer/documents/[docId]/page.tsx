"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  doc,
  getDoc,
  writeBatch,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Printer, Check, Ban, PencilLine } from "lucide-react";
import type { Document, Job, UserProfile } from "@/lib/types";
import { resolveCustomerDocumentViewerAccess } from "@/lib/customer-document-access";
import { CustomerDocumentPrintView } from "@/components/customer-portal/customer-document-print-view";
import { useToast } from "@/hooks/use-toast";
import {
  callCustomerPortalQuotationDecision,
  formatCustomerPortalQuotationDecisionError,
} from "@/lib/callable-customer-quotation-decision";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ViewerMode = "customer" | "office";

function quotationActorLabel(viewerMode: ViewerMode, profile: UserProfile, job: Job | null): string {
  if (viewerMode === "office") {
    return profile.displayName?.trim() || profile.email?.trim() || "เจ้าหน้าที่สหดีเซล";
  }
  return job?.customerSnapshot?.name?.trim() || profile.displayName?.trim() || "ลูกค้า";
}

export default function CustomerDocumentPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params);
  const { db, app } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [document, setDocument] = useState<Document | null>(null);
  const [viewerMode, setViewerMode] = useState<ViewerMode | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotationBusy, setQuotationBusy] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  useEffect(() => {
    if (!db || !profile) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "documents", docId));
        if (!snap.exists()) {
          setError("ไม่พบเอกสาร");
          setDocument(null);
          setViewerMode(null);
          return;
        }
        const data = { id: snap.id, ...snap.data() } as Document;

        const mode = await resolveCustomerDocumentViewerAccess(db, data, profile);
        if (!mode) {
          setError("คุณไม่มีสิทธิ์เปิดเอกสารนี้");
          setDocument(null);
          setViewerMode(null);
          return;
        }

        setDocument(data);
        setViewerMode(mode);
      } catch (e: unknown) {
        setError((e as Error).message || "โหลดไม่สำเร็จ");
        setDocument(null);
        setViewerMode(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [db, profile, docId]);

  useEffect(() => {
    if (!db || !document?.jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const s = await getDoc(doc(db, "jobs", document.jobId!));
      if (cancelled) return;
      if (s.exists()) {
        setJob({ id: s.id, ...s.data() } as Job);
      } else {
        setJob(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, document?.jobId]);

  const refreshJob = useCallback(async () => {
    if (!db || !document?.jobId) return;
    const s = await getDoc(doc(db, "jobs", document.jobId));
    if (s.exists()) {
      setJob({ id: s.id, ...s.data() } as Job);
    } else {
      setJob(null);
    }
  }, [db, document?.jobId]);

  const showQuotationDecision =
    !!document &&
    document.docType === "QUOTATION" &&
    !!job &&
    job.status === "WAITING_APPROVE" &&
    job.salesDocId === document.id &&
    !job.isArchived;

  const handleApprove = async () => {
    if (!db || !profile || !document?.jobId || !job || !viewerMode) return;
    setQuotationBusy(true);
    try {
      if (viewerMode === "customer") {
        if (!app) throw new Error("ไม่พร้อมเชื่อมต่อระบบ");
        await callCustomerPortalQuotationDecision(app, {
          jobId: job.id,
          decision: "APPROVE",
          messageVariant: "documentPage",
        });
      } else {
        const liveRef = doc(db, "jobs", job.id);
        const batch = writeBatch(db);
        const label = quotationActorLabel(viewerMode, profile, job);
        const msg = `อนุมัติใบเสนอราคาแล้ว โดย ${label}${viewerMode === "office" ? " (ยืนยันจากระบบสหดีเซล — ดูเอกสาร)" : " (ผ่านพอร์ทัลลูกค้า — ดูเอกสาร)"}`;

        batch.update(liveRef, {
          status: "PENDING_PARTS",
          salesDocStatus: "APPROVED",
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(collection(liveRef, "activities")), {
          text: msg,
          userName: profile.displayName || profile.email || label,
          userId: profile.uid,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      }
      toast({ title: "อนุมัติแล้ว", description: "งานเข้าขั้นตอนรอจัดอะไหล่ตามระบบ" });
      await refreshJob();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description:
          viewerMode === "customer"
            ? formatCustomerPortalQuotationDecisionError(e)
            : (e as Error).message || "เกิดข้อผิดพลาด",
      });
    } finally {
      setQuotationBusy(false);
    }
  };

  const handleRejectNoRepair = async () => {
    if (!db || !profile || !document?.jobId || !job || !viewerMode) return;
    setQuotationBusy(true);
    try {
      if (viewerMode === "customer") {
        if (!app) throw new Error("ไม่พร้อมเชื่อมต่อระบบ");
        await callCustomerPortalQuotationDecision(app, {
          jobId: job.id,
          decision: "NO_REPAIR",
          messageVariant: "documentPage",
        });
      } else {
        const liveRef = doc(db, "jobs", job.id);
        const batch = writeBatch(db);
        const label = quotationActorLabel(viewerMode, profile, job);
        const msg =
          viewerMode === "office"
            ? `บันทึกประสงค์ไม่ซ่อม/ขอนำกลับ (ใบเสนอราคา) โดย ${label} (ศูนย์) — สถานะไปตามระบบ`
            : `ลูกค้าแจ้งประสงค์ไม่ซ่อม ขอนำกลับ — โดย ${label} (ผ่านพอร์ทัล — ดูเอกสาร)`;

        batch.update(liveRef, {
          status: "DONE",
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(collection(liveRef, "activities")), {
          text: msg,
          userName: profile.displayName || profile.email || label,
          userId: profile.uid,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      }
      toast({ title: "บันทึกแล้ว", description: "ระบบอัปเดตสถานะงานตามขั้นตอนเดิม" });
      setRejectDialogOpen(false);
      await refreshJob();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description:
          viewerMode === "customer"
            ? formatCustomerPortalQuotationDecisionError(e)
            : (e as Error).message || "เกิดข้อผิดพลาด",
      });
    } finally {
      setQuotationBusy(false);
    }
  };

  const handleRequestQuotationChanges = async () => {
    if (!db || !profile || !document?.jobId || !job || !viewerMode) return;
    setQuotationBusy(true);
    try {
      if (viewerMode === "customer") {
        if (!app) throw new Error("ไม่พร้อมเชื่อมต่อระบบ");
        await callCustomerPortalQuotationDecision(app, {
          jobId: job.id,
          decision: "REQUEST_CHANGES",
          messageVariant: "documentPage",
        });
      } else {
        const liveRef = doc(db, "jobs", job.id);
        const label = quotationActorLabel(viewerMode, profile, job);
        const msg =
          viewerMode === "office"
            ? `ขอแก้ไขรายการในใบเสนอราคา — แจ้งโดย ${label} (ศูนย์) — สถานะงานยังอยู่ที่รอลูกค้าอนุมัติ`
            : `ขอแก้ไขรายการในใบเสนอราคา — โดย ${label} — สถานะงานยังอยู่ที่รอลูกค้าอนุมัติ — กรุณาติดต่อสหดีเซลตามเบอร์โทรของศูนย์ หรือส่งข้อความทางช่อง "Chat with สหดีเซล" ในพอร์ทัล`;

        const batch = writeBatch(db);
        batch.set(doc(collection(liveRef, "activities")), {
          text: msg,
          userName: profile.displayName || profile.email || label,
          userId: profile.uid,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      }

      toast({
        title: "บันทึกคำขอแก้ไขแล้ว",
        description:
          "ศูนย์จะเห็นในประวัติงาน — กรุณาติดต่อสหดีเซลทางโทรศัพท์หรือแชตในพอร์ทัล",
      });
      setRejectDialogOpen(false);
      await refreshJob();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description:
          viewerMode === "customer"
            ? formatCustomerPortalQuotationDecisionError(e)
            : (e as Error).message || "เกิดข้อผิดพลาด",
      });
    } finally {
      setQuotationBusy(false);
    }
  };

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const backHref =
    viewerMode === "office" && document?.jobId
      ? `/app/jobs/${document.jobId}`
      : document?.jobId
        ? `/customer/jobs/${document.jobId}`
        : "/customer/jobs";

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-16 pt-24 max-w-[220mm] space-y-4">
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button asChild variant="ghost" size="sm" className="text-white/90 hover:text-white">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              กลับ
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-white/40 bg-slate-800/80 text-white hover:bg-slate-700 hover:text-white"
            onClick={() => window.print()}
            disabled={!document}
          >
            <Printer className="mr-2 h-4 w-4" />
            สั่งพิมพ์
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-center text-red-400">{error}</p>
        ) : document ? (
          <CustomerDocumentPrintView document={document} />
        ) : null}

        {showQuotationDecision && viewerMode && profile ? (
          <div className="rounded-lg border border-white/15 bg-slate-900/80 p-4 space-y-3 print:hidden">
            <p className="text-sm font-medium text-slate-200">
              {viewerMode === "customer" && job?.quotationAwaitingOfficeResubmit
                ? "รอศูนย์ส่งใบเสนอราคาให้พิจารณาอีกครั้ง"
                : "การอนุมัติใบเสนอราคา (งานอยู่ในสถานะรอลูกค้าอนุมัติ)"}
            </p>
            {viewerMode === "customer" && job?.quotationAwaitingOfficeResubmit ? (
              <p className="text-xs text-slate-400 leading-relaxed">
                คุณได้ส่งคำขอแก้ไขแล้ว — ปุ่มด้านล่างจะเปิดอีกครั้งเมื่อเจ้าหน้าที่กด &quot;ส่งให้ลูกค้าพิจารณาใบเสนอราคาอีกครั้ง&quot; ในระบบสำนักงาน
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={
                  quotationBusy ||
                  (viewerMode === "customer" && !!job?.quotationAwaitingOfficeResubmit)
                }
                onClick={() => void handleApprove()}
              >
                {quotationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                อนุมัติ
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  quotationBusy ||
                  (viewerMode === "customer" && !!job?.quotationAwaitingOfficeResubmit)
                }
                onClick={() => setRejectDialogOpen(true)}
              >
                <Ban className="mr-2 h-4 w-4" />
                ไม่อนุมัติ / แก้ไข
              </Button>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-slate-500 text-center print:hidden">
          มุมมองอ่านอย่างเดียว — ไม่สามารถแก้ไขเอกสารจากพอร์ทัลลูกค้า
        </p>
      </main>

      <Dialog open={rejectDialogOpen} onOpenChange={(o) => !quotationBusy && setRejectDialogOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ไม่อนุมัติหรือขอแก้ไขใบเสนอราคา</DialogTitle>
            <DialogDescription>เลือกรายการที่ตรงกับความประสงค์ของลูกค้า</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 whitespace-normal py-3 text-left justify-start"
              disabled={quotationBusy}
              onClick={() => void handleRequestQuotationChanges()}
            >
              <PencilLine className="mr-2 h-4 w-4 shrink-0" />
              1. ขอแก้ไขรายการ (สถานะงานยังรอลูกค้าอนุมัติ — บันทึกในประวัติ)
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-auto min-h-11 whitespace-normal py-3 text-left justify-start"
              disabled={quotationBusy}
              onClick={() => void handleRejectNoRepair()}
            >
              <Ban className="mr-2 h-4 w-4 shrink-0" />
              2. ประสงค์ไม่ซ่อม ขอนำกลับ (ดำเนินการตามระบบเดิมเมื่อไม่อนุมัติ)
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={quotationBusy} onClick={() => setRejectDialogOpen(false)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
