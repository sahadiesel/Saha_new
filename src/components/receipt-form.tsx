"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  doc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
  writeBatch,
  deleteField,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ChevronsUpDown, AlertCircle, Info, Send, Trash2, XCircle, CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";

import { createDocument } from "@/firebase/documents";
import type { StoreSettings, Customer, Document as DocumentType, AccountingAccount } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const receiptFormSchema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  sourceDocIds: z.array(z.string()).min(1, "กรุณาเลือกบิลอย่างน้อย 1 รายการ"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  amount: z.coerce.number().min(0.01, "ยอดเงินต้องมากกว่า 0"),
  notes: z.string().optional(),
});

type ReceiptFormData = z.infer<typeof receiptFormSchema>;

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function ReceiptForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editDocId = searchParams.get("editDocId");
  const presetAmountParam = searchParams.get("presetAmount");
  const urlSourceDocIds = useMemo(() => {
    const multi = searchParams.get("sourceDocIds");
    if (multi)
      return multi
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const one = searchParams.get("sourceDocId");
    return one ? [one] : [];
  }, [searchParams]);
  const urlSourceKey = urlSourceDocIds.join("|");
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sourceDocs, setSourceDocs] = useState<DocumentType[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extraSourceDocs, setExtraSourceDocs] = useState<DocumentType[]>([]);
  /** เอกสารแรกจากลิงก์ (sourceDocId) — ใช้ซิงก์ customerId / แสดงชื่อเมื่อไม่มีใน collection customers */
  const [bootstrapSourceDoc, setBootstrapSourceDoc] = useState<DocumentType | null>(null);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const docToEditRef = useMemo(() => (db && editDocId ? doc(db, "documents", editDocId) : null), [db, editDocId]);
  const { data: docToEdit, isLoading: isLoadingDoc } = useDoc<DocumentType>(docToEditRef);

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      paymentDate: "", // Set in useEffect
      amount: 0,
      customerId: searchParams.get("customerId") || "",
      sourceDocIds: [],
      accountId: "",
      notes: "",
    },
  });

  // Safe client-side initialization for paymentDate
  useEffect(() => {
    if (!editDocId && !form.getValues("paymentDate")) {
      form.setValue("paymentDate", format(new Date(), "yyyy-MM-dd"));
    }
  }, [editDocId, form]);

  const selectedCustomerId = form.watch('customerId');
  const watchedSourceDocIds = form.watch('sourceDocIds');

  useEffect(() => {
    if (editDocId || urlSourceDocIds.length === 0) return;
    form.setValue("sourceDocIds", urlSourceDocIds);
  }, [editDocId, urlSourceKey, form]);

  useEffect(() => {
    if (!db || editDocId || urlSourceDocIds.length === 0) {
      setBootstrapSourceDoc(null);
      return;
    }
    let cancelled = false;
    setBootstrapSourceDoc(null);
    (async () => {
      const s = await getDoc(doc(db, "documents", urlSourceDocIds[0]));
      if (cancelled || !s.exists()) return;
      const d = { id: s.id, ...s.data() } as DocumentType;
      setBootstrapSourceDoc(d);
      const cid = d.customerId || d.customerSnapshot?.id;
      if (cid) form.setValue("customerId", cid);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, editDocId, urlSourceKey, form]);

  useEffect(() => {
    if (!db) return;
    const unsubCustomers = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      setIsLoading(false);
    });
    const unsubAccounts = onSnapshot(query(collection(db, "accountingAccounts"), where("isActive", "==", true)), (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
    });
    return () => { unsubCustomers(); unsubAccounts(); };
  }, [db]);

  useEffect(() => {
    if (docToEdit && !isSubmitting) {
      form.reset({
        customerId: docToEdit.customerId || docToEdit.customerSnapshot?.id || "",
        sourceDocIds: docToEdit.referencesDocIds || [],
        paymentDate: docToEdit.paymentDate || docToEdit.docDate || format(new Date(), "yyyy-MM-dd"),
        accountId: docToEdit.receivedAccountId || "",
        amount: docToEdit.grandTotal,
        notes: docToEdit.notes || "",
      });
    }
  }, [docToEdit, form, isSubmitting]);

  const displaySourceDocs = useMemo(() => {
    const m = new Map<string, DocumentType>();
    for (const d of sourceDocs) m.set(d.id, d);
    for (const d of extraSourceDocs) m.set(d.id, d);
    return Array.from(m.values());
  }, [sourceDocs, extraSourceDocs]);

  useEffect(() => {
    if (!db || !selectedCustomerId) {
      setSourceDocs([]);
      return;
    }
    const q = query(
      collection(db, "documents"),
      where("customerId", "==", selectedCustomerId),
      where("docType", "in", ["TAX_INVOICE", "BILLING_NOTE"]),
      where("status", "in", ["UNPAID", "PARTIAL", "APPROVED"])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentType));
      
      const filtered = allDocs.filter(doc => {
          if (doc.status === 'CANCELLED' || doc.status === 'PAID') return false;
          if (doc.receiptStatus === 'CONFIRMED') return false;
          if (doc.receiptDocId && doc.receiptDocId !== editDocId) return false;
          
          if (doc.docType === 'TAX_INVOICE' && doc.billingRequired && !doc.billingNoteId) {
              return false;
          }
          return true;
      });

      setSourceDocs(filtered);
    });
    return unsubscribe;
  }, [db, selectedCustomerId, editDocId]);

  useEffect(() => {
    if (!db || !selectedCustomerId) {
      setExtraSourceDocs([]);
      return;
    }
    const missing = watchedSourceDocIds.filter((id) => !sourceDocs.some((d) => d.id === id));
    if (missing.length === 0) {
      setExtraSourceDocs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        missing.map((id) =>
          getDoc(doc(db, "documents", id)).then((s) =>
            s.exists() ? ({ id: s.id, ...s.data() } as DocumentType) : null
          )
        )
      );
      if (!cancelled) setExtraSourceDocs(rows.filter(Boolean) as DocumentType[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selectedCustomerId, watchedSourceDocIds, sourceDocs]);
  
  useEffect(() => {
    const selected = displaySourceDocs.filter(d => watchedSourceDocIds.includes(d.id));
    const total = selected.reduce((sum, d) => sum + (d.paymentSummary?.balance ?? d.grandTotal), 0);
    const rounded = Math.round(total * 100) / 100;
    if (presetAmountParam && selected.length === 1) {
      const p = parseFloat(presetAmountParam);
      if (Number.isFinite(p)) {
        form.setValue("amount", Math.round(p * 100) / 100);
        if (selected.length > 0 && selected[0].suggestedAccountId && !form.getValues('accountId') && !editDocId) {
          form.setValue('accountId', selected[0].suggestedAccountId);
        }
        return;
      }
    }
    form.setValue('amount', rounded);
    
    if (selected.length > 0 && selected[0].suggestedAccountId && !form.getValues('accountId') && !editDocId) {
        form.setValue('accountId', selected[0].suggestedAccountId);
    }
  }, [watchedSourceDocIds, displaySourceDocs, form, editDocId, presetAmountParam]);

  const customerDisplayName = useMemo(() => {
    if (!selectedCustomerId) return "";
    const fromList = customers.find((c) => c.id === selectedCustomerId)?.name;
    if (fromList) return fromList;
    const snap = displaySourceDocs.find(
      (d) => (d.customerId || d.customerSnapshot?.id) === selectedCustomerId
    )?.customerSnapshot;
    if (snap?.name || snap?.taxName) return snap.name || snap.taxName || "";
    if (bootstrapSourceDoc) {
      const bid = bootstrapSourceDoc.customerId || bootstrapSourceDoc.customerSnapshot?.id;
      if (bid === selectedCustomerId) {
        return (
          bootstrapSourceDoc.customerSnapshot?.name ||
          bootstrapSourceDoc.customerSnapshot?.taxName ||
          ""
        );
      }
    }
    return "";
  }, [selectedCustomerId, customers, displaySourceDocs, bootstrapSourceDoc]);

  const bootstrappingCustomer = !editDocId && urlSourceDocIds.length > 0 && !bootstrapSourceDoc;

  const buildCustomerFromSnapshot = (id: string, snap: DocumentType["customerSnapshot"]): Customer => ({
    id,
    name: snap?.name || snap?.taxName || "ลูกค้า",
    phone: (snap?.phone as string) || "",
    detail: "",
    useTax: !!(snap?.taxId || snap?.taxName),
    taxName: snap?.taxName,
    taxAddress: snap?.taxAddress,
    taxId: snap?.taxId,
    taxPhone: snap?.taxPhone,
    taxBranchType: snap?.taxBranchType,
    taxBranchNo: snap?.taxBranchNo,
    taxProfileId: snap?.taxProfileId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  const handleToggleDoc = (docId: string) => {
    const currentIds = form.getValues('sourceDocIds');
    if (currentIds.includes(docId)) {
      form.setValue('sourceDocIds', currentIds.filter((id) => id !== docId), { shouldValidate: true });
    } else {
      form.setValue('sourceDocIds', [...currentIds, docId], { shouldValidate: true });
    }
  };

  const handleProcessSubmission = async (data: ReceiptFormData) => {
    if (isSubmitting) return;
    
    const selectedDocs = displaySourceDocs.filter(d => data.sourceDocIds.includes(d.id));
    const account = accounts.find(a => a.id === data.accountId);

    const canonicalCustomerId =
      selectedDocs[0]?.customerId || selectedDocs[0]?.customerSnapshot?.id || data.customerId;

    let customer: Customer | undefined = customers.find((c) => c.id === canonicalCustomerId);
    if (!customer && selectedDocs.length > 0) {
      const snap = selectedDocs[0].customerSnapshot;
      if (snap && (snap.name || snap.taxName)) {
        customer = buildCustomerFromSnapshot(canonicalCustomerId, snap);
      }
    }

    if (!db || !customer || !storeSettings || !profile || selectedDocs.length === 0 || !account) {
      toast({
        variant: "destructive",
        title: "ข้อมูลไม่ครบถ้วน",
        description: "กรุณาเลือกบัญชีและบิลอย่างน้อย 1 ใบ — ถ้าไม่มีชื่อลูกค้า ให้ตรวจว่าใบกำกับมีข้อมูลลูกค้าครบ",
      });
      return;
    }
    
    setIsSubmitting(true);
    const amount2dec = Math.round(data.amount * 100) / 100;
    const payInstrument = account.type === "CASH" ? "CASH" : "TRANSFER";
    const payMethodLegacy = payInstrument === "CASH" ? "CASH" : "TRANSFER";

    const items = selectedDocs.map(doc => ({
      description: `ชำระค่าสินค้า/บริการ ตาม${doc.docType === "TAX_INVOICE" ? "ใบกำกับภาษี" : "ใบวางบิล"} เลขที่ ${doc.docNo}`,
      quantity: 1,
      unitPrice: doc.paymentSummary?.balance ?? doc.grandTotal,
      total: doc.paymentSummary?.balance ?? doc.grandTotal
    }));

    try {
      const docData = {
        docDate: data.paymentDate,
        customerId: canonicalCustomerId,
        customerSnapshot: { ...customer, id: canonicalCustomerId },
        storeSnapshot: { ...storeSettings },
        items,
        subtotal: amount2dec,
        discountAmount: 0,
        net: amount2dec,
        withTax: selectedDocs.some(d => d.withTax),
        vatAmount: selectedDocs.some(d => d.withTax) ? Math.round(((amount2dec / 1.07) * 0.07) * 100) / 100 : 0,
        grandTotal: amount2dec,
        notes: data.notes,
        referencesDocIds: data.sourceDocIds,
        paymentMethod: payMethodLegacy,
        paymentInstrument: payInstrument,
        paymentDate: data.paymentDate,
        receivedAccountId: data.accountId,
      };

      let finalDocId: string;
      let finalDocNo: string;

      if (editDocId) {
          await updateDoc(
            doc(db, "documents", editDocId),
            sanitizeForFirestore({
              ...docData,
              checkDueDate: deleteField(),
              status: "ISSUED",
              receiptStatus: "ISSUED_NOT_CONFIRMED",
              updatedAt: serverTimestamp(),
            })
          );
          finalDocId = editDocId;
          finalDocNo = docToEdit?.docNo || "";
      } else {
          // Direct to ISSUED status for accountants
          const result = await createDocument(db, 'RECEIPT', docData, profile, undefined, { initialStatus: 'ISSUED' });
          finalDocId = result.docId;
          finalDocNo = result.docNo;
          
          await updateDoc(doc(db, 'documents', finalDocId), {
              receiptStatus: 'ISSUED_NOT_CONFIRMED',
              updatedAt: serverTimestamp()
          });
      }

      const batch = writeBatch(db);
      
      if (editDocId && docToEdit?.referencesDocIds) {
          const removedDocIds = docToEdit.referencesDocIds.filter(id => !data.sourceDocIds.includes(id));
          removedDocIds.forEach(id => {
              batch.update(doc(db, 'documents', id), {
                  receiptStatus: deleteField(),
                  receiptDocId: deleteField(),
                  receiptDocNo: deleteField(),
                  updatedAt: serverTimestamp()
              });
          });
      }

      selectedDocs.forEach(sourceDoc => {
          batch.update(doc(db, 'documents', sourceDoc.id), {
              receiptStatus: 'ISSUED_NOT_CONFIRMED',
              receiptDocId: finalDocId,
              receiptDocNo: finalDocNo,
              updatedAt: serverTimestamp()
          });
      });
      await batch.commit();

      toast({
        title: "ออกใบเสร็จรับเงินสำเร็จ",
        description: `เลขที่ ${finalDocNo} — ไปขั้นตอนยืนยันรับเงินเข้าบัญชี (บันทึกรายรับ / ปิดลูกหนี้ / ปิดงาน)`,
      });
      setIsSubmitting(false);
      router.push(`/app/management/accounting/documents/receipt/${finalDocId}/confirm`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: error.message });
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch));
  }, [customers, customerSearch]);

  const isFormLoading = isLoading || (editDocId && isLoadingDoc);

  if (isFormLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-primary">
                <Info className="h-5 w-5" /> 
                {editDocId ? `แก้ไขใบเสร็จ ${docToEdit?.docNo}` : "เลือกบิลที่ต้องการรวมใบเสร็จ"}
            </h2>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                    className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 font-bold"
                    disabled={isSubmitting || watchedSourceDocIds.length === 0}
                    onClick={form.handleSubmit(d => handleProcessSubmission(d))}
                >
                    {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    บันทึกและออกใบเสร็จ
                </Button>
            </div>
        </div>
        
        <Card>
            <CardHeader><CardTitle className="text-base">1. ข้อมูลลูกค้าและบิลที่ต้องการรวม</CardTitle></CardHeader>
            <CardContent className="space-y-6">
            <FormField name="customerId" render={({ field }) => (
                <FormItem>
                    <FormLabel>ชื่อลูกค้า</FormLabel>
                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                        <FormControl>
                        <Button variant="outline" role="combobox" className="w-full md:w-[400px] justify-between font-normal" disabled={!!editDocId || isSubmitting}>
                            <span className="truncate text-left">
                              {!field.value
                                ? "ค้นหาชื่อลูกค้า..."
                                : bootstrappingCustomer
                                  ? "กำลังโหลดชื่อจากบิลอ้างอิง..."
                                  : customerDisplayName || "ลูกค้า (จากใบกำกับภาษี)"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                        </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                        <div className="p-2 border-b">
                            <Input placeholder="พิมพ์ชื่อลูกค้า..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                        </div>
                        <ScrollArea className="h-60">
                        {filteredCustomers.length > 0 ? (
                            filteredCustomers.map(c => (
                                <Button variant="ghost" key={c.id} onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); form.setValue('sourceDocIds', []); }} className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 px-3 text-left">
                                    <div className="flex flex-col">
                                        <span>{c.name}</span>
                                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                                    </div>
                                </Button>
                            ))
                        ) : <div className="p-4 text-center text-sm text-muted-foreground">ไม่พบรายชื่อลูกค้า</div>}
                        </ScrollArea>
                    </PopoverContent>
                    </Popover>
                    <FormMessage />
                </FormItem>
            )} />

            {selectedCustomerId && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                    <FormLabel>เลือกเอกสารที่ต้องการออกใบเสร็จ (ใบกำกับภาษี / ใบวางบิล — ไม่รวมใบส่งของ)</FormLabel>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12 text-center">เลือก</TableHead>
                                    <TableHead>เลขที่เอกสาร</TableHead>
                                    <TableHead>วันที่</TableHead>
                                    <TableHead className="text-right">ยอดคงค้าง</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {displaySourceDocs.length > 0 ? displaySourceDocs.map(doc => (
                                    <TableRow key={doc.id} className={cn("hover:bg-muted/30 cursor-pointer", watchedSourceDocIds.includes(doc.id) && "bg-primary/5")} onClick={() => !isSubmitting && handleToggleDoc(doc.id)}>
                                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                            <Checkbox 
                                                checked={watchedSourceDocIds.includes(doc.id)} 
                                                onCheckedChange={() => !isSubmitting && handleToggleDoc(doc.id)} 
                                                disabled={isSubmitting}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs">{doc.docNo}</span>
                                                <Badge variant="outline" className="text-[8px] h-4 px-1">{doc.docType === 'BILLING_NOTE' ? 'วางบิล' : 'กำกับภาษี'}</Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs">{safeFormat(new Date(doc.docDate), "dd/MM/yy")}</TableCell>
                                        <TableCell className="text-right font-bold text-primary">
                                            {formatCurrency(doc.paymentSummary?.balance ?? doc.grandTotal)}
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-sm text-muted-foreground text-center italic">
                                            ไม่พบเอกสารค้างชำระที่สามารถออกใบเสร็จได้
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
            </CardContent>
        </Card>

        {watchedSourceDocIds.length > 0 && (
        <Card className="animate-in zoom-in-95">
            <CardHeader><CardTitle className="text-base">2. รายละเอียดใบเสร็จ (บันทึกบัญชีจริงเมื่อรับเงินที่หน้าลูกหนี้)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>วันที่ออกใบเสร็จ</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal h-10",
                                !field.value && "text-muted-foreground"
                              )}
                              disabled={isSubmitting}
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
                <FormField name="amount" render={({ field }) => (
                    <FormItem>
                        <FormLabel>ยอดเงินรวมตามใบเสร็จ (บาท)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} className="font-black text-xl text-primary" readOnly /></FormControl>
                        <FormDescription className="text-right text-[10px]">รวมยอดจากบิล {watchedSourceDocIds.length} รายการ</FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField name="accountId" render={({ field }) => (
                    <FormItem>
                        <FormLabel>เข้าบัญชี (คาดการณ์)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่จะนำเงินเข้า..." /></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'ธนาคาร'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>บันทึกเพิ่มเติม</FormLabel><FormControl><Textarea {...field} placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)..." disabled={isSubmitting} /></FormControl></FormItem>)} />
            </CardContent>
        </Card>
        )}
      </form>
    </Form>
  );
}
