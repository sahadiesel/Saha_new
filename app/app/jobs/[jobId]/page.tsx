"use client";

import { useState, useEffect, useMemo, Suspense, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from 'next/link';
import { doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, Timestamp, collection, query, where, getDocs, getDoc, writeBatch, orderBy, deleteField, getCountFromServer, type Query } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { safeFormat, APP_DATE_FORMAT, APP_DATE_TIME_FORMAT } from '@/lib/date-utils';
import { jobStatusLabel, deptLabel, docStatusLabel, deptCode } from "@/lib/ui-labels";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { JOB_DEPARTMENTS, type JobStatus, DATA_LIMITS } from "@/lib/constants";
import { isJobActivityHiddenFromTimeline } from "@/lib/job-activity-display";
import { Loader2, User, Clock, X, Send, Save, AlertCircle, Camera, FileText, CheckCircle, ArrowLeft, Ban, PackageCheck, Check, UserCheck, Edit, Phone, Receipt, ImageIcon, BookOpen, Eye, Trash2, Forward, History, RotateCcw, ClipboardList, PlusCircle, Undo2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Job, JobActivity, JobDepartment, Document as DocumentType, DocType, UserProfile, Vendor } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobVehicleDetails } from "@/components/job-details/job-vehicle-details";
import { JobCustomerChatPanel } from "@/components/customer-portal/job-customer-chat-panel";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { restoreJobFromArchive, JOB_RESTORE_STATUS_OPTIONS } from "@/firebase/jobs-archive";
import { archiveCollectionNameByYear, getGregorianArchiveYearFromDateString } from "@/lib/archive-utils";
import { jobDisplayRef } from "@/lib/job-display";

const FILE_SIZE_THRESHOLD = 500 * 1024; // 500KB

/** เอกสารอ้างอิงบนหน้างาน — จำกัดชนิดให้ตรงกับ Record ป้ายชื่อ (แก้ TS บน DocType กว้าง) */
const JOB_REFERENCE_DOC_TYPES = ["QUOTATION", "DELIVERY_NOTE", "TAX_INVOICE", "RECEIPT"] as const;
type JobReferenceDocType = (typeof JOB_REFERENCE_DOC_TYPES)[number];
const JOB_REFERENCE_DOC_LABELS: Record<JobReferenceDocType, string> = {
  QUOTATION: "ใบเสนอราคา",
  DELIVERY_NOTE: "ใบส่งของชั่วคราว",
  TAX_INVOICE: "ใบกำกับภาษี",
  RECEIPT: "ใบเสร็จรับเงิน",
};

// --- Helpers ---
const getSafeTime = (val: any): number => {
    if (!val) return 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds !== undefined) return val.seconds * 1000;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    return 0;
};

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

/** หลังส่งงานข้ามแผนก — คงสายซ่อม/อะไหล่ ไม่รีเซ็ตเป็นรอรับงาน */
function statusAfterSubDepartmentHandoff(current: JobStatus): JobStatus {
  if (current === "IN_REPAIR_PROCESS" || current === "PENDING_PARTS") return current;
  if (current === "IN_PROGRESS") return "IN_REPAIR_PROCESS";
  if (current === "WAITING_QUOTATION" || current === "WAITING_APPROVE") return current;
  return "RECEIVED";
}

