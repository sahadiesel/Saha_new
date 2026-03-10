"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit, 
  doc,
  writeBatch,
  serverTimestamp,
  getDocs,
  getDoc,
  type QueryConstraint, 
  type FirestoreError 
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowRight, 
  Loader2, 
  FileImage, 
  AlertCircle, 
  ExternalLink,
  FileText,
  Receipt,
  UserCheck,
  CheckCircle2,
  Eye,
  RotateCcw,
  Check,
  Ban,
  PackageCheck,
  ClipboardList
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import type { Job, JobStatus, JobDepartment, UserProfile } from "@/lib/types";
import { JOB_STATUSES } from "@/lib/constants";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import { cn, sanitizeForFirestore } from "@/lib/utils";

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
    case 'PICKED_UP': return 'bg-blue-600 text-white border-blue-700 hover:bg-blue-600';
    case 'CLOSED': return 'bg-slate-400 text-white border-slate-500 hover:bg-slate-400';
    default: return 'bg-secondary text-secondary-foreground';
  }
}

interface JobListProps {
  department?: JobDepartment;
  status?: JobStatus | JobStatus[];
  excludeStatus?: JobStatus | JobStatus[];
  assigneeUid?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  searchTerm?: string;
  actionPreset?: string;
}

export function JobList({ 
  department, 
  status, 
  excludeStatus, 
  assigneeUid, 
  emptyTitle = "ไม่พบรายการงาน", 
  emptyDescription = "ยังไม่มีรายการงานในระบบ",
  searchTerm = "",
}: JobListProps) {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);
  const [indexUrl, setIndexUrl] = useState<string | null>(null);

  const [billingJob, setBillingJob] = useState<Job | null>(null);
  const [assigningJob, setAssigningJob] = useState<Job | null>(null);
  const [deptWorkers, setDeptWorkers] = useState<UserProfile[]>([]);
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");

  const statusConfig = useMemo(() => {
    const statusArray = status ? (Array.isArray(status) ? status : [status]) : [];
    const excludeArray = excludeStatus ? (Array.isArray(excludeStatus) ? excludeStatus : [excludeStatus]) : [];
    
    let finalInStatus: JobStatus[] = statusArray;
    if (statusArray.length === 0 && excludeArray.length > 0) {
        finalInStatus = (JOB_STATUSES as unknown as JobStatus[]).filter(s => !excludeArray.includes(s));
    }

    return { 
        inStatus: finalInStatus,
        key: JSON.stringify(finalInStatus)
    };
  }, [status, excludeStatus]);

  const isMgmtOrOffice = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'OFFICE' || profile?.department === 'MANAGEMENT';
  const canAssignWork = isMgmtOrOffice || profile?.role === 'OFFICER';
  const isWorker = profile?.role === 'WORKER';
  const canDoBilling = isMgmtOrOffice;

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    setError(null);
    const qConstraints: QueryConstraint[] = [];
    if (department) qConstraints.push(where('department', '==', department));
    if (assigneeUid) qConstraints.push(where('assigneeUid', '==', assigneeUid));
    if (statusConfig.inStatus.length > 0) qConstraints.push(where('status', 'in', statusConfig.inStatus));
    qConstraints.push(orderBy('lastActivityAt', 'desc'));
    qConstraints.push(limit(200));

    const q = query(collection(db, "jobs"), ...qConstraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      const term = searchTerm.toLowerCase().trim();
      if (term) {
        jobsData = jobsData.filter(j => 
          (j.customerSnapshot?.name || "").toLowerCase().includes(term) ||
          (j.customerSnapshot?.phone || "").includes(term) ||
          (j.description || "").toLowerCase().includes(term) ||
          (j.id && j.id.toLowerCase().includes(term)) ||
          // Vehicle Search
          (j.carServiceDetails?.licensePlate || "").toLowerCase().includes(term) ||
          (j.carServiceDetails?.brand || "").toLowerCase().includes(term) ||
          (j.carServiceDetails?.model || "").toLowerCase().includes(term) ||
          (j.commonrailDetails?.brand || "").toLowerCase().includes(term) ||
          (j.commonrailDetails?.partNumber || "").toLowerCase().includes(term) ||
          (j.commonrailDetails?.registrationNumber || "").toLowerCase().includes(term) ||
          (j.mechanicDetails?.brand || "").toLowerCase().includes(term) ||
          (j.mechanicDetails?.partNumber || "").toLowerCase().includes(term) ||
          (j.mechanicDetails?.registrationNumber || "").toLowerCase().includes(term)
        );
      }
      setJobs(jobsData);
      setLoading(false);
    }, (err) => {
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexUrl(urlMatch[0]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, department, assigneeUid, statusConfig.key, searchTerm]);

  const handleUpdateStatus = async (jobId: string, nextStatus: JobStatus, activityText: string) => {
    if (!db || !profile || isProcessing) return;
    setIsProcessing(jobId);
    try {
      const batch = writeBatch(db);
      const jobRef = doc(db, "jobs", jobId);
      batch.update(jobRef, { status: nextStatus, lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(collection(jobRef, "activities")), { text: activityText, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      await batch.commit();
      toast({ title: "อัปเดตสถานะสำเร็จ" });
    } catch (e: any) { 
      toast({ variant: "destructive", title: "Error", description: e.message }); 
    } finally { setIsProcessing(null); }
  };

  const handleAcceptJob = async (job: Job) => {
    if (!db || !profile || isProcessing) return;
    setIsProcessing(job.id);
    try {
      const batch = writeBatch(db);
      const jobRef = doc(db, "jobs", job.id);
      batch.update(jobRef, { status: 'IN_PROGRESS', assigneeUid: profile.uid, assigneeName: profile.displayName, lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(collection(jobRef, "activities")), { text: `ช่างรับงานเองเรียบร้อยแล้ว`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      await batch.commit();
      toast({ title: "รับงานสำเร็จ" });
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); } finally { setIsProcessing(null); }
  };

  const handleOpenAssignQuick = async (job: Job) => {
    if (!db) return;
    setAssigningJob(job);
    setSelectedWorkerId("");
    setIsLoadingWorkers(true);
    try {
      if (job.department === 'OUTSOURCE') {
        const q = query(collection(db, "vendors"), where("vendorType", "==", "CONTRACTOR"), where("isActive", "==", true));
        const snap = await getDocs(q);
        setDeptWorkers(snap.docs.map(d => ({ uid: d.id, displayName: d.data().companyName } as any)));
      } else {
        const q = query(collection(db, "users"), where("department", "==", job.department), where("status", "==", "ACTIVE"));
        const snap = await getDocs(q);
        setDeptWorkers(snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile)).filter(u => u.role === 'WORKER'));
      }
    } catch (e) { toast({ variant: 'destructive', title: "Error" }); } finally { setIsLoadingWorkers(false); }
  };

  const handleConfirmAssign = async () => {
    if (!db || !profile || !assigningJob || !selectedWorkerId || isProcessing) return;
    const worker = deptWorkers.find(w => w.uid === selectedWorkerId);
    if (!worker) return;
    setIsProcessing(assigningJob.id);
    try {
      const batch = writeBatch(db);
      const jobRef = doc(db, "jobs", assigningJob.id);
      batch.update(jobRef, { status: 'IN_PROGRESS', assigneeUid: worker.uid, assigneeName: worker.displayName, lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(collection(jobRef, "activities")), { text: `มอบหมายงานให้: ${worker.displayName} โดย ${profile.displayName}`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      await batch.commit();
      toast({ title: "มอบหมายงานสำเร็จ" });
      setAssigningJob(null);
    } catch (e: any) { toast({ variant: 'destructive', title: "Error", description: e.message }); } finally { setIsProcessing(null); }
  };

  const handleCustomerPickup = async (job: Job) => {
    if (!db || !profile || isProcessing) return;
    setIsProcessing(job.id);
    try {
      const batch = writeBatch(db);
      const jobRef = doc(db, "jobs", job.id);
      
      // 1. Update Job Status to PICKED_UP
      batch.update(jobRef, { 
        status: 'PICKED_UP', 
        lastActivityAt: serverTimestamp(), 
        updatedAt: serverTimestamp() 
      });
      
      // 2. Update associated document if it exists and is in DRAFT to PENDING_REVIEW (Submit for review)
      if (job.salesDocId) {
        const docRef = doc(db, "documents", job.salesDocId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().status === 'DRAFT') {
          batch.update(docRef, {
            status: 'PENDING_REVIEW',
            updatedAt: serverTimestamp()
          });
        }
      }

      // 3. Log Activity
      batch.set(doc(collection(jobRef, "activities")), { 
        text: `ลูกค้ารับสินค้าแล้ว - เปลี่ยนสถานะเป็น "รับสินค้าแล้ว" และส่งเรื่องให้ฝ่ายบัญชีตรวจสอบการชำระเงิน`, 
        userName: profile.displayName, 
        userId: profile.uid, 
        createdAt: serverTimestamp() 
      });
      
      await batch.commit();
      toast({ title: "บันทึกการรับสินค้าสำเร็จ", description: "งานถูกย้ายไปยังส่วนรอรับเงินแล้วค่ะ" });
    } catch (e: any) { 
      toast({ variant: "destructive", title: "Error", description: e.message }); 
    } finally { setIsProcessing(null); }
  };

  if (indexUrl) return (<div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 border-2 border-dashed rounded-lg"><AlertCircle className="h-12 w-12 text-destructive mb-4" /><h3 className="text-lg font-bold mb-2">ต้องสร้างดัชนี (Index) ก่อน</h3><Button asChild><a href={indexUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />สร้าง Index</a></Button></div>);
  if (loading) return (<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>);
  if (jobs.length === 0) return (<Card className="text-center py-12"><CardHeader><CardTitle className="text-muted-foreground">{emptyTitle}</CardTitle><CardDescription>{emptyDescription}</CardDescription></CardHeader></Card>);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {jobs.map((job) => {
          const isOwnDept = profile?.department === job.department;
          const hasActualBill = !!job.salesDocId && (job.salesDocType === 'DELIVERY_NOTE' || job.salesDocType === 'TAX_INVOICE');
          const hasQuotation = !!job.salesDocId && job.salesDocType === 'QUOTATION';
          const isWaitingPickup = job.status === 'WAITING_CUSTOMER_PICKUP';
          
          return (
            <Card key={job.id} className="flex flex-col overflow-hidden hover:shadow-md transition-shadow">
              <div className="relative aspect-video bg-muted">
                {job.photos?.[0] ? (<Image src={job.photos[0]} alt={job.description} fill className="object-cover" />) : (<div className="flex h-full items-center justify-center text-muted-foreground"><FileImage className="h-10 w-10 opacity-20" /></div>)}
                <Badge className={cn("absolute top-2 right-2 shadow-sm border", getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge>
              </div>
              <CardHeader className="p-4 space-y-1">
                <CardTitle className="text-base line-clamp-1">{job.customerSnapshot.name}</CardTitle>
                <CardDescription className="text-[10px]">{deptLabel(job.department)} • {safeFormat(job.lastActivityAt, APP_DATE_TIME_FORMAT)}</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex-grow"><p className="text-sm line-clamp-2 text-muted-foreground">{job.description}</p></CardContent>
              <CardFooter className="px-4 pb-4 pt-0 flex flex-col gap-2">
                <Button asChild className="w-full h-9" variant="secondary"><Link href={`/app/jobs/${job.id}`}>ดูรายละเอียด <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                <div className="w-full flex flex-col gap-2">
                  {canAssignWork && job.status === 'RECEIVED' && (<Button onClick={() => handleOpenAssignQuick(job)} className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-white font-bold"><UserCheck className="mr-2 h-4 w-4" />มอบหมายงาน</Button>)}
                  {isMgmtOrOffice && job.status === 'WAITING_APPROVE' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        className="h-9 bg-green-600 hover:bg-green-700 text-white font-bold text-[10px]" 
                        onClick={() => handleUpdateStatus(job.id, 'PENDING_PARTS', 'ลูกค้าอนุมัติการซ่อมแล้ว')} 
                        disabled={!!isProcessing}
                      >
                        <Check className="mr-1 h-3 w-3" />อนุมัติ
                      </Button>
                      <Button 
                        variant="outline" 
                        className="h-9 border-destructive text-destructive hover:bg-destructive/10 text-[10px] font-bold" 
                        onClick={() => handleUpdateStatus(job.id, 'DONE', 'ลูกค้าไม่อนุมัติการซ่อม - ส่งไป "รอทำบิล" เพื่อตรวจสอบค่าใช้จ่ายหรือออกบิล 0 บาทค่ะ')} 
                        disabled={!!isProcessing}
                      >
                        <Ban className="mr-1 h-3 w-3" />ไม่อนุมัติ
                      </Button>
                    </div>
                  )}
                  
                  {isMgmtOrOffice && job.status === 'PENDING_PARTS' && (
                    <Button asChild className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px]">
                      <Link href={`/app/office/parts/withdraw/new?jobId=${job.id}`}>
                        <ClipboardList className="mr-2 h-4 w-4" />
                        เบิกอะไหล่
                      </Link>
                    </Button>
                  )}

                  {job.status === 'IN_REPAIR_PROCESS' && (
                    <Button 
                      className="w-full h-9 bg-green-600 hover:bg-green-700 text-white font-bold" 
                      onClick={() => handleUpdateStatus(job.id, 'DONE', 'ช่างแจ้งซ่อมเสร็จสิ้น - รอดำเนินการทำบิล')}
                      disabled={!!isProcessing}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      งานเสร็จแจ้งทำบิล
                    </Button>
                  )}

                  {isWorker && isOwnDept && job.status === 'RECEIVED' && (<Button onClick={() => handleAcceptJob(job)} disabled={isProcessing === job.id} className="w-full h-9 bg-green-600 hover:bg-green-700 text-white font-bold">{isProcessing === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4" />}รับงานนี้</Button>)}
                  {job.status === 'WAITING_QUOTATION' && !hasActualBill && canDoBilling && (<Button asChild className="w-full h-9 font-bold" variant="default"><Link href={`/app/office/documents/quotation/new?jobId=${job.id}`}><FileText className="mr-2 h-4 w-4" />สร้างใบเสนอราคา</Link></Button>)}
                  
                  {['DONE', 'WAITING_CUSTOMER_PICKUP', 'PICKED_UP', 'CLOSED'].includes(job.status) && (
                    <div className="flex flex-col gap-2 w-full">
                      {isWaitingPickup ? (
                        <Button 
                          onClick={() => handleCustomerPickup(job)}
                          disabled={isProcessing === job.id}
                          className="w-full h-9 bg-primary hover:bg-primary/90 text-white font-bold"
                        >
                          {isProcessing === job.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          ลูกค้ารับสินค้า
                        </Button>
                      ) : (hasActualBill || job.status === 'PICKED_UP') ? (
                        <Button asChild variant="outline" className="w-full h-9 border-primary text-primary hover:bg-primary/10 font-bold overflow-hidden">
                          <Link href={`/app/jobs/${job.id}`}>
                            <div className="flex items-center justify-center truncate">
                              <Eye className="mr-2 h-4 w-4 shrink-0" />
                              <span className="truncate">{job.status === 'PICKED_UP' ? 'รอดำเนินการรับเงิน' : (job.status === 'CLOSED' ? 'ดูรายละเอียด' : `ดูบิล ${job.salesDocNo || ""}`)}</span>
                            </div>
                          </Link>
                        </Button>
                      ) : (
                        <>
                          {job.status === 'DONE' && canDoBilling && (<Button className="w-full h-9 border-primary text-primary hover:bg-primary/10 font-bold" variant="outline" onClick={() => setBillingJob(job)}><Receipt className="mr-2 h-4 w-4" />ออกบิล</Button>)}
                          {hasQuotation && (<Button asChild variant="ghost" className="w-full h-8 text-primary hover:text-primary hover:bg-primary/5 text-[10px] font-bold border border-dashed border-primary/20"><Link href={`/app/office/documents/quotation/${job.salesDocId}`}><Eye className="mr-1 h-3 w-3" /> ดูใบเสนอราคา {job.salesDocNo}</Link></Button>)}
                        </>
                      )}
                      {canDoBilling && job.status === 'DONE' && (<Button asChild variant="ghost" className="w-full h-8 text-destructive hover:text-destructive hover:bg-destructive/10 text-[10px] font-bold"><Link href={`/app/jobs/${job.id}?action=revert`}><RotateCcw className="mr-1 h-3 w-3" /> ส่งกลับแก้ไข</Link></Button>)}
                    </div>
                  )}
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>
      
      <Dialog open={!!assigningJob} onOpenChange={(open) => !open && setAssigningJob(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-amber-500" />{assigningJob?.department === 'OUTSOURCE' ? 'มอบหมายผู้รับเหมา' : 'มอบหมายพนักงาน'}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-4">{isLoadingWorkers ? (<div className="flex items-center justify-center p-4 border rounded-md border-dashed"><Loader2 className="h-5 w-5 animate-spin mr-2" /><span>กำลังโหลด...</span></div>) : (<Select value={selectedWorkerId} onValueChange={setSelectedWorkerId}><SelectTrigger><SelectValue placeholder="เลือกรายชื่อ..." /></SelectTrigger><SelectContent>{deptWorkers.length > 0 ? deptWorkers.map(w => (<SelectItem key={w.uid} value={w.uid}>{w.displayName}</SelectItem>)) : <div className="p-4 text-center text-sm italic">ไม่พบรายชื่อ</div>}</SelectContent></Select>)}</div>
          <DialogFooter><Button variant="outline" onClick={() => setAssigningJob(null)}>ยกเลิก</Button><Button onClick={handleConfirmAssign} disabled={!selectedWorkerId || !!isProcessing}>ยืนยัน</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!billingJob} onOpenChange={(open) => !open && setBillingJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>เลือกประเภทเอกสาร</AlertDialogTitle><AlertDialogDescription>เลือกประเภทเอกสารที่ต้องการออกสำหรับงานซ่อมของ <b>{billingJob?.customerSnapshot.name}</b></AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col sm:flex-row gap-2"><Button variant="outline" onClick={() => setBillingJob(null)} className="w-full sm:w-auto">ยกเลิก</Button><Button variant="secondary" onClick={() => { if (billingJob) router.push(`/app/office/documents/delivery-note/new?jobId=${billingJob.id}`); setBillingJob(null); }} className="w-full sm:w-auto">ใบส่งของชั่วคราว</Button><Button onClick={() => { if (billingJob) router.push(`/app/office/documents/tax-invoice/new?jobId=${billingJob.id}`); setBillingJob(null); }} className="w-full sm:w-auto">ใบกำกับภาษี</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}