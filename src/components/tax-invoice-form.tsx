
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, onSnapshot, query, where, updateDoc, serverTimestamp, getDocs, orderBy, limit, writeBatch, getDoc, deleteField } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ChevronsUpDown, AlertCircle, Info, Send, Trash2, XCircle, CalendarDays, ArrowLeft, FileSearch, Eye, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";

import { createDocument, getNextAvailableDocNo } from "@/firebase/documents";
import type { Job, StoreSettings, Customer, Document as DocumentType, AccountingAccount, DocType, JobStatus } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const lineItemSchema = z.object({
  description: z.string().min(1, "กรุณากรอกรายละเอียดรายการ"),
  quantity: z.coerce.number().min(0.01, "จำนวนต้องมากกว่า 0"),
  unitPrice: z.coerce.number().min(0, "ราคาต่อหน่วยห้ามติดลบ"),
  total: z.coerce.number(),
});

const taxInvoiceFormSchema = z.object({
  jobId: z.string().optional(),
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  issueDate: z.string().min(1, "กรุณาเลือกวันที่"),
  items: z.array(lineItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
  subtotal: z.coerce.number(),
  discountAmount: z.coerce.number().min(0).optional(),
  net: z.coerce.number(),
  isVat: z.boolean().default(true),
  vatAmount: z.coerce.number(),
  grandTotal: z.coerce.number(),
  notes: z.string().optional(),
  senderName: z.string().optional(),
  receiverName: z.string().optional(),
  isBackfill: z.boolean().default(false),
  manualDocNo: z.string().optional(),
  paymentTerms: z.enum(["CASH", "CREDIT"]).optional(),
  suggestedAccountId: z.string().optional(),
  billingRequired: z.boolean().default(false),
  dueDate: z.string().optional().nullable(),
});

type TaxInvoiceFormData = z.infer<typeof taxInvoiceFormSchema>;

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function TaxInvoiceForm({ jobId: jobIdProp, editDocId: editDocIdProp }: { jobId: string | null, editDocId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveJobId = useMemo(() => searchParams.get("jobId") || jobIdProp, [searchParams, jobIdProp]);
  const effectiveEditDocId = useMemo(() => searchParams.get("editDocId") || editDocIdProp, [searchParams, editDocIdProp]);
  
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const isEditing = !!effectiveEditDocId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [referencedQuotationId, setReferencedQuotationId] = useState<string | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReviewSubmission, setIsReviewSubmission] = useState(false);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [pendingData, setPendingData] = useState<TaxInvoiceFormData | null>(null);

  const [existingTi, setExistingActiveDoc] = useState<DocumentType | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  const [previewDocNo, setPreviewDocNo] = useState<string>("");

  const [suggestedPayments, setSuggestedPayments] = useState<{accountId: string, amount: number}[]>([{accountId: '', amount: 0}]);
  const [recordRemainingAsCredit, setRecordRemainingAsCredit] = useState(false);
  const [submitBillingRequired, setSubmitBillingRequired] = useState(false);
  const [submitDueDate, setSubmitDueDate] = useState('');

  const [allQuotations, setAllQuotations] = useState<DocumentType[]>([]);
  const [isSearchingQt, setIsSearchingQt] = useState(false);
  const [isQtSearchOpen, setIsQtSearchOpen] = useState(false);
  const [qtSearchQuery, setQtSearchQuery] = useState("");

  const jobDocRef = useMemo(() => (db && effectiveJobId ? doc(db, "jobs", effectiveJobId) : null), [db, effectiveJobId]);
  const docToEditRef = useMemo(() => (db && effectiveEditDocId ? doc(db, "documents", effectiveEditDocId) : null), [db, effectiveEditDocId]);
  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);

  const { data: job, isLoading: isLoadingJob } = useDoc<Job>(jobDocRef);
  const { data: docToEdit, isLoading: isLoadingDocToEdit } = useDoc<DocumentType>(docToEditRef);
  const { data: storeSettings, isLoading: isLoadingStore } = useDoc<StoreSettings>(storeSettingsRef);
  
  const form = useForm<TaxInvoiceFormData>({
    resolver: zodResolver(taxInvoiceFormSchema),
    defaultValues: {
      jobId: effectiveJobId || undefined,
      customerId: "",
      issueDate: "", 
      items: [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
      isVat: true,
      subtotal: 0,
      discountAmount: 0,
      net: 0,
      vatAmount: 0,
      grandTotal: 0,
      notes: "",
      senderName: "",
      receiverName: "",
      paymentTerms: 'CASH',
      suggestedAccountId: '',
      billingRequired: false,
    },
  });

  useEffect(() => {
    form.register("jobId");
  }, [form]);

  const selectedCustomerId = form.watch('customerId');
  const watchedIssueDate = form.watch('issueDate');
  const currentCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);
  const grandTotal = form.watch('grandTotal');
  
  const isLocked = isEditing && (docToEdit?.status === 'PAID' || docToEdit?.status === 'PENDING_REVIEW') && profile?.role !== 'ADMIN' && profile?.role !== 'MANAGER';

  useEffect(() => {
    if (!isEditing && !form.getValues("issueDate")) {
      form.setValue("issueDate", format(new Date(), "yyyy-MM-dd"));
    }
  }, [isEditing, form]);

  useEffect(() => {
    if (!db || isEditing || !watchedIssueDate) return;
    
    const fetchPreview = async () => {
      try {
        setIndexErrorUrl(null);
        const result = await getNextAvailableDocNo(db, 'TAX_INVOICE', watchedIssueDate);
        if (result.indexErrorUrl) {
          setIndexErrorUrl(result.indexErrorUrl);
        } else {
          setPreviewDocNo(result.docNo);
        }
      } catch (e: any) {
      }
    };
    fetchPreview();
  }, [db, isEditing, watchedIssueDate]);

  useEffect(() => {
    if (!db) return;
    onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
      setIsLoadingCustomers(false);
    });
    onSnapshot(query(collection(db, "accountingAccounts"), where("isActive", "==", true)), (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
    });
  }, [db]);

  useEffect(() => {
    if (docToEdit) {
      form.reset({
        jobId: docToEdit.jobId || effectiveJobId || undefined,
        customerId: docToEdit.customerId || docToEdit.customerSnapshot?.id || "",
        issueDate: docToEdit.docDate || format(new Date(), "yyyy-MM-dd"),
        items: docToEdit.items?.map(item => ({...item})) || [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
        notes: docToEdit.notes ?? '',
        isVat: true,
        discountAmount: docToEdit.discountAmount || 0,
        senderName: profile?.displayName || docToEdit.senderName || '',
        receiverName: docToEdit.customerSnapshot?.name || docToEdit.receiverName || '',
        isBackfill: false,
        paymentTerms: docToEdit.paymentTerms || 'CASH',
        suggestedAccountId: docToEdit.suggestedAccountId || '',
        billingRequired: docToEdit.billingRequired || false,
        dueDate: docToEdit.dueDate || null,
      });
      if (docToEdit.suggestedPayments) setSuggestedPayments(docToEdit.suggestedPayments.map(p => ({ accountId: p.accountId, amount: p.amount })));
      setRecordRemainingAsCredit(docToEdit.paymentTerms === 'CREDIT');
      setSubmitBillingRequired(docToEdit.billingRequired || false);
      setSubmitDueDate(docToEdit.dueDate || '');
      if (docToEdit.referencesDocIds?.[0]) setReferencedQuotationId(docToEdit.referencesDocIds[0]);
    } else if (job) {
        form.setValue('jobId', effectiveJobId || undefined);
        form.setValue('customerId', job.customerId);
        form.setValue('items', [{ description: job.description, quantity: 1, unitPrice: 0, total: 0 }]);
        form.setValue('receiverName', job.customerSnapshot?.taxName || job.customerSnapshot?.name || '');
    }
    if (profile) form.setValue('senderName', profile.displayName || '');
  }, [job, docToEdit, profile, form, effectiveJobId]);

  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedDiscount = useWatch({ control: form.control, name: "discountAmount" });

  useEffect(() => {
    const subtotal = Math.round(watchedItems.reduce((sum, item) => sum + (item.total || 0), 0) * 100) / 100;
    const discount = watchedDiscount || 0;
    const net = Math.round((subtotal - discount) * 100) / 100;
    const vat = Math.round((net * 0.07) * 100) / 100;
    form.setValue("subtotal", subtotal);
    form.setValue("net", net);
    form.setValue("vatAmount", vat);
    form.setValue("grandTotal", Math.round((net + vat) * 100) / 100);
  }, [watchedItems, watchedDiscount, form]);

  const currentSuggestedTotal = useMemo(() => suggestedPayments.reduce((sum, p) => sum + (p.amount || 0), 0), [suggestedPayments]);
  const remainingAmount = useMemo(() => Math.round(((grandTotal || 0) - currentSuggestedTotal) * 100) / 100, [grandTotal, currentSuggestedTotal]);

  const executeSave = async (data: TaxInvoiceFormData, submitForReview: boolean) => {
    const customerSnapshot = currentCustomer || docToEdit?.customerSnapshot || job?.customerSnapshot;
    if (!db || !customerSnapshot || !storeSettings || !profile) return;
    setIsProcessing(true);
    
    const targetStatus = submitForReview ? 'PENDING_REVIEW' : 'DRAFT';
    const targetJobStatus: JobStatus = submitForReview ? 'PICKED_UP' : 'WAITING_CUSTOMER_PICKUP';
    
    const linkedJobId = data.jobId || docToEdit?.jobId || effectiveJobId;
    const jobDetails = job || (isEditing && docToEdit?.jobId ? docToEdit.carSnapshot : null);
    
    const carSnapshot = linkedJobId ? { 
      licensePlate: (jobDetails as any)?.carServiceDetails?.licensePlate || (jobDetails as any)?.licensePlate || docToEdit?.carSnapshot?.licensePlate,
      brand: (jobDetails as any)?.carServiceDetails?.brand || (jobDetails as any)?.commonrailDetails?.brand || (jobDetails as any)?.mechanicDetails?.brand || (jobDetails as any)?.brand || docToEdit?.carSnapshot?.brand,
      model: (jobDetails as any)?.carServiceDetails?.model || (jobDetails as any)?.model || docToEdit?.carSnapshot?.model,
      partNumber: (jobDetails as any)?.commonrailDetails?.partNumber || (jobDetails as any)?.mechanicDetails?.partNumber || (jobDetails as any)?.partNumber || docToEdit?.carSnapshot?.partNumber,
      registrationNumber: (jobDetails as any)?.commonrailDetails?.registrationNumber || (jobDetails as any)?.mechanicDetails?.registrationNumber || (jobDetails as any)?.registrationNumber || docToEdit?.carSnapshot?.registrationNumber,
      details: (jobDetails as any)?.description || (jobDetails as any)?.details || docToEdit?.carSnapshot?.details 
    } : {};

    try {
        const payload = { 
          ...data, 
          jobId: linkedJobId || undefined,
          docDate: data.issueDate, 
          customerSnapshot, 
          carSnapshot, 
          storeSnapshot: storeSettings, 
          withTax: true, 
          paymentSummary: { paidTotal: 0, balance: data.grandTotal, paymentStatus: 'UNPAID' }, 
          arStatus: submitForReview ? 'PENDING' : (isEditing ? docToEdit?.arStatus : null), 
          referencesDocIds: referencedQuotationId ? [referencedQuotationId] : [] 
        };
        
        if (isEditing && effectiveEditDocId) {
            const batch = writeBatch(db);
            const docRef = doc(db, 'documents', effectiveEditDocId);
            const finalDocNo = docToEdit?.docNo || "Unknown";

            batch.update(docRef, sanitizeForFirestore({ ...payload, status: targetStatus, updatedAt: serverTimestamp(), dispute: { isDisputed: false, reason: "" } }));
            
            if (linkedJobId) {
                const jobRef = doc(db, 'jobs', linkedJobId);
                batch.update(jobRef, {
                    status: targetJobStatus,
                    salesDocId: effectiveEditDocId,
                    salesDocNo: finalDocNo,
                    salesDocType: 'TAX_INVOICE',
                    salesDocStatus: targetStatus,
                    lastActivityAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
            await batch.commit();
        } else {
            await createDocument(db, 'TAX_INVOICE', payload, profile, linkedJobId ? targetJobStatus : undefined, { manualDocNo: data.isBackfill ? data.manualDocNo : undefined, initialStatus: targetStatus });
        }
        toast({ title: submitForReview ? "ส่งตรวจสอบสำเร็จ" : "บันทึกร่างสำเร็จ" });
        router.push('/app/office/documents/tax-invoice');
    } catch (e: any) { 
      toast({ variant: "destructive", title: "Error", description: e.message }); 
    } finally { setIsProcessing(false); }
  };

  const checkUniqueness = async (jobIdVal: string) => {
    if (!db || isEditing) return true;
    setIndexErrorUrl(null);
    try {
      const q = query(collection(db, "documents"), where("jobId", "==", jobIdVal), where("docType", "==", "TAX_INVOICE"), limit(5));
      const snap = await getDocs(q);
      const activeDoc = snap.docs.find(d => d.data().status !== 'CANCELLED');
      if (activeDoc) {
        setExistingActiveDoc({ id: activeDoc.id, ...activeDoc.data() } as DocumentType);
        return false;
      }
      return true;
    } catch (e: any) {
      if (e.message?.includes('requires an index')) {
        const urlMatch = e.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexErrorUrl(urlMatch[0]);
      }
      throw e;
    }
  };

  const handleSaveWrapper = async (data: TaxInvoiceFormData, submitForReview: boolean) => {
    if (isProcessing) return; 
    const currentJobId = data.jobId || effectiveJobId || docToEdit?.jobId;
    try {
      if (currentJobId) {
        const ok = await checkUniqueness(currentJobId);
        if (!ok) {
          setPendingData({ ...data, jobId: currentJobId });
          setIsReviewSubmission(submitForReview);
          setShowDuplicateDialog(true);
          return;
        }
      }
      if (submitForReview) { 
          setPendingData({ ...data, jobId: currentJobId }); 
          setIsReviewSubmission(true); 
          if (suggestedPayments.length === 1 && suggestedPayments[0].amount === 0) {
              setSuggestedPayments([{accountId: accounts.find(a=>a.type==='CASH')?.id || '', amount: data.grandTotal}]);
          }
          setShowReviewConfirm(true); 
          return; 
      }
      await executeSave({ ...data, jobId: currentJobId }, false);
    } catch (e) {}
  };

  const handleCancelExistingAndSave = async () => {
    if (!db || !existingTi || !profile || !pendingData || isProcessing) return;
    setIsProcessing(true);
    try {
        await updateDoc(doc(db, 'documents', existingTi.id), { 
            status: 'CANCELLED', 
            updatedAt: serverTimestamp(), 
            notes: (existingTi.notes || "") + `\n[System] ยกเลิกเมื่อ ${safeFormat(new Date(), 'dd/MM/yy HH:mm')} โดย ${profile.displayName} เพื่อออกใบใหม่แทนที่` 
        });

        const finalData = { ...pendingData };
        if (!finalData.jobId && existingTi.jobId) {
            finalData.jobId = existingTi.jobId;
        }

        setShowDuplicateDialog(false);
        setExistingActiveDoc(null);
        
        await executeSave(finalData, isReviewSubmission);
    } catch(e: any) { 
        toast({ variant: 'destructive', title: "Error", description: e.message }); 
        setIsProcessing(false);
    }
  };

  const handleFetchFromDoc = async (sourceDoc: DocumentType) => {
    const itemsFromDoc = (sourceDoc.items || []).map((item: any) => ({ description: String(item.description ?? ''), quantity: Number(item.quantity ?? 1), unitPrice: Number(item.unitPrice ?? 0), total: Math.round((Number(item.quantity ?? 1) * Number(item.unitPrice ?? 0)) * 100) / 100 }));
    if (itemsFromDoc.length === 0) return;
    replace(itemsFromDoc);
    if (sourceDoc.docType === 'QUOTATION') setReferencedQuotationId(sourceDoc.id);
    if (sourceDoc.jobId) form.setValue('jobId', sourceDoc.jobId);
    form.setValue('discountAmount', Number(sourceDoc.discountAmount ?? 0));
    form.setValue('customerId', sourceDoc.customerId || sourceDoc.customerSnapshot?.id || "");
    form.setValue('receiverName', sourceDoc.customerSnapshot?.taxName || sourceDoc.customerSnapshot?.name || "");
    setIsQtSearchOpen(false);
  };

  const loadAllDocs = async (type: DocType | 'BILLS') => {
    if (!db) return;
    if (type === 'QUOTATION') {
        setIsSearchingQt(true);
        try {
            const snap = await getDocs(query(collection(db, "documents"), where("docType", "==", "QUOTATION"), limit(500)));
            const getTime = (v: any) => v?.toMillis?.() || v?.seconds * 1000 || 0;
            setAllQuotations(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentType)).filter(d => d.status !== 'CANCELLED').sort((a,b) => getTime(b.createdAt) - getTime(a.createdAt)));
        } finally { setIsSearchingQt(false); }
    }
  };

  const isFormLoading = isLoadingJob || isLoadingStore || isLoadingCustomers || isLoadingDocToEdit;

  if (isFormLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch));

  return (
    <div className="flex flex-col gap-6">
      {indexErrorUrl && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้างดัชนี (Index) ก่อน</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>ฐานข้อมูลต้องการดัชนีเพื่อเรียงลำดับเอกสาร กรุณากดปุ่มด้านล่างเพื่อสร้าง Index</span>
            <Button asChild variant="outline" size="sm" className="w-fit bg-white text-destructive hover:bg-muted">
              <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4"/>สร้าง Index</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          <div className="flex justify-between items-center">
            <Button type="button" variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={form.handleSubmit((d) => handleSaveWrapper(d, false))} disabled={isLocked || isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                บันทึกฉบับร่าง
              </Button>
              <Button type="button" onClick={form.handleSubmit((d) => handleSaveWrapper(d, true))} disabled={isLocked || isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                ส่งบัญชีตรวจสอบ
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 border rounded-lg bg-card shadow-sm">
            <div className="lg:col-span-2 space-y-2">
              <h2 className="text-xl font-bold">{storeSettings?.taxName || 'Sahadiesel Service'}</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{storeSettings?.taxAddress}</p>
              <p className="text-sm text-muted-foreground">โทร: {storeSettings?.phone}</p>
            </div>
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-right text-primary">ใบกำกับภาษี</h1>
              {isEditing ? (
                <p className="text-right text-sm font-mono">{docToEdit?.docNo}</p>
              ) : (
                <div className="text-right">
                  <Badge variant="outline" className="font-mono text-lg py-1 px-3 border-primary/30 text-primary bg-primary/5">
                    {previewDocNo || "กำลังโหลดเลขที่..."}
                  </Badge>
                </div>
              )}
              <FormField
                control={form.control}
                name="issueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>วันที่ออกเอกสาร</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal h-10",
                              !field.value && "text-muted-foreground"
                            )}
                            disabled={isLocked}
                          >
                            {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                            <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value ? parseISO(field.value) : undefined}
                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center gap-4 py-3">
              <CardTitle className="text-base whitespace-nowrap">ข้อมูลลูกค้าและรายการ</CardTitle>
              <div className="flex gap-2">
                <Popover open={isQtSearchOpen} onOpenChange={setIsQtSearchOpen}>
                  <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" onClick={() => loadAllDocs('QUOTATION')} disabled={isLocked}><FileSearch className="mr-2 h-3 w-3" /> ใบเสนอราคา</Button></PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <div className="p-2 border-b">
                      <Input placeholder="ค้นหาชื่อลูกค้า หรือเลขที่..." value={qtSearchQuery} onChange={e=>setQtSearchQuery(e.target.value)} />
                    </div>
                    <ScrollArea className="h-60">
                      {isSearchingQt ? (
                        <Loader2 className="animate-spin m-4" /> 
                      ) : allQuotations.filter(q => 
                          q.docNo.toLowerCase().includes(qtSearchQuery.toLowerCase()) || 
                          q.customerSnapshot?.name?.toLowerCase().includes(qtSearchQuery.toLowerCase())
                        ).map(q => (
                          <Button key={q.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b text-left" onClick={() => handleFetchFromDoc(q)}>
                            <div className="flex flex-col">
                              <span className="font-semibold">{q.docNo}</span>
                              <span className="text-[10px]">{q.customerSnapshot?.name}</span>
                            </div>
                          </Button>
                        ))
                      }
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>ชื่อลูกค้า</FormLabel>
                  <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("w-full max-w-sm justify-between font-normal", !field.value && "text-muted-foreground")} disabled={isLocked || !!effectiveJobId}>
                          <span>{currentCustomer?.name || "เลือกลูกค้า..."}</span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <div className="p-2 border-b">
                        <Input placeholder="ค้นหา..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                      </div>
                      <ScrollArea className="h-fit max-h-60">
                        {filteredCustomers.map((c) => (
                          <Button key={c.id} variant="ghost" onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); }} className="w-full justify-start h-auto py-2 px-3 text-left">
                            <span>{c.name}</span>
                          </Button>
                        ))}
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                </FormItem>
              )} />
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>รายการ</TableHead><TableHead className="w-32 text-right">จำนวน</TableHead><TableHead className="w-40 text-right">ราคา</TableHead><TableHead className="text-right">ยอดรวม</TableHead><TableHead/></TableRow></TableHeader>
                  <TableBody>{fields.map((field, index) => (<TableRow key={field.id}><TableCell><FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (<Input {...field} value={field.value ?? ''} disabled={isLocked}/>)}/></TableCell><TableCell><FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (<Input type="number" className="text-right" {...field} value={field.value || ''} disabled={isLocked} onChange={(e) => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.unitPrice`)) * 100) / 100); }} />)}/></TableCell><TableCell><FormField control={form.control} name={`items.${index}.unitPrice`} render={({ field }) => (<Input type="number" className="text-right" {...field} value={field.value || ''} disabled={isLocked} onChange={(e) => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.quantity`)) * 100) / 100); }} />)}/></TableCell><TableCell className="text-right">{formatCurrency(form.watch(`items.${index}.total`))}</TableCell><TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={isLocked}><Trash2 className="h-4 w-4"/></Button></TableCell></TableRow>))}</TableBody>
                </Table>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => append({description: '', quantity: 1, unitPrice: 0, total: 0})} disabled={isLocked}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มรายการ</Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">หมายเหตุ</CardTitle></CardHeader>
              <CardContent>
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <Textarea {...field} value={field.value || ""} rows={5} disabled={isLocked} placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)..." />
                )} />
              </CardContent>
            </Card>
            <div className="space-y-4">
              <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">รวมเป็นเงิน (ก่อนภาษี)</span>
                  <span>{formatCurrency(form.watch('subtotal'))}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ส่วนลด (บาท)</span>
                  <FormField control={form.control} name="discountAmount" render={({ field }) => (
                    <Input type="number" step="any" className="w-32 text-right bg-background h-8" {...field} value={field.value || ''} disabled={isLocked} />
                  )}/>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ยอดหลังหักส่วนลด</span>
                  <span>{formatCurrency(form.watch('net'))}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม 7%</span>
                  <span>{formatCurrency(form.watch('vatAmount'))}</span>
                </div>
                <Separator/>
                <div className="flex justify-between items-center text-xl font-bold text-primary">
                  <span>ยอดสุทธิรวมทั้งสิ้น</span>
                  <span>{formatCurrency(form.watch('grandTotal'))} บาท</span>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Form>

      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" />พบใบเดิม</DialogTitle>
            <DialogDescription>มีการออกใบกำกับภาษีไปแล้วคือเลขที่ <span className="font-bold">{existingTi?.docNo}</span></DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Alert variant="secondary" className="bg-amber-50 border-amber-200">
              <Info className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800">นโยบายระบบ</AlertTitle>
              <AlertDescription className="text-amber-700 text-xs">หนึ่งงานซ่อมสามารถผูกใบกำกับภาษีได้เพียงฉบับเดียวเท่านั้นค่ะ</AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => router.push(`/app/office/documents/tax-invoice/${existingTi?.id}`)}><Eye className="mr-2 h-4 w-4" /> ดูใบเดิม</Button>
            <Button variant="destructive" onClick={handleCancelExistingAndSave} disabled={isProcessing}>{isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />} ยกเลิกใบเดิมและสร้างใหม่</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReviewConfirm} onOpenChange={setShowReviewConfirm}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>ระบุเงื่อนไขการรับเงิน</DialogTitle></DialogHeader>
          <div className="py-4 space-y-6">
            <div className="p-4 bg-primary/5 rounded-lg border flex justify-between items-center"><span className="font-semibold">ยอดรวมทั้งสิ้น:</span><span className="text-2xl font-black text-primary">฿{formatCurrency(grandTotal)}</span></div>
            <div className="space-y-4">
                <Label className="flex items-center gap-2"><Wallet className="h-4 w-4" /> รายการรับเงิน</Label>
                <div className="border rounded-md overflow-hidden"><Table><TableHeader><TableRow><TableHead>บัญชี (Account)</TableHead><TableHead className="w-32">จำนวน</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                <TableBody>{suggestedPayments.map((p, i) => (<TableRow key={i}><TableCell className="p-2"><Select value={p.accountId} onValueChange={(v) => { const n = [...suggestedPayments]; n[i].accountId = v; setSuggestedPayments(n); }}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="เลือกบัญชี..."/></SelectTrigger><SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}</SelectContent></Select></TableCell><TableCell className="p-2"><Input type="number" className="h-8 text-right text-xs" value={p.amount || ''} onChange={(e) => { const n = [...suggestedPayments]; n[i].amount = parseFloat(e.target.value) || 0; setSuggestedPayments(n); }}/></TableCell><TableCell className="p-2"><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setSuggestedPayments(prev => prev.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3" /></Button></TableCell></TableRow>))}</TableBody></Table></div>
                <Button variant="outline" size="sm" className="w-full h-8 border-dashed" onClick={() => setSuggestedPayments([...suggestedPayments, {accountId: '', amount: 0}])}><PlusCircle className="mr-2 h-3 w-3" /> เพิ่มบัญชีรับเงิน</Button>
            </div>
            <div className="pt-4 border-t"><div className={cn("flex justify-between items-center p-3 rounded-md border", remainingAmount > 0.01 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}><span className="text-sm font-bold">ยอดคงเหลือ:</span><span className={cn("text-lg font-black", remainingAmount > 0.01 ? "text-amber-600" : "text-green-600")}>฿{formatCurrency(remainingAmount)}</span></div>
            {remainingAmount > 0.01 && (<div className="mt-4 space-y-4 animate-in fade-in"><div className="flex items-center space-x-2"><Checkbox id="r-credit" checked={recordRemainingAsCredit} onCheckedChange={(v: any) => setRecordRemainingAsCredit(v)} /><Label htmlFor="r-credit" className="font-bold text-amber-700">บันทึกยอดคงเหลือเป็นลูกหนี้ (Credit)</Label></div>{recordRemainingAsCredit && (<div className="grid grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/20"><div className="space-y-2"><Label className="text-xs">วันครบกำหนด</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full pl-3 text-left font-normal h-9",
                    !submitDueDate && "text-muted-foreground"
                  )}
                >
                  {submitDueDate ? format(parseISO(submitDueDate), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                  <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={submitDueDate ? parseISO(submitDueDate) : undefined}
                  onSelect={(date) => setSubmitDueDate(date ? format(date, "yyyy-MM-dd") : "")}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            </div><div className="flex items-center space-x-2 pt-6"><Checkbox id="r-billing" checked={submitBillingRequired} onCheckedChange={(v: any) => setSubmitBillingRequired(v)} /><Label htmlFor="r-billing" className="text-xs">ต้องวางบิลรวม</Label></div></div>)}</div>)}</div>
          </div>
          <DialogFooter className="bg-muted/30 p-6 border-t"><Button variant="outline" onClick={() => setShowReviewConfirm(false)}>ยกเลิก</Button><Button onClick={() => { if(isProcessing) return; const validPayments = suggestedPayments.filter(p => p.amount > 0 && p.accountId); const firstAcc = accounts.find(a => a.id === validPayments[0]?.accountId); const finalPayload = { ...pendingData!, paymentTerms: recordRemainingAsCredit ? 'CREDIT' as const : 'CASH' as const, suggestedPayments: validPayments.map(p => { const acc = accounts.find(a => a.id === p.accountId); return { ...p, amount: Math.round(p.amount * 100) / 100, method: acc?.type === 'CASH' ? 'CASH' : 'TRANSFER' }; }), suggestedAccountId: validPayments[0]?.accountId || '', suggestedPaymentMethod: firstAcc?.type === 'CASH' ? 'CASH' : 'TRANSFER' as any, billingRequired: recordRemainingAsCredit ? submitBillingRequired : false, dueDate: recordRemainingAsCredit ? submitDueDate : null }; executeSave(finalPayload, true); setShowReviewConfirm(false); }} disabled={isProcessing || (remainingAmount > 0.01 && !recordRemainingAsCredit) || (suggestedPayments.some(p => p.amount > 0 && !p.accountId))}>{isProcessing ? <Loader2 className="animate-spin mr-2" /> : <Send className="mr-2" />} ยืนยันและส่งให้บัญชี</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
