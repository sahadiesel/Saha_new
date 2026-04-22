"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, onSnapshot, query, serverTimestamp, updateDoc, where, orderBy, getDocs, limit, writeBatch, deleteField, setDoc, addDoc } from "firebase/firestore";
import { useFirebase, useCollection, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, PlusCircle, Trash2, Save, ArrowLeft, ChevronsUpDown, AlertCircle, LayoutTemplate, Eye, XCircle, Info, ExternalLink, CalendarDays, Send } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";

import { createDocument, getNextAvailableDocNo } from "@/firebase/documents";
import type { Job, StoreSettings, Customer, Document as DocumentType, QuotationTemplate } from "@/lib/types";
import { docStatusLabel } from "@/lib/ui-labels";

const lineItemSchema = z.object({
  description: z.string().min(1, "ต้องกรอกรายละเอียดรายการ"),
  quantity: z.coerce.number().min(0.01, "จำนวนต้องมากกว่า 0"),
  unitPrice: z.coerce.number().min(0, "ราคาต่อหน่วยห้ามติดลบ"),
  total: z.coerce.number().default(0),
});

const quotationFormSchema = z.object({
  jobId: z.string().optional(),
  customerId: z.string().min(1, "กรุณาเลือกลูกค้าจากรายการ"),
  issueDate: z.string().min(1, "กรุณาเลือกวันที่ออกเอกสาร"),
  expiryDate: z.string().min(1, "กรุณาเลือกวันที่ยืนราคา"),
  items: z.array(lineItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการในตาราง"),
  subtotal: z.coerce.number().default(0),
  discountAmount: z.coerce.number().min(0, "ส่วนลดห้ามติดลบ").optional().default(0),
  net: z.coerce.number().default(0),
  isVat: z.boolean().default(false),
  vatAmount: z.coerce.number().default(0),
  grandTotal: z.coerce.number().min(0.01, "ยอดรวมสุทธิไม่ถูกต้อง").default(0),
  notes: z.string().optional().default(""),
});

type QuotationFormData = z.infer<typeof quotationFormSchema>;

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function QuotationForm({ jobId, editDocId }: { jobId: string | null, editDocId: string | null }) {
  const router = useRouter();
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const isEditing = !!editDocId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [isTemplatePopoverOpen, setIsTemplatePopoverOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [existingActiveDoc, setExistingActiveDoc] = useState<DocumentType | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  const [pendingFormData, setPendingFormData] = useState<QuotationFormData | null>(null);
  const [previewDocNo, setPreviewDocNo] = useState<string>("");

  const jobDocRef = useMemo(() => (db && jobId ? doc(db, "jobs", jobId) : null), [db, jobId]);
  const docToEditRef = useMemo(() => (db && editDocId ? doc(db, "documents", editDocId) : null), [db, editDocId]);
  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const templatesQuery = useMemo(() => (db ? query(collection(db, "quotationTemplates"), orderBy("updatedAt", "desc")) : null), [db]);

  const { data: job, isLoading: isLoadingJob } = useDoc<Job>(jobDocRef);
  const { data: docToEdit, isLoading: isLoadingDocToEdit } = useDoc<DocumentType>(docToEditRef);
  const { data: storeSettings, isLoading: isLoadingStore } = useDoc<StoreSettings>(storeSettingsRef);
  const { data: templates } = useCollection<QuotationTemplate>(templatesQuery);

  const filteredQuotationTemplates = useMemo(() => {
    if (!templates?.length) return [];
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, templateSearch]);
  
  const form = useForm<QuotationFormData>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: {
      jobId: jobId || undefined,
      issueDate: "",
      expiryDate: "",
      items: [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
      isVat: false,
      subtotal: 0,
      discountAmount: 0,
      net: 0,
      vatAmount: 0,
      grandTotal: 0,
      notes: "",
    },
  });

  const selectedCustomerId = form.watch('customerId');
  const watchedIssueDate = form.watch('issueDate');
  const currentCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);
  const isCustomerSelectionDisabled = !!jobId || (isEditing && !!docToEdit?.customerId);
  const isCancelled = docToEdit?.status === 'CANCELLED';

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "items",
  });

  useEffect(() => {
    if (!isEditing && !form.getValues("issueDate")) {
      const today = new Date();
      form.setValue("issueDate", format(today, "yyyy-MM-dd"));
      form.setValue("expiryDate", format(new Date(today.setDate(today.getDate() + 30)), "yyyy-MM-dd"));
    }
  }, [isEditing, form]);

  useEffect(() => {
    if (!db || isEditing || !watchedIssueDate) return;
    
    const fetchPreview = async () => {
      try {
        setIndexErrorUrl(null);
        const result = await getNextAvailableDocNo(db, 'QUOTATION', watchedIssueDate);
        if (result.indexErrorUrl) {
          setIndexErrorUrl(result.indexErrorUrl);
        } else {
          setPreviewDocNo(result.docNo);
        }
      } catch (e: any) {}
    };
    fetchPreview();
  }, [db, isEditing, watchedIssueDate]);

  useEffect(() => {
    if (!db) return;
    setIsLoadingCustomers(true);
    const unsubscribe = onSnapshot(collection(db, "customers"), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      setIsLoadingCustomers(false);
    });
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    const dataToLoad = docToEdit || job;
    if (!dataToLoad) return;

    let customerId = (dataToLoad as any).customerId || (dataToLoad as any).customerSnapshot?.id || "";
    
    if (!customerId && dataToLoad.customerSnapshot?.name && dataToLoad.customerSnapshot?.phone && customers.length > 0) {
      const found = customers.find(c => c.name === dataToLoad.customerSnapshot?.name && c.phone === dataToLoad.customerSnapshot?.phone);
      if (found) customerId = found.id;
    }

    const items = 'items' in dataToLoad && dataToLoad.items && dataToLoad.items.length > 0
        ? dataToLoad.items.map(item => ({ 
            description: item.description || "", 
            quantity: Number(item.quantity) || 0, 
            unitPrice: Number(item.unitPrice) || 0, 
            total: Number(item.total) || 0 
          }))
        : [{ description: (dataToLoad as any).description || (dataToLoad as any).technicalReport || '', quantity: 1, unitPrice: 0, total: 0 }];

    form.reset({
        jobId: 'jobId' in dataToLoad ? dataToLoad.jobId || undefined : jobId || undefined,
        customerId: customerId,
        issueDate: 'docDate' in dataToLoad ? dataToLoad.docDate : format(new Date(), 'yyyy-MM-dd'),
        expiryDate: 'expiryDate' in dataToLoad && (dataToLoad as any).expiryDate ? (dataToLoad as any).expiryDate : format(new Date(new Date().setDate(new Date().getDate() + 30)), 'yyyy-MM-dd'),
        items: items,
        notes: 'notes' in dataToLoad ? dataToLoad.notes : '',
        isVat: 'withTax' in dataToLoad ? dataToLoad.withTax : false,
        discountAmount: 'discountAmount' in dataToLoad ? Number(dataToLoad.discountAmount) || 0 : 0,
        subtotal: 'subtotal' in dataToLoad ? Number(dataToLoad.subtotal) || 0 : 0,
        net: 'net' in dataToLoad ? Number(dataToLoad.net) || 0 : 0,
        vatAmount: 'vatAmount' in dataToLoad ? Number(dataToLoad.vatAmount) || 0 : 0,
        grandTotal: 'grandTotal' in dataToLoad ? Number(dataToLoad.grandTotal) || 0 : 0,
    });
  }, [job, docToEdit, customers, jobId, form]);

  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedDiscount = useWatch({ control: form.control, name: "discountAmount" });
  const watchedIsVat = useWatch({ control: form.control, name: "isVat" });

  useEffect(() => {
    const subtotal = Math.round(watchedItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0) * 100) / 100;
    const discount = Number(watchedDiscount) || 0;
    const net = Math.round(Math.max(0, subtotal - discount) * 100) / 100;
    const vatAmount = Math.round((watchedIsVat ? net * 0.07 : 0) * 100) / 100;
    const grandTotal = Math.round((net + vatAmount) * 100) / 100;

    form.setValue("subtotal", subtotal);
    form.setValue("net", net);
    form.setValue("vatAmount", vatAmount);
    form.setValue("grandTotal", grandTotal);
  }, [watchedItems, watchedDiscount, watchedIsVat, form]);

  const applyTemplate = (template: QuotationTemplate) => {
    if (template.items && template.items.length > 0) {
      replace(template.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total
      })));
      form.setValue('isVat', template.withTax ?? false);
      form.setValue('discountAmount', template.discountAmount || 0);
      form.setValue('notes', template.notes || "");
      toast({ title: "ใช้ Template สำเร็จ", description: `ดึงข้อมูลจาก "${template.name}" เรียบร้อยแล้วค่ะ` });
    }
    setIsTemplatePopoverOpen(false);
    setTemplateSearch("");
  };

  const handleSaveAsTemplate = async () => {
    const items = form.getValues("items");
    const name = prompt("กรุณาระบุชื่อ Template ที่ต้องการบันทึก:");
    if (!name || !db || !profile) return;

    setIsProcessing(true);
    try {
      const templateData = {
        name: name.trim(),
        items: items.map(i => ({ ...i })),
        discountAmount: form.getValues("discountAmount") || 0,
        withTax: form.getValues("isVat") || false,
        notes: form.getValues("notes") || "",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName,
      };

      const newRef = doc(collection(db, "quotationTemplates"));
      await setDoc(newRef, {
        ...sanitizeForFirestore(templateData),
        id: newRef.id,
      });

      toast({ title: "บันทึก Template สำเร็จ", description: `Template "${name}" พร้อมใช้งานแล้วค่ะ` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const executeSave = async (data: QuotationFormData) => {
    const customerSnapshot = customers.find(c => c.id === data.customerId) || docToEdit?.customerSnapshot || job?.customerSnapshot;
    if (!db || !customerSnapshot || !profile || !storeSettings) return;
    
    setIsProcessing(true);
    const jobDetails = job || (isEditing && docToEdit?.jobId ? docToEdit.carSnapshot : null);
    const carSnapshot = (data.jobId || docToEdit?.jobId) ? { 
      licensePlate: (jobDetails as any)?.carServiceDetails?.licensePlate || (jobDetails as any)?.licensePlate || docToEdit?.carSnapshot?.licensePlate,
      brand: (jobDetails as any)?.carServiceDetails?.brand || (jobDetails as any)?.commonrailDetails?.brand || (jobDetails as any)?.mechanicDetails?.brand || (jobDetails as any)?.brand || docToEdit?.carSnapshot?.brand,
      model: (jobDetails as any)?.carServiceDetails?.model || (jobDetails as any)?.model || docToEdit?.carSnapshot?.model,
      partNumber: (jobDetails as any)?.commonrailDetails?.partNumber || (jobDetails as any)?.mechanicDetails?.partNumber || (jobDetails as any)?.partNumber || docToEdit?.carSnapshot?.partNumber,
      registrationNumber: (jobDetails as any)?.commonrailDetails?.registrationNumber || (jobDetails as any)?.mechanicDetails?.registrationNumber || (jobDetails as any)?.registrationNumber || docToEdit?.carSnapshot?.registrationNumber,
      details: (jobDetails as any)?.description || (jobDetails as any)?.details || docToEdit?.carSnapshot?.details 
    } : {};

    const documentData = {
        customerId: data.customerId,
        docDate: data.issueDate,
        jobId: data.jobId,
        customerSnapshot: { ...customerSnapshot, id: data.customerId },
        carSnapshot: carSnapshot,
        storeSnapshot: { ...storeSettings },
        items: data.items,
        subtotal: data.subtotal,
        discountAmount: data.discountAmount || 0,
        net: data.net,
        withTax: data.isVat,
        vatAmount: data.vatAmount,
        grandTotal: data.grandTotal,
        notes: data.notes,
        expiryDate: data.expiryDate,
    };

    try {
        if (isEditing && editDocId) {
            await updateDoc(doc(db, 'documents', editDocId), sanitizeForFirestore({ ...documentData, updatedAt: serverTimestamp() }));
            toast({ title: "อัปเดตสำเร็จ" });
            router.push(`/app/office/documents/quotation/${editDocId}`);
        } else {
            const { docId } = await createDocument(db, 'QUOTATION', documentData, profile, data.jobId ? 'PENDING_CUSTOMER_INFORM' : undefined);
            toast({ title: "สร้างใบเสนอราคาสำเร็จ" });
            router.push(`/app/office/documents/quotation/${docId}`);
        }
    } catch (e: any) {
        toast({ variant: "destructive", title: "Error", description: e.message });
        setIsProcessing(false);
    }
  };

  const checkUniqueness = async (jobIdVal: string) => {
    if (!db || isEditing) return true;
    setIndexErrorUrl(null);
    try {
      const q = query(collection(db, "documents"), where("jobId", "==", jobIdVal), where("docType", "==", "QUOTATION"), limit(5));
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

  const onSubmit = async (data: QuotationFormData) => {
    if (isCancelled || isProcessing) return; 
    if (data.jobId) {
      const ok = await checkUniqueness(data.jobId);
      if (!ok) {
        setPendingFormData(data);
        setShowDuplicateDialog(true);
        return;
      }
    }
    await executeSave(data);
  };

  const handleCancelExistingAndSave = async () => {
    if (!db || !existingActiveDoc || !profile || !pendingFormData || isProcessing) return;
    setIsProcessing(true);
    try {
        await updateDoc(doc(db, 'documents', existingActiveDoc.id), { 
            status: 'CANCELLED', 
            updatedAt: serverTimestamp(), 
            notes: (existingActiveDoc.notes || "") + `\n[System] ยกเลิกโดย ${profile.displayName} เพื่อออกใบใหม่แทนที่` 
        });
        await executeSave(pendingFormData);
        setShowDuplicateDialog(false);
    } catch(e: any) { toast({ variant: 'destructive', title: "Error", description: e.message }); setIsProcessing(false); }
  };

  const markQuotationOfferedToCustomer = async () => {
    if (!db || !profile || !editDocId || !docToEdit) return;
    if (docToEdit.status !== "DRAFT" || isCancelled) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, "documents", editDocId), {
        status: "OFFERED",
        updatedAt: serverTimestamp(),
      });
      if (docToEdit.jobId) {
        const jobRef = doc(db, "jobs", docToEdit.jobId);
        await updateDoc(jobRef, {
          salesDocStatus: "OFFERED",
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await addDoc(collection(jobRef, "activities"), {
          text: `ใบเสนอราคา ${docToEdit.docNo} — ทำเครื่องหมายว่าเสนอลูกค้าแล้ว`,
          userName: profile.displayName,
          userId: profile.uid,
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: "อัปเดตสถานะแล้ว", description: "บันทึกว่าเสนอราคาลูกค้าแล้ว" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ไม่สำเร็จ", description: e.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const isFormLoading = form.formState.isSubmitting || isLoadingJob || isLoadingStore || isLoadingCustomers || isLoadingDocToEdit || isProcessing;
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const lowercasedFilter = customerSearch.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(lowercasedFilter) ||
        c.phone.includes(customerSearch)
    );
  }, [customers, customerSearch]);

  if (isLoadingJob || isLoadingStore || isLoadingCustomers || isLoadingDocToEdit) return <div className="p-8 space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;
  
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 border rounded-lg bg-card shadow-sm">
              <div className="lg:col-span-2 space-y-2">
                <h2 className="text-xl font-bold">{storeSettings?.taxName || 'Sahadiesel Service'}</h2>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{storeSettings?.taxAddress}</p>
                <p className="text-sm text-muted-foreground">โทร: {storeSettings?.phone}</p>
              </div>
              <div className="space-y-4">
                <h1 className="text-2xl font-bold text-right text-primary">ใบเสนอราคา</h1>
                {isEditing ? (
                  <div className="text-right space-y-1">
                    <p className="text-sm font-mono">{docToEdit?.docNo}</p>
                    {docToEdit?.status && (
                      <Badge variant={docToEdit.status === "DRAFT" ? "outline" : "secondary"} className="text-[10px]">
                        {docStatusLabel(docToEdit.status, "QUOTATION")}
                      </Badge>
                    )}
                  </div>
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
                              disabled={isCancelled || isProcessing}
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
                <FormField
                  control={form.control}
                  name="expiryDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>ยืนราคาถึงวันที่</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal h-10",
                                !field.value && "text-muted-foreground"
                              )}
                              disabled={isCancelled || isProcessing}
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
            <CardHeader><CardTitle className="text-base">ข้อมูลลูกค้า</CardTitle></CardHeader>
            <CardContent>
              <FormField name="customerId" render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>ชื่อลูกค้า</FormLabel>
                  <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("w-full max-w-sm justify-between font-normal", !field.value && "text-muted-foreground")} disabled={isCustomerSelectionDisabled || isProcessing}>
                          <span className="truncate">{currentCustomer ? `${currentCustomer.name} (${currentCustomer.phone})` : "เลือกลูกค้า..."}</span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <div className="p-2 border-b"><Input placeholder="ค้นหา..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} /></div>
                      <ScrollArea className="h-fit max-h-60">{filteredCustomers.map(c => (
                          <Button key={c.id} variant="ghost" onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); }} className="w-full justify-start h-auto py-2 px-3 border-b text-left">
                            <div className="flex flex-col"><span>{c.name}</span><span className="text-xs text-muted-foreground">{c.phone}</span></div>
                          </Button>
                        ))}</ScrollArea>
                    </PopoverContent>
                  </Popover>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-base">รายการสินค้า/บริการ</CardTitle>
              <Popover
                open={isTemplatePopoverOpen}
                onOpenChange={(open) => {
                  setIsTemplatePopoverOpen(open);
                  if (!open) setTemplateSearch("");
                }}
              >
                  <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={isCancelled || isProcessing}><LayoutTemplate className="mr-2 h-4 w-4"/>เลือกจาก Template</Button></PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <div className="p-2 border-b">
                      <Input
                        placeholder="ค้นหาชื่อ Template..."
                        value={templateSearch}
                        onChange={(e) => setTemplateSearch(e.target.value)}
                        className="h-9"
                        disabled={isCancelled || isProcessing}
                      />
                    </div>
                    <ScrollArea className="h-64">
                      {filteredQuotationTemplates.length === 0 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">
                          {templates?.length ? "ไม่พบ Template ที่ตรงกับคำค้น" : "ยังไม่มี Template"}
                        </p>
                      ) : (
                        filteredQuotationTemplates.map((t) => (
                          <Button
                            key={t.id}
                            variant="ghost"
                            className="w-full justify-start h-auto py-2 px-3 border-b rounded-none text-left flex flex-col items-start"
                            onClick={() => applyTemplate(t)}
                          >
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-[10px] text-muted-foreground">{t.items.length} รายการ</span>
                          </Button>
                        ))
                      )}
                    </ScrollArea>
                  </PopoverContent>
              </Popover>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-12 text-center">#</TableHead><TableHead>รายละเอียด</TableHead><TableHead className="w-32 text-right">จำนวน</TableHead><TableHead className="w-40 text-right">ราคา/หน่วย</TableHead><TableHead className="w-40 text-right">ยอดรวม</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
                  <TableBody>{fields.map((field, index) => (
                      <TableRow key={field.id}><TableCell className="text-center">{index + 1}</TableCell><TableCell><FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (<Input {...field} disabled={isCancelled || isProcessing} />)}/></TableCell><TableCell><FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (<Input type="number" step="any" className="text-right" value={field.value || ''} onChange={(e) => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.unitPrice`)) * 100) / 100); }} disabled={isCancelled || isProcessing} />)}/></TableCell><TableCell><FormField control={form.control} name={`items.${index}.unitPrice`} render={({ field }) => (<Input type="number" step="any" className="text-right" value={field.value || ''} onChange={(e) => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.quantity`)) * 100) / 100); }} disabled={isCancelled || isProcessing} />)}/></TableCell><TableCell className="text-right font-medium">{formatCurrency(form.watch(`items.${index}.total`))}</TableCell><TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={isCancelled || isProcessing}><Trash2 className="text-destructive h-4 w-4"/></Button></TableCell></TableRow>
                    ))}</TableBody>
                </Table>
              </div>
              {!isCancelled && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => append({description: '', quantity: 1, unitPrice: 0, total: 0})} disabled={isCancelled || isProcessing}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มรายการ</Button>}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">หมายเหตุ</CardTitle></CardHeader>
              <CardContent>
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <Textarea {...field} value={field.value || ""} rows={5} disabled={isCancelled || isProcessing} />
                )} />
              </CardContent>
            </Card>
            <div className="space-y-4">
              <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">รวมเป็นเงิน</span>
                  <span>{formatCurrency(form.watch('subtotal'))}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">ส่วนลด (บาท)</span>
                  <FormField control={form.control} name="discountAmount" render={({ field }) => (
                    <Input type="number" step="any" className="w-32 text-right bg-background h-8" {...field} disabled={isCancelled || isProcessing} />
                  )}/>
                </div>
                <div className="flex justify-between items-center py-2">
                  <FormField control={form.control} name="isVat" render={({ field }) => (
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isCancelled || isProcessing}/>
                      <Label className="text-sm font-normal cursor-pointer">ภาษีมูลค่าเพิ่ม 7%</Label>
                    </div>
                  )} />
                  <span className="text-sm">{formatCurrency(form.watch('vatAmount'))}</span>
                </div>
                <Separator/>
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>ยอดสุทธิรวมทั้งสิ้น</span>
                  <span>{formatCurrency(form.watch('grandTotal'))}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 sm:gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={isProcessing}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
            {isEditing && docToEdit?.status === "DRAFT" && !isCancelled && (
              <Button
                type="button"
                variant="secondary"
                className="border-green-600 text-green-800 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950/40"
                onClick={() => void markQuotationOfferedToCustomer()}
                disabled={isFormLoading}
              >
                <Send className="mr-2 h-4 w-4" />
                เสนอราคาลูกค้าแล้ว
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handleSaveAsTemplate} disabled={isFormLoading || isCancelled} className="border-primary text-primary hover:bg-primary/5"><LayoutTemplate className="mr-2 h-4 w-4" />บันทึกเป็น Template</Button>
            <Button type="submit" onClick={form.handleSubmit(onSubmit)} disabled={isFormLoading || isCancelled}>
              {isFormLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
              {isEditing ? 'บันทึกการแก้ไข' : 'บันทึกใบเสนอราคา'}
            </Button>
          </div>

          <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" />พบใบเสนอราคาเดิม</DialogTitle>
                <DialogDescription>งานซ่อมนี้มีการออกใบเสนอราคาไปแล้วคือเลขที่ <span className="font-bold text-primary">{existingActiveDoc?.docNo}</span></DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => router.push(`/app/office/documents/quotation/${existingActiveDoc?.id}`)}>
                  <Eye className="mr-2 h-4 w-4" /> ดูใบเดิม
                </Button>
                <Button variant="destructive" className="w-full sm:w-auto" onClick={handleCancelExistingAndSave} disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />} 
                  ยกเลิกใบเดิมและสร้างใหม่
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>
      </Form>
    </div>
  );
}
