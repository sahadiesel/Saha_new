"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, onSnapshot, query, where, updateDoc, serverTimestamp, addDoc, getDocs, limit, orderBy, runTransaction, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BrowserMultiFormatReader } from '@zxing/browser';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, PlusCircle, Trash2, Save, ArrowLeft, ChevronsUpDown, Camera, X, Send, AlertCircle, ExternalLink, CalendarDays, Search, Box, ImageIcon, PackagePlus, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";

import { getNextAvailablePurchaseDocNo } from "@/firebase/purchases";
import { VENDOR_TYPES } from "@/lib/constants";
import { vendorTypeLabel } from "@/lib/ui-labels";
import type { PurchaseDoc, Vendor, AccountingAccount, Part } from "@/lib/types";
import Link from "next/link";

const FILE_SIZE_THRESHOLD = 500 * 1024; // 500KB

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
                resolve(file); 
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

const lineItemSchema = z.object({
  partId: z.string().min(1, "กรุณาเลือกอะไหล่จากระบบ"),
  code: z.string().optional(),
  description: z.string().min(1, "กรุณากรอกรายการ"),
  quantity: z.coerce.number().min(0.01, "จำนวนต้องมากกว่า 0"),
  unitPrice: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
  total: z.coerce.number(),
});

const purchaseFormSchema = z.object({
  vendorId: z.string().min(1, "กรุณาเลือกล้านค้า"),
  docDate: z.string().min(1, "กรุณาเลือกวันที่"),
  invoiceNo: z.string().min(1, "กรุณากรอกเลขที่บิล"),
  items: z.array(lineItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
  subtotal: z.coerce.number(),
  discountAmount: z.coerce.number().optional(),
  net: z.coerce.number(),
  withTax: z.boolean().default(true),
  vatAmount: z.coerce.number(),
  grandTotal: z.coerce.number(),
  paymentMode: z.enum(["CASH", "CREDIT"]),
  dueDate: z.string().optional().nullable(),
  note: z.string().optional(),
  suggestedAccountId: z.string().optional(),
  suggestedPaymentMethod: z.enum(["CASH", "TRANSFER"]).optional(),
});

type PurchaseFormData = z.infer<typeof purchaseFormSchema>;

export function PurchaseDocForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editDocId = searchParams.get("editDocId");
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [vendorSearch, setVendorSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [isVendorPopoverOpen, setIsVendorPopoverOpen] = useState(false);
  const [activePartSearchIdx, setActivePartSearchIdx] = useState<number | null>(null);
  const [selectedVendorType, setSelectedVendorType] = useState<string>("SUPPLIER");
  
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [previewDocNo, setPreviewDocNo] = useState<string>("");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);

  const [creationId] = useState(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let autoId = '';
    for (let i = 0; i < 20; i++) {
      autoId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return autoId;
  });

  const docToEditRef = useMemo(() => (db && editDocId ? doc(db, "purchaseDocs", editDocId) : null), [db, editDocId]);
  const { data: docToEdit, isLoading: isLoadingDoc } = useDoc<PurchaseDoc>(docToEditRef);

  const form = useForm<PurchaseFormData>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      vendorId: "",
      docDate: "",
      invoiceNo: "",
      items: [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
      withTax: true,
      paymentMode: "CASH",
      subtotal: 0,
      discountAmount: 0,
      net: 0,
      vatAmount: 0,
      grandTotal: 0,
      note: "",
      suggestedAccountId: "",
      suggestedPaymentMethod: "CASH",
    },
  });

  useEffect(() => {
    if (!editDocId && !form.getValues("docDate")) {
      form.setValue("docDate", format(new Date(), "yyyy-MM-dd"));
    }
  }, [editDocId, form]);

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedDiscount = useWatch({ control: form.control, name: "discountAmount" });
  const watchedIsVat = useWatch({ control: form.control, name: "withTax" });
  const watchedPaymentMode = form.watch("paymentMode");
  const watchedDocDate = form.watch("docDate");

  useEffect(() => {
    if (!db || editDocId || !watchedDocDate) return;
    
    const fetchPreview = async () => {
      try {
        setIndexErrorUrl(null);
        const result = await getNextAvailablePurchaseDocNo(db, watchedDocDate);
        if (result.indexErrorUrl) {
          setIndexErrorUrl(result.indexErrorUrl);
        } else {
          setPreviewDocNo(result.docNo);
        }
      } catch (e: any) {
      }
    };
    fetchPreview();
  }, [db, editDocId, watchedDocDate]);

  useEffect(() => {
    if (!db) return;
    const unsubVendors = onSnapshot(query(collection(db, "vendors"), where("isActive", "==", true)), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor));
      data.sort((a, b) => (a.shortName || "").localeCompare(b.shortName || "", 'th'));
      setVendors(data);
      setIsLoadingData(false);
    });
    const unsubParts = onSnapshot(query(collection(db, "parts"), orderBy("name", "asc")), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
    });
    const unsubAccounts = onSnapshot(query(collection(db, "accountingAccounts"), where("isActive", "==", true)), (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
    });
    return () => { unsubVendors(); unsubParts(); unsubAccounts(); };
  }, [db]);

  useEffect(() => {
    if (docToEdit) {
      form.reset({
        vendorId: docToEdit.vendorId || "",
        docDate: docToEdit.docDate || format(new Date(), "yyyy-MM-dd"),
        invoiceNo: docToEdit.invoiceNo || "",
        items: docToEdit.items?.map(i => ({ ...i })) || [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
        subtotal: docToEdit.subtotal || 0,
        discountAmount: docToEdit.discountAmount || 0,
        net: docToEdit.net || 0,
        withTax: docToEdit.withTax ?? true,
        vatAmount: docToEdit.vatAmount || 0,
        grandTotal: docToEdit.grandTotal || 0,
        paymentMode: docToEdit.paymentMode || "CASH",
        dueDate: docToEdit.dueDate || null,
        note: docToEdit.note || "",
        suggestedAccountId: docToEdit.suggestedAccountId || '',
        suggestedPaymentMethod: docToEdit.suggestedPaymentMethod || 'CASH',
      });
      
      if (vendors.length > 0) {
        const vendor = vendors.find(v => v.id === docToEdit.vendorId);
        if (vendor) {
          setSelectedVendorType(vendor.vendorType);
        }
      }
    }
  }, [docToEdit, form, vendors]);

  useEffect(() => {
    const subtotal = watchedItems.reduce((sum, item) => sum + (item.total || 0), 0);
    const discount = watchedDiscount || 0;
    const net = subtotal - discount;
    const vatAmount = watchedIsVat ? net * 0.07 : 0;
    const grandTotal = net + vatAmount;

    form.setValue("subtotal", subtotal);
    form.setValue("net", net);
    form.setValue("vatAmount", vatAmount);
    form.setValue("grandTotal", grandTotal);
  }, [watchedItems, watchedDiscount, watchedIsVat, form]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setIsCompressing(true);
      try {
        const processedFiles: File[] = [];
        for (const file of files) {
          const processed = await compressImageIfNeeded(file);
          processedFiles.push(processed);
        }
        setPhotos(prev => [...prev, ...processedFiles]);
        const newPreviews = processedFiles.map(file => URL.createObjectURL(file));
        setPhotoPreviews(prev => [...prev, ...newPreviews]);
      } catch (err) {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาดในการจัดการรูปภาพ" });
      } finally {
        setIsCompressing(false);
        e.target.value = '';
      }
    }
  };

  const handleVendorTypeChange = (value: string) => {
    setSelectedVendorType(value);
    const currentVendorId = form.getValues("vendorId");
    const currentVendor = vendors.find(v => v.id === currentVendorId);
    
    if (currentVendor && currentVendor.vendorType !== value) {
      form.setValue("vendorId", "");
    }
    setVendorSearch("");
  };

  const handleSelectPart = (index: number, part: Part) => {
    form.setValue(`items.${index}.partId`, part.id);
    form.setValue(`items.${index}.code`, part.code);
    form.setValue(`items.${index}.description`, part.name);
    form.setValue(`items.${index}.unitPrice`, part.costPrice || 0);
    setActivePartSearchIdx(null);
    setPartSearch("");
  };

  const onSubmit = async (data: PurchaseFormData, isSubmitForReview: boolean) => {
    if (!db || !profile || !storage) return;
    if (isSubmitting) return;
    
    const vendor = vendors.find(v => v.id === data.vendorId);
    if (!vendor) return;

    setIsSubmitting(true);
    try {
      const uploadedPhotos: string[] = docToEdit?.billPhotos || [];
      if (photos.length > 0) {
        for (const file of photos) {
          const photoRef = ref(storage, `purchases/${Date.now()}-${file.name}`);
          await uploadBytes(photoRef, file);
          const url = await getDownloadURL(photoRef);
          uploadedPhotos.push(url);
        }
      }

      const targetStatus = isSubmitForReview ? 'PENDING_REVIEW' : 'DRAFT';

      await runTransaction(db, async (transaction) => {
        const docSettingsRef = doc(db, 'settings', 'documents');
        const docSettingsSnap = await transaction.get(docSettingsRef);
        
        const finalDocId = editDocId || creationId;
        const newDocRef = doc(db, "purchaseDocs", finalDocId);
        
        let alreadyReceived = false;
        let existingDocNo = "";
        if (editDocId) {
            const existingDoc = await transaction.get(newDocRef);
            if (existingDoc.exists()) {
                alreadyReceived = !!existingDoc.data()?.isReceived;
                existingDocNo = existingDoc.data()?.docNo || "";
            }
        }

        const partsToUpdate = [];
        if (isSubmitForReview && !alreadyReceived) {
            for (const item of data.items) {
                if (!item.partId) continue;
                const partRef = doc(db, 'parts', item.partId);
                const partSnap = await transaction.get(partRef);
                partsToUpdate.push({ partRef, partSnap, item });
            }
        }

        for (const { partRef, partSnap, item } of partsToUpdate) {
            if (partSnap.exists()) {
                const partData = partSnap.data() as Part;
                const currentQty = partData.stockQty || 0;
                const currentAvgCost = partData.costPrice || 0;
                const receivedQty = item.quantity || 0;
                const purchasePrice = item.unitPrice || 0;

                const newTotalQty = currentQty + receivedQty;
                let newAvgCost = currentAvgCost;

                if (newTotalQty > 0) {
                    newAvgCost = ((currentQty * currentAvgCost) + (receivedQty * purchasePrice)) / newTotalQty;
                } else if (receivedQty > 0) {
                    newAvgCost = purchasePrice;
                }

                transaction.update(partRef, {
                    stockQty: newTotalQty,
                    costPrice: Math.round(newAvgCost * 100) / 100,
                    updatedAt: serverTimestamp()
                });
            }
        }

        const finalDocNo = editDocId ? existingDocNo : previewDocNo;
        const docData = {
          ...data,
          id: finalDocId,
          docNo: finalDocNo,
          vendorSnapshot: { 
            shortName: vendor.shortName, 
            companyName: vendor.companyName, 
            taxId: vendor.taxId || "", 
            address: vendor.address || "" 
          },
          billPhotos: uploadedPhotos,
          status: targetStatus,
          updatedAt: serverTimestamp(),
          isReceived: alreadyReceived || isSubmitForReview,
          ...(isSubmitForReview && { submittedAt: serverTimestamp() }),
          ...(!editDocId && { createdAt: serverTimestamp() })
        };

        transaction.set(newDocRef, sanitizeForFirestore(docData), { merge: true });

        if (isSubmitForReview) {
            const claimId = `CLAIM_${finalDocId}`;
            const claimRef = doc(db, "purchaseClaims", claimId);
            transaction.set(claimRef, sanitizeForFirestore({
                id: claimId,
                status: 'PENDING',
                purchaseDocId: finalDocId,
                purchaseDocNo: finalDocNo,
                vendorNameSnapshot: vendor.companyName,
                invoiceNo: data.invoiceNo,
                paymentMode: data.paymentMode,
                amountTotal: data.grandTotal,
                suggestedAccountId: data.suggestedAccountId || null,
                suggestedPaymentMethod: data.suggestedPaymentMethod || null,
                note: data.note || "",
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                createdByUid: profile.uid,
                createdByName: profile.displayName,
            }));
        }
        
        if (!editDocId) {
            const dateObj = new Date(data.docDate);
            const year = dateObj.getFullYear() > 2400 ? dateObj.getFullYear() - 543 : dateObj.getFullYear();
            const counterRef = doc(db, 'documentCounters', String(year));
            const prefix = (docSettingsSnap.exists() ? (docSettingsSnap.data() as any).purchasePrefix : 'PUR') || 'PUR';
            
            const seqParts = finalDocNo.split('-');
            const seq = parseInt(seqParts[seqParts.length - 1], 10);
            
            transaction.set(counterRef, { 
                [`PURCHASE_${prefix.toUpperCase()}_count`]: seq
            }, { merge: true });
        }
      });

      toast({ title: isSubmitForReview ? "รับอะไหล่และส่งตรวจสอบสำเร็จ" : "บันทึกฉบับร่างสำเร็จ" });
      router.push("/app/office/parts/purchases");
    } catch (e: any) {
      console.error("Save Purchase Doc Error:", e);
      toast({ variant: "destructive", title: "ผิดพลาด", description: e.message });
      setIsSubmitting(false);
    }
  };

  const filteredVendors = vendors.filter(v => 
    v.vendorType === selectedVendorType &&
    (v.companyName.toLowerCase().includes(vendorSearch.toLowerCase()) || v.shortName.toLowerCase().includes(vendorSearch.toLowerCase()))
  );

  const filteredParts = parts.filter(p => 
    p.name.toLowerCase().includes(partSearch.toLowerCase()) || 
    p.code.toLowerCase().includes(partSearch.toLowerCase())
  );

  if (isLoadingData || (editDocId && isLoadingDoc)) return <Skeleton className="h-96" />;

  return (
    <div className="flex flex-col gap-6">
      {indexErrorUrl && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้างดัชนี (Index) ก่อน</AlertTitle>
          <Button asChild variant="outline" size="sm" className="mt-2 bg-white text-destructive">
            <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4"/>สร้าง Index</a>
          </Button>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
                  <ArrowLeft className="mr-2 h-4 w-4"/> กลับ
              </Button>
              <div className="flex gap-2 w-full sm:w-auto">
                  <Button 
                      type="button" 
                      variant="secondary" 
                      className="flex-1 sm:flex-none"
                      disabled={isSubmitting || isCompressing} 
                      onClick={form.handleSubmit(data => onSubmit(data, false))}
                  >
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                      บันทึกฉบับร่าง
                  </Button>
                  <Button 
                      type="button" 
                      className="flex-1 sm:flex-none"
                      disabled={isSubmitting || isCompressing} 
                      onClick={form.handleSubmit(data => onSubmit(data, true))}
                  >
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4"/>}
                      บันทึกรับของและส่งตรวจสอบ
                  </Button>
              </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
              <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base">1. ข้อมูลผู้ขาย</CardTitle>
                      <Badge variant="outline" className="font-mono">{editDocId ? docToEdit?.docNo : (previewDocNo || "Loading...")}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormItem>
                          <FormLabel>ชนิดร้านค้า</FormLabel>
                          <Select value={selectedVendorType} onValueChange={handleVendorTypeChange} disabled={isSubmitting}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกชนิดร้านค้า" /></SelectTrigger></FormControl>
                            <SelectContent>{VENDOR_TYPES.map(type => (<SelectItem key={type} value={type}>{vendorTypeLabel(type)}</SelectItem>))}</SelectContent>
                          </Select>
                        </FormItem>

                        <FormField name="vendorId" control={form.control} render={({ field }) => (
                            <FormItem>
                                <FormLabel>รายชื่อร้านค้า</FormLabel>
                                <Popover open={isVendorPopoverOpen} onOpenChange={setIsVendorPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                          <Button variant="outline" className="w-full justify-between" disabled={isSubmitting}>
                                            <span className="truncate">{field.value ? vendors.find(v=>v.id===field.value)?.companyName : "เลือกล้านค้า..."}</span>
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50"/>
                                          </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                        <div className="p-2"><Input placeholder="ค้นหาชื่อร้าน..." value={vendorSearch} onChange={e=>setVendorSearch(e.target.value)} /></div>
                                        <ScrollArea className="h-60">
                                            {filteredVendors.map(v => (
                                              <Button key={v.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b rounded-none text-left" onClick={()=>{field.onChange(v.id); setIsVendorPopoverOpen(false);}}>
                                                <div className="flex flex-col"><p className="font-semibold">{v.shortName}</p><p className="text-xs text-muted-foreground">{v.companyName}</p></div>
                                              </Button>
                                            ))}
                                        </ScrollArea>
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )} />
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField name="invoiceNo" render={({ field }) => (<FormItem><FormLabel>เลขที่บิล</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={isSubmitting} /></FormControl><FormMessage/></FormItem>)} />
                        <FormField control={form.control} name="docDate" render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel>วันที่ในบิล</FormLabel>
                              <Popover>
                                <PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")} disabled={isSubmitting}>{field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")} initialFocus /></PopoverContent>
                              </Popover>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                  </CardContent>
              </Card>

              <Card>
                  <CardHeader><CardTitle className="text-base">2. เงื่อนไขการจ่ายเงิน</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                      <FormField name="paymentMode" render={({ field }) => (
                          <FormItem>
                            <FormLabel>รูปแบบ</FormLabel>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-4 pt-2" disabled={isSubmitting}>
                              <div className="flex items-center space-x-2"><RadioGroupItem value="CASH" id="p-cash"/><Label htmlFor="p-cash">เงินสด/โอน</Label></div>
                              <div className="flex items-center space-x-2"><RadioGroupItem value="CREDIT" id="p-credit"/><Label htmlFor="p-credit">เครดิต</Label></div>
                            </RadioGroup>
                          </FormItem>
                      )} />
                      {watchedPaymentMode === 'CREDIT' ? (
                          <FormField control={form.control} name="dueDate" render={({ field }) => (
                              <FormItem className="flex flex-col">
                                <FormLabel>วันครบกำหนด</FormLabel>
                                <Popover>
                                  <PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")} disabled={isSubmitting}>{field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")} initialFocus /></PopoverContent>
                                </Popover>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                      ) : (
                          <div className="grid grid-cols-2 gap-4">
                              <FormField name="suggestedPaymentMethod" render={({ field }) => (
                                <FormItem>
                                  <FormLabel>จ่ายโดย</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectItem value="CASH">เงินสด</SelectItem>
                                      <SelectItem value="TRANSFER">เงินโอน</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )} />
                              <FormField name="suggestedAccountId" render={({ field }) => (
                                <FormItem>
                                  <FormLabel>บัญชีที่จ่าย</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="เลือก..."/></SelectTrigger></FormControl>
                                    <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                  </Select>
                                </FormItem>
                              )} />
                          </div>
                      )}
                  </CardContent>
              </Card>
          </div>

          <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">3. รายการสินค้า/อะไหล่</CardTitle>
                <Button asChild variant="outline" size="sm" className="h-8 border-dashed border-primary text-primary hover:bg-primary/5">
                  <Link href="/app/office/parts/list">
                    <PackagePlus className="mr-2 h-4 w-4" /> สร้างอะไหล่ใหม่
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                  <Alert className="mb-4 bg-primary/5 border-primary/20">
                    <Info className="h-4 w-4 text-primary" />
                    <AlertTitle className="text-xs font-bold">ข้อมูลประกอบการสั่งซื้อ</AlertTitle>
                    <AlertDescription className="text-[10px]">
                      ต้องเลือกรายการจากคลังสินค้าเท่านั้น หากไม่มีกรุณากดปุ่ม <b>"สร้างอะไหล่ใหม่"</b> ด้านบนเพื่อเพิ่มข้อมูลก่อนค่ะ
                    </AlertDescription>
                  </Alert>

                  <div className="border rounded-md overflow-x-auto">
                      <Table>
                          <TableHeader><TableRow><TableHead>รายการ (ต้องเลือกจากระบบ)</TableHead><TableHead className="w-24">จำนวน</TableHead><TableHead className="w-32">ราคา/หน่วย</TableHead><TableHead className="w-32 text-right">รวม</TableHead><TableHead className="w-12"/></TableRow></TableHeader>
                          <TableBody>
                              {fields.map((field, index) => (
                                  <TableRow key={field.id}>
                                      <TableCell>
                                          <div className="flex gap-2">
                                              <Popover open={activePartSearchIdx === index} onOpenChange={(o)=>setActivePartSearchIdx(o ? index : null)}>
                                                  <PopoverTrigger asChild><Button variant="outline" size="icon" className="shrink-0" disabled={isSubmitting}><Search className="h-4 w-4"/></Button></PopoverTrigger>
                                                  <PopoverContent className="w-80 p-0" align="start">
                                                      <div className="p-2 border-b"><Input placeholder="ค้นหาอะไหล่..." value={partSearch} onChange={e=>setPartSearch(e.target.value)} /></div>
                                                      <ScrollArea className="h-64">
                                                          {filteredParts.length > 0 ? filteredParts.map(p => (
                                                              <Button key={p.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b text-left" onClick={() => handleSelectPart(index, p)}>
                                                                  <div className="flex flex-col"><p className="font-bold text-sm">{p.code}</p><p className="text-xs">{p.name}</p></div>
                                                              </Button>
                                                          )) : <div className="p-4 text-center text-xs text-muted-foreground italic">ไม่พบอะไหล่ที่ค้นหา</div>}
                                                      </ScrollArea>
                                                  </PopoverContent>
                                              </Popover>
                                              <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (
                                                <Input 
                                                  {...field} 
                                                  value={field.value ?? ''} 
                                                  disabled={isSubmitting} 
                                                  readOnly 
                                                  placeholder="คลิกแว่นขยายเพื่อเลือกอะไหล่..." 
                                                  className="bg-muted/50 cursor-not-allowed text-xs" 
                                                />
                                              )}/>
                                          </div>
                                          {form.watch(`items.${index}.code`) && <p className="text-[10px] text-primary font-bold mt-1 px-10">รหัสสต็อก: {form.watch(`items.${index}.code`)}</p>}
                                      </TableCell>
                                      <TableCell><FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (<Input type="number" step="any" className="text-right" {...field} value={field.value || ''} disabled={isSubmitting} onChange={e => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, v * form.getValues(`items.${index}.unitPrice`)); }} />)}/></TableCell>
                                      <TableCell><FormField control={form.control} name={`items.${index}.unitPrice`} render={({ field }) => (<Input type="number" step="any" className="text-right" {...field} value={field.value || ''} disabled={isSubmitting} onChange={e => { const v = parseFloat(e.target.value) || 0; field.onChange(v); form.setValue(`items.${index}.total`, v * form.getValues(`items.${index}.quantity`)); }} />)}/></TableCell>
                                      <TableCell className="text-right font-medium">{(form.watch(`items.${index}.total`) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                      <TableCell><Button type="button" variant="ghost" size="icon" disabled={isSubmitting} onClick={()=>remove(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell>
                                  </TableRow>
                              ))}
                          </TableBody>
                      </Table>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="mt-4" disabled={isSubmitting || fields.length >= 50} onClick={()=>append({description:'', quantity:1, unitPrice:0, total:0})}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มรายการ</Button>
              </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
              <Card>
                  <CardHeader><CardTitle className="text-base">4. แนบรูปบิล</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                      <div className="flex items-center gap-4">
                          <Input type="file" multiple accept="image/*" disabled={isSubmitting || isCompressing} onChange={handlePhotoChange} className="max-w-[300px]" />
                          {isCompressing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {docToEdit?.billPhotos?.map((url, i) => (
                              <div key={`existing-${i}`} className="relative aspect-square w-20 border rounded-md overflow-hidden bg-muted"><Image src={url} alt="existing" fill className="object-cover" /><Badge className="absolute bottom-0 right-0 rounded-none text-[8px] h-3 px-1">Cloud</Badge></div>
                          ))}
                          {photoPreviews.map((p, i) => (
                              <div key={`new-${i}`} className="relative aspect-square w-20 border rounded-md overflow-hidden bg-muted"><Image src={p} alt="preview" fill className="object-cover" /><Button type="button" variant="destructive" size="icon" className="absolute top-0 right-0 h-5 w-5 rounded-none" onClick={() => { setPhotos(prev => prev.filter((_, idx) => idx !== i)); setPhotoPreviews(prev => prev.filter((_, idx) => idx !== i)); }}><X className="h-3 w-3"/></Button></div>
                          ))}
                      </div>
                      <FormField name="note" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={isSubmitting} /></FormControl></FormItem>)} />
                  </CardContent>
              </Card>
              <div className="space-y-4 p-6 border rounded-lg bg-muted/30 h-fit">
                  <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">รวมเป็นเงิน</span><span className="font-medium">{(form.watch('subtotal') || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">ส่วนลด (บาท)</span><FormField name="discountAmount" render={({ field }) => (<Input type="number" step="any" className="w-32 text-right bg-background h-8" {...field} value={field.value || ''} disabled={isSubmitting}/>)} /></div>
                  <div className="flex justify-between items-center py-2"><FormField name="withTax" render={({ field }) => (
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isSubmitting}/>
                      <Label className="text-sm font-normal cursor-pointer">ภาษีมูลค่าเพิ่ม 7%</Label>
                    </div>
                  )} /><span className="text-sm">{(form.watch('vatAmount') || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  <Separator className="my-2"/>
                  <div className="flex justify-between items-center text-xl font-bold text-primary"><span>ยอดรวมสุทธิ</span><span>{(form.watch('grandTotal') || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
              </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
