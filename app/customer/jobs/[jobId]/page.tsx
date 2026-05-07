"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import type { Job, JobActivity } from "@/lib/types";
import { jobStatusLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";
import { isCustomerFacingActivityText } from "@/lib/customer-portal-activity";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";

export default function CustomerJobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const searchParams = useSearchParams();
  const archiveYear = searchParams.get("archiveYear");
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [activities, setActivities] = useState<JobActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !profile?.phone) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let jobRef = doc(db, "jobs", jobId);
        let snap = await getDoc(jobRef);

        if (!snap.exists() && archiveYear) {
          jobRef = doc(db, `jobsArchive_${archiveYear}`, jobId);
          snap = await getDoc(jobRef);
        }

        if (!snap.exists()) {
          const y0 = new Date().getFullYear();
          for (let i = 0; i < 5; i++) {
            const col = `jobsArchive_${y0 - i}`;
            const tryRef = doc(db, col, jobId);
            const trySnap = await getDoc(tryRef);
            if (trySnap.exists()) {
              jobRef = tryRef;
              snap = trySnap;
              break;
            }
          }
        }

        if (!snap.exists()) {
          setError("ไม่พบงานนี้");
          setJob(null);
          setActivities([]);
          return;
        }

        const data = { id: snap.id, ...snap.data() } as Job;
        if (data.customerId !== profile.phone) {
          setError("คุณไม่มีสิทธิ์ดูงานนี้");
          setJob(null);
          setActivities([]);
          return;
        }

        setJob(data);

        const actSnap = await getDocs(collection(jobRef, "activities"));
        const acts = actSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as JobActivity))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? 0;
            const tb = b.createdAt?.toMillis?.() ?? 0;
            return ta - tb;
          });
        const visible = acts.filter((a) => isCustomerFacingActivityText(a.text));
        setActivities(visible.length > 0 ? visible : acts);
      } catch (e: unknown) {
        setError((e as Error).message || "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    })();
  }, [db, profile?.phone, jobId, archiveYear]);

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const backHref = archiveYear ? "/customer/jobs/history" : "/customer/jobs";

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-16 pt-24 md:pt-28 max-w-2xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="text-white/80">
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ
          </Link>
        </Button>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-center text-red-400">{error}</p>
        ) : job ? (
          <>
            <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-xl font-headline">{jobDisplayRef(job)}</CardTitle>
                <CardDescription className="text-slate-300">
                  สถานะ: {jobStatusLabel(job.status)}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-slate-200 space-y-2">
                {job.description ? (
                  <p>
                    <span className="text-slate-400">รายละเอียด: </span>
                    {job.description}
                  </p>
                ) : null}
                {job.carServiceDetails?.licensePlate ? (
                  <p>ทะเบียน: {job.carServiceDetails.licensePlate}</p>
                ) : null}
                {job.commonrailDetails?.registrationNumber ? (
                  <p>ทะเบียน (คอมมอนเรล): {job.commonrailDetails.registrationNumber}</p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-lg">ความคืบหน้า / อัปเดตจากศูนย์</CardTitle>
                <CardDescription className="text-slate-300">
                  แสดงรายการที่เกี่ยวกับสถานะงานเป็นหลัก
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activities.length === 0 ? (
                  <p className="text-slate-400 text-sm">ยังไม่มีบันทึกที่แสดงได้</p>
                ) : (
                  activities.map((a) => (
                    <div
                      key={a.id || a.createdAt?.toString()}
                      className="border-l-2 border-primary/50 pl-3 text-sm"
                    >
                      <p className="text-white whitespace-pre-wrap">{a.text}</p>
                      <p className="text-xs text-slate-500 mt-1">
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
          </>
        ) : null}
      </main>
    </div>
  );
}
