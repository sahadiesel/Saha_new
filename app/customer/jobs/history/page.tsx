"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, History } from "lucide-react";
import type { Job } from "@/lib/types";
import { jobStatusLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";

const ARCHIVE_YEARS_BACK = 4;

export default function CustomerJobsHistoryPage() {
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<(Job & { _archiveYear?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db || !profile?.phone) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const y0 = new Date().getFullYear();
        const collected: (Job & { _archiveYear?: number })[] = [];
        for (let i = 0; i < ARCHIVE_YEARS_BACK; i++) {
          const year = y0 - i;
          const col = `jobsArchive_${year}`;
          const q = query(
            collection(db, col),
            where("customerId", "==", profile.phone),
            limit(80)
          );
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            collected.push({ id: d.id, ...d.data(), _archiveYear: year } as Job & { _archiveYear: number });
          });
        }
        collected.sort((a, b) => {
          const ta = a.closedDate || a.archivedAtDate || "";
          const tb = b.closedDate || b.archivedAtDate || "";
          return tb.localeCompare(ta);
        });
        setJobs(collected);
      } finally {
        setLoading(false);
      }
    })();
  }, [db, profile?.phone]);

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-16 pt-24 md:pt-28 max-w-2xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="text-white/80">
          <Link href="/customer/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            งานระหว่างดำเนินการ
          </Link>
        </Button>
        <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-headline">
              <History className="h-5 w-5 text-primary" />
              ประวัติงานซ่อม
            </CardTitle>
            <CardDescription className="text-slate-300">
              งานที่ปิดแล้วย้อนหลังไม่เกิน {ARCHIVE_YEARS_BACK} ปี
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">ยังไม่มีประวัติงานในระบบ</p>
            ) : (
              jobs.map((job) => (
                <Link
                  key={`${job._archiveYear}-${job.id}`}
                  href={`/customer/jobs/${job.id}?archiveYear=${job._archiveYear}`}
                  className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors"
                >
                  <div className="font-bold text-white">{jobDisplayRef(job)}</div>
                  <div className="text-sm text-slate-300 mt-1">{job.customerSnapshot?.name}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    ปิดงาน: {job.closedDate || job.archivedAtDate || "—"}
                  </div>
                  <div className="text-xs text-primary mt-2 font-medium">
                    {jobStatusLabel(job.status)}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
