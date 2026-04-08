"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  or,
  and,
  deleteDoc,
  doc,
  type OrderByDirection, 
  type QueryConstraint, 
  type FirestoreError 
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, AlertCircle, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import type { Job, JobStatus, JobDepartment } from "@/lib/types";
import { JOB_STATUSES } from "@/lib/constants";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";
import { cn } from "@/lib/utils";

interface JobTableListProps {
  department?: JobDepartment;
  status?: JobStatus;
  excludeStatus?: JobStatus | JobStatus[];
  searchTerm?: string;
  orderByField?: string;
  orderByDirection?: OrderByDirection;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  source?: 'active' | 'archive';
  year?: number;
}

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

export function JobTableList({ 
  department, 
  status,
  excludeStatus,
  searchTerm = "",
  orderByField = "lastActivityAt",
  orderByDirection = "desc",
  emptyTitle = "ไม่พบรายการงาน",
  emptyDescription = "ไม่มีข้อมูลงานซ่อมที่ตรงกับเงื่อนไข",
  source = 'active',
  year = new Date().getFullYear(),
}: JobTableListProps) {
  const { db } = useFirebase();
  const { profile, user } = useAuth();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [indexUrl, setIndexUrl] = useState<string | null>(null);
  
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isUserAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT';

  const filterConfig = useMemo(() => {
    const excludeArray = excludeStatus ? (Array.isArray(excludeStatus) ? excludeStatus : [excludeStatus]) : [];
    let finalInStatus: JobStatus[] = [];
    if (status) {
        finalInStatus = [status];
    } else if (excludeArray.length > 0) {
        finalInStatus = (JOB_STATUSES as unknown as JobStatus[]).filter(s => !excludeArray.includes(s));
    }
    return { inStatus: finalInStatus, key: JSON.stringify(finalInStatus) };
  }, [status, excludeStatus]);

  const fetchData = useCallback(async () => {
    if (!db || !user) return;

    setLoading(true);
    setError(null);
    setIndexUrl(null);

    try {
      const collectionName = source === 'archive' ? `jobsArchive_${year}` : 'jobs';
      const filters: QueryConstraint[] = [];
      
      if (department) {
        filters.push(or(
          where('department', '==', department),
          where('mainDepartment', '==', department)
        ));
      }

      if (filterConfig.inStatus.length > 0) {
        filters.push(where('status', 'in', filterConfig.inStatus));
      }
      
      const q = query(
        collection(db, collectionName), 
        and(...filters),
        orderBy(orderByField, orderByDirection),
        limit(500)
      );

      const snapshot = await getDocs(q);
      let jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      
      const term = searchTerm.toLowerCase().trim();
      if (term) {
        jobsData = jobsData.filter(j =>
          (j.customerSnapshot?.name || "").toLowerCase().includes(term) ||
          (j.customerSnapshot?.phone || "").includes(term) ||
          (j.description || "").toLowerCase().includes(term) ||
          (j.id && j.id.toLowerCase().includes(term)) ||
          (j.jobNo && j.jobNo.toLowerCase().includes(term)) ||
          (j.carServiceDetails?.licensePlate || "").toLowerCase().includes(term) ||
          (j.carSnapshot?.licensePlate || "").toLowerCase().includes(term) ||
          (j.commonrailDetails?.partNumber || "").toLowerCase().includes(term) ||
          (j.mechanicDetails?.partNumber || "").toLowerCase().includes(term) ||
          (j.commonrailDetails?.registrationNumber || "").toLowerCase().includes(term) ||
          (j.mechanicDetails?.registrationNumber || "").toLowerCase().includes(term)
        );
      }
      
      setJobs(jobsData);
    } catch (err: any) {
      console.error("Error fetching jobs:", err);
      setError(err);
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexUrl(urlMatch[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [db, user, source, year, department, orderByField, orderByDirection, filterConfig.key, searchTerm]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeleteJob = async () => {
    if (!db || !jobToDelete) return;
    setIsDeleting(true);
    try {
      const collectionName = source === 'archive' ? `jobsArchive_${year}` : 'jobs';
      await deleteDoc(doc(db, collectionName, jobToDelete.id));
      toast({ title: "ลบรายการงานซ่อมสำเร็จ" });
      setJobs(prev => prev.filter(j => j.id !== jobToDelete.id));
      setJobToDelete(null);
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col justify-center items-center h-64 gap-4">
        <Loader2 className="animate-spin h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground font-medium">กำลังเตรียมข้อมูล...</p>
      </div>
    );
  }

  if (indexUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 rounded-lg border-2 border-dashed">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-bold mb-2">ต้องสร้างดัชนี (Index) สำหรับคิวรีนี้</h3>
        <Button asChild>
          <a href={indexUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            กดเพื่อสร้าง Index (Firebase Console)
          </a>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 gap-4">
        <Loader2 className="animate-spin h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground font-medium">กำลังเตรียมข้อมูล...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card className="text-center py-16 bg-muted/20 border-dashed">
        <CardHeader>
          <CardTitle className="text-muted-foreground">{searchTerm ? 'ไม่พบข้อมูลที่ตรงกับการค้นหา' : emptyTitle}</CardTitle>
          <CardDescription>{emptyDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-none shadow-none bg-transparent">
        <CardContent className="p-0">
          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
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
                      <div className="font-mono text-[11px] font-bold text-primary mb-0.5">{jobDisplayRef(job)}</div>
                      <div className="font-semibold">{job.customerSnapshot.name}</div>
                      <div className="text-xs text-muted-foreground">{job.customerSnapshot.phone}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="outline" className="font-normal">{deptLabel(job.department)}</Badge></TableCell>
                    <TableCell className="max-w-[200px] truncate hidden lg:table-cell text-sm text-muted-foreground">{job.description}</TableCell>
                    <TableCell><Badge className={cn(getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{safeFormat(job.lastActivityAt, APP_DATE_TIME_FORMAT)}</TableCell>
                    <TableCell className="text-right pr-6">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/app/jobs/${job.id}`} className="flex items-center">
                              <Eye className="mr-2 h-4 w-4" />
                              ดูรายละเอียด
                            </Link>
                          </DropdownMenuItem>
                          {isUserAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive focus:text-destructive font-medium"
                                onClick={() => setJobToDelete(job)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                ลบรายการงานซ่อม
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!jobToDelete} onOpenChange={(o) => !o && setJobToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              ยืนยันการลบงานซ่อม?
            </AlertDialogTitle>
            <AlertDialogDescription>
              คุณกำลังจะลบงานซ่อมของ <span className="font-bold">"{jobToDelete?.customerSnapshot.name}"</span> ออกจากระบบอย่างถาวร 
              การกระทำนี้ไม่สามารถย้อนกลับได้ และข้อมูลกิจกรรมทั้งหมดในใบงานนี้จะหายไปค่ะ
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteJob} 
              className="bg-destructive hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "ยืนยันการลบถาวร"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
