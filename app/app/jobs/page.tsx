"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { collection, onSnapshot, query, type FirestoreError } from "firebase/firestore";
import { useFirebase, useAuth } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, PlusCircle, Search, FileImage, LayoutGrid, Table as TableIcon, Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Job, JobStatus } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

// Helper for safe timestamp comparison
const getSafeTime = (val: any): number => {
    if (!val) return 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds !== undefined) return val.seconds * 1000;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    return 0;
};

const isClosedStatus = (status?: Job['status']) => 
    ["CLOSED", "DONE", "COMPLETED"].includes(String(status || "").toUpperCase());

const getStatusStyles = (status: Job['status']) => {
  switch (status) {
    case 'RECEIVED': return 'bg-amber-500 text-white border-amber-600 hover:bg-amber-500';
    case 'IN_PROGRESS': return 'bg-cyan-500 text-white border-cyan-600 hover:bg-cyan-500';
    case 'WAITING_QUOTATION': return 'bg-blue-500 text-white border-blue-600 hover:bg-blue-500';
    case 'WAITING_APPROVE': return 'bg-orange-500 text-white border-orange-600 hover:bg-orange-500';
    case 'PENDING_PARTS': return 'bg-purple-500 text-white border-purple-600 hover:bg-purple-500';
    case 'IN_REPAIR_PROCESS': return 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-600';
    case 'DONE': return 'bg-green-500 text-white border-green-600 hover:bg-green-500';
    case 'WAITING_CUSTOMER_PICKUP': return 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-600 shadow-sm';
    case 'CLOSED': return 'bg-slate-400 text-white border-slate-500 hover:bg-slate-400';
    default: return 'bg-secondary text-secondary-foreground';
  }
}

