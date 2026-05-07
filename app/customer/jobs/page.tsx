"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Wrench } from "lucide-react";
import type { Job } from "@/lib/types";
import { jobStatusLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";

export default function CustomerJobsActivePage() {
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db || !profile?.phone) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, "jobs"),
          where("customerId", "==", profile.phone),
          limit(80)
        );
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Job));
        list.sort((a, b) => {
          const ta = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
          const tb = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setJobs(list.filter((j) => j.status !== "CLOSED"));
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
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="text-white/80">
            <Link href="/customer">
              <ArrowLeft className="mr-2 h-4 w-4" />
              หน้าหลักลูกค้า
            </Link>
          </Button>
        </div>
        <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-headline">
              <Wrench className="h-5 w-5 text-primary" />
              งานที่อยู่ระหว่างดำเนินการ
            </CardTitle>
            <CardDescription className="text-slate-300">
              รายการงานซ่อมที่ยังดำเนินการอยู่ (เชื่อมจากเบอร์โทรในระบบลูกค้า)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">ยังไม่มีงานที่เปิดอยู่ในขณะนี้</p>
            ) : (
              jobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/customer/jobs/${job.id}`}
                  className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors"
                >
                  <div className="font-bold text-white">{jobDisplayRef(job)}</div>
                  <div className="text-sm text-slate-300 mt-1">{job.customerSnapshot?.name}</div>
                  <div className="text-xs text-primary mt-2 font-medium">
                    {jobStatusLabel(job.status)}
                  </div>
                </Link>
              ))
            )}
            <Button asChild variant="outline" className="w-full border-white/20 text-white mt-4">
              <Link href="/customer/jobs/history">ประวัติงานซ่อม (ปิดงานแล้ว)</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
