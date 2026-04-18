
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  collection, query, where, onSnapshot, doc, writeBatch, 
  serverTimestamp, getDocs, limit, orderBy, runTransaction, getDoc, updateDoc, addDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase, useDoc, useCollection } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Loader2, PlusCircle, Trash2, Save, ArrowLeft, Search, 
  ScanBarcode, AlertCircle, Info, Package, User, FileText, ChevronsUpDown, X, ClipboardList, Hash, ExternalLink, Users, PackageCheck
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import type { Customer, Job, Part, Document as DocumentType, StoreSettings, UserProfile } from "@/lib/types";

function tsMs(t: unknown): number {
  if (t && typeof t === "object" && "toMillis" in t && typeof (t as { toMillis: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function formatStockQty(q: number): string {
  if (Number.isInteger(q)) return String(q);
  return q.toLocaleString("th-TH", { maximumFractionDigits: 6 });
}

/** แสดงใน dropdown — อ้างอิงใบเสนอราคา ไม่โชว์แค่ id */
function formatJobWithdrawalRefLabel(job: Job): string {
  const quote =
    job.salesDocType === "QUOTATION" && job.salesDocNo
      ? `ใบเสนอราคา ${job.salesDocNo}`
      : job.salesDocNo
        ? `เอกสาร ${job.salesDocNo}${job.salesDocType ? ` (${job.salesDocType})` : ""}`
        : "ยังไม่มีเลขอ้างอิงใบเสนอราคา";
  const name = job.customerSnapshot?.name || "—";
  const desc = (job.description || "").trim();
  const short = desc.length > 48 ? `${desc.slice(0, 48)}…` : desc;
  return `${quote} — ${name}${short ? ` — ${short}` : ""}`;
}
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createDocument, getNextAvailableDocNo } from "@/firebase/documents";
import { Skeleton } from "@/components/ui/skeleton";
import {
  documentItemsToDeltaLines,
  mergeStockDeltasFromWithdrawalEdit,
  summarizeWithdrawalDeltas,
  type StockMovementRow,
} from "@/lib/part-withdrawal-stock-delta";

const withdrawalItemSchema = z.object({
  partId: z.string().min(1, "กรุณาเลือกอะไหล่จากระบบ"),
  code: z.string().optional(),
  description: z.string().min(1, "กรุณากรอกรายการ"),
  stockQty: z.number().optional(),
  quantity: z.coerce.number().min(0.01, "ต้องระบุจำนวน"),
  unitPrice: z.coerce.number().min(0).default(0),
  total: z.coerce.number().default(0),
});

const withdrawalSchema = z.object({
  refType: z.enum(["JOB", "SALES_DOC", "LOAN", "INTERNAL"]),
  refId: z.string().min(1, "กรุณาระบุรายการอ้างอิง"),
  customerId: z.string().min(1, "กรุณาเลือกลูกค้าหรือพนักงาน"),
  items: z.array(withdrawalItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
  notes: z.string().optional(),
  docDate: z.string().min(1, "กรุณาเลือกวันที่"),
});

type WithdrawalFormData = z.infer<typeof withdrawalSchema>;

interface PartWithdrawalFormProps {
    editDocId?: string | null;
}

export default function PartWithdrawalForm({ editDocId }: PartWithdrawalFormProps) {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryJobId = searchParams.get('jobId');

  const isEditing = !!editDocId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [activeSalesDocs, setActiveSalesDocs] = useState<DocumentType[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const [customerSearch, setCustomerSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [activePartSearchIdx, setActivePartSearchIdx] = useState<number | null>(null);

  const [previewDocNo, setPreviewDocNo] = useState<string>("");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  const [quotationDoc, setQuotationDoc] = useState<DocumentType | null>(null);
  const [loadingQuotation, setLoadingQuotation] = useState(false);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<any>(null);

  const [stockConfirmOpen, setStockConfirmOpen] = useState(false);
  const [stockSummary, setStockSummary] = useState<{
    withdrawals: StockMovementRow[];
    returnsToStock: StockMovementRow[];
  } | null>(null);
  const pendingIssueSaveRef = useRef<{
    data: WithdrawalFormData;
    jobCompletion?: "PARTIAL" | "COMPLETE";
  } | null>(null);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const docToEditRef = useMemo(() => (db && editDocId ? doc(db, "documents", editDocId) : null), [db, editDocId]);
  const { data: docToEdit, isLoading: isLoadingDoc } = useDoc<DocumentType>(docToEditRef);

  const form = useForm<WithdrawalFormData>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: {
      refType: "JOB",
      refId: "",
      customerId: "",
      docDate: new Date().toISOString().split("T")[0],
      items: [{ partId: "", code: "", description: "", stockQty: 0, quantity: 1, unitPrice: 0, total: 0 }],
      notes: "",
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchedRefType = form.watch("refType");
  const watchedCustomerId = form.watch("customerId");
  const watchedRefId = form.watch("refId");
  const watchedDocDate = form.watch("docDate");

  // โหลดใบเสนอราคาที่ผูกกับงาน (แสดงรายการอ้างอิงด้านบน)
  useEffect(() => {
    if (!db || watchedRefType !== "JOB" || !watchedRefId) {
      setQuotationDoc(null);
      setLoadingQuotation(false);
      return;
    }
    let cancelled = false;
    setLoadingQuotation(true);
    (async () => {
      try {
        let job = activeJobs.find((j) => j.id === watchedRefId);
        if (!job) {
          const js = await getDoc(doc(db, "jobs", watchedRefId));
          if (cancelled) return;
          if (!js.exists()) {
            setQuotationDoc(null);
            setLoadingQuotation(false);
            return;
          }
          job = { id: js.id, ...js.data() } as Job;
        }
        if (job.salesDocId && job.salesDocType === "QUOTATION") {
          const d = await getDoc(doc(db, "documents", job.salesDocId));
          if (cancelled) return;
          if (d.exists()) {
            setQuotationDoc({ id: d.id, ...d.data() } as DocumentType);
            setLoadingQuotation(false);
            return;
          }
        }
        const qSnap = await getDocs(query(collection(db, "documents"), where("jobId", "==", job.id)));
        if (cancelled) return;
        const quotations = qSnap.docs
          .map((x) => ({ id: x.id, ...x.data() } as DocumentType))
          .filter((d) => d.docType === "QUOTATION")
          .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
        setQuotationDoc(quotations[0] ?? null);
      } catch {
        if (!cancelled) setQuotationDoc(null);
      } finally {
        if (!cancelled) setLoadingQuotation(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, watchedRefType, watchedRefId, activeJobs]);

  // Fetch Preview Doc No
  useEffect(() => {
    if (!db || editDocId || !watchedDocDate) return;
    const fetchPreview = async () => {
      try {
        setIndexErrorUrl(null);
        const result = await getNextAvailableDocNo(db, 'WITHDRAWAL', watchedDocDate);
        setPreviewDocNo(result.docNo);
        if (result.indexErrorUrl) setIndexErrorUrl(result.indexErrorUrl);
      } catch (e) {}
    };
    fetchPreview();
  }, [db, watchedDocDate, isSubmitting, editDocId]);

  // Load basic data
  useEffect(() => {
    if (!db) return;
    
    const unsubCustomers = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    const unsubWorkers = onSnapshot(query(collection(db, "users"), where("role", "==", "WORKER"), where("status", "==", "ACTIVE")), (snap) => {
      setWorkers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    });

    const unsubJobs = onSnapshot(query(collection(db, "jobs"), where("status", "==", "PENDING_PARTS")), (snap) => {
      setActiveJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    });

    const unsubDocs = onSnapshot(query(collection(db, "documents"), where("status", "==", "DRAFT")), (snap) => {
      setActiveSalesDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentType)));
    });

    const unsubParts = onSnapshot(collection(db, "parts"), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
      setIsLoadingData(false);
    });

    return () => { unsubCustomers(); unsubWorkers(); unsubJobs(); unsubDocs(); unsubParts(); };
  }, [db]);

  // Handle URL Job ID — เติมอ้างอิงงาน (รองรับจัดซื้อ/เบิกเพิ่ม แม้สถานะไม่ใช่แค่รออะไหล่)
  useEffect(() => {
    if (!queryJobId || isEditing || !db) return;
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(db, "jobs", queryJobId));
      if (cancelled || !snap.exists()) return;
      const targetJob = { id: snap.id, ...snap.data() } as Job;
      form.setValue("refType", "JOB");
      form.setValue("customerId", targetJob.customerId);
      form.setValue("refId", targetJob.id);
      if (targetJob.status !== "PENDING_PARTS") {
        toast({
          title: "หมายเหตุ",
          description:
            "งานนี้ไม่ได้อยู่ในสถานะ «รอจัดอะไหล่» — ยังบันทึกการเบิกเพิ่มจากงานนี้ได้ตามปกติ",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryJobId, isEditing, db, form, toast]);

  // Load existing doc for editing
  useEffect(() => {
    if (docToEdit && customers.length > 0) {
        form.reset({
            refType: docToEdit.jobId ? 'JOB' : (docToEdit.notes?.includes('INTERNAL') ? 'INTERNAL' : 'LOAN'), 
            refId: docToEdit.jobId || 'MANUAL_REF',
            customerId: docToEdit.customerId || "",
            docDate: docToEdit.docDate,
            items: docToEdit.items.map(i => ({
                partId: i.partId || "",
                code: i.code || "",
                description: i.description || "",
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                total: i.total,
                stockQty: parts.find(p => p.id === i.partId)?.stockQty || 0
            })),
            notes: docToEdit.notes || "",
        });
    }
  }, [docToEdit, customers, parts, form]);

  const availableEntities = useMemo(() => {
    if (watchedRefType === 'JOB') {
      const customerIdsWithValidJobs = new Set(activeJobs.map(j => j.customerId));
      return customers.filter(c => customerIdsWithValidJobs.has(c.id)).map(c => ({ id: c.id, name: c.name, phone: c.phone }));
    }
    if (watchedRefType === 'SALES_DOC') {
      const customerIdsWithDraftDocs = new Set(activeSalesDocs.map(d => d.customerId));
      return customers.filter(c => customerIdsWithDraftDocs.has(c.id)).map(c => ({ id: c.id, name: c.name, phone: c.phone }));
    }
    if (watchedRefType === 'INTERNAL') {
      return workers.map(w => ({ id: w.uid, name: w.displayName, phone: w.phone }));
    }
    return customers.map(c => ({ id: c.id, name: c.name, phone: c.phone }));
  }, [watchedRefType, activeJobs, activeSalesDocs, workers, customers]);

  const filteredJobs = useMemo(() => activeJobs.filter(j => j.customerId === watchedCustomerId), [activeJobs, watchedCustomerId]);
  const filteredSalesDocs = useMemo(() => activeSalesDocs.filter(d => d.customerId === watchedCustomerId), [activeSalesDocs, watchedCustomerId]);

  const handleSelectPart = (index: number, part: Part) => {
    form.setValue(`items.${index}.partId`, part.id);
    form.setValue(`items.${index}.code`, part.code);
    form.setValue(`items.${index}.description`, part.name);
    form.setValue(`items.${index}.stockQty`, part.stockQty);
    form.setValue(`items.${index}.unitPrice`, part.sellingPrice);
    form.setValue(`items.${index}.total`, part.sellingPrice * form.getValues(`items.${index}.quantity`));
    setActivePartSearchIdx(null);
    setPartSearch("");
  };

  const startScanner = async (index: number) => {
    setActivePartSearchIdx(index);
    setIsScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const reader = new BrowserMultiFormatReader();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const controls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            const found = parts.find(p => p.code === result.getText());
            if (found) {
              handleSelectPart(index, found);
              stopScanner();
            } else {
              toast({ variant: "destructive", title: "ไม่พบรหัสสินค้า", description: result.getText() });
            }
          }
        });
        scannerControlsRef.current = controls;
      }
    } catch (e) {
      setIsScannerOpen(false);
      toast({ variant: "destructive", title: "ไม่สามารถเปิดกล้องได้" });
    }
  };

  const stopScanner = () => {
    if (scannerControlsRef.current) scannerControlsRef.current.stop();
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScannerOpen(false);
  };

  const openIssueConfirm = (
    data: WithdrawalFormData,
    jobCompletion?: "PARTIAL" | "COMPLETE"
  ) => {
    if (!db || !profile || !storeSettings) return;
    if (data.refType === "JOB" && !jobCompletion) {
      toast({ variant: "destructive", title: "กรุณาเลือกประเภทการเบิก", description: "เบิกบางส่วน หรือ จัดอะไหล่ครบแล้ว" });
      return;
    }
    const entity = availableEntities.find((e) => e.id === data.customerId);
    if (!entity) {
      toast({ variant: "destructive", title: "กรุณาเลือกรายชื่ออ้างอิง" });
      return;
    }
    const prevIssued = !!(isEditing && docToEdit && docToEdit.status === "ISSUED");
    const prevLines = isEditing && docToEdit ? documentItemsToDeltaLines(docToEdit.items || []) : [];
    const nextLines = data.items
      .filter((i) => i.partId)
      .map((i) => ({
        partId: i.partId,
        quantity: i.quantity,
        code: i.code,
        description: i.description || "",
      }));
    const deltaMap = mergeStockDeltasFromWithdrawalEdit(prevLines, nextLines, prevIssued);
    const summary = summarizeWithdrawalDeltas(deltaMap);
    pendingIssueSaveRef.current = { data, jobCompletion };
    setStockSummary(summary);
    setStockConfirmOpen(true);
  };

  const performWithdrawalSave = async (
    data: WithdrawalFormData,
    isDraft: boolean,
    jobCompletion?: "PARTIAL" | "COMPLETE"
  ) => {
    if (!db || !profile || !storeSettings) return;

    const entity = availableEntities.find(e => e.id === data.customerId);
    if (!entity) {
        toast({ variant: "destructive", title: "กรุณาเลือกรายชื่ออ้างอิง" });
        return;
    }

    setIsSubmitting(true);
    try {
      if (!isDraft) {
        const prevIssued = !!(isEditing && docToEdit && docToEdit.status === "ISSUED");
        const prevLines = isEditing && docToEdit ? documentItemsToDeltaLines(docToEdit.items || []) : [];
        const nextLines = data.items
          .filter((i) => i.partId)
          .map((i) => ({
            partId: i.partId,
            quantity: i.quantity,
            code: i.code,
            description: i.description || "",
          }));
        const deltaMap = mergeStockDeltasFromWithdrawalEdit(prevLines, nextLines, prevIssued);
        const docLabel = docToEdit?.docNo ? `ใบเบิก ${docToEdit.docNo}` : "ใบเบิก";

        await runTransaction(db, async (transaction) => {
          const pending: {
            partRef: ReturnType<typeof doc>;
            currentQty: number;
            delta: number;
            meta: { partId: string; code?: string; description: string };
          }[] = [];

          for (const [partId, { delta, code, description }] of deltaMap) {
            if (Math.abs(delta) < 1e-9) continue;
            const partRef = doc(db, "parts", partId);
            const partSnap = await transaction.get(partRef);
            if (!partSnap.exists()) throw new Error(`ไม่พบสินค้า ${code || description || partId}`);

            const currentQty = partSnap.data().stockQty || 0;
            if (delta > 0 && currentQty < delta) {
              throw new Error(
                `สินค้า ${code || description} สต็อกไม่พอ (เหลือ ${currentQty} ต้องการเพิ่มอีก ${delta})`
              );
            }
            pending.push({ partRef, currentQty, delta, meta: { partId, code, description } });
          }

          for (const { partRef, currentQty, delta, meta } of pending) {
            const newQty = currentQty - delta;
            transaction.update(partRef, {
              stockQty: newQty,
              updatedAt: serverTimestamp(),
            });

            const actRef = doc(collection(db, "stockActivities"));
            if (delta > 0) {
              transaction.set(
                actRef,
                sanitizeForFirestore({
                  partId: meta.partId,
                  partCode: meta.code,
                  partName: meta.description,
                  type: "WITHDRAW",
                  diffQty: delta,
                  beforeQty: currentQty,
                  afterQty: newQty,
                  notes:
                    prevIssued && isEditing
                      ? `แก้ไข ${docLabel} — ตัดสต็อกเพิ่ม ${delta} หน่วย (${data.refType}: ${data.refId}). ${data.notes || "-"}`
                      : `เบิกใส่ ${data.refType}: ${data.refId}. หมายเหตุ: ${data.notes || "-"}`,
                  createdByUid: profile.uid,
                  createdByName: profile.displayName,
                  createdAt: serverTimestamp(),
                })
              );
            } else {
              const back = Math.abs(delta);
              transaction.set(
                actRef,
                sanitizeForFirestore({
                  partId: meta.partId,
                  partCode: meta.code,
                  partName: meta.description,
                  type: "ADJUST_ADD",
                  diffQty: back,
                  beforeQty: currentQty,
                  afterQty: newQty,
                  notes: `คืนสต็อกจากแก้ไข ${docLabel} (${back} หน่วย) — ${data.refType}: ${data.refId}. โดย ${profile.displayName}`,
                  createdByUid: profile.uid,
                  createdByName: profile.displayName,
                  createdAt: serverTimestamp(),
                })
              );
            }
          }
        });
      }

      const subtotal = data.items.reduce((sum, i) => sum + (i.total || 0), 0);
      const targetStatus = isDraft ? 'DRAFT' : 'ISSUED';
      
      const docPayload = {
        jobId: data.refType === 'JOB' ? data.refId : undefined,
        quotationDocNo:
          data.refType === "JOB" && quotationDoc?.docNo ? quotationDoc.docNo : undefined,
        customerId: data.customerId,
        docDate: data.docDate,
        customerSnapshot: entity,
        storeSnapshot: storeSettings,
        items: data.items.map(i => ({ 
            description: i.description || "", 
            quantity: i.quantity, 
            unitPrice: i.unitPrice || 0, 
            total: i.total || 0,
            partId: i.partId,
            code: i.code,
            stockSnapshot: (i.stockQty || 0) - (isDraft ? 0 : i.quantity)
        })),
        subtotal,
        discountAmount: 0,
        net: subtotal,
        withTax: false,
        vatAmount: 0,
        grandTotal: subtotal,
        notes: (data.refType === 'INTERNAL' ? '[INTERNAL] ' : '') + (data.notes || ''),
        senderName: profile.displayName,
        receiverName: entity.name,
        jobWithdrawalCompletion:
          !isDraft && data.refType === "JOB" && jobCompletion ? jobCompletion : undefined,
      } as Omit<DocumentType, "id" | "docNo" | "docType" | "createdAt" | "updatedAt" | "status">;

      let createdDocNo = "";

      if (isEditing && editDocId) {
          await updateDoc(doc(db, 'documents', editDocId), sanitizeForFirestore({
              ...docPayload,
              status: targetStatus,
              updatedAt: serverTimestamp()
          }));
          const existing = await getDoc(doc(db, "documents", editDocId));
          createdDocNo = existing.exists() ? (existing.data().docNo as string) : "";
      } else {
          const { docNo } = await createDocument(db, 'WITHDRAWAL', docPayload, profile, undefined, { initialStatus: targetStatus });
          createdDocNo = docNo;
      }

      if (!isDraft && data.refType === "JOB" && data.refId && jobCompletion) {
        const jobRef = doc(db, "jobs", data.refId);
        const jobSnap = await getDoc(jobRef);
        if (jobSnap.exists()) {
          const jStatus = jobSnap.data().status as Job["status"];
          if (jobCompletion === "COMPLETE" && jStatus === "PENDING_PARTS") {
            await updateDoc(jobRef, {
              status: "IN_REPAIR_PROCESS",
              lastActivityAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            await addDoc(collection(jobRef, "activities"), {
              text: `จัดอะไหล่ครบแล้ว (ใบเบิก ${createdDocNo || "—"}) — เริ่มดำเนินการซ่อม`,
              userName: profile.displayName,
              userId: profile.uid,
              createdAt: serverTimestamp(),
            });
          } else if (jobCompletion === "PARTIAL") {
            await addDoc(collection(jobRef, "activities"), {
              text: `เบิกอะไหล่บางส่วน (ใบเบิก ${createdDocNo || "—"}) — สถานะงานยังรอจัดอะไหล่ สามารถเบิกเพิ่มได้`,
              userName: profile.displayName,
              userId: profile.uid,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      toast({ 
          title: isDraft ? "บันทึกฉบับร่างสำเร็จ" : "สร้างใบเบิกอะไหล่สำเร็จ", 
          description: isDraft ? "ข้อมูลถูกบันทึกแล้วแต่ยังไม่มีการตัดสต็อกสินค้าค่ะ" : "สต็อกถูกหักและเอกสารบันทึกเรียบร้อยแล้วค่ะ" 
      });
      router.push("/app/office/parts/withdraw");
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSave = async (
    data: WithdrawalFormData,
    isDraft: boolean,
    jobCompletion?: "PARTIAL" | "COMPLETE"
  ) => {
    if (!db || !profile || !storeSettings) return;
    if (!isDraft && data.refType === "JOB" && !jobCompletion) {
      toast({ variant: "destructive", title: "กรุณาเลือกประเภทการเบิก", description: "เบิกบางส่วน หรือ จัดอะไหล่ครบแล้ว" });
      return;
    }
    if (!isDraft) {
      openIssueConfirm(data, jobCompletion);
      return;
    }
    await performWithdrawalSave(data, true, undefined);
  };

  const handleConfirmIssueSave = async () => {
    const pending = pendingIssueSaveRef.current;
    if (!pending) {
      setStockConfirmOpen(false);
      return;
    }
    setStockConfirmOpen(false);
    pendingIssueSaveRef.current = null;
    setStockSummary(null);
    await performWithdrawalSave(pending.data, false, pending.jobCompletion);
  };

  const filteredEntities = availableEntities.filter(e => e.name.toLowerCase().includes(customerSearch.toLowerCase()) || e.phone.includes(customerSearch));

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}><ArrowLeft className="mr-2 h-4 w-4" /> กลับ</Button>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                    type="button" 
                    variant="secondary" 
                    className="flex-1 sm:flex-none"
                    disabled={isSubmitting} 
                    onClick={form.handleSubmit(d => handleSave(d, true))} 
                >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    บันทึกฉบับร่าง
                </Button>
                {watchedRefType === "JOB" ? (
                  <>
                    <Button
                      type="button"
                      onClick={form.handleSubmit((d) => handleSave(d, false, "PARTIAL"))}
                      disabled={isSubmitting}
                      variant="outline"
                      className="flex-1 sm:flex-none border-green-600 text-green-700 hover:bg-green-50 font-bold"
                    >
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                      เบิกบางส่วน (ตัดสต็อก)
                    </Button>
                    <Button
                      type="button"
                      onClick={form.handleSubmit((d) => handleSave(d, false, "COMPLETE"))}
                      disabled={isSubmitting}
                      className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 font-bold"
                    >
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                      จัดอะไหล่ครบแล้ว (ตัดสต็อก + เริ่มซ่อม)
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={form.handleSubmit((d) => handleSave(d, false))}
                    disabled={isSubmitting}
                    className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 font-bold"
                  >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                    สร้างรายการเบิก (ตัดสต็อก)
                  </Button>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                    <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary"/> 1. ข้อมูลเอกสาร</CardTitle>
                    <Badge variant="outline" className="font-mono text-[10px] border-primary/30 text-primary bg-primary/5">
                        {isEditing ? docToEdit?.docNo : (previewDocNo || "Loading...")}
                    </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="docDate" render={({ field }) => (
                    <FormItem className="flex flex-col">
                        <FormLabel>วันที่เบิก</FormLabel>
                        <FormControl><Input type="date" {...field} disabled={isSubmitting} /></FormControl>
                    </FormItem>
                )} />
                <FormField name="refType" control={form.control} render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทการเบิก</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); form.setValue("customerId", ""); form.setValue("refId", ""); }} value={field.value} disabled={isSubmitting}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="JOB">งานซ่อม (Job)</SelectItem>
                        <SelectItem value="SALES_DOC">บิลขาย (ฉบับร่าง)</SelectItem>
                        <SelectItem value="LOAN">ยืมอะไหล่</SelectItem>
                        <SelectItem value="INTERNAL">เบิกใช้ในร้าน</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2">{watchedRefType === 'INTERNAL' ? <Users className="h-4 w-4 text-primary"/> : <User className="h-4 w-4 text-primary"/>} 2. รายละเอียดการอ้างอิง</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <FormField name="customerId" control={form.control} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{watchedRefType === 'INTERNAL' ? 'พนักงานผู้เบิก (Worker)' : 'ชื่อลูกค้า'}</FormLabel>
                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")} disabled={isSubmitting || !!queryJobId || isEditing}>
                            <span className="truncate">
                              {field.value ? (availableEntities.find(e => e.id === field.value)?.name || "เลือกรายชื่อ...") : `ค้นหา${watchedRefType === 'INTERNAL' ? 'พนักงาน' : 'ลูกค้า'}...`}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <div className="p-2 border-b"><Input placeholder="พิมพ์ชื่อเพื่อค้นหา..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} /></div>
                        <ScrollArea className="h-60">
                          {filteredEntities.map(e => (
                            <Button key={e.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b last:border-0 rounded-none text-left" onClick={() => { field.onChange(e.id); setIsCustomerPopoverOpen(false); form.setValue("refId", (watchedRefType === 'INTERNAL' ? 'INTERNAL_USE' : '')); }}>
                              <div className="flex flex-col"><span className="font-medium">{e.name}</span><span className="text-xs text-muted-foreground">{e.phone}</span></div>
                            </Button>
                          ))}
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />

                {watchedCustomerId && (
                  <FormField name="refId" control={form.control} render={({ field }) => (
                    <FormItem className="animate-in fade-in slide-in-from-top-1">
                      <FormLabel>
                        {watchedRefType === "JOB" ? "งานที่รอจัดอะไหล่ (อ้างอิงใบเสนอราคา)" : "รายการอ้างอิง"}
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""} disabled={isSubmitting || !!queryJobId || isEditing || watchedRefType === 'INTERNAL'}>
                        <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {watchedRefType === 'JOB' &&
                            filteredJobs.map((j) => (
                              <SelectItem key={j.id} value={j.id}>
                                {formatJobWithdrawalRefLabel(j)}
                              </SelectItem>
                            ))}
                          {watchedRefType === 'SALES_DOC' && filteredSalesDocs.map(d => <SelectItem key={d.id} value={d.id}>{d.docNo} ({d.grandTotal.toLocaleString()}.-)</SelectItem>)}
                          {watchedRefType === 'LOAN' && <SelectItem value="MANUAL_LOAN">ใบยืมอะไหล่ (ระบุมือ)</SelectItem>}
                          {watchedRefType === 'INTERNAL' && <SelectItem value="INTERNAL_USE">เบิกใช้ภายในร้าน</SelectItem>}
                        </SelectContent>
                      </Select>
                      {watchedRefType === "JOB" && (
                        <p className="text-xs text-muted-foreground">
                          แสดงเฉพาะงานที่สถานะ «รอจัดอะไหล่» — ชื่อรายการอ้างอิงใช้เลขที่ใบเสนอราคา ไม่ใช่รหัสงานดิบ
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </CardContent>
            </Card>
          </div>

          {watchedRefType === "JOB" && watchedRefId && (
            <Card className="border-dashed border-primary/30 bg-muted/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  3. รายการจากใบเสนอราคา (อ้างอิง)
                </CardTitle>
                <CardDescription>
                  รายการด้านล่างมาจากใบเสนอราคาที่ผูกกับงาน — ไม่ใช่ยอดเบิกจริงจนกว่าจะกรอกในขั้นตอนถัดไป
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingQuotation ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : quotationDoc ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="secondary" className="font-mono">
                        {quotationDoc.docNo}
                      </Badge>
                      <Button type="button" variant="link" className="h-auto p-0" asChild>
                        <Link href={`/app/office/documents/quotation/${quotationDoc.id}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-4 w-4" />
                          เปิดใบเสนอราคา
                        </Link>
                      </Button>
                    </div>
                    <div className="border rounded-md overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>รายการ</TableHead>
                            <TableHead className="w-24 text-right">จำนวน</TableHead>
                            <TableHead className="w-28 text-right">ราคา/หน่วย</TableHead>
                            <TableHead className="w-32 text-right">รวม</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(quotationDoc.items || []).map((line, idx) => (
                            <TableRow key={`${line.description}-${idx}`}>
                              <TableCell className="text-sm">
                                <span className="font-mono text-xs text-muted-foreground mr-2">{line.code || "—"}</span>
                                {line.description}
                              </TableCell>
                              <TableCell className="text-right">{line.quantity}</TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {(line.unitPrice ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {(line.total ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    ไม่พบใบเสนอราคาที่ผูกกับงานนี้ — ยังเบิกอะไหล่ได้ตามรายการด้านล่าง
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                {watchedRefType === "JOB" ? "4." : "3."} รายการอะไหล่ที่เบิก (จำนวนจริง / ตัดสต็อก)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>รายการสินค้า</TableHead>
                      <TableHead className="w-24 text-right">สต็อก</TableHead>
                      <TableHead className="w-32 text-right">จำนวนเบิก</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, index) => (
                      <TableRow key={field.id}>
                        <TableCell>
                          <div className="flex gap-2">
                            <Popover open={activePartSearchIdx === index} onOpenChange={(o) => !o && setActivePartSearchIdx(null)}>
                              <PopoverTrigger asChild><Button variant="outline" size="icon" onClick={() => setActivePartSearchIdx(index)} disabled={isSubmitting}><Search className="h-4 w-4" /></Button></PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="start">
                                <div className="p-2 border-b"><Input placeholder="ค้นหาอะไหล่..." value={partSearch} onChange={e => setPartSearch(e.target.value)} /></div>
                                <ScrollArea className="h-64">
                                  {parts.filter(p => p.name.toLowerCase().includes(partSearch.toLowerCase()) || p.code.toLowerCase().includes(partSearch.toLowerCase())).map(p => (
                                    <Button key={p.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b text-left" onClick={() => handleSelectPart(index, p)}>
                                      <div className="flex flex-col"><p className="font-bold text-sm">{p.code}</p><p className="text-xs">{p.name}</p><p className="text-[10px] text-primary font-bold">คงเหลือ: {p.stockQty}</p></div>
                                    </Button>
                                  ))}
                                </ScrollArea>
                              </PopoverContent>
                            </Popover>
                            <Button variant="outline" size="icon" onClick={() => startScanner(index)} disabled={isSubmitting}><ScanBarcode className="h-4 w-4" /></Button>
                            <Input readOnly placeholder="เลือกอะไหล่..." value={form.watch(`items.${index}.description`) || ""} className="bg-muted/30 cursor-not-allowed text-xs" />
                          </div>
                          {form.watch(`items.${index}.code`) && <p className="text-[10px] font-mono text-primary mt-1 ml-20">รหัส: {form.watch(`items.${index}.code`)}</p>}
                        </TableCell>
                        <TableCell className="text-right font-bold text-muted-foreground">{form.watch(`items.${index}.stockQty`) ?? "-"}</TableCell>
                        <TableCell><FormField name={`items.${index}.quantity`} control={form.control} render={({ field }) => (
                            <Input type="number" step="any" className="text-right" {...field} disabled={isSubmitting} onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                field.onChange(v);
                                form.setValue(`items.${index}.total`, v * form.getValues(`items.${index}.unitPrice`));
                            }} />
                        )} /></TableCell>
                        <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={isSubmitting}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ partId: "", quantity: 1, description: "", code: "", stockQty: 0, unitPrice: 0, total: 0 })} disabled={isSubmitting || fields.length >= 50}><PlusCircle className="mr-2 h-4 w-4" /> เพิ่มรายการ</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {watchedRefType === "JOB" ? "5." : "4."} หมายเหตุเพิ่มเติม
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField name="notes" control={form.control} render={({ field }) => (<Textarea placeholder="ระบุเหตุผลการเบิก..." {...field} disabled={isSubmitting} />)} />
            </CardContent>
          </Card>
        </form>
      </Form>

      <Dialog open={isScannerOpen} onOpenChange={(o) => !o && stopScanner()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-black">
          <div className="relative aspect-square">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            <div className="absolute inset-0 border-2 border-primary/50 m-12 rounded-lg pointer-events-none">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 animate-pulse" />
            </div>
          </div>
          <DialogFooter className="p-4 bg-background"><Button variant="outline" onClick={stopScanner} className="w-full">ยกเลิก</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={stockConfirmOpen}
        onOpenChange={(open) => {
          setStockConfirmOpen(open);
          if (!open) {
            pendingIssueSaveRef.current = null;
            setStockSummary(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0">
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการตัดสต็อก</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-foreground space-y-1">
              <span className="block text-muted-foreground">
                ตรวจสอบรายการด้านล่าง — ถ้าถูกต้องกด «ยืนยันการบันทึก» หรือกด «ยกเลิก» เพื่อกลับไปแก้ไขรายการ
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {stockSummary && (
            <ScrollArea className="max-h-[min(50vh,320px)] pr-3 -mr-1">
              <div className="space-y-4 text-sm pb-2">
                <div>
                  <p className="font-semibold text-destructive mb-2">เบิกออกจากสต็อก (ตัดเพิ่ม)</p>
                  {stockSummary.withdrawals.length === 0 ? (
                    <p className="text-muted-foreground text-sm border rounded-md p-3 bg-muted/30">— ไม่มี</p>
                  ) : (
                    <ul className="list-none space-y-1.5 border rounded-md p-3 bg-muted/40">
                      {stockSummary.withdrawals.map((row, idx) => (
                        <li key={`w-${row.partId}-${idx}`} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0">
                            <span className="font-mono text-xs text-primary">{row.code || "—"}</span>
                            <span className="block">{row.description}</span>
                          </span>
                          <span className="font-bold tabular-nums shrink-0">{formatStockQty(row.quantity)} ชิ้น</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-green-700 dark:text-green-400 mb-2">คืนเข้าสต็อก</p>
                  {stockSummary.returnsToStock.length === 0 ? (
                    <p className="text-muted-foreground text-sm border rounded-md p-3 bg-muted/30">— ไม่มี</p>
                  ) : (
                    <ul className="list-none space-y-1.5 border rounded-md p-3 bg-muted/40">
                      {stockSummary.returnsToStock.map((row, idx) => (
                        <li key={`r-${row.partId}-${idx}`} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0">
                            <span className="font-mono text-xs text-primary">{row.code || "—"}</span>
                            <span className="block">{row.description}</span>
                          </span>
                          <span className="font-bold tabular-nums shrink-0">{formatStockQty(row.quantity)} ชิ้น</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {stockSummary.withdrawals.length === 0 && stockSummary.returnsToStock.length === 0 && (
                  <p className="text-sm text-amber-800 dark:text-amber-200 border border-amber-200/60 bg-amber-50 dark:bg-amber-950/40 rounded-md p-3">
                    ไม่มีการเปลี่ยนจำนวนในสต็อก — ระบบจะบันทึกข้อมูลในใบเบิกเท่านั้น (เช่น แก้หมายเหตุ)
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={isSubmitting} className="mt-0">
              ยกเลิก — กลับไปแก้ไข
            </AlertDialogCancel>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700"
              disabled={isSubmitting}
              onClick={() => void handleConfirmIssueSave()}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ยืนยันการบันทึก
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
