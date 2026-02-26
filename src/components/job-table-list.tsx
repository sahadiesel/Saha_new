"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  startAfter, 
  QueryDocumentSnapshot, 
  type OrderByDirection, 
  type QueryConstraint, 
  type FirestoreError 
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, PlusCircle, Search, FileImage, LayoutGrid, Table as TableIcon, Eye, AlertCircle, ExternalLink } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Job, JobStatus, JobDepartment } from "@/lib/types";
import { JOB_STATUSES } from "@/lib/constants";
import { safeFormat } from "@/lib/date-utils";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
  limit: limitProp = 20,
  emptyTitle = "ไม่พบรายการงาน",
  emptyDescription = "ไม่มีข้อมูลงานซ่อมที่ตรงกับเงื่อนไข",
  source = 'active',
  year = new Date().getFullYear(),
}: JobTableListProps) {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [indexUrl, setIndexUrl] = useState<string | null>(null);
  
  const [currentPage, setCurrentPage] = useState(0);
  const pageStartCursors = useRef<(QueryDocumentSnapshot | null)[]>([null]);
  const [isLastPage, setIsLastPage] = useState(false);

  // Memoize filter logic to avoid infinite loops from array literals
  const filterConfig = useMemo(() => {
    const excludeArray = excludeStatus ? (Array.isArray(excludeStatus) ? excludeStatus : [excludeStatus]) : [];
    
    // Complement set for allowed statuses
    let finalInStatus: JobStatus[] = [];
    if (status) {
        finalInStatus = [status];
    } else if (excludeArray.length > 0) {
        finalInStatus = (JOB_STATUSES as unknown as JobStatus[]).filter(s => !excludeArray.includes(s));
    }

    return { 
        inStatus: finalInStatus,
        key: JSON.stringify(finalInStatus)
    };
  }, [status, excludeStatus]);

  const fetchData = useCallback(async (pageIndex: number) => {
    if (!db) return;

    setLoading(true);
    setError(null);
    setIndexUrl(null);

    try {
      const isSearch = !!searchTerm.trim();
      const collectionName = source === 'archive' ? `jobsArchive_${year}` : 'jobs';
      
      const qConstraints: QueryConstraint[] = [];
      if (department) qConstraints.push(where('department', '==', department));
      
      // Use 'in' filter which is generally more stable than 'not-in' for ordered queries
      if (filterConfig.inStatus.length > 0) {
        qConstraints.push(where('status', 'in', filterConfig.inStatus));
      }
      
      qConstraints.push(orderBy(orderByField, orderByDirection));

      if (isSearch) {
        qConstraints.push(limit(200));
      } else {
        const cursor = pageStartCursors.current[pageIndex];
        if (cursor) {
          qConstraints.push(startAfter(cursor));
        }
        qConstraints.push(limit(limitProp));
      }

      const q = query(collection(db, collectionName), ...qConstraints);
      const snapshot = await getDocs(q);
      let jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      
      if (isSearch) {
        const term = searchTerm.toLowerCase().trim();
        jobsData = jobsData.filter(j => 
          (j.customerSnapshot?.name || "").toLowerCase().includes(term) ||
          (j.customerSnapshot?.phone || "").includes(term) ||
          (j.description || "").toLowerCase().includes(term) ||
          (j.id && j.id.toLowerCase().includes(term)) ||
          (j.carServiceDetails?.licensePlate || "").toLowerCase().includes(term) ||
          (j.carSnapshot?.licensePlate || "").toLowerCase().includes(term)
        );
        setIsLastPage(true);
      } else {
        setIsLastPage(snapshot.docs.length < limitProp);
        if (snapshot.docs.length > 0) {
          pageStartCursors.current[pageIndex + 1] = snapshot.docs[snapshot.docs.length - 1];
        }
      }
      
      setJobs(jobsData);
    } catch (err: any) {
      console.error("Error fetching jobs:", err);
      setError(err);
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          setIndexUrl(urlMatch[0]);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [db, source, year, department, orderByField, orderByDirection, limitProp, filterConfig.key, searchTerm]);

  useEffect(() => {
    setCurrentPage(0);
    pageStartCursors.current = [null];
    fetchData(0);
  }, [searchTerm, department, filterConfig.key, fetchData]);

  const handleNextPage = () => {
    if (!isLastPage) {
      const nextIdx = currentPage + 1;
      setCurrentPage(nextIdx);
      fetchData(nextIdx);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      const prevIdx = currentPage - 1;
      setCurrentPage(prevIdx);
      fetchData(prevIdx);
    }
  };

  if (indexUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 rounded-lg border-2 border-dashed">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-bold mb-2">ต้องสร้างดัชนี (Index) สำหรับคิวรีนี้</h3>
        <p className="text-muted-foreground mb-6 max-w-md">
          ระบบต้องการการสร้างดัชนีในฐานข้อมูลเพื่อให้สามารถแสดงข้อมูลได้ถูกต้อง กรุณาคลิกปุ่มด้านล่างเพื่อสร้างดัชนี
        </p>
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
                    <div className="font-semibold">{job.customerSnapshot.name}</div>
                    <div className="text-xs text-muted-foreground">{job.customerSnapshot.phone}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><Badge variant="outline" className="font-normal">{deptLabel(job.department)}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate hidden lg:table-cell text-sm text-muted-foreground">{job.description}</TableCell>
                  <TableCell><Badge className={cn(getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge></TableCell>
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
        {!searchTerm && (
          <div className="flex w-full justify-between items-center mt-4">
            <span className="text-sm text-muted-foreground">หน้า {currentPage + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 0}>ก่อนหน้า</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={isLastPage}>ถัดไป</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
