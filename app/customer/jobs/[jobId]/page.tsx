"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Check, Ban, FileText, Printer, ExternalLink, PencilLine } from "lucide-react";
import type { Document, Job, JobActivity } from "@/lib/types";
import { jobStatusLabel, deptLabel, docStatusLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";
import { customerPortalVehicleLines, customerPortalStatusBadgeClass } from "@/lib/customer-job-portal-ui";
import { isJobActivityHiddenFromTimeline } from "@/lib/job-activity-display";
import { JobCustomerChatPanel } from "@/components/customer-portal/job-customer-chat-panel";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  callCustomerPortalQuotationDecision,
  formatCustomerPortalQuotationDecisionError,
} from "@/lib/callable-customer-quotation-decision";
type ResolvedJob = {
  jobRef: ReturnType<typeof doc>;
  job: Job;
  isLiveJob: boolean;
};

async function resolveCustomerJob(
  db: import("firebase/firestore").Firestore,
  jobId: string,
  archiveYear: string | null
): Promise<ResolvedJob | null> {
  if (archiveYear) {
    const jobRef = doc(db, `jobsArchive_${archiveYear}`, jobId);
    const snap = await getDoc(jobRef);
    if (snap.exists()) {
      return {
        jobRef,
        job: { id: snap.id, ...snap.data() } as Job,
        isLiveJob: false,
      };
    }
  }

  const liveRef = doc(db, "jobs", jobId);
  const liveSnap = await getDoc(liveRef);
  if (liveSnap.exists()) {
    return {
      jobRef: liveRef,
      job: { id: liveSnap.id, ...liveSnap.data() } as Job,
      isLiveJob: true,
    };
  }

  const y0 = new Date().getFullYear();
  for (let i = 0; i < 6; i++) {
    const col = `jobsArchive_${y0 - i}`;
    const jobRef = doc(db, col, jobId);
    const snap = await getDoc(jobRef);
    if (snap.exists()) {
      return {
        jobRef,
        job: { id: snap.id, ...snap.data() } as Job,
        isLiveJob: false,
      };
    }
  }

  return null;
}

const DOC_LABEL: Partial<Record<Document["docType"], string>> = {
  QUOTATION: "ใบเสนอราคา",
  DELIVERY_NOTE: "ใบส่งของชั่วคราว",
  TAX_INVOICE: "ใบกำกับภาษี",
  RECEIPT: "ใบเสร็จรับเงิน",
  CREDIT_NOTE: "ใบลดหนี้",
  DEBIT_NOTE: "ใบเพิ่มหนี้",
  WITHDRAWAL: "ใบเบิกอะไหล่",
  BILLING_NOTE: "ใบวางบิล",
};

