
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
  or,
  and,
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
  ClipboardList,
  Wallet,
  PlusCircle,
  Trash2,
  Send,
  CalendarDays
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { jobDisplayRef } from "@/lib/job-display";
import { JOB_STATUSES } from "@/lib/constants";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import type { Job, JobStatus, JobDepartment, Document as DocumentType, AccountingAccount, UserProfile } from "@/lib/types";

const getStatusStyles = (status: Job['status']) => {
  switch (status) {
    case 'RECEIVED': return 'bg-amber-500 text-white border-amber-600 hover:bg-amber-500';
    case 'IN_PROGRESS': return 'bg-cyan-500 text-white border-cyan-600 hover:bg-cyan-500';
    case 'WAITING_QUOTATION': return 'bg-blue-500 text-white border-blue-600 hover:bg-blue-500';
    case 'PENDING_CUSTOMER_INFORM': return 'bg-pink-500 text-white border-pink-600 hover:bg-pink-500';
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

const formatCurrency = (value: number | null | undefined) => (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getJobAgeDays = (job: Job) => {
  const anyJob = job as Job & {
    createdAt?: { toDate?: () => Date } | Date | string;
    lastActivityAt?: { toDate?: () => Date } | Date | string;
  };
  const source = anyJob.createdAt ?? anyJob.lastActivityAt;
  if (!source) return 0;

  let start: Date | null = null;
  if (source instanceof Date) start = source;
  else if (typeof source === "string") {
    const d = new Date(source);
    start = Number.isNaN(d.getTime()) ? null : d;
  } else if (typeof source === "object" && source && "toDate" in source && typeof source.toDate === "function") {
    start = source.toDate();
  }

  if (!start || Number.isNaN(start.getTime())) return 0;
  const diff = Math.floor((Date.now() - start.getTime()) / MS_PER_DAY) + 1;
  return Math.max(1, diff);
};

const getStaleAgeBadgeClass = (days: number) => {
  if (days >= 15) return "bg-red-600 text-white";
  if (days >= 8) return "bg-orange-500 text-white";
  if (days >= 1) return "bg-green-600 text-white";
  return "bg-slate-500 text-white";
};

interface JobListProps {
  department?: JobDepartment;
  status?: JobStatus | JobStatus[];
  excludeStatus?: JobStatus | JobStatus[];
  assigneeUid?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  searchTerm?: string;
  actionPreset?: string;
  sortByOldestInSystem?: boolean;
  showSystemAgeBadge?: boolean;
}

export function JobList({ 
  department, 
  status, 
  excludeStatus, 
  assigneeUid, 
  emptyTitle = "ไม่พบรายการงาน", 
  emptyDescription = "ยังไม่มีรายการงานในระบบ",
  searchTerm = "",
  sortByOldestInSystem = false,
  showSystemAgeBadge = false,
}: JobListProps) {
  type QuickStatusAction = 'APPROVE_JOB' | 'REJECT_JOB' | 'FINISH_JOB' | 'ACCEPT_JOB';

  const { db } = useFirebase();
  const { profile, user } = useAuth();
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

  const [paymentConfirmJob, setPaymentConfirmJob] = useState<Job | null>(null);
  const [paymentConfirmDoc, setPaymentConfirmDoc] = useState<DocumentType | null>(null);
  const [isFetchingDoc, setIsFetchingDoc] = useState(false);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [suggestedPayments, setSuggestedPayments] = useState<{accountId: string, amount: number}[]>([{accountId: '', amount: 0}]);
  const [recordRemainingAsCredit, setRecordRemainingAsCredit] = useState(false);
  const [submitBillingRequired, setSubmitBillingRequired] = useState(false);
  const [submitDueDate, setSubmitDueDate] = useState('');
  const [statusConfirmAction, setStatusConfirmAction] = useState<{ type: QuickStatusAction; job: Job } | null>(null);

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

  const canSeeAccounts = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'OFFICE' || profile.department === 'MANAGEMENT' || profile.department === 'ACCOUNTING_HR';
  }, [profile]);

  useEffect(() => {
    // รอ auth พร้อมก่อน subscribe — ถ้า subscribe เร็วเกินไปจะได้ permission-denied แล้ว effect ไม่รันซ้ำ
    // (เพราะ db ไม่เปลี่ยน) ทำให้หน้าว่างจนกว่าจะ remount จากการนำทางไปหน้าอื่น
    if (!db || !user) return;
    setLoading(true);
    setError(null);
    
    const filters: QueryConstraint[] = [];
    
    if (department) {
      filters.push(or(
        where('department', '==', department),
        where('mainDepartment', '==', department)
      ));
    }
    
    if (assigneeUid) filters.push(where('assigneeUid', '==', assigneeUid));
    if (statusConfig.inStatus.length > 0) filters.push(where('status', 'in', statusConfig.inStatus));
    
    const q = query(
      collection(db, "jobs"), 
      and(...filters),
      orderBy(sortByOldestInSystem ? 'createdAt' : 'lastActivityAt', sortByOldestInSystem ? 'asc' : 'desc'),
      limit(200)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      
      const isPickupView = status === 'WAITING_CUSTOMER_PICKUP' || (Array.isArray(status) && status.includes('WAITING_CUSTOMER_PICKUP'));
      if (isPickupView) {
          jobsData = jobsData.filter(j => !['PENDING_REVIEW', 'APPROVED', 'PAID'].includes(j.salesDocStatus || ""));
      }

      const term = searchTerm.toLowerCase().trim();
      if (term) {
        jobsData = jobsData.filter(j => 
          (j.customerSnapshot?.name || "").toLowerCase().includes(term) ||
          (j.customerSnapshot?.phone || "").includes(term) ||
          (j.description || "").toLowerCase().includes(term) ||
          (j.id && j.id.toLowerCase().includes(term)) ||
          (j.jobNo && j.jobNo.toLowerCase().includes(term)) ||
          (j.carServiceDetails?.licensePlate || "").toLowerCase().includes(term) ||
          (j.carSnapshot?.licensePlate || "").toLowerCase().includes(term)
        );
      }
      if (sortByOldestInSystem) {
        jobsData = [...jobsData].sort((a, b) => getJobAgeDays(b) - getJobAgeDays(a));
      }
      setJobs(jobsData);
      setLoading(false);
    }, (err) => {
      const code = (err as FirestoreError)?.code;
      if (code === 'permission-denied') {
        errorEmitter.emit(
          'permission-error',
          new FirestorePermissionError({ path: 'jobs', operation: 'list' } satisfies SecurityRuleContext)
        );
      }
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexUrl(urlMatch[0]);
      }
      setError(err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, user, department, assigneeUid, statusConfig.key, searchTerm, status, sortByOldestInSystem]);

  useEffect(() => {
    if (!db || !canSeeAccounts) return;
    const q = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
    const unsubscribe = onSnapshot(q, (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
    }, async (err) => {
        if (err.code === 'permission-denied') {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: 'accountingAccounts',
                operation: 'list',
            }));
        }
    });
    return () => unsubscribe();
  }, [db, canSeeAccounts]);

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

  const handleOpenPaymentConfirm = async (job: Job) => {
    if (!db || isFetchingDoc) return;
    if (!job.salesDocId) {
        toast({ variant: 'destructive', title: 'ไม่พบเอกสารบิล', description: 'กรุณาออกบิลก่อนทำรายการส่งมอบค่ะ' });
        return;
    }
    
    setIsFetchingDoc(true);
    try {
        const docSnap = await getDoc(doc(db, "documents", job.salesDocId));
        if (docSnap.exists()) {
            const document = { id: docSnap.id, ...docSnap.data() } as DocumentType;
            
            // SECURITY: If bill is already being reviewed, prevent this dialog
            if (['PENDING_REVIEW', 'APPROVED', 'PAID'].includes(document.status)) {
                toast({ variant: 'destructive', title: 'ไม่สามารถดำเนินการได้', description: 'บิลชุดนี้อยู่ระหว่างตรวจสอบหรือจ่ายเงินแล้ว งานซ่อมควรย้ายหน้าไปที่รอรับเงินค่ะ' });
                setIsFetchingDoc(false);
                return;
            }

            setPaymentConfirmJob(job);
            setPaymentConfirmDoc(document);
            setRecordRemainingAsCredit(document.paymentTerms === 'CREDIT');
            setSubmitBillingRequired(document.billingRequired || false);
            setSubmitDueDate(document.dueDate || '');
            
            const defaultAcc = accounts.find(a => a.type === 'CASH') || accounts[0];
            setSuggestedPayments([{ accountId: defaultAcc?.id || '', amount: document.grandTotal }]);
        } else {
            toast({ variant: 'destructive', title: 'ไม่พบเอกสารบิลในระบบ' });
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: e.message });
    } finally {
        setIsFetchingDoc(false);
    }
  };

  const handleFinalPaymentConfirm = async () => {
    if (!db || !profile || !paymentConfirmJob || !paymentConfirmDoc || isProcessing) return;
    
    const validPayments = suggestedPayments.filter(p => p.amount > 0 && p.accountId);
    if (validPayments.length === 0 && !recordRemainingAsCredit) {
        toast({ variant: 'destructive', title: 'กรุณาระบุการรับเงิน', description: 'ต้องระบุบัญชีรับเงิน หรือเลือกเป็นขายเชื่อ (Credit) ค่ะ' });
        return;
    }

    const currentTotal = suggestedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const remaining = Math.round((paymentConfirmDoc.grandTotal - currentTotal) * 100) / 100;
    
    if (remaining > 0.01 && !recordRemainingAsCredit) {
        toast({ variant: 'destructive', title: 'ยอดเงินไม่ครบ', description: 'ยอดที่ระบุรับเงินไม่ครบตามบิล กรุณาเลือก "บันทึกยอดคงเหลือเป็นลูกหนี้" หรือแก้ไขจำนวนเงินค่ะ' });
        return;
    }

    setIsProcessing(paymentConfirmJob.id);
    try {
        const batch = writeBatch(db);
        const jobRef = doc(db, "jobs", paymentConfirmJob.id);
        const docRef = doc(db, "documents", paymentConfirmDoc.id);

        const finalPayments = validPayments.map(p => {
            const acc = accounts.find(a => a.id === p.accountId);
            return { ...p, amount: Math.round(p.amount * 100) / 100, method: acc?.type === 'CASH' ? 'CASH' : 'TRANSFER' };
        });

        batch.update(docRef, sanitizeForFirestore({
            status: 'PENDING_REVIEW',
            paymentTerms: recordRemainingAsCredit ? 'CREDIT' : 'CASH',
            suggestedPayments: finalPayments,
            billingRequired: recordRemainingAsCredit ? submitBillingRequired : false,
            dueDate: recordRemainingAsCredit ? submitDueDate : null,
            updatedAt: serverTimestamp(),
            dispute: { isDisputed: false, reason: "" }
        }));

        batch.update(jobRef, { 
            status: 'PICKED_UP', 
            salesDocStatus: 'PENDING_REVIEW',
            lastActivityAt: serverTimestamp(), 
            updatedAt: serverTimestamp() 
        });

        batch.set(doc(collection(jobRef, "activities")), { 
            text: `ลูกค้ารับสินค้าแล้ว - ระบุเงื่อนไขการรับเงิน: ${recordRemainingAsCredit ? 'ขายเชื่อ (Credit)' : 'รับเงินสด/โอน'} ยอดรวม ฿${formatCurrency(paymentConfirmDoc.grandTotal)}`, 
            userName: profile.displayName, 
            userId: profile.uid, 
            createdAt: serverTimestamp() 
        });

        await batch.commit();
        toast({ title: "บันทึกการส่งมอบสำเร็จ", description: "ข้อมูลถูกส่งให้ฝ่ายบัญชีตรวจสอบการรับเงินแล้วค่ะ" });
        setPaymentConfirmJob(null);
        setPaymentConfirmDoc(null);
    } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
        setIsProcessing(null);
    }
  };

  const handleUpdatePaymentLine = (index: number, field: 'accountId' | 'amount', value: any) => {
    setSuggestedPayments(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const currentSuggestedTotal = useMemo(() => suggestedPayments.reduce((sum, p) => sum + (p.amount || 0), 0), [suggestedPayments]);
  const remainingInDialog = useMemo(() => {
      if (!paymentConfirmDoc) return 0;
      return Math.round((paymentConfirmDoc.grandTotal - currentSuggestedTotal) * 100) / 100;
  }, [paymentConfirmDoc, currentSuggestedTotal]);
  const statusConfirmConfig = useMemo(() => {
    return {
      APPROVE_JOB: {
        title: "ยืนยันอนุมัติงาน",
        description: "ยืนยันว่าลูกค้าอนุมัติแล้ว และต้องการเปลี่ยนสถานะเป็นกำลังจัดอะไหล่ใช่ไหม?",
        confirmText: "ยืนยันอนุมัติ",
      },
      REJECT_JOB: {
        title: "ยืนยันไม่อนุมัติงาน",
        description: "ยืนยันว่าลูกค้าไม่อนุมัติหรือยกเลิก และต้องการเปลี่ยนสถานะเป็นรอทำบิลใช่ไหม?",
        confirmText: "ยืนยันไม่อนุมัติ",
      },
      FINISH_JOB: {
        title: "ยืนยันแจ้งงานเสร็จ",
        description: "เก็บรายละเอียดงานเรียบร้อยแล้ว และต้องการเปลี่ยนสถานะเป็นรอทำบิลใช่ไหม?",
        confirmText: "ยืนยันงานเสร็จ",
      },
      ACCEPT_JOB: {
        title: "ยืนยันรับงาน",
        description: "ยืนยันว่าคุณพร้อมรับงานนี้และเริ่มดำเนินการใช่ไหม?",
        confirmText: "ยืนยันรับงาน",
      },
    } as const;
  }, []);

  const executeConfirmedStatusAction = async () => {
    if (!statusConfirmAction) return;
    const { type, job } = statusConfirmAction;
    if (type === 'APPROVE_JOB') {
      await handleUpdateStatus(job.id, 'PENDING_PARTS', 'ลูกค้าอนุมัติการซ่อมแล้ว');
    } else if (type === 'REJECT_JOB') {
      await handleUpdateStatus(job.id, 'DONE', 'ลูกค้าไม่อนุมัติการซ่อม - ส่งไป "รอทำบิล"');
    } else if (type === 'FINISH_JOB') {
      await handleUpdateStatus(job.id, 'DONE', 'ช่างแจ้งซ่อมเสร็จสิ้น - รอดำเนินการทำบิล');
    } else if (type === 'ACCEPT_JOB') {
      await handleAcceptJob(job);
    }
    setStatusConfirmAction(null);
  };

  if (indexUrl) return (<div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 border-2 border-dashed rounded-lg"><AlertCircle className="h-12 w-12 text-destructive mb-4" /><h3 className="text-lg font-bold mb-2">ต้องสร้างดัชนี (Index) ก่อน</h3><Button asChild><a href={indexUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md"><ExternalLink className="h-4 w-4" />สร้าง Index</a></Button></div>);
  if (!user) return (<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>);
  if (loading) return (<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>);
  if (error && !indexUrl) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            โหลดรายการงานไม่สำเร็จ
          </CardTitle>
          <CardDescription className="text-destructive/90">
            {error?.message || String(error)}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (jobs.length === 0) return (<Card className="text-center py-12"><CardHeader><CardTitle className="text-muted-foreground">{emptyTitle}</CardTitle><CardDescription>{emptyDescription}</CardDescription></CardHeader></Card>);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {jobs.map((job) => {
          const isOwnDept = profile?.department === job.department;
          const hasActualBill = !!job.salesDocId && (job.salesDocType === 'DELIVERY_NOTE' || job.salesDocType === 'TAX_INVOICE');
          const hasQuotation = !!job.salesDocId && job.salesDocType === 'QUOTATION';
          const isWaitingPickup = job.status === 'WAITING_CUSTOMER_PICKUP';
          const ageDays = getJobAgeDays(job);
          
          return (
            <Card key={job.id} className="flex flex-col overflow-hidden hover:shadow-md transition-shadow">
              <div className="relative aspect-video bg-muted">
                {job.photos?.[0] ? (<Image src={job.photos[0]} alt={job.description} fill className="object-cover" />) : (<div className="flex h-full items-center justify-center text-muted-foreground"><FileImage className="h-10 w-10 opacity-20" /></div>)}
                <Badge className={cn("absolute top-2 right-2 shadow-sm border", getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge>
                {showSystemAgeBadge && ageDays > 0 && (
                  <Badge className={cn("absolute top-2 left-2 shadow-sm border border-black/80 font-bold", getStaleAgeBadgeClass(ageDays))}>
                    ค้าง {ageDays} วัน
                  </Badge>
                )}
              </div>
              <CardHeader className="p-4 space-y-1">
                <CardTitle className="text-base line-clamp-1">{job.customerSnapshot.name}</CardTitle>
                <CardDescription className="text-[10px]">
                  <span className="font-mono font-semibold text-foreground/80">{jobDisplayRef(job)}</span>
                  {' · '}{deptLabel(job.department)} • {safeFormat(job.lastActivityAt, APP_DATE_TIME_FORMAT)}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex-grow"><p className="text-sm line-clamp-2 text-muted-foreground">{job.description}</p></CardContent>
              <CardFooter className="px-4 pb-4 pt-0 flex flex-col gap-2">
                <Button asChild className="w-full h-9" variant="secondary"><Link href={`/app/jobs/${job.id}`}>ดูรายละเอียด <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                <div className="w-full flex flex-col gap-2">
                  {canAssignWork && job.status === 'RECEIVED' && (<Button onClick={() => handleOpenAssignQuick(job)} className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-white font-bold"><UserCheck className="mr-2 h-4 w-4" />มอบหมายงาน</Button>)}
                  
                  {isMgmtOrOffice && job.status === 'PENDING_CUSTOMER_INFORM' && (
                    <Button asChild className="w-full h-9 bg-pink-600 hover:bg-pink-700 text-white font-bold">
                      <Link href={`/app/office/documents/${job.salesDocId}`}>
                        <Send className="mr-2 h-4 w-4" /> แจ้งราคาลูกค้า
                      </Link>
                    </Button>
                  )}

                  {isMgmtOrOffice && job.status === 'WAITING_APPROVE' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button className="h-9 bg-green-600 hover:bg-green-700 text-white font-bold text-[10px]" onClick={() => setStatusConfirmAction({ type: 'APPROVE_JOB', job })} disabled={!!isProcessing}><Check className="mr-1 h-3 w-3" />อนุมัติ</Button>
                      <Button variant="outline" className="h-9 border-destructive text-destructive hover:bg-destructive/10 text-[10px] font-bold" onClick={() => setStatusConfirmAction({ type: 'REJECT_JOB', job })} disabled={!!isProcessing}><Ban className="mr-1 h-3 w-3" />ไม่อนุมัติ</Button>
                    </div>
                  )}
                  
                  {isMgmtOrOffice && job.status === 'PENDING_PARTS' && (
                    <Button asChild className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px]"><Link href={`/app/office/parts/withdraw/new?jobId=${job.id}`}><ClipboardList className="mr-2 h-4 w-4" />เบิกอะไหล่</Link></Button>
                  )}

                  {job.status === 'IN_REPAIR_PROCESS' && (
                    <Button className="w-full h-9 bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => setStatusConfirmAction({ type: 'FINISH_JOB', job })} disabled={!!isProcessing}><CheckCircle2 className="mr-2 h-4 w-4" />งานเสร็จแจ้งทำบิล</Button>
                  )}

                  {isWorker && isOwnDept && job.status === 'RECEIVED' && (<Button onClick={() => setStatusConfirmAction({ type: 'ACCEPT_JOB', job })} disabled={isProcessing === job.id} className="w-full h-9 bg-green-600 hover:bg-green-700 text-white font-bold">{isProcessing === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4" />}รับงานนี้</Button>)}
                  {job.status === 'WAITING_QUOTATION' && !hasActualBill && canDoBilling && (<Button asChild className="w-full h-9 font-bold" variant="default"><Link href={`/app/office/documents/quotation/new?jobId=${job.id}`}><FileText className="mr-2 h-4 w-4" />สร้างใบเสนอราคา</Link></Button>)}
                  
                  {['DONE', 'WAITING_CUSTOMER_PICKUP', 'PICKED_UP', 'CLOSED'].includes(job.status) && (
                    <div className="flex flex-col gap-2 w-full">
                      {isWaitingPickup ? (
                        <Button 
                          onClick={() => handleOpenPaymentConfirm(job)}
                          disabled={isProcessing === job.id || isFetchingDoc || ['PENDING_REVIEW', 'APPROVED', 'PAID'].includes(job.salesDocStatus || "")}
                          className="w-full h-9 bg-primary hover:bg-primary/90 text-white font-bold"
                        >
                          {isProcessing === job.id || isFetchingDoc ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          ลูกค้ารับสินค้า
                        </Button>
                      ) : (hasActualBill || job.status === 'PICKED_UP') ? (
                        <Button asChild variant="outline" className="w-full h-9 border-primary text-primary hover:bg-primary/10 font-bold overflow-hidden">
                          <Link href={`/app/jobs/${job.id}`}>
                            <div className="flex items-center justify-center truncate">
                              <Eye className="mr-2 h-4 w-4 shrink-0" />
                              <span className="truncate">{job.status === 'PICKED_UP' ? 'รอรับเงิน' : (job.status === 'CLOSED' ? 'ดูรายละเอียด' : `ดูบิล ${job.salesDocNo || ""}`)}</span>
                            </div>
                          </Link>
                        </Button>
                      ) : (
                        <>
                          {job.status === 'DONE' && canDoBilling && (<Button className="w-full h-9 border-primary text-primary hover:bg-primary/10 font-bold" variant="outline" onClick={() => setBillingJob(job)}><Receipt className="mr-2 h-4 w-4" />ออกบิล</Button>)}
                          {hasQuotation && (<Button asChild variant="ghost" className="w-full h-8 text-primary hover:text-primary hover:bg-primary/5 text-[10px] font-bold border border-dashed border-primary/20"><Link href={`/app/office/documents/quotation/${job.salesDocId}`}><Eye className="mr-1 h-3 w-3" /> ดูใบเสนอราคา {job.salesDocNo}</Link></Button>)}
                        </>
                      )}
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
          <DialogHeader><DialogHeader><DialogTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-amber-500" />{assigningJob?.department === 'OUTSOURCE' ? 'มอบหมายผู้รับเหมา' : 'มอบหมายพนักงาน'}</DialogTitle></DialogHeader></DialogHeader>
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

      <Dialog open={!!paymentConfirmJob} onOpenChange={(o) => !o && !isProcessing && setPaymentConfirmJob(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>ระบุเงื่อนไขการรับเงิน (Customer Pickup)</DialogTitle>
            <DialogDescription>สำหรับงานซ่อมของ {paymentConfirmJob?.customerSnapshot.name}</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="p-4 bg-primary/5 rounded-lg border flex justify-between items-center">
                <span className="font-semibold">ยอดรวมทั้งสิ้นตามบิล:</span>
                <span className="text-2xl font-black text-primary">฿{formatCurrency(paymentConfirmDoc?.grandTotal)}</span>
              </div>

              <div className="space-y-4">
                <Label className="flex items-center gap-2 font-bold text-primary"><Wallet className="h-4 w-4" /> รายการรับเงินที่ออฟฟิศรับมา</Label>
                <div className="border rounded-md overflow-hidden">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead>บัญชี (Account)</TableHead>
                                <TableHead className="w-32">จำนวน</TableHead>
                                <TableHead className="w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {suggestedPayments.map((p, i) => (
                                <TableRow key={i}>
                                    <TableCell className="p-2">
                                        <Select value={p.accountId} onValueChange={(v) => handleUpdatePaymentLine(i, 'accountId', v)}>
                                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="เลือกบัญชี..."/></SelectTrigger>
                                            <SelectContent>
                                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell className="p-2">
                                        <Input type="number" className="h-8 text-right text-xs" value={p.amount || ''} onChange={(e) => handleUpdatePaymentLine(i, 'amount', parseFloat(e.target.value) || 0)}/>
                                    </TableCell>
                                    <TableCell className="p-2">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setSuggestedPayments(prev => prev.filter((_, idx) => idx !== i))}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <Button variant="outline" size="sm" className="w-full h-8 border-dashed" onClick={() => setSuggestedPayments([...suggestedPayments, {accountId: '', amount: 0}])}>
                    <PlusCircle className="mr-2 h-3 w-3" /> เพิ่มบัญชีรับเงิน
                </Button>

                <div className="pt-4 border-t">
                    <div className={cn("flex justify-between items-center p-3 rounded-md border", remainingInDialog > 0.01 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}><span className="text-sm font-bold">ยอดเงินที่ยังไม่ได้รับ:</span><span className={cn("text-lg font-black", remainingInDialog > 0.01 ? "text-amber-600" : "text-green-600")}>฿{formatCurrency(remainingInDialog)}</span></div>
                    {remainingInDialog > 0.01 && (<div className="mt-4 space-y-4 animate-in fade-in"><div className="flex items-center space-x-2"><Checkbox id="r-credit-list" checked={recordRemainingAsCredit} onCheckedChange={(v: any) => setRecordRemainingAsCredit(v)} /><Label htmlFor="r-credit-list" className="font-bold text-amber-700 cursor-pointer">บันทึกยอดคงเหลือเป็นลูกหนี้ (Credit)</Label></div>{recordRemainingAsCredit && (<div className="grid grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/20"><div className="space-y-2"><Label className="text-xs">วันครบกำหนดชำระ</Label><Input type="date" value={submitDueDate} onChange={e => setSubmitDueDate(e.target.value)} className="h-9" /></div><div className="flex items-center space-x-2 pt-6"><Checkbox id="r-billing-list" checked={submitBillingRequired} onCheckedChange={(v: any) => setSubmitBillingRequired(v)} /><Label htmlFor="r-billing-list" className="text-xs cursor-pointer">ต้องวางบิลรวม</Label></div></div>)}</div>)}</div>
              </div>
          </div>
          
          <DialogFooter className="bg-muted/30 p-6 border-t gap-2"><Button variant="outline" onClick={() => setPaymentConfirmJob(null)} disabled={!!isProcessing}>ยกเลิก</Button><Button onClick={handleFinalPaymentConfirm} disabled={!!isProcessing || (remainingInDialog > 0.01 && !recordRemainingAsCredit) || (suggestedPayments.some(p => p.amount > 0 && !p.accountId))} className="bg-green-600 hover:bg-green-700 font-bold">{isProcessing ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />} ยืนยันและส่งให้บัญชี</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!statusConfirmAction}
        onOpenChange={(open) => {
          if (!open && !isProcessing) setStatusConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction.type].title : "ยืนยันการเปลี่ยนสถานะ"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction.type].description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!isProcessing}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction disabled={!!isProcessing} onClick={executeConfirmedStatusAction}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction.type].confirmText : "ยืนยัน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
