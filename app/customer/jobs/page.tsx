"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Wrench, Search } from "lucide-react";
import type { Job } from "@/lib/types";
import { CustomerJobCard } from "@/components/customer-portal/customer-job-card";
import { jobDisplayRef } from "@/lib/job-display";

export default function CustomerJobsActivePage() {
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!db || !profile?.phone) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "jobs"), where("customerId", "==", profile.phone), limit(120));
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

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const compact = searchTerm.replace(/\D/g, "");
    if (!term && !compact) return jobs;
    return jobs.filter((j) => {
      const ref = jobDisplayRef(j).toLowerCase();
      const name = (j.customerSnapshot?.name || "").toLowerCase();
      const desc = (j.description || "").toLowerCase();
      const plate =
        `${j.carServiceDetails?.licensePlate || ""} ${j.commonrailDetails?.registrationNumber || ""} ${j.mechanicDetails?.registrationNumber || ""}`.toLowerCase();
      if (term && (ref.includes(term) || name.includes(term) || desc.includes(term) || plate.includes(term)))
        return true;
      if (compact.length >= 3 && (j.customerSnapshot?.phone || "").replace(/\D/g, "").includes(compact))
        return true;
      return false;
    });
  }, [jobs, searchTerm]);

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-16 pt-24 md:pt-28 max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="text-white/80">
            <Link href="/customer">
              <ArrowLeft className="mr-2 h-4 w-4" />
              หน้าหลักลูกค้า
            </Link>
          </Button>
        </div>

        <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md">
          <CardHeader className="space-y-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-headline">
                <Wrench className="h-5 w-5 text-primary" />
                งานที่อยู่ระหว่างดำเนินการ
              </CardTitle>
              <CardDescription className="text-slate-300">
                งานซ่อมที่เชื่อมกับเบอร์โทรของคุณในระบบ — คลิกการ์ดเพื่อดูรายละเอียด เอกสาร และพูดคุยกับศูนย์
              </CardDescription>
            </div>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="ค้นหาเลขงาน, ชื่อ, รายละเอียด, ทะเบียน..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-slate-950/50 border-white/15"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                {jobs.length === 0 ? "ยังไม่มีงานที่เปิดอยู่ในขณะนี้" : "ไม่พบงานที่ตรงกับการค้นหา"}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((job) => (
                  <CustomerJobCard key={job.id} job={job} />
                ))}
              </div>
            )}
            <Button asChild variant="outline" className="w-full border-white/20 text-white hover:bg-white/10">
              <Link href="/customer/jobs/history">ประวัติงานซ่อม (ปิดงานแล้ว)</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