// Job Card for Grid/List views
function JobCard({ job }: { job: Job }) {
  return (
    <Card className="flex flex-col overflow-hidden group hover:shadow-md transition-all">
      <div className="relative aspect-video w-full bg-muted">
        {/* Status Badge at Top Right */}
        <Badge 
          className={cn(
            "absolute top-2 right-2 z-10 shadow-sm text-[10px] px-2 py-0.5 border", 
            getStatusStyles(job.status),
            job.status === 'RECEIVED' && "animate-blink"
          )}
        >
          {jobStatusLabel(job.status)}
        </Badge>

        {job.photos && job.photos.length > 0 ? (
            <Image
                src={job.photos[0]}
                alt={job.description || "Job image"}
                fill
                className="object-cover group-hover:scale-105 transition-transform"
            />
        ) : (
            <div className="flex h-full w-full items-center justify-center">
                <FileImage className="h-10 w-10 text-muted-foreground/50" />
            </div>
        )}
      </div>
      <CardHeader className="p-4 space-y-1">
        <CardTitle className="text-base font-bold line-clamp-1">{job.customerSnapshot.name}</CardTitle>
        <CardDescription className="text-xs">
          {deptLabel(job.department)}
          <br />
          อัปเดต: {safeFormat(job.lastActivityAt, 'PP')}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex-grow">
        <p className="line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
      </CardContent>
      <CardFooter className="px-4 pb-4 pt-0">
        <Button asChild variant="secondary" size="sm" className="w-full h-8 rounded-full">
          <Link href={`/app/jobs/${job.id}`}>
            ดูรายละเอียด
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Compact Job Card for Board View
function CompactJobCard({ job }: { job: Job }) {
    return (
        <Card className="mb-2 hover:border-primary/50 transition-colors shadow-none border bg-card">
            <CardContent className="p-3">
                <div className="flex gap-3">
                    {job.photos && job.photos.length > 0 && (
                        <div className="relative w-12 h-12 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                            <Image src={job.photos[0]} alt="Job" fill className="object-cover" />
                        </div>
                    )}
                    <div className="flex-grow overflow-hidden">
                        <p className="font-semibold text-sm truncate">{job.customerSnapshot.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{job.description}</p>
                        <div className="flex justify-between items-center mt-2">
                            <Badge className={cn("text-[9px] px-1 h-4 border", getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge>
                            <Button asChild size="icon" variant="ghost" className="h-6 w-6 rounded-full">
                                <Link href={`/app/jobs/${job.id}`}><Eye className="h-3.5 w-3.5" /></Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

// Kanban Board Component
function JobsStatusBoard({ jobs }: { jobs: Job[] }) {
    const statusColumns: JobStatus[] = ['RECEIVED', 'IN_PROGRESS', 'WAITING_QUOTATION', 'WAITING_APPROVE', 'PENDING_PARTS', 'IN_REPAIR_PROCESS'];
    
    const jobsByStatus = useMemo(() => {
        const grouped: Record<string, Job[]> = {};
        jobs.forEach(job => {
            const statusKey = statusColumns.includes(job.status) ? job.status : 'OTHER';
            if (!grouped[statusKey]) grouped[statusKey] = [];
            grouped[statusKey].push(job);
        });
        
        for (const status in grouped) {
            grouped[status].sort((a, b) => getSafeTime(b.lastActivityAt) - getSafeTime(a.lastActivityAt));
        }
        return grouped;
    }, [jobs]);

    const allColumnKeys = [...statusColumns, ...(jobsByStatus['OTHER']?.length > 0 ? ['OTHER'] : [])];

    return (
        <ScrollArea className="w-full">
            <div className="flex gap-4 pb-4">
                {allColumnKeys.map(statusKey => {
                    const columnJobs = jobsByStatus[statusKey] || [];
                    return (
                        <div key={statusKey} className="w-[280px] shrink-0">
                            <div className="bg-muted/30 rounded-lg p-3 h-full flex flex-col border">
                                <div className="flex justify-between items-center mb-3 px-1">
                                    <h3 className="text-sm font-bold text-muted-foreground">{jobStatusLabel(statusKey as JobStatus) || statusKey}</h3>
                                    <Badge variant="secondary" className="h-5 text-[10px] px-1.5">{columnJobs.length}</Badge>
                                </div>
                                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-22rem)] scrollbar-hide">
                                    {columnJobs.length > 0 ? (
                                        columnJobs.map(job => <CompactJobCard key={job.id} job={job} />)
                                    ) : (
                                        <div className="flex items-center justify-center h-20 text-muted-foreground text-[10px] border-2 border-dashed rounded-lg bg-card/50">ไม่มีงาน</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    );
}

// Table View Component
function JobsTable({ jobs }: { jobs: Job[] }) {
  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardContent className="p-0">
        <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
            <TableHeader className="bg-muted/50">
                <TableRow>
                <TableHead className="pl-6">ลูกค้า (Customer)</TableHead>
                <TableHead className="hidden md:table-cell">แผนก</TableHead>
                <TableHead className="hidden lg:table-cell">รายละเอียด</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="hidden md:table-cell">อัปเดตล่าสุด</TableHead>
                <TableHead className="text-right pr-6">จัดการ</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {jobs.map(job => (
                <TableRow key={job.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="pl-6 py-4">
                    <div className="font-semibold">{job.customerSnapshot.name}</div>
                    <div className="text-xs text-muted-foreground">{job.customerSnapshot.phone}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="outline" className="font-normal">{deptLabel(job.department)}</Badge></TableCell>
                    <TableCell className="max-w-[200px] truncate hidden lg:table-cell text-sm text-muted-foreground">{job.description}</TableCell>
                    <TableCell><Badge className={cn("border", getStatusStyles(job.status), job.status === 'RECEIVED' && "animate-blink")}>{jobStatusLabel(job.status)}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{safeFormat(job.lastActivityAt, 'dd MMM yy HH:mm')}</TableCell>
                    <TableCell className="text-right pr-6">
                    <Button asChild variant="secondary" size="icon" className="h-8 w-8 rounded-full shadow-sm">
                        <Link href={`/app/jobs/${job.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                    </TableCell>
                </TableRow>
                ))}
            </TableBody>
            </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Main Page Component
export default function ManagementJobsPage() {
    const [searchTerm, setSearchTerm] = useState("");
    const [desktopView, setDesktopView] = useState<'table' | 'board'>('table');
    const { db } = useFirebase();
    const { toast } = useToast();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db) return;
        setLoading(true);
        const q = query(collection(db, "jobs"));
        const unsubscribe = onSnapshot(q, 
            (snapshot) => {
                const jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
                setJobs(jobsData);
                setLoading(false);
            }, 
            async (error: any) => {
                if (error.code === 'permission-denied') {
                  const permissionError = new FirestorePermissionError({
                    path: 'jobs',
                    operation: 'list',
                  } satisfies SecurityRuleContext);
                  errorEmitter.emit('permission-error', permissionError);
                } else {
                  toast({ variant: "destructive", title: "Error loading jobs", description: error.message });
                }
                setLoading(false);
            }
        );
        return () => unsubscribe();
    }, [db, toast]);

    const visibleJobs = useMemo(() => {
        let openJobs = jobs.filter(j => !isClosedStatus(j.status));
        const q = searchTerm.trim().toLowerCase();
        if (q) {
            openJobs = openJobs.filter(j =>
                (j.customerSnapshot?.name || "").toLowerCase().includes(q) ||
                (j.customerSnapshot?.phone || "").includes(q) ||
                (j.description || "").toLowerCase().includes(q) ||
                (j.carServiceDetails?.licensePlate || "").toLowerCase().includes(q) ||
                (j.carSnapshot?.licensePlate || "").toLowerCase().includes(q)
            );
        }
        return openJobs;
    }, [jobs, searchTerm]);

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex flex-col justify-center items-center h-64 gap-4">
                    <Loader2 className="animate-spin h-10 w-10 text-primary" />
                    <p className="text-sm text-muted-foreground font-medium">กำลังเตรียมข้อมูลภาพรวม...</p>
                </div>
            )
        }
        if (visibleJobs.length === 0) {
            return (
                <Card className="text-center py-16 bg-muted/20 border-dashed">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground">{searchTerm ? 'ไม่พบย่านที่ตรงกับการค้นหา' : 'ไม่มีงานที่กำลังดำเนินการ'}</CardTitle>
                        <CardDescription>งานใหม่จะปรากฏที่นี่ทันทีที่มีการเปิดรับงาน</CardDescription>
                    </CardHeader>
                </Card>
            )
        }
        return (
          <>
            {/* Desktop View */}
            <div className="hidden lg:block">
              {desktopView === 'table' ? <JobsTable jobs={visibleJobs} /> : <JobsStatusBoard jobs={visibleJobs} />}
            </div>
            {/* Mobile View */}
            <div className="grid grid-cols-1 gap-4 lg:hidden">
              {visibleJobs.map(job => <JobCard key={job.id} job={job} />)}
            </div>
          </>
        );
    };

    return (
        <div className="space-y-6">
            <PageHeader title="ภาพรวมงานซ่อม" description="ติดตามและจัดการงานซ่อมทั้งหมดในระบบ">
                 <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1 sm:flex-initial">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="ค้นหาชื่องาน/ลูกค้า/ทะเบียน..."
                            className="w-full rounded-lg bg-background pl-9 sm:w-[250px]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                     <div className="hidden lg:flex items-center gap-1 rounded-lg bg-muted p-1 border">
                        <Button variant={desktopView === 'table' ? 'secondary' : 'ghost'} size="sm" className="h-8 px-3" onClick={() => setDesktopView('table')}><TableIcon className="h-3.5 w-3.5 mr-1.5" /> Table</Button>
                        <Button variant={desktopView === 'board' ? 'secondary' : 'ghost'} size="sm" className="h-8 px-3" onClick={() => setDesktopView('board')}><LayoutGrid className="h-3.5 w-3.5 mr-1.5"/> Board</Button>
                    </div>
                    <Button asChild className="shadow-md">
                        <Link href="/app/office/intake">
                            <PlusCircle className="h-4 w-4 mr-2" />
                            เปิดงานใหม่
                        </Link>
                    </Button>
                </div>
            </PageHeader>
            <div className="space-y-4">
                {renderContent()}
            </div>
        </div>
    );
}