const compressImageIfNeeded = async (file: File): Promise<File> => {
  if (file.size <= FILE_SIZE_THRESHOLD) return file;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let quality = 0.9;
        const attemptCompression = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                if (blob.size <= FILE_SIZE_THRESHOLD || q <= 0.1) {
                  const compressedFile = new File([blob], file.name, {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                } else {
                  attemptCompression(q - 0.1);
                }
              } else {
                resolve(file); // Fallback to original
              }
            },
            "image/jpeg",
            q
          );
        };
        attemptCompression(quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

function JobDetailsPageContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const quickCameraRef = useRef<HTMLInputElement>(null);
  const quickGalleryRef = useRef<HTMLInputElement>(null);
  const activityPhotoDialogCameraRef = useRef<HTMLInputElement>(null);
  const activityPhotoDialogGalleryRef = useRef<HTMLInputElement>(null);
  /** กันบันทึกซ้ำระหว่างอัปโหลด (ก่อน state isSubmittingNote ทัน) */
  const activityPhotoSubmitLockRef = useRef(false);
  const quickJobPhotoUploadLockRef = useRef(false);

  const jobId = useMemo(() => {
    const id = params?.jobId;
    return (Array.isArray(id) ? id[0] : id) as string;
  }, [params]);

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundInPrimary, setNotFoundInPrimary] = useState(false);
  const [archiveYear, setArchiveYear] = useState<number | null>(null);
  
  const [activityPhotoDialogOpen, setActivityPhotoDialogOpen] = useState(false);
  const [activityPhotoFiles, setActivityPhotoFiles] = useState<File[]>([]);
  const [activityPhotoPreviews, setActivityPhotoPreviews] = useState<string[]>([]);
  const [activityPhotoCaption, setActivityPhotoCaption] = useState("");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isAddingPhotos, setIsAddingPhotos] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [transferDepartment, setTransferDepartment] = useState<JobDepartment | ''>('');
  const [transferNote, setTransferNote] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);

  const [isSubTransferDialogOpen, setIsSubTransferDialogOpen] = useState(false);
  const [subTransferDept, setSubTransferDept] = useState<JobDepartment | ''>('');
  
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [departmentWorkers, setDepartmentWorkers] = useState<WithId<UserProfile>[]>([]);
  const [isFetchingWorkers, setIsFetchingWorkers] = useState(false);
  const [reassignWorkerId, setReassignWorkerId] = useState<string | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);

  const [techReport, setTechReport] = useState("");
  const [isSavingTechReport, setIsSavingTechReport] = useState(false);

  const [relatedDocuments, setRelatedDocuments] = useState<Partial<Record<DocType, DocumentType[]>>>({});
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [withdrawals, setWithdrawals] = useState<DocumentType[]>([]);

  const [isEditDescriptionDialogOpen, setIsEditDescriptionDialogOpen] = useState(false);
  const [descriptionToEdit, setDescriptionToEdit] = useState("");
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);

  const [isEditNotebookDialogOpen, setIsEditNotebookDialogOpen] = useState(false);

  const [isEditVehicleDialogOpen, setIsEditVehicleDialogOpen] = useState(false);
  const [vehicleEditData, setVehicleEditData] = useState<any>({});
  const [isUpdatingVehicle, setIsUpdatingVehicle] = useState(false);

  const [isRevertDialogOpen, setIsRevertDialogOpen] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const [isReverting, setIsReverting] = useState(false);

  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [restoreTargetStatus, setRestoreTargetStatus] = useState<JobStatus>('DONE');
  const [isRestoring, setIsRestoring] = useState(false);

  const [isBillingSelectionOpen, setIsBillingSelectionOpen] = useState(false);
  const [statusConfirmAction, setStatusConfirmAction] = useState<null | 'REQUEST_QUOTATION' | 'FINISH_JOB' | 'RETURN_TO_MAIN' | 'RETURN_TO_HANDOFF' | 'APPROVE_JOB' | 'REJECT_JOB' | 'PARTS_READY' | 'REQUEST_MORE_PARTS'>(null);

  const isSubTask = useMemo(() => job?.mainDepartment && job.department !== job.mainDepartment, [job]);

  /** แผนกที่ส่งงานย่อยได้: ไม่ออฟฟิศ / ไม่ซ้ำแผนกปัจจุบัน / ไม่ส่งกลับแผนกหลักโดยตรง (ใช้ปุ่มส่งกลับแผนกหลัก) */
  const subTransferTargets = useMemo((): JobDepartment[] => {
    if (!job) return [];
    const main = job.mainDepartment;
    return JOB_DEPARTMENTS.filter(
      (d) => d !== "OFFICE" && d !== job.department && (!main || d !== main)
    ) as JobDepartment[];
  }, [job]);

  /** ส่งต่อได้เฉพาะตอนอยู่ที่แผนกหลัก — พอส่งไปแผนกย่อยแล้วให้ใช้แต่ปุ่มส่งกลับ */
  const canSubTransfer =
    !!job &&
    !isSubTask &&
    subTransferTargets.length > 0 &&
    ["RECEIVED", "IN_PROGRESS", "WAITING_QUOTATION", "WAITING_APPROVE", "PENDING_PARTS", "IN_REPAIR_PROCESS"].includes(job.status);

  const showReturnToHandoff =
    !!job &&
    isSubTask &&
    job.subTaskHandoffSource &&
    job.subTaskHandoffSource !== job.mainDepartment &&
    ["RECEIVED", "IN_PROGRESS", "WAITING_QUOTATION", "WAITING_APPROVE", "PENDING_PARTS", "IN_REPAIR_PROCESS"].includes(job.status);

  const activitiesQuery = useMemo(() => {
    if (!db || !jobId) return null;
    if (job?.isArchived || archiveYear != null) {
      const year =
        archiveYear != null
          ? archiveYear
          : getGregorianArchiveYearFromDateString(job?.closedDate || "");
      return query(collection(db, archiveCollectionNameByYear(year), jobId, "activities"), orderBy("createdAt", "desc"));
    }
    return query(collection(db, "jobs", jobId, "activities"), orderBy("createdAt", "desc"));
  }, [db, jobId, job?.isArchived, job?.closedDate, archiveYear]);

  const { data: activities, isLoading: activitiesLoading } = useCollection<JobActivity>(
    activitiesQuery as Query<JobActivity> | null
  );

  const visibleActivities = useMemo(() => {
    const list = activities ?? [];
    return list.filter((a) => !isJobActivityHiddenFromTimeline(a.text));
  }, [activities]);

  const isStaff = profile?.role !== 'VIEWER';
  const isUserAdmin = profile?.role === 'ADMIN';
  /** ตรงกับ isMgmt() ใน Firestore — ลบทั้งรายการกิจกรรม / ลบรูปในบล็อกกิจกรรม */
  const canDeleteEntireActivity =
    profile?.uid === "oh3jF10Am4PPGelNzFhjWX6GE5E2" ||
    profile?.role === "ADMIN" ||
    profile?.role === "MANAGER" ||
    profile?.department === "MANAGEMENT";

  const isMgmtOrOffice = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'OFFICE' || profile?.department === 'MANAGEMENT';
  const canIssueBill = isMgmtOrOffice && isStaff;
  const canManageWork = isMgmtOrOffice || profile?.role === 'OFFICER';
  /** อนุมัติ/ไม่อนุมัติใบเสนอราคา (รอลูกค้า) — ตามระบบเดิม: ฝ่ายบริหาร/ออฟฟิศ + เจ้าหน้าที่ (OFFICER) */
  const canConfirmWaitingQuotation = canManageWork;
  
  const allowEditing = searchParams.get('edit') === 'true' && isUserAdmin;
  
  const isTechnicalDept = ['CAR_SERVICE', 'COMMONRAIL', 'MECHANIC', 'OUTSOURCE'].includes(profile?.department || '');
  /** แชตกับลูกค้า (พอร์ทัล) — แสดงเฉพาะฝ่ายออฟฟิศ; แอดมินเห็นได้ทุกงาน */
  const showStaffCustomerPortalChat =
    profile?.role === "ADMIN" || profile?.department === "OFFICE";
  const isJobInFinishedState = job?.status === 'DONE' || job?.status === 'WAITING_CUSTOMER_PICKUP' || job?.status === 'CLOSED';

  const isViewOnly = job?.isArchived || 
                     profile?.role === 'VIEWER' || 
                     (isJobInFinishedState && !allowEditing);

  const canUpdateActivity = isStaff && !isViewOnly;
  
  const isLockedForBilled = (job?.status === 'WAITING_CUSTOMER_PICKUP' || !!job?.salesDocId) && !allowEditing;
  const canEditDetails = isStaff && canManageWork && !job?.isArchived && (job?.status !== 'CLOSED' || allowEditing) && !isLockedForBilled;

  const canEditIntakePhotos = isMgmtOrOffice && isStaff && !isViewOnly;

  const isAlreadyBilled = useMemo(() => {
    if (!job) return false;
    if (job.isArchived) return true;
    if (job.status === 'CLOSED') return true;
    if (job.status === 'WAITING_CUSTOMER_PICKUP') return true;
    const hasActiveBillField = !!job.salesDocId && (job.salesDocType === 'DELIVERY_NOTE' || job.salesDocType === 'TAX_INVOICE');
    if (hasActiveBillField) return true;
    const hasLiveDn = relatedDocuments['DELIVERY_NOTE']?.some(d => d.status !== 'CANCELLED');
    const hasLiveTi = relatedDocuments['TAX_INVOICE']?.some(d => d.status !== 'CANCELLED');
    return !!(hasLiveDn || hasLiveTi);
  }, [job, relatedDocuments]);

  useEffect(() => {
    if (searchParams.get('action') === 'revert' && job?.status === 'DONE' && canIssueBill) {
      setIsRevertDialogOpen(true);
    }
  }, [searchParams, job?.status, canIssueBill]);

  const getJobRef = () => {
    if (!db || !job) return null;
    if (job.isArchived || archiveYear != null) {
      const year =
        archiveYear != null ? archiveYear : getGregorianArchiveYearFromDateString(job.closedDate || "");
      return doc(db, archiveCollectionNameByYear(year), jobId);
    }
    return doc(db, "jobs", jobId);
  };

  const getActivityDocRef = (activityId: string) => {
    if (!db || !job || !activityId) return null;
    if (job.isArchived || archiveYear != null) {
      const year =
        archiveYear != null ? archiveYear : getGregorianArchiveYearFromDateString(job.closedDate || "");
      return doc(db, archiveCollectionNameByYear(year), jobId, "activities", activityId);
    }
    return doc(db, "jobs", jobId, "activities", activityId);
  };

  useEffect(() => {
    if (!db || !jobId) return;
    setLoadingDocs(true);
    const docsQuery = query(collection(db, "documents"), where("jobId", "==", jobId));
    const unsubscribeDocs = onSnapshot(docsQuery, (snapshot) => {
        const allDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DocumentType));
        const grouped: Partial<Record<DocType, DocumentType[]>> = {};
        const relevantDocTypes: DocType[] = ['QUOTATION', 'DELIVERY_NOTE', 'TAX_INVOICE', 'RECEIPT'];
        const wdDocs: DocumentType[] = [];

        for (const docItem of allDocs) {
            if (docItem.docType === 'WITHDRAWAL') {
                wdDocs.push(docItem);
            } else if (relevantDocTypes.includes(docItem.docType)) {
                if (!grouped[docItem.docType]) grouped[docItem.docType] = [];
                grouped[docItem.docType]!.push(docItem);
            }
        }
        for (const docType in grouped) {
            grouped[docType as DocType]!.sort((a, b) => getSafeTime(b.createdAt) - getSafeTime(a.createdAt));
        }
        setRelatedDocuments(grouped);
        setWithdrawals(wdDocs.sort((a,b) => getSafeTime(b.createdAt) - getSafeTime(a.createdAt)));
        setLoadingDocs(false);
    }, (error) => {
        console.error("Error fetching related documents:", error);
        setLoadingDocs(false);
    });

    return () => { unsubscribeDocs(); };
  }, [db, jobId]);

  useEffect(() => {
    if (!jobId || !db) return;
    const jobDocRef = doc(db, "jobs", jobId);
    const unsubscribe = onSnapshot(jobDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const jobData = { id: docSnap.id, ...docSnap.data() } as Job;
        setJob(jobData);
        setTechReport(jobData.technicalReport || jobData.officeNote || "");
        setLoading(false);
        setNotFoundInPrimary(false);
      } else {
        setNotFoundInPrimary(true);
      }
    }, (error) => {
      setLoading(false);
    });
    return () => unsubscribe();
  }, [jobId, db]);

  useEffect(() => {
    if (notFoundInPrimary && db && jobId) {
      setLoading(true);
      const searchArchives = async () => {
        const currentYear = new Date().getFullYear();
        for (let i = 0; i <= 5; i++) {
          const year = currentYear - i;
          try {
            const archiveDocRef = doc(db, `jobsArchive_${year}`, jobId);
            const docSnap = await getDoc(archiveDocRef);
            if (docSnap.exists()) {
              const jobData = { id: docSnap.id, ...docSnap.data(), isArchived: true } as Job;
              setJob(jobData);
              setArchiveYear(year);
              setTechReport(jobData.technicalReport || jobData.officeNote || "");
              setLoading(false);
              return;
            }
          } catch (e) {}
        }
        setLoading(false);
      };
      searchArchives();
    }
  }, [notFoundInPrimary, db, jobId]);

  const handleOpenEditDescriptionDialog = () => {
    setDescriptionToEdit(job?.description || "");
    setIsEditDescriptionDialogOpen(true);
  }

  const handleUpdateDescription = async () => {
    const jobDocRef = getJobRef();
    if (!db || !job || !profile || !jobDocRef) return;
    setIsUpdatingDescription(true);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { description: descriptionToEdit, lastActivityAt: serverTimestamp() });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `แก้ไขรายการแจ้งซ่อม`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    
    batch.commit().then(() => {
      toast({ title: "อัปเดตรายการแจ้งซ่อมสำเร็จ" });
      setIsEditDescriptionDialogOpen(false);
    }).catch(async (error) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: jobDocRef.path,
        operation: 'update',
        requestResourceData: { description: descriptionToEdit },
      }));
    }).finally(() => {
      setIsUpdatingDescription(false);
    });
  };

  const handleUpdateNotebook = async () => {
    const jobDocRef = getJobRef();
    if (!db || !job || !profile || !jobDocRef) return;
    setIsSavingTechReport(true);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { technicalReport: techReport, officeNote: deleteField(), lastActivityAt: serverTimestamp() });

    batch.commit().then(() => {
      toast({ title: "บันทึกสมุดบันทึกสำเร็จ" });
      setIsEditNotebookDialogOpen(false);
    }).catch(async (error) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: jobDocRef.path,
        operation: 'update',
        requestResourceData: { technicalReport: techReport },
      }));
    }).finally(() => {
      setIsSavingTechReport(false);
    });
  };

  const handleOpenEditVehicleDialog = () => {
    if (!job) return;
    const data = job.carServiceDetails || job.commonrailDetails || job.mechanicDetails || {};
    setVehicleEditData(data);
    setIsEditVehicleDialogOpen(true);
  };

  const handleUpdateVehicleDetails = async () => {
    const jobDocRef = getJobRef();
    if (!db || !job || !profile || !jobDocRef) return;
    setIsUpdatingVehicle(true);
    let fieldName = 'carServiceDetails';
    if (job.commonrailDetails || job.department === 'COMMONRAIL') fieldName = 'commonrailDetails';
    else if (job.mechanicDetails || job.department === 'MECHANIC') fieldName = 'mechanicDetails';
    
    const batch = writeBatch(db);
    batch.update(jobDocRef, { [fieldName]: vehicleEditData, lastActivityAt: serverTimestamp() });

    batch.commit().then(() => {
      toast({ title: "อัปเดตรายละเอียดสำเร็จ" });
      setIsEditVehicleDialogOpen(false);
    }).catch(async (error) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: jobDocRef.path,
        operation: 'update',
        requestResourceData: { [fieldName]: vehicleEditData },
      }));
    }).finally(() => {
      setIsUpdatingVehicle(false);
    });
  };

  const handleActivityPhotoDialogFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (activityPhotoFiles.length + files.length > DATA_LIMITS.MAX_ACTIVITY_PHOTOS) {
      toast({
        variant: "destructive",
        title: `แนบรูปได้สูงสุด ${DATA_LIMITS.MAX_ACTIVITY_PHOTOS} รูปต่อครั้งค่ะ`,
      });
      return;
    }
    setIsCompressing(true);
    try {
      const newFiles: File[] = [];
      const newPreviews: string[] = [];
      for (const file of files) {
        const processed = await compressImageIfNeeded(file);
        newFiles.push(processed);
        newPreviews.push(URL.createObjectURL(processed));
      }
      setActivityPhotoFiles((prev) => [...prev, ...newFiles]);
      setActivityPhotoPreviews((prev) => [...prev, ...newPreviews]);
    } catch {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาดในการจัดการรูปภาพ" });
    } finally {
      setIsCompressing(false);
    }
  };

  const removeActivityPhotoAtIndex = (index: number) => {
    const url = activityPhotoPreviews[index];
    if (url) URL.revokeObjectURL(url);
    setActivityPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setActivityPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitActivityPhotos = async () => {
    const jobDocRef = getJobRef();
    const caption = activityPhotoCaption.trim();
    if (activityPhotoFiles.length === 0) {
      toast({ variant: "destructive", title: "กรุณาแนบรูปภาพ", description: "เลือกหรือถ่ายรูปอย่างน้อย 1 รูปก่อนบันทึกค่ะ" });
      return;
    }
    if (!caption) {
      toast({
        variant: "destructive",
        title: "กรุณาอธิบายวัตถุประสงค์ของรูป",
        description: "เขียนสั้นๆ ว่ารูปนี้แสดงอะไร เช่น น้ำมันมีสิ่งเจือปน",
      });
      return;
    }
    if (!db || !profile || !job || !jobDocRef || !storage) return;

    const activitiesCountSnap = await getCountFromServer(collection(jobDocRef, "activities"));
    if (activitiesCountSnap.data().count >= DATA_LIMITS.MAX_ACTIVITY_LOGS) {
      toast({
        variant: "destructive",
        title: "รายการกิจกรรมเต็ม",
        description: `ไม่สามารถบันทึกเพิ่มได้เนื่องจากเกิน ${DATA_LIMITS.MAX_ACTIVITY_LOGS} รายการ`,
      });
      return;
    }

    if (activityPhotoSubmitLockRef.current) return;
    activityPhotoSubmitLockRef.current = true;
    setIsSubmittingNote(true);
    try {
      const photoURLs: string[] = [];
      for (const photo of activityPhotoFiles) {
        const photoRef = ref(storage, `jobs/${jobId}/activity/${Date.now()}-${photo.name}`);
        await uploadBytes(photoRef, photo);
        photoURLs.push(await getDownloadURL(photoRef));
      }
      const batch = writeBatch(db);
      const updateData: Record<string, unknown> = { lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() };
      if (job.status === "RECEIVED") {
        updateData.status = "IN_PROGRESS";
        if (!job.assigneeUid) {
          updateData.assigneeUid = profile.uid;
          updateData.assigneeName = profile.displayName;
        }
      }
      batch.set(doc(collection(jobDocRef, "activities")), {
        text: `แนบรูปกิจกรรม: ${caption}`,
        userName: profile.displayName,
        userId: profile.uid,
        createdAt: serverTimestamp(),
        photos: photoURLs,
      });
      batch.update(jobDocRef, updateData);
      await batch.commit();
      setActivityPhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
      setActivityPhotoFiles([]);
      setActivityPhotoCaption("");
      setActivityPhotoDialogOpen(false);
      toast({ title: "บันทึกรูปกิจกรรมสำเร็จ" });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === "permission-denied") {
        errorEmitter.emit("permission-error", new FirestorePermissionError({ path: jobDocRef.path, operation: "write" }));
      } else {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: err.message });
      }
    } finally {
      activityPhotoSubmitLockRef.current = false;
      setIsSubmittingNote(false);
    }
  };

  const handleQuickPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const jobDocRef = getJobRef();
    if (!e.target.files || !jobId || !db || !profile || !jobDocRef || !job) { e.target.value = ''; return; }
    if (quickJobPhotoUploadLockRef.current) {
      e.target.value = "";
      return;
    }
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const currentPhotoCount = job?.photos?.length || 0;
    if (currentPhotoCount + files.length > DATA_LIMITS.MAX_INTAKE_PHOTOS) {
      toast({ variant: "destructive", title: `อัปโหลดรูปภาพรวมกันได้ไม่เกิน ${DATA_LIMITS.MAX_INTAKE_PHOTOS} รูปค่ะ` });
      e.target.value = ''; return;
    }
    
    quickJobPhotoUploadLockRef.current = true;
    setIsAddingPhotos(true);
    setIsCompressing(true);
    try {
        const photoURLs: string[] = [];
        for (const file of files) {
            const processed = await compressImageIfNeeded(file);
            const photoRef = ref(storage!, `jobs/${jobId}/photos/${Date.now()}-${processed.name}`);
            await uploadBytes(photoRef, processed);
            photoURLs.push(await getDownloadURL(photoRef));
        }
        const batch = writeBatch(db);
        batch.set(doc(collection(jobDocRef, "activities")), { text: `เพิ่มรูปประกอบงาน (ตอนรับงาน) ${photoURLs.length} รูป`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp(), photos: photoURLs });
        const updateData: any = { photos: arrayUnion(...photoURLs), lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (job.status === 'RECEIVED') {
            updateData.status = 'IN_PROGRESS';
            if (!job.assigneeUid) { updateData.assigneeUid = profile.uid; updateData.assigneeName = profile.displayName; }
        }
        batch.update(jobDocRef, updateData);
        await batch.commit();
        toast({title: `อัปโหลดรูปภาพสำเร็จแล้วค่ะ`});
    } catch(error: any) {
        if (error.code === 'permission-denied') {
            errorEmitter.emit('permission-error', new FirestorePermissionError({ path: jobDocRef.path, operation: 'write', requestResourceData: { photosCount: files.length } }));
        } else {
            toast({variant: "destructive", title: "อัปโหลดล้มเหลว", description: error.message});
        }
    } finally { 
      quickJobPhotoUploadLockRef.current = false;
      setIsAddingPhotos(false); 
      setIsCompressing(false);
      e.target.value = ''; 
    }
  }

  const handleDeletePhoto = async (url: string) => {
    const jobDocRef = getJobRef();
    if (!db || !storage || !profile || !job || !jobDocRef) return;
    if (!confirm("คุณต้องการลบรูปภาพนี้ออกจากระบบถาวรใช่หรือไม่?")) return;
    setIsAddingPhotos(true);
    try {
      const batch = writeBatch(db);
      batch.update(jobDocRef, { photos: arrayRemove(url), lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(collection(jobDocRef, "activities")), { text: `ลบรูปภาพประกอบงานออก 1 รูป`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      await batch.commit();
      await deleteObject(ref(storage, url)).catch(e => console.warn("File already deleted", e));
      toast({ title: "ลบรูปภาพสำเร็จแล้วค่ะ" });
    } catch (error: any) { toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: error.message }); } finally { setIsAddingPhotos(false); }
  };

  const handleDeleteEntireActivity = async (activity: JobActivity) => {
    if (!db || !storage || !profile || !canDeleteEntireActivity || !activity.id) return;
    const preview =
      activity.text?.slice(0, 120) || (activity.photos?.length ? `แนบรูป ${activity.photos.filter(Boolean).length} รูป` : "รายการนี้");
    if (
      !confirm(
        `ลบรายการกิจกรรมนี้ทั้งหมดจากระบบถาวร?\n\n${preview}${activity.text && activity.text.length > 120 ? "…" : ""}\n\nรูปใน Storage จะถูกลบด้วย (ถ้ามี)`
      )
    ) {
      return;
    }
    const activityRef = getActivityDocRef(activity.id);
    if (!activityRef) return;

    setDeletingActivityId(activity.id);
    try {
      const urls = (activity.photos || []).filter(Boolean) as string[];
      await Promise.all(urls.map((url) => deleteObject(ref(storage, url)).catch((err) => console.warn("activity storage delete", err))));
      await deleteDoc(activityRef);
      toast({ title: "ลบรายการกิจกรรมแล้ว" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: msg });
    } finally {
      setDeletingActivityId(null);
    }
  };

  const handleDeleteActivityPhoto = async (activityId: string, url: string) => {
    if (!db || !storage || !profile || !canDeleteEntireActivity) return;
    if (deletingActivityId) return;
    if (job?.isArchived) {
        toast({ variant: "destructive", title: "ไม่สามารถลบรูปในประวัติได้" });
        return;
    }
    if (!confirm("คุณต้องการลบรูปภาพกิจกรรมนี้ออกจากระบบถาวรใช่หรือไม่?")) return;
    
    setIsSubmittingNote(true);
    try {
        const activityRef = doc(db, "jobs", jobId, "activities", activityId);
        
        await updateDoc(activityRef, {
            photos: arrayRemove(url)
        });
        
        await deleteObject(ref(storage, url)).catch(e => console.warn("File already deleted from storage", e));
        
        toast({ title: "ลบรูปกิจกรรมสำเร็จแล้วค่ะ" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: error.message });
    } finally {
        setIsSubmittingNote(false);
    }
  };

  const handleTransferJob = async () => {
    if (!canEditDetails || !transferDepartment || !job || !db || !profile) return;
    setIsTransferring(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { department: transferDepartment, mainDepartment: transferDepartment, subTaskHandoffSource: deleteField(), status: 'RECEIVED', assigneeUid: null, assigneeName: null, lastActivityAt: serverTimestamp() });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `มีการเปลี่ยนแปลงแผนกหลักเป็น ${deptCode(transferDepartment)}. หมายเหตุ: ${transferNote || 'ไม่มี'}`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    batch.commit().then(() => {
      toast({ title: 'โอนย้ายแผนกสำเร็จ' });
      setIsTransferDialogOpen(false);
    }).catch(e => toast({ variant: 'destructive', title: "Error", description: e.message })).finally(() => setIsTransferring(false));
  };

  const handleSubTransfer = async () => {
    if (!db || !profile || !job || !subTransferDept) return;
    if (subTransferDept === job.department) {
      toast({ variant: "destructive", title: "เลือกแผนกปลายทางต่างจากแผนกปัจจุบัน" });
      return;
    }
    if (job.subTaskHandoffSource && subTransferDept === job.subTaskHandoffSource) {
      toast({ variant: "destructive", title: "ต้องการส่งกลับแผนกเดิม — ใช้ปุ่ม \"ส่งงานกลับแผนกก่อนหน้า\"" });
      return;
    }
    setIsTransferring(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    const nextStatus = statusAfterSubDepartmentHandoff(job.status);
    const mainDept = job.mainDepartment ?? job.department;
    batch.update(jobDocRef, {
      department: subTransferDept,
      mainDepartment: mainDept,
      subTaskHandoffSource: job.department,
      status: nextStatus,
      assigneeUid: null,
      assigneeName: null,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `ส่งงานต่อให้แผนก: ${deptLabel(subTransferDept)} เพื่อดำเนินการย่อย (จาก ${deptLabel(job.department)})`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    batch
      .commit()
      .then(() => {
        toast({ title: `ส่งงานต่อไปยังแผนก ${deptCode(subTransferDept)} เรียบร้อย` });
        setIsSubTransferDialogOpen(false);
      })
      .catch((e) => toast({ variant: "destructive", title: "Error", description: e.message }))
      .finally(() => setIsTransferring(false));
  };

  const handleReturnToMain = async () => {
    if (!db || !profile || !job || !job.mainDepartment) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, {
      department: job.mainDepartment,
      status: "IN_REPAIR_PROCESS",
      subTaskHandoffSource: deleteField(),
      assigneeUid: null,
      assigneeName: null,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `แผนกย่อย (${deptLabel(job.department)}) ส่งงานกลับแผนกหลัก (${deptLabel(job.mainDepartment)})`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    batch.commit().then(() => toast({ title: "ส่งงานกลับแผนกหลักเรียบร้อยแล้วค่ะ" }))
    .catch(e => toast({ variant: 'destructive', title: 'Error', description: e.message }))
    .finally(() => setIsSubmittingNote(false));
  };

  const handleReturnToHandoff = async () => {
    if (!db || !profile || !job?.subTaskHandoffSource) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    const back = job.subTaskHandoffSource;
    const from = job.department;
    batch.update(jobDocRef, {
      department: back,
      subTaskHandoffSource: from,
      status: "IN_REPAIR_PROCESS",
      assigneeUid: null,
      assigneeName: null,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(jobDocRef, "activities")), {
      text: `ส่งงานกลับแผนกก่อนหน้า: ${deptLabel(back)} (จาก ${deptLabel(from)})`,
      userName: profile.displayName,
      userId: profile.uid,
      createdAt: serverTimestamp(),
    });
    batch
      .commit()
      .then(() => toast({ title: "ส่งงานกลับแผนกก่อนหน้าเรียบร้อย" }))
      .catch((e) => toast({ variant: "destructive", title: "Error", description: e.message }))
      .finally(() => setIsSubmittingNote(false));
  };

  const handleFinishJob = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { status: 'DONE', lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `ช่างแจ้งซ่อมเสร็จสิ้น - รอดำเนินการทำบิล`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    batch.commit().then(() => {
        toast({ title: "บันทึกแจ้งทำบิลสำเร็จ", description: "สถานะงานเปลี่ยนเป็น 'DONE' แล้วค่ะ กรุณาแจ้งแผนกออฟฟิศเพื่อออกบิลนะคะ" });
    })
    .catch(e => toast({ variant: 'destructive', title: 'Error', description: e.message }))
    .finally(() => setIsSubmittingNote(false));
  };

  const handleRequestQuotation = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { 
      status: 'WAITING_QUOTATION', 
      lastActivityAt: serverTimestamp(), 
      updatedAt: serverTimestamp() 
    });
    batch.set(doc(collection(jobDocRef, "activities")), { 
      text: `แจ้งฝ่ายออฟฟิศเพื่อขอใบเสนอราคา (Request Quotation)`, 
      userName: profile.displayName, 
      userId: profile.uid, 
      createdAt: serverTimestamp() 
    });
    batch.commit().then(() => {
        toast({ title: "ส่งคำขอเสนอราคาแล้ว", description: "ฝ่ายออฟฟิศจะได้รับแจ้งเพื่อดำเนินการออกใบเสนอราคาค่ะ" });
    })
    .catch(e => toast({ variant: 'destructive', title: 'Error', description: e.message }))
    .finally(() => setIsSubmittingNote(false));
  };

  const handleRequestMoreParts = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { 
      status: 'PENDING_PARTS', 
      lastActivityAt: serverTimestamp(), 
      updatedAt: serverTimestamp() 
    });
    batch.set(doc(collection(jobDocRef, "activities")), { 
      text: `ช่างแจ้งเบิกอะไหล่เพิ่ม (สถานะเปลี่ยนเป็น: กำลังจัดเตรียมอะไหล่)`, 
      userName: profile.displayName, 
      userId: profile.uid, 
      createdAt: serverTimestamp() 
    });
    batch.commit().then(() => toast({ title: "ส่งแจ้งเบิกอะไหล่เพิ่มแล้ว" })).finally(() => setIsSubmittingNote(false));
  };

  const handleRevertJob = async () => {
    if (!db || !profile || !job || !revertReason.trim()) return;
    setIsReverting(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    
    batch.update(jobDocRef, {
      status: 'IN_REPAIR_PROCESS',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(doc(collection(jobDocRef, "activities")), {
      text: `ฝ่ายออฟฟิศส่งงานกลับไปแก้ไข: ${revertReason.trim()}`,
      userName: profile.displayName,
      userId: profile.uid,
      createdAt: serverTimestamp()
    });

    try {
      await batch.commit();
      toast({ title: "ส่งกลับแก้ไขสำเร็จ", description: "งานถูกส่งกลับไปยังสถานะกำลังดำเนินการซ่อมแล้วค่ะ" });
      setIsRevertDialogOpen(false);
      setRevertReason("");
      router.replace(`/app/jobs/${jobId}`, { scroll: false });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsReverting(false);
    }
  };

  const handleRestoreJob = async () => {
    if (!db || !profile || !job || !(job.isArchived || archiveYear != null)) return;
    setIsRestoring(true);
    try {
      const year =
        archiveYear != null ? archiveYear : getGregorianArchiveYearFromDateString(job.closedDate || "");
      if (!year) {
        throw new Error('ไม่พบปีของประวัติงาน — ลองเปิดงานจากรายการประวัติอีกครั้ง');
      }
      await restoreJobFromArchive(db, job.id, year, profile, restoreTargetStatus);
      toast({
        title: "กู้คืนงานสำเร็จ",
        description: `ย้ายกลับไปที่ Jobs แล้ว — สถานะ: ${jobStatusLabel(restoreTargetStatus)}`,
      });
      setIsRestoreDialogOpen(false);
      setArchiveYear(null);
      setNotFoundInPrimary(false);
      router.replace(`/app/jobs/${job.id}`);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'กู้คืนไม่สำเร็จ', description: e.message });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleApproveJob = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { 
      status: 'PENDING_PARTS', 
      lastActivityAt: serverTimestamp(), 
      updatedAt: serverTimestamp() 
    });
    batch.set(doc(collection(jobDocRef, "activities")), { 
      text: `ลูกค้าอนุมัติการซ่อมเรียบร้อยแล้ว (สถานะ: กำลังจัดอะไหล่)`, 
      userName: profile.displayName, 
      userId: profile.uid, 
      createdAt: serverTimestamp() 
    });
    batch.commit().then(() => toast({ title: "อนุมัติงานสำเร็จ" })).finally(() => setIsSubmittingNote(false));
  };

  const handleRejectJob = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, { 
      status: 'DONE', // Transition to DONE instead of CLOSED
      lastActivityAt: serverTimestamp(), 
      updatedAt: serverTimestamp() 
    });
    batch.set(doc(collection(jobDocRef, "activities")), { 
      text: `ลูกค้าไม่อนุมัติการซ่อม / ยกเลิกงาน - ปรับสถานะเป็น "รอทำบิล" (DONE) เพื่อให้ฝ่ายออฟฟิศตรวจสอบค่าใช้จ่ายหรือออกบิล 0 บาทตามขั้นตอนค่ะ`, 
      userName: profile.displayName, 
      userId: profile.uid, 
      createdAt: serverTimestamp() 
    });
    batch.commit().then(() => toast({ title: "เปลี่ยนสถานะเป็นรอทำบิลเรียบร้อย" })).finally(() => setIsSubmittingNote(false));
  };

  const handlePartsReady = async () => {
    if (!db || !profile || !job) return;
    setIsSubmittingNote(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    batch.update(jobDocRef, {
      status: 'IN_REPAIR_PROCESS',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(jobDocRef, "activities")), {
      text: `อะไหล่มาครบแล้ว เริ่มดำเนินการซ่อม`,
      userName: profile.displayName,
      userId: profile.uid,
      createdAt: serverTimestamp()
    });
    batch.commit().then(() => toast({ title: "เริ่มดำเนินการซ่อมแล้ว" })).finally(() => setIsSubmittingNote(false));
  };

  const statusConfirmConfig = useMemo(() => {
    return {
      REQUEST_QUOTATION: {
        title: "ยืนยันแจ้งเสนอราคา",
        description: "คุณได้ใส่รายการที่ต้องการให้เสนอราคาให้เรียบร้อยโดยบันทึกไว้ในส่วนสมุดบันทึกแล้ว ใช่ไหม?",
        confirmText: "ใช่, แจ้งเสนอราคา",
        onConfirm: handleRequestQuotation,
      },
      FINISH_JOB: {
        title: "ยืนยันแจ้งงานเสร็จทำบิล",
        description: "เก็บรายละเอียดงาน และตรวจสอบสินค้าเรียบร้อย พร้อมที่จะส่งให้ลูกค้าแล้วใช่ไหม?",
        confirmText: "ใช่, งานเสร็จแจ้งทำบิล",
        onConfirm: handleFinishJob,
      },
      RETURN_TO_MAIN: {
        title: "ยืนยันส่งงานกลับแผนกหลัก",
        description: "ยืนยันว่าแผนกย่อยดำเนินการเสร็จแล้ว และพร้อมส่งงานกลับแผนกหลักใช่ไหม?",
        confirmText: "ยืนยันส่งกลับแผนกหลัก",
        onConfirm: handleReturnToMain,
      },
      RETURN_TO_HANDOFF: {
        title: "ยืนยันส่งงานกลับแผนกก่อนหน้า",
        description:
          "ยืนยันว่าต้องการส่งงานกลับให้แผนกที่ส่งงานต่อมาให้คุณ เพื่อดำเนินการต่อที่แผนกนั้นใช่ไหม? สถานะจะเป็นกำลังดำเนินการซ่อมเพื่อรองรับการเบิกอะไหล่เพิ่มตามใบเสนอราคา",
        confirmText: "ยืนยันส่งกลับแผนกก่อนหน้า",
        onConfirm: handleReturnToHandoff,
      },
      APPROVE_JOB: {
        title: "ยืนยันอนุมัติเริ่มซ่อม",
        description: "ยืนยันว่าลูกค้าอนุมัติแล้ว และพร้อมเปลี่ยนสถานะไปจัดเตรียมอะไหล่ใช่ไหม?",
        confirmText: "ยืนยันอนุมัติ",
        onConfirm: handleApproveJob,
      },
      REJECT_JOB: {
        title: "ยืนยันลูกค้าไม่อนุมัติ/ยกเลิก",
        description: "ยืนยันว่าลูกค้าไม่อนุมัติงานนี้ และต้องการเปลี่ยนสถานะเป็นรอทำบิลใช่ไหม?",
        confirmText: "ยืนยันไม่อนุมัติ",
        onConfirm: handleRejectJob,
      },
      PARTS_READY: {
        title: "ยืนยันอะไหล่มาครบ",
        description: "ตรวจสอบว่าอะไหล่ครบแล้ว และพร้อมเริ่มดำเนินการซ่อมใช่ไหม?",
        confirmText: "ยืนยันเริ่มซ่อม",
        onConfirm: handlePartsReady,
      },
      REQUEST_MORE_PARTS: {
        title: "ยืนยันแจ้งเบิกอะไหล่เพิ่ม",
        description: "ยืนยันว่าจำเป็นต้องเบิกอะไหล่เพิ่ม และพร้อมเปลี่ยนสถานะไปรออะไหล่ใช่ไหม?",
        confirmText: "ยืนยันแจ้งเบิกเพิ่ม",
        onConfirm: handleRequestMoreParts,
      },
    } as const;
  }, [handleApproveJob, handleFinishJob, handlePartsReady, handleRejectJob, handleRequestMoreParts, handleRequestQuotation, handleReturnToHandoff, handleReturnToMain]);

  const handleOpenReassignDialog = async () => {
    if (!db || !job) return;
    setIsReassignDialogOpen(true);
    setReassignWorkerId(null);
    setIsFetchingWorkers(true);
    try {
      if (job.department === 'OUTSOURCE') {
        const q = query(collection(db, "vendors"), where("vendorType", "==", "CONTRACTOR"), where("isActive", "==", true));
        const snapshot = await getDocs(q);
        setDepartmentWorkers(snapshot.docs.map(d => ({ 
            id: d.id, 
            displayName: d.data().contactName || d.data().companyName || d.data().shortName 
        } as any)));
      } else {
        const q = query(collection(db, "users"), where("department", "==", job.department), where("role", "==", "WORKER"), where("status", "==", "ACTIVE"));
        const snapshot = await getDocs(q);
        setDepartmentWorkers(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as WithId<UserProfile>)));
      }
    } catch (e) { toast({ variant: 'destructive', title: "Error" }); } finally { setIsFetchingWorkers(false); }
  };

  const handleReassignJob = async () => {
    if (!db || !profile || !job || !reassignWorkerId) return;
    const worker = departmentWorkers.find(w => w.id === reassignWorkerId);
    if (!worker) return;
    setIsReassigning(true);
    const jobDocRef = doc(db, "jobs", job.id);
    const batch = writeBatch(db);
    const nextStatus = job.status === 'RECEIVED' ? 'IN_PROGRESS' : job.status;
    batch.update(jobDocRef, { assigneeUid: worker.id, assigneeName: worker.displayName, status: nextStatus, lastActivityAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(collection(jobDocRef, "activities")), { text: `มอบหมายงานให้: ${worker.displayName}`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
    batch.commit().then(() => {
      toast({ title: "ดำเนินการสำเร็จ" });
      setIsReassignDialogOpen(false);
    }).finally(() => setIsReassigning(false));
  };

  if (loading || !job) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

  return (
    <>
      <Button variant="outline" size="sm" className="mb-4" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> ย้อนกลับ</Button>
      <PageHeader
        title={`Job: ${job.customerSnapshot.name}`}
        description={
          job.jobNo
            ? `เลขที่ใบงาน: ${jobDisplayRef(job)} · รหัสอ้างอิง: ${job.id}`
            : `เลขที่ใบงาน: ${jobDisplayRef(job)}`
        }
      />
      
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {(job.isArchived || archiveYear) && isUserAdmin && (
            <Card className="border-amber-500 bg-amber-50 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-amber-700 flex items-center gap-2 text-base">
                  <RotateCcw className="h-5 w-5" />
                  เครื่องมือ Admin: กู้คืนงานจากประวัติ
                </CardTitle>
                <CardDescription className="text-amber-600 text-xs">
                  หากงานนี้ถูกปิดโดยผิดพลาด สามารถกู้คืนเพื่อให้ฝ่ายออฟฟิศจัดการต่อได้ค่ะ
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="border-amber-600 text-amber-700 hover:bg-amber-100 w-full font-bold"
                  onClick={() => {
                    setRestoreTargetStatus('DONE');
                    setIsRestoreDialogOpen(true);
                  }}
                  disabled={isRestoring}
                >
                  {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  กู้คืนกลับไปที่ Jobs
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>รายละเอียดใบงาน</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><h4 className="font-semibold text-base">ลูกค้า</h4><p>{job.customerSnapshot.name} (<a href={`tel:${job.customerSnapshot.phone}`} className="text-primary hover:underline inline-flex items-center gap-1"><Phone className="h-3 w-3" />{job.customerSnapshot.phone}</a>)</p></div>
              <div className="flex gap-8">
                <div><h4 className="font-semibold text-base">แผนกที่ดูแล</h4><Badge className={cn("text-sm border", getStatusStyles(job.status))}>{deptLabel(job.department)}</Badge></div>
                {job.mainDepartment && job.mainDepartment !== job.department && (
                    <div><h4 className="font-semibold text-base text-muted-foreground">แผนกหลัก</h4><Badge variant="outline" className="text-sm">{deptLabel(job.mainDepartment)}</Badge></div>
                )}
              </div>
              {job.assigneeName && <div><h4 className="font-semibold text-base">{job.department === 'OUTSOURCE' ? 'ผู้รับเหมา' : 'ผู้รับผิดชอบ'}</h4><p>{job.assigneeName}</p></div>}
              <div><div className="flex items-center gap-4"><h4 className="font-semibold text-base">รายการแจ้งซ่อม</h4>{canEditDetails && <Button onClick={handleOpenEditDescriptionDialog} variant="outline" size="sm" className="h-7" disabled={isViewOnly}><Edit className="h-3 w-3 mr-1"/> แก้ไข</Button>}</div><p className="whitespace-pre-wrap pt-1">{job.description}</p></div>
              <div className="border-t pt-4"><div className="flex items-center gap-4 mb-2"><h4 className="font-semibold text-base">รายละเอียดรถ/ชิ้นส่วน</h4>{canEditDetails && <Button onClick={handleOpenEditVehicleDialog} variant="outline" size="sm" className="h-7" disabled={isViewOnly}><Edit className="h-3 w-3 mr-1"/> แก้ไข</Button>}</div><JobVehicleDetails job={job} /></div>
               <div className="flex gap-2 pt-4 border-t">
                  {canEditDetails && <Button onClick={() => setIsTransferDialogOpen(true)} variant="outline" size="sm" disabled={isViewOnly}>เปลี่ยนแปลงแผนกหลัก</Button>}
                  {canEditDetails && (
                      <Button onClick={handleOpenReassignDialog} variant="outline" size="sm" disabled={isViewOnly}>
                          <UserCheck className="mr-2 h-4 w-4" /> 
                          {job.assigneeUid ? 'เปลี่ยนผู้รับผิดชอบ' : 'มอบหมายงาน'}
                      </Button>
                  )}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-lg flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />สมุดบันทึก (Notebook)</CardTitle>{canUpdateActivity && <Button onClick={() => { setTechReport(job?.technicalReport || job?.officeNote || ""); setIsEditNotebookDialogOpen(true); }} variant="outline" size="sm" className="h-7" disabled={isViewOnly}><Edit className="h-3 w-3 mr-1"/> แก้ไข</Button>}</CardHeader>
            <CardContent><div className="min-h-[100px] p-4 bg-muted/30 rounded-md border border-dashed"><p className="whitespace-pre-wrap text-sm">{job.technicalReport || job.officeNote || 'ยังไม่มีบันทึก'}</p></div></CardContent>
          </Card>

          {showStaffCustomerPortalChat && (
            <JobCustomerChatPanel jobId={job.id} variant="staff" readOnly={isViewOnly} />
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>รูปประกอบงาน (ตอนรับงาน)</CardTitle>
              {canEditIntakePhotos && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isAddingPhotos || isCompressing || (job?.photos?.length || 0) >= DATA_LIMITS.MAX_INTAKE_PHOTOS}>
                      {isAddingPhotos || isCompressing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {isCompressing ? "กำลังลดขนาดรูป..." : "กำลังอัปโหลด..."}
                        </>
                      ) : (
                        <>
                          <Camera className="mr-2 h-4 w-4" /> เพิ่มภาพถ่าย
                        </>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => quickCameraRef.current?.click()}>
                      <Camera className="mr-2 h-4 w-4" /> ถ่ายรูปจากกล้อง
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => quickGalleryRef.current?.click()}>
                      <ImageIcon className="mr-2 h-4 w-4" /> เลือกจากอัลบั้ม
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <input type="file" ref={quickCameraRef} className="hidden" accept="image/*" capture="environment" onChange={handleQuickPhotoUpload} />
              <input type="file" ref={quickGalleryRef} className="hidden" multiple accept="image/*" onChange={handleQuickPhotoUpload} />
            </CardHeader>
            <CardContent>{job.photos && job.photos.some(Boolean) ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{job.photos.filter(Boolean).map((url, i) => (
                    <div key={`${url}-${i}`} className="relative group aspect-square">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full"><Image src={url} alt={`Job photo ${i+1}`} width={200} height={200} unoptimized className="rounded-md border object-cover w-full h-full hover:opacity-80 transition-opacity" /></a>
                        {isUserAdmin && !isViewOnly && <Button type="button" variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={(e) => { e.preventDefault(); handleDeletePhoto(url); }} disabled={isAddingPhotos}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                ))}</div>
            ) : <p className="text-muted-foreground text-sm">ยังไม่มีรูปตอนรับงาน</p>}</CardContent>
          </Card>
          
          {(!isViewOnly) && canUpdateActivity && (
            <Card>
              <CardHeader>
                <CardTitle>แนบรูประหว่างดำเนินการ</CardTitle>
                <CardDescription className="text-sm">
                  ประวัติด้านล่างบันทึกโดยระบบจากแต่ละขั้นตอน (รับงาน เอกสาร สถานะ ฯลฯ) — ถ้าต้องการแนบรูประหว่างทาง
                  ให้กดปุ่มแล้วถ่ายหรือเลือกรูป พร้อมเขียนคำอธิบายใต้รูปว่าแสดงอะไร
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="outline"
                  className="border-primary/40"
                  disabled={isSubmittingNote || isAddingPhotos || isCompressing || job.isArchived}
                  onClick={() => setActivityPhotoDialogOpen(true)}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  แนบรูปกิจกรรม (พร้อมคำอธิบาย)
                </Button>
              </CardContent>
            </Card>
          )}

          <Dialog
            open={activityPhotoDialogOpen}
            onOpenChange={(open) => {
              setActivityPhotoDialogOpen(open);
              if (!open) {
                setActivityPhotoPreviews((prev) => {
                  prev.forEach((u) => URL.revokeObjectURL(u));
                  return [];
                });
                setActivityPhotoFiles([]);
                setActivityPhotoCaption("");
              }
            }}
          >
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>แนบรูปกิจกรรม</DialogTitle>
                <DialogDescription>
                  ถ่ายหรือเลือกรูป แล้วอธิบายสั้นๆ ว่ารูปนี้ใช้ยืนยันอะไร (บังคับก่อนบันทึก)
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmittingNote || isCompressing || activityPhotoFiles.length >= DATA_LIMITS.MAX_ACTIVITY_PHOTOS}
                    onClick={() => activityPhotoDialogCameraRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    ถ่ายรูป
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmittingNote || isCompressing || activityPhotoFiles.length >= DATA_LIMITS.MAX_ACTIVITY_PHOTOS}
                    onClick={() => activityPhotoDialogGalleryRef.current?.click()}
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    เลือกจากอัลบั้ม
                  </Button>
                  {isCompressing && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-4 w-4 animate-spin" /> กำลังลดขนาดรูป...
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  ref={activityPhotoDialogCameraRef}
                  className="hidden"
                  accept="image/*"
                  capture="environment"
                  onChange={handleActivityPhotoDialogFiles}
                />
                <input
                  type="file"
                  ref={activityPhotoDialogGalleryRef}
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={handleActivityPhotoDialogFiles}
                />
                {activityPhotoPreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {activityPhotoPreviews.map((src, i) => (
                      <div key={src} className="relative aspect-square w-full overflow-hidden rounded-md border bg-muted">
                        <Image src={src} alt="" fill unoptimized sizes="120px" className="object-cover" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => removeActivityPhotoAtIndex(i)}
                          disabled={isSubmittingNote}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="activity-photo-caption">คำอธิบายรูป (วัตถุประสงค์)</Label>
                  <Textarea
                    id="activity-photo-caption"
                    placeholder="เช่น ภายในถังน้ำมันมีตะกอน / หลังล้างแล้วพบสิ่งแปลกปลอม ฯลฯ"
                    value={activityPhotoCaption}
                    onChange={(e) => setActivityPhotoCaption(e.target.value)}
                    rows={4}
                    disabled={isSubmittingNote}
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmittingNote}
                  onClick={() => {
                    setActivityPhotoPreviews((prev) => {
                      prev.forEach((u) => URL.revokeObjectURL(u));
                      return [];
                    });
                    setActivityPhotoFiles([]);
                    setActivityPhotoCaption("");
                    setActivityPhotoDialogOpen(false);
                  }}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSubmitActivityPhotos()}
                  disabled={isSubmittingNote || isCompressing}
                >
                  {isSubmittingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                  {isSubmittingNote ? "กำลังอัปโหลด…" : "บันทึกรูปและคำอธิบาย"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Card>
            <CardHeader>
              <CardTitle>ประวัติการดำเนินการ</CardTitle>
              <CardDescription className="text-xs">
                {job.isArchived
                  ? "งานที่ปิดแล้ว — แสดงข้อความและรูปที่บันทึกไว้"
                  : "รายการส่วนใหญ่บันทึกโดยระบบอัตโนมัติจากการดำเนินการในแอป รายการที่ขึ้นต้นว่า «แนบรูปกิจกรรม» มาจากการแนบรูปพร้อมคำอธิบาย"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">{activitiesLoading ? <div className="flex items-center justify-center h-24"><Loader2 className="h-66 w-6 animate-spin text-muted-foreground" /></div> : visibleActivities.length > 0 ? (
                visibleActivities.map((activity) => (
                  <div key={activity.id} className="flex gap-4">
                      <User className="h-5 w-5 mt-1 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                            <p className="font-semibold text-sm min-w-0">
                              {activity.userName}{" "}
                              <span className="text-[10px] font-normal text-muted-foreground ml-2">
                                {safeFormat(activity.createdAt, APP_DATE_TIME_FORMAT)}
                              </span>
                            </p>
                            {canDeleteEntireActivity && activity.id ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-destructive border-destructive/40 hover:bg-destructive/10 h-8 text-xs w-full sm:w-auto shrink-0"
                                disabled={!!deletingActivityId || !!isSubmittingNote}
                                onClick={() => void handleDeleteEntireActivity(activity)}
                              >
                                {deletingActivityId === activity.id ? (
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="mr-1 h-3 w-3" />
                                )}
                                ลบรายการทั้งหมด
                              </Button>
                            ) : null}
                          </div>
                          {activity.text ? (
                            <p className="whitespace-pre-wrap text-sm my-1">{activity.text}</p>
                          ) : activity.photos?.some(Boolean) ? (
                            <p className="text-sm text-muted-foreground italic my-1">(แนบรูปภาพ — ไม่มีข้อความ)</p>
                          ) : null}
                          {activity.photos?.some(Boolean) && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                  {activity.photos.filter(Boolean).map((url, i) => (
                                      <div key={`${url}-${i}`} className="relative group aspect-square">
                                          <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                                              <Image src={url} alt="Activity" width={100} height={100} unoptimized className="rounded-md object-cover w-full aspect-square hover:opacity-80 transition-opacity" />
                                          </a>
                                          {canDeleteEntireActivity && !job.isArchived && (
                                              <Button 
                                                  type="button" 
                                                  variant="destructive" 
                                                  size="icon" 
                                                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10" 
                                                  disabled={deletingActivityId === activity.id || !!isSubmittingNote}
                                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteActivityPhoto(activity.id!, url); }}
                                              >
                                                  <Trash2 className="h-3 w-3" />
                                              </Button>
                                          )}
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              ))) : <p className="text-muted-foreground text-sm text-center h-24 flex items-center justify-center">ยังไม่มีประวัติกิจกรรม</p>}
            </CardContent>
          </Card>
        </div>
        
        <div className="space-y-6">
          {/* Reference Documents */}
          <Card><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><FileText className="h-4 w-4"/> เอกสารอ้างอิง</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
              {loadingDocs ? <div className="flex justify-center"><Loader2 className="animate-spin"/></div> : (
                <>
                  {JOB_REFERENCE_DOC_TYPES.map((docType) => {
                      const label = JOB_REFERENCE_DOC_LABELS[docType];
                      const latestDoc = relatedDocuments[docType]?.[0];
                      return (
                        <div key={docType} className="flex justify-between items-start border-b border-muted/50 pb-2 last:border-0 last:pb-0">
                          <span className="text-muted-foreground pt-1">{label}:</span>
                          {latestDoc ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-2">
                                {isTechnicalDept ? (
                                  <span className="font-medium">{latestDoc.docNo}</span>
                                ) : (
                                  <Button asChild variant="link" className="p-0 h-auto font-medium">
                                    <Link href={`/app/office/documents/${latestDoc.id}`}>{latestDoc.docNo}</Link>
                                  </Button>
                                )}
                                <Badge variant="outline" className="text-[8px] px-1 h-4">
                                  {docStatusLabel(latestDoc.status, latestDoc.docType)}
                                </Badge>
                              </div>
                              {canIssueBill && latestDoc.status === 'APPROVED' && !latestDoc.receiptDocId && docType === 'TAX_INVOICE' && (
                                <Button asChild size="sm" variant="outline" className="h-6 text-[9px] px-2 border-primary text-primary hover:bg-primary/5">
                                  <Link href={`/app/management/accounting/documents/receipt?customerId=${latestDoc.customerId}&sourceDocId=${latestDoc.id}`}>
                                    <Receipt className="h-2.5 w-2.5 mr-1" /> ออกใบเสร็จ (Issue Receipt)
                                  </Link>
                                </Button>
                              )}
                            </div>
                          ) : <span className="pt-1">— ไม่มี —</span>}
                        </div>
                      );
                  })}
                  <div className="flex justify-between items-start border-b border-muted/50 pb-2 last:border-0 last:pb-0">
                    <span className="text-muted-foreground pt-1">ใบเบิกอะไหล่:</span>
                    {withdrawals.length > 0 ? (
                      <div className="flex flex-col items-end gap-1">
                        {withdrawals.map(wd => (
                            <div key={wd.id} className="flex items-center gap-2">
                                <Button asChild variant="link" className="p-0 h-auto font-medium">
                                    <Link href={`/app/documents/${wd.id}`}>{wd.docNo}</Link>
                                </Button>
                                <Badge variant="outline" className="text-[8px] px-1 h-4">
                                    {docStatusLabel(wd.status, 'WITHDRAWAL')}
                                </Badge>
                            </div>
                        ))}
                      </div>
                    ) : <span className="pt-1">— ไม่มี —</span>}
                  </div>
                </>
              )}
            </CardContent></Card>

          {/* Job Status Card */}
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-base font-semibold">สถานะงาน (Status)</CardTitle><Badge className={cn("border", getStatusStyles(job.status))}>{jobStatusLabel(job.status)}</Badge></CardHeader></Card>
          
          {(!isViewOnly) && (
            <Card className="border-primary/50 bg-primary/5 shadow-md animate-in fade-in zoom-in-95 duration-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary" /> 
                    การดำเนินการ (Actions)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {/* Approve/Reject for WAITING_APPROVE */}
                    {isMgmtOrOffice && job.status === 'WAITING_APPROVE' && (
                        <>
                            <Button className="w-full bg-green-600 hover:bg-green-700 font-bold" onClick={() => setStatusConfirmAction('APPROVE_JOB')} disabled={isSubmittingNote}>
                                <Check className="mr-2 h-4 w-4" /> อนุมัติเริ่มซ่อม
                            </Button>
                            <Button variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10 font-bold" onClick={() => setStatusConfirmAction('REJECT_JOB')} disabled={isSubmittingNote}>
                                <Ban className="mr-2 h-4 w-4" /> ลูกค้าไม่อนุมัติ/ยกเลิก
                            </Button>
                        </>
                    )}

                    {/* Parts Ready for PENDING_PARTS */}
                    {isMgmtOrOffice && job.status === 'PENDING_PARTS' && (
                        <Button className="w-full bg-blue-600 hover:bg-blue-700 font-bold" onClick={() => setStatusConfirmAction('PARTS_READY')} disabled={isSubmittingNote}>
                            <PackageCheck className="mr-2 h-4 w-4" /> อะไหล่มาครบแล้ว (เริ่มซ่อม)
                        </Button>
                    )}

                    {/* Request Quotation */}
                    {job.status === 'IN_PROGRESS' && (
                        <Button 
                          variant="outline"
                          onClick={() => setStatusConfirmAction('REQUEST_QUOTATION')} 
                          disabled={isSubmittingNote} 
                          className="w-full border-blue-600 text-blue-600 hover:bg-blue-50 font-bold"
                        >
                            <FileText className="mr-2 h-4 w-4" /> 
                            แจ้งเสนอราคา
                        </Button>
                    )}

                    {/* Finish / Return to Main */}
                    {(['IN_PROGRESS', 'WAITING_QUOTATION', 'WAITING_APPROVE', 'IN_REPAIR_PROCESS', 'PENDING_PARTS'].includes(job.status) ||
                      (isSubTask && job.status === 'RECEIVED')) && (
                        <Button 
                          onClick={() => setStatusConfirmAction(isSubTask ? 'RETURN_TO_MAIN' : 'FINISH_JOB')} 
                          disabled={isSubmittingNote} 
                          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
                        >
                            <CheckCircle className="mr-2 h-4 w-4" /> 
                            {isSubTask ? "ส่งงานกลับแผนกหลัก" : "งานเสร็จแจ้งทำบิล"}
                        </Button>
                    )}

                    {showReturnToHandoff && (
                      <Button
                        variant="outline"
                        className="w-full border-violet-600 text-violet-700 hover:bg-violet-50 font-bold"
                        onClick={() => setStatusConfirmAction('RETURN_TO_HANDOFF')}
                        disabled={isSubmittingNote}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        ส่งงานกลับแผนกก่อนหน้า ({deptLabel(job.subTaskHandoffSource!)})
                      </Button>
                    )}

                    {/* Withdraw Parts - Logic Split */}
                    {job.status === 'PENDING_PARTS' && (
                        <Button 
                          asChild
                          variant="outline"
                          className="w-full border-blue-600 text-blue-600 hover:bg-blue-50 font-bold"
                        >
                            <Link href={`/app/office/parts/withdraw/new?jobId=${job.id}`}>
                              <ClipboardList className="mr-2 h-4 w-4" /> 
                              เบิกอะไหล่
                            </Link>
                        </Button>
                    )}

                    {/* Request More Parts (Only when In Repair) */}
                    {job.status === 'IN_REPAIR_PROCESS' && (
                        <Button 
                          variant="outline"
                          onClick={() => setStatusConfirmAction('REQUEST_MORE_PARTS')}
                          disabled={isSubmittingNote}
                          className="w-full border-amber-600 text-amber-600 hover:bg-amber-50 font-bold"
                        >
                            <PlusCircle className="mr-2 h-4 w-4" /> 
                            แจ้งเบิกอะไหล่เพิ่ม
                        </Button>
                    )}

                    {/* Sub-Transfer (งานหลักหรืองานย่อยส่งต่อแผนกถัดไปได้) */}
                    {canSubTransfer && (
                        <Button
                          variant="outline"
                          className="w-full border-amber-500 text-amber-600 hover:bg-amber-50 font-bold"
                          onClick={() => {
                            setSubTransferDept('');
                            setIsSubTransferDialogOpen(true);
                          }}
                        >
                            <Forward className="mr-2 h-4 w-4" /> ส่งงานต่อ
                        </Button>
                    )}

                    {/* Issue Bill */}
                    {['DONE', 'WAITING_CUSTOMER_PICKUP'].includes(job.status) && canIssueBill && !isAlreadyBilled && (
                        <Button 
                          onClick={() => setIsBillingSelectionOpen(true)}
                          disabled={isSubmittingNote} 
                          className="w-full bg-primary hover:bg-primary/90 text-white font-bold"
                        >
                            <Receipt className="mr-2 h-4 w-4" /> 
                            ออกบิล (Issue Bill)
                        </Button>
                    )}

                    {/* Revert Job (Office can send back to technical) */}
                    {job.status === 'DONE' && canIssueBill && (
                      <Button variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10 font-bold" onClick={() => setIsRevertDialogOpen(true)}>
                        <RotateCcw className="mr-2 h-4 w-4" /> ส่งกลับแก้ไข
                      </Button>
                    )}

                    {!canConfirmWaitingQuotation && job.status === 'WAITING_APPROVE' && (
                        <p className="text-[10px] text-muted-foreground text-center italic">ส่วนนี้สำหรับฝ่ายออฟฟิศ/บริหารหรือเจ้าหน้าที่ที่ได้รับมอบหมายจัดการเท่านั้น</p>
                    )}
                </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
          <DialogContent><DialogHeader><DialogTitle>โอนย้ายแผนกหลัก</DialogTitle></DialogHeader><div className="grid gap-4 py-4"><div className="grid gap-2"><Label>แผนกใหม่</Label><Select value={transferDepartment} onValueChange={(v) => setTransferDepartment(v as JobDepartment)}><SelectTrigger><SelectValue placeholder="เลือกแผนก" /></SelectTrigger><SelectContent>{JOB_DEPARTMENTS.filter(d => d !== job?.department).map(d => <SelectItem key={d} value={d}>{deptLabel(d)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>หมายเหตุ</Label><Textarea value={transferNote} onChange={(e) => setTransferNote(e.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setIsTransferDialogOpen(false)} disabled={isTransferring}>ยกเลิก</Button><Button onClick={handleTransferJob} disabled={isTransferring || !transferDepartment}>ยืนยัน</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={isSubTransferDialogOpen} onOpenChange={setIsSubTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Forward className="h-5 w-5 text-primary" /> ส่งงานต่อ (เปิดงานย่อย)
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>แผนกปลายทาง</Label>
              <Select value={subTransferDept || undefined} onValueChange={(v) => setSubTransferDept(v as JobDepartment)}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกแผนก..." />
                </SelectTrigger>
                <SelectContent>
                  {subTransferTargets.length > 0 ? (
                    subTransferTargets.map((d) => (
                      <SelectItem key={d} value={d}>
                        {deptLabel(d)}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground">ไม่มีแผนกให้ส่งต่อในขณะนี้</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="p-3 bg-muted/50 rounded-md text-xs text-muted-foreground flex gap-2">
              <History className="h-4 w-4 shrink-0" />
              <p>
                เมื่อแผนกปลายทางต้องการส่งกลับ ใช้ปุ่ม &quot;ส่งงานกลับแผนกก่อนหน้า&quot; หรือ &quot;ส่งงานกลับแผนกหลัก&quot; ตามลำดับการส่งงาน
                {job.mainDepartment && job.mainDepartment !== job.department
                  ? ` — แผนกหลัก: ${deptLabel(job.mainDepartment)}`
                  : ` — แผนกหลัก: ${deptLabel(job.mainDepartment || job.department)}`}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSubTransferDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubTransfer} disabled={isTransferring || !subTransferDept || subTransferTargets.length === 0}>
              ยืนยันการส่งต่อ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isEditDescriptionDialogOpen} onOpenChange={setIsEditDescriptionDialogOpen}><DialogContent><DialogHeader><DialogTitle>แก้ไขรายการแจ้งซ่อม</DialogTitle></DialogHeader><div className="py-4"><Textarea value={descriptionToEdit} onChange={(e) => setDescriptionToEdit(e.target.value)} rows={8} /></div><DialogFooter><Button variant="outline" onClick={() => setIsEditDescriptionDialogOpen(false)} disabled={isUpdatingDescription}>ยกเลิก</Button><Button onClick={handleUpdateDescription} disabled={isUpdatingDescription}>บันทึก</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={isEditNotebookDialogOpen} onOpenChange={setIsEditNotebookDialogOpen}><DialogContent><DialogHeader><DialogTitle>แก้ไขสมุดบันทึก</DialogTitle></DialogHeader><div className="py-4"><Textarea placeholder="บันทึกรายละเอียดงาน..." value={techReport} onChange={(e) => setTechReport(e.target.value)} rows={12} /></div><DialogFooter><Button variant="outline" onClick={() => setIsEditNotebookDialogOpen(false)} disabled={isSavingTechReport}>ยกเลิก</Button><Button onClick={handleUpdateNotebook} disabled={isSavingTechReport}>บันทึก</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={isEditVehicleDialogOpen} onOpenChange={setIsEditVehicleDialogOpen}><DialogContent><DialogHeader><DialogTitle>แก้ไขรายละเอียดรถ/ชิ้นส่วน</DialogTitle></DialogHeader><div className="grid gap-4 py-4">
                {(job.carServiceDetails || job.department === 'CAR_SERVICE' || job.mainDepartment === 'CAR_SERVICE') ? (
                    <><div className="grid gap-2"><Label>ยี่ห้อรถ</Label><Input value={vehicleEditData.brand || ""} onChange={e => setVehicleEditData({...vehicleEditData, brand: e.target.value})} /></div><div className="grid gap-2"><Label>รุ่นรถ</Label><Input value={vehicleEditData.model || ""} onChange={e => setVehicleEditData({...vehicleEditData, model: e.target.value})} /></div><div className="grid gap-2"><Label>ทะเบียนรถ</Label><Input value={vehicleEditData.licensePlate || ""} onChange={e => setVehicleEditData({...vehicleEditData, licensePlate: e.target.value})} /></div></>
                ) : (
                    <><div className="grid gap-2"><Label>ยี่ห้อ</Label><Input value={vehicleEditData.brand || ""} onChange={e => setVehicleEditData({...vehicleEditData, brand: e.target.value})} /></div><div className="grid gap-2"><Label>เลขอะไหล่</Label><Input value={vehicleEditData.partNumber || ""} onChange={e => setVehicleEditData({...vehicleEditData, partNumber: e.target.value})} /></div><div className="grid gap-2"><Label>เลขทะเบียนชิ้นส่วน</Label><Input value={vehicleEditData.registrationNumber || ""} onChange={e => setVehicleEditData({...vehicleEditData, registrationNumber: e.target.value})} /></div></>
                )}
            </div><DialogFooter><Button variant="outline" onClick={() => setIsEditVehicleDialogOpen(false)} disabled={isUpdatingVehicle}>ยกเลิก</Button><Button onClick={handleUpdateVehicleDetails} disabled={isUpdatingVehicle}>บันทึก</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={isReassignDialogOpen} onOpenChange={setIsReassignDialogOpen}><DialogContent><DialogHeader><DialogTitle>{job.department === 'OUTSOURCE' ? 'มอบหมายผู้รับเหมา' : 'มอบหมายพนักงาน'}</DialogTitle></DialogHeader>{isFetchingWorkers ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : (<div className="py-4"><Label>{job.department === 'OUTSOURCE' ? 'เลือกร้านผู้รับเหมา' : 'พนักงาน'}</Label><span className="block mt-2"><Select value={reassignWorkerId || ""} onValueChange={setReassignWorkerId}><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger><SelectContent>{departmentWorkers.length > 0 ? departmentWorkers.map(w => <SelectItem key={w.id} value={w.id}>{w.displayName}</SelectItem>) : <div className="p-4 text-center">ไม่พบรายการให้เลือก</div>}</SelectContent></Select></span></div>)}<DialogFooter><Button variant="outline" onClick={() => setIsReassignDialogOpen(false)} disabled={isReassigning}>ยกเลิก</Button><Button onClick={handleReassignJob} disabled={isReassigning || isFetchingWorkers || !reassignWorkerId}>ยืนยัน</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={isRevertDialogOpen} onOpenChange={setIsRevertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-destructive" />
              ส่งกลับไปแก้ไข (Revert to Repair)
            </DialogTitle>
            <DialogDescription>
              ระบุเหตุผลที่ต้องการให้ช่างดำเนินการเพิ่มเติม
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>เหตุผลการส่งกลับ</Label>
              <Textarea 
                placeholder="เช่น อะไหล่ยังใส่ไม่ครบ..." 
                value={revertReason} 
                onChange={(e) => setRevertReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsRevertDialogOpen(false); router.replace(`/app/jobs/${jobId}`, { scroll: false }); }} disabled={isReverting}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleRevertJob} disabled={isReverting || !revertReason.trim()}>
              {isReverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              ยืนยันส่งกลับแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />
              กู้คืนงานจากประวัติ
            </DialogTitle>
            <DialogDescription>
              ย้ายงานจาก <span className="font-mono text-xs">jobsArchive_{archiveYear ?? '…'}</span> กลับไปที่ collection <span className="font-mono text-xs">jobs</span> และเลือกสถานะที่ต้องการ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>สถานะหลังกู้คืน</Label>
            <Select value={restoreTargetStatus} onValueChange={(v) => setRestoreTargetStatus(v as JobStatus)}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกสถานะ" />
              </SelectTrigger>
              <SelectContent>
                {JOB_RESTORE_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {jobStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              แนะนำ: เลือก &quot;ทำเสร็จรอทำบิล&quot; หากต้องการให้ฝ่ายออฟฟิศออกบิลต่อ
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRestoreDialogOpen(false)} disabled={isRestoring}>
              ยกเลิก
            </Button>
            <Button onClick={handleRestoreJob} disabled={isRestoring} className="bg-amber-600 hover:bg-amber-700">
              {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              ยืนยันกู้คืน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isBillingSelectionOpen} onOpenChange={setIsBillingSelectionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>เลือกประเภทเอกสาร</AlertDialogTitle>
            <AlertDialogDescription>เลือกประเภทเอกสารที่ต้องการออกสำหรับงานซ่อมของ <b>{job?.customerSnapshot.name}</b></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsBillingSelectionOpen(false)} className="w-full sm:w-auto">ยกเลิก</Button>
            <Button variant="secondary" onClick={() => { if (job) router.push(`/app/office/documents/delivery-note/new?jobId=${job.id}`); setIsBillingSelectionOpen(false); }} className="w-full sm:w-auto">ใบส่งของชั่วคราว</Button>
            <Button onClick={() => { if (job) router.push(`/app/office/documents/tax-invoice/new?jobId=${job.id}`); setIsBillingSelectionOpen(false); }} className="w-full sm:w-auto">ใบกำกับภาษี</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!statusConfirmAction} onOpenChange={(open) => !open && setStatusConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction].title : "ยืนยันการดำเนินการ"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction].description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmittingNote}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmittingNote}
              onClick={async () => {
                if (!statusConfirmAction) return;
                await statusConfirmConfig[statusConfirmAction].onConfirm();
                setStatusConfirmAction(null);
              }}
            >
              {isSubmittingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {statusConfirmAction ? statusConfirmConfig[statusConfirmAction].confirmText : "ยืนยัน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function JobDetailsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <JobDetailsPageContent />
    </Suspense>
  );
}