export default function CustomerJobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const searchParams = useSearchParams();
  const archiveYear = searchParams.get("archiveYear");
  const { db, app } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [resolved, setResolved] = useState<ResolvedJob | null>(null);
  const [activities, setActivities] = useState<JobActivity[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotationDialog, setQuotationDialog] = useState<null | "approve">(null);
  const [rejectOptionsOpen, setRejectOptionsOpen] = useState(false);
  const [quotationBusy, setQuotationBusy] = useState(false);

  useEffect(() => {
    if (!db || !profile?.phone) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await resolveCustomerJob(db, jobId, archiveYear);
        if (!r) {
          setError("ไม่พบงานนี้");
          setResolved(null);
          setActivities([]);
          setDocuments([]);
          return;
        }
        if (r.job.customerId !== profile.phone) {
          setError("คุณไม่มีสิทธิ์ดูงานนี้");
          setResolved(null);
          setActivities([]);
          setDocuments([]);
          return;
        }

        setResolved(r);

        const actSnap = await getDocs(collection(r.jobRef, "activities"));
        const acts = actSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as JobActivity))
          .filter((a) => !isJobActivityHiddenFromTimeline(a.text))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? 0;
            const tb = b.createdAt?.toMillis?.() ?? 0;
            return ta - tb;
          });
        setActivities(acts);

        const dq = query(collection(db, "documents"), where("jobId", "==", r.job.id));
        const docSnap = await getDocs(dq);
        const docList = docSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Document));
        const seen = new Set(docList.map((x) => x.id));
        if (r.job.salesDocId && !seen.has(r.job.salesDocId)) {
          const s = await getDoc(doc(db, "documents", r.job.salesDocId));
          if (s.exists()) {
            docList.push({ id: s.id, ...s.data() } as Document);
          }
        }
        docList.sort((a, b) => String(b.docDate).localeCompare(String(a.docDate)));
        setDocuments(docList);
      } catch (e: unknown) {
        setError((e as Error).message || "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    })();
  }, [db, profile?.phone, jobId, archiveYear]);

  async function reloadLiveJobAndActivities() {
    if (!db || !resolved?.isLiveJob) return;
    const liveRef = doc(db, "jobs", resolved.job.id);
    const jobSnap = await getDoc(liveRef);
    if (jobSnap.exists()) {
      const j = { id: jobSnap.id, ...jobSnap.data() } as Job;
      setResolved((prev) => (prev ? { ...prev, job: j } : null));
    }
    const actSnap = await getDocs(collection(liveRef, "activities"));
    const acts = actSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as JobActivity))
      .filter((a) => !isJobActivityHiddenFromTimeline(a.text))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return ta - tb;
      });
    setActivities(acts);
  }

  async function executeQuotationApprove() {
    if (!db || !app || !profile || !resolved || !resolved.isLiveJob) return;
    const job = resolved.job;
    if (job.status !== "WAITING_APPROVE") return;

    setQuotationBusy(true);
    try {
      await callCustomerPortalQuotationDecision(app, {
        jobId: job.id,
        decision: "APPROVE",
        messageVariant: "jobPage",
      });
      toast({ title: "อนุมัติแล้ว", description: "ศูนย์ได้รับข้อมูลในระบบแล้ว" });
      setQuotationDialog(null);
      await reloadLiveJobAndActivities();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description: formatCustomerPortalQuotationDecisionError(e),
      });
    } finally {
      setQuotationBusy(false);
    }
  }

  async function executeQuotationRejectNoRepair() {
    if (!db || !app || !profile || !resolved || !resolved.isLiveJob) return;
    const job = resolved.job;
    if (job.status !== "WAITING_APPROVE") return;

    setQuotationBusy(true);
    try {
      await callCustomerPortalQuotationDecision(app, {
        jobId: job.id,
        decision: "NO_REPAIR",
        messageVariant: "jobPage",
      });
      toast({ title: "บันทึกแล้ว", description: "ศูนย์ได้รับข้อมูลในระบบแล้ว" });
      setRejectOptionsOpen(false);
      await reloadLiveJobAndActivities();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description: formatCustomerPortalQuotationDecisionError(e),
      });
    } finally {
      setQuotationBusy(false);
    }
  }

  async function executeQuotationRequestChanges() {
    if (!db || !app || !profile || !resolved || !resolved.isLiveJob) return;
    const job = resolved.job;
    if (job.status !== "WAITING_APPROVE") return;

    setQuotationBusy(true);
    try {
      await callCustomerPortalQuotationDecision(app, {
        jobId: job.id,
        decision: "REQUEST_CHANGES",
        messageVariant: "jobPage",
      });
      toast({
        title: "บันทึกคำขอแก้ไขแล้ว",
        description: "ศูนย์จะเห็นในประวัติงาน — ติดต่อสหดีเซลทางโทรศัพท์หรือแชตในพอร์ทัล",
      });
      setRejectOptionsOpen(false);
      await reloadLiveJobAndActivities();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ไม่สำเร็จ",
        description: formatCustomerPortalQuotationDecisionError(e),
      });
    } finally {
      setQuotationBusy(false);
    }
  }

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const backHref = archiveYear ? "/customer/jobs/history" : "/customer/jobs";
  const job = resolved?.job;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-20 pt-24 md:pt-28 max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="text-white/80">
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ
          </Link>
        </Button>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-center text-red-400">{error}</p>
        ) : job ? (
          <>
            <Card className="border-white/10 bg-slate-900/85 backdrop-blur-md text-white">
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-xl font-headline leading-tight">
                    งาน {job.customerSnapshot?.name || "ลูกค้า"}
                  </CardTitle>
                  <Badge className={cn("border-0", customerPortalStatusBadgeClass(job.status))}>
                    {jobStatusLabel(job.status)}
                  </Badge>
                </div>
                <CardDescription className="text-slate-300 font-mono text-sm">
                  {jobDisplayRef(job)} · {deptLabel(job.department)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-200">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                    รายการแจ้งซ่อม
                  </h3>
                  <p className="whitespace-pre-wrap">{job.description || "—"}</p>
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
                    รายละเอียดรถ / ชิ้นส่วน
                  </h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {customerPortalVehicleLines(job).length ? (
                      customerPortalVehicleLines(job).map((line, i) => <li key={i}>{line}</li>)
                    ) : (
                      <li className="text-slate-500">ไม่มีข้อมูลเพิ่มเติม</li>
                    )}
                  </ul>
                </div>
                {job.assigneeName ? (
                  <p>
                    <span className="text-slate-400">ผู้รับผิดชอบ: </span>
                    {job.assigneeName}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {job.photos?.some(Boolean) ? (
              <Card className="border-white/10 bg-slate-900/85 text-white">
                <CardHeader>
                  <CardTitle className="text-lg">รูปประกอบงาน (ตอนรับงาน)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {job.photos.filter(Boolean).map((url, i) => (
                      <a
                        key={`${url}-${i}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative aspect-square overflow-hidden rounded-lg border border-white/10"
                      >
                        <Image src={url!} alt="" fill unoptimized className="object-cover hover:opacity-90" />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-white/10 bg-slate-900/85 text-white">
              <CardHeader>
                <CardTitle className="text-lg">เอกสารประกอบ</CardTitle>
                <CardDescription className="text-slate-400">
                  เปิดดูและพิมพ์ได้ — ไม่สามารถแก้ไขจากพอร์ทัลลูกค้า
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {documents.length === 0 ? (
                  <p className="text-sm text-slate-500">ยังไม่มีเอกสารในระบบสำหรับงานนี้</p>
                ) : (
                  documents.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {DOC_LABEL[d.docType] || d.docType} {d.docNo}
                        </p>
                        <p className="text-xs text-slate-400">{docStatusLabel(d.status, d.docType)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="secondary" className="font-bold">
                          <Link href={`/customer/documents/${d.id}`}>
                            <ExternalLink className="mr-2 h-3 w-3" />
                            ดู / พิมพ์
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}

                {resolved?.isLiveJob && job.status === "WAITING_APPROVE" && job.salesDocId ? (
                  <div className="rounded-lg border border-orange-500/40 bg-orange-950/20 p-4 space-y-3">
                    <p className="text-sm font-bold text-orange-200 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {job.quotationAwaitingOfficeResubmit
                        ? "รอศูนย์ปรับใบเสนอราคาและส่งให้คุณพิจารณาอีกครั้ง"
                        : "ใบเสนอราคารอการยืนยันจากคุณ"}
                    </p>
                    {job.quotationAwaitingOfficeResubmit ? (
                      <p className="text-xs text-orange-100/90 leading-relaxed">
                        คุณได้ส่งคำขอแก้ไขแล้ว — ปุ่มด้านล่างจะเปิดให้ใช้อีกครั้งเมื่อเจ้าหน้าที่ส่งใบเสนอราคาฉบับปรับให้พิจารณาในระบบ
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 font-bold"
                        disabled={!!job.quotationAwaitingOfficeResubmit || quotationBusy}
                        onClick={() => setQuotationDialog("approve")}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        อนุมัติ
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-400 text-red-200 hover:bg-red-950/50"
                        disabled={!!job.quotationAwaitingOfficeResubmit || quotationBusy}
                        onClick={() => setRejectOptionsOpen(true)}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        ไม่อนุมัติ / แก้ไข
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="text-white">
                        <Link href={`/customer/documents/${job.salesDocId}`}>
                          <Printer className="mr-2 h-4 w-4" />
                          เปิดใบเสนอราคา
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-slate-900/85 text-white">
              <CardHeader>
                <CardTitle className="text-lg">ประวัติการดำเนินการ</CardTitle>
                <CardDescription className="text-slate-400">
                  บันทึกความคืบหน้าและกิจกรรมที่เกี่ยวกับงานนี้
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activities.length === 0 ? (
                  <p className="text-sm text-slate-500">ยังไม่มีบันทึก</p>
                ) : (
                  activities.map((a) => (
                    <div key={a.id || String(a.createdAt?.toMillis?.())} className="border-l-2 border-primary/40 pl-3">
                      <p className="text-sm whitespace-pre-wrap text-slate-100">{a.text}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {a.userName} ·{" "}
                        {a.createdAt?.toDate
                          ? format(a.createdAt.toDate(), "d MMM yyyy HH:mm", { locale: th })
                          : ""}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {resolved?.isLiveJob && !archiveYear ? (
              <JobCustomerChatPanel jobId={job.id} variant="customer" disabled={false} readOnly={false} />
            ) : (
              <p className="text-xs text-center text-slate-500">
                แชตกับศูนย์เปิดใช้ได้เฉพาะงานที่ยังอยู่ในระบบหลัก (ไม่ใช่ประวัติที่เก็บถาวร)
              </p>
            )}
          </>
        ) : null}
      </main>

      <AlertDialog open={quotationDialog !== null} onOpenChange={(o) => !o && !quotationBusy && setQuotationDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการอนุมัติใบเสนอราคา?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะเปลี่ยนสถานะเพื่อให้ศูนย์จัดเตรียมอะไหล่และดำเนินการซ่อมต่อ — โปรดตรวจสอบใบเสนอราคาให้ครบก่อนยืนยัน
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quotationBusy}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction disabled={quotationBusy} onClick={() => void executeQuotationApprove()}>
              {quotationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยัน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectOptionsOpen} onOpenChange={(o) => !quotationBusy && setRejectOptionsOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ไม่อนุมัติหรือขอแก้ไขใบเสนอราคา</DialogTitle>
            <DialogDescription>เลือกรายการที่ตรงกับความประสงค์ของคุณ</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 whitespace-normal py-3 text-left justify-start"
              disabled={quotationBusy}
              onClick={() => void executeQuotationRequestChanges()}
            >
              <PencilLine className="mr-2 h-4 w-4 shrink-0" />
              1. ขอแก้ไขรายการ (สถานะงานยังรอลูกค้าอนุมัติ)
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-auto min-h-11 whitespace-normal py-3 text-left justify-start"
              disabled={quotationBusy}
              onClick={() => void executeQuotationRejectNoRepair()}
            >
              <Ban className="mr-2 h-4 w-4 shrink-0" />
              2. ประสงค์ไม่ซ่อม ขอนำกลับ
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={quotationBusy} onClick={() => setRejectOptionsOpen(false)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
