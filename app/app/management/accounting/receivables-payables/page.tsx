"use client";

import { useMemo, Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
  serverTimestamp,
  getDoc,
  getDocs,
  deleteField,
  type FirestoreError,
  type Firestore,
  type QueryDocumentSnapshot,
  type DocumentData,
  addDoc,
  limit,
  orderBy,
  startAfter,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format as dfFormat, parseISO } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search, AlertCircle, ExternalLink, PlusCircle, ChevronsUpDown, MoreHorizontal, Info, FileStack, CalendarDays, Filter, Calculator } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { Calendar } from "@/components/ui/calendar";

import type {
  AccountingObligation,
  AccountingAccount,
  UserProfile,
  Vendor,
  Document as DocumentType,
} from "@/lib/types";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { ReceiveArPaymentDialog } from "@/components/accounting/receive-ar-payment-dialog";
import {
  arInvoiceDedupeKey,
  dedupeArBySalesDocNo,
  isArDedupeDocType,
} from "@/lib/accounting-ar-dedupe";
import {
  resolveArOutstandingBalance,
  resolveArPaidAmount,
  splitObligationPaidOutstanding,
} from "@/lib/accounting-ar-outstanding";
import { PayCreditorDialog } from "@/components/accounting/pay-creditor-dialog";

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const roundMoney2 = (n: number) => Math.round(n * 100) / 100;

type ReceivablesPayablesSummary = {
  paid: { net: number; vat: number; grand: number; lineCount: number };
  outstanding: { net: number; vat: number; grand: number; count: number };
};

type PaymentStatusFilter = "ALL" | "PAID" | "OUTSTANDING";

const PAYMENT_FILTER_LABELS: Record<PaymentStatusFilter, string> = {
  ALL: "ทั้งหมด",
  PAID: "ชำระแล้ว",
  OUTSTANDING: "ค้างชำระ",
};

/** ดึงใบกำกับ APPROVED ทั้งชุดที่เกี่ยวกับการซ่อมลูกหนี้ — แบ่งหน้า + orderBy ไม่ให้พลาดใบที่ไม่อยู่ใน limit แรก */
async function getApprovedTaxInvoiceSnapshotsPaged(db: Firestore): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const pageSize = 200;
  const maxPages = 50;
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;
  for (let p = 0; p < maxPages; p++) {
    const q = last
      ? query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          startAfter(last),
          limit(pageSize)
        )
      : query(
          collection(db, "documents"),
          where("status", "==", "APPROVED"),
          where("docType", "==", "TAX_INVOICE"),
          orderBy("updatedAt", "desc"),
          limit(pageSize)
        );
    const snap = await getDocs(q);
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  return out;
}

const addCreditorSchema = z.object({
  vendorId: z.string().min(1, "กรุณาเลือก Vendor"),
  invoiceNo: z.string().min(1, "กรุณากรอกเลขที่บิล"),
  docDate: z.string().min(1, "กรุณาเลือกวันที่เอกสาร"),
  dueDate: z.string().optional(),
  expectedPaymentAccountId: z.string().optional(),
  amountTotal: z.coerce.number().positive("ยอดเงินต้องมากกว่า 0"),
  notes: z.string().optional(),
});

const editApTermsSchema = z.object({
  dueDate: z.string().optional(),
  expectedPaymentAccountId: z.string().optional(),
});

function EditApTermsDialog({
  obligation,
  accounts,
  isOpen,
  onClose,
}: {
  obligation: WithId<AccountingObligation> | null;
  accounts: WithId<AccountingAccount>[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const { db } = useFirebase();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const form = useForm<z.infer<typeof editApTermsSchema>>({
    resolver: zodResolver(editApTermsSchema),
    defaultValues: { dueDate: "", expectedPaymentAccountId: "" },
  });
  useEffect(() => {
    if (obligation && isOpen) {
      form.reset({
        dueDate: obligation.dueDate || "",
        expectedPaymentAccountId: obligation.expectedPaymentAccountId || "",
      });
    }
  }, [obligation, isOpen, form]);
  const handleSave = async (data: z.infer<typeof editApTermsSchema>) => {
    if (!db || !obligation) return;
    setSaving(true);
    try {
      const due = data.dueDate?.trim() || null;
      const expRaw = data.expectedPaymentAccountId?.trim();
      const expAcc = expRaw && expRaw !== "__none__" ? expRaw : null;
      const batch = writeBatch(db);
      batch.update(doc(db, "accountingObligations", obligation.id), {
        dueDate: due,
        expectedPaymentAccountId: expAcc,
        updatedAt: serverTimestamp(),
      });
      if (obligation.sourceDocType === "PURCHASE" && obligation.sourceDocId) {
        batch.update(doc(db, "purchaseDocs", obligation.sourceDocId), {
          dueDate: due,
          expectedPaymentAccountId: expAcc,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      toast({ title: "อัปเดตข้อมูลเจ้าหนี้แล้ว" });
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: msg });
    } finally {
      setSaving(false);
    }
  };
  if (!obligation) return null;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แก้ไขกำหนดจ่าย / บัญชีที่คาดจ่าย</DialogTitle>
          <DialogDescription>
            {obligation.invoiceNo || obligation.sourceDocNo} — {obligation.vendorShortNameSnapshot || obligation.vendorNameSnapshot}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="edit-ap-terms" onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>วันครบกำหนดจ่าย (ไม่บังคับ)</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}
                        >
                          {field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>ไม่ระบุ</span>}
                          <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value ? parseISO(field.value) : undefined}
                        onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")}
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
              name="expectedPaymentAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>บัญชีที่คาดว่าจะจ่าย</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)} value={field.value && field.value !== "__none__" ? field.value : "__none__"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="ไม่ระบุ" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">ไม่ระบุ</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button type="submit" form="edit-ap-terms" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCreditorDialog({
  vendors,
  accounts,
  isOpen,
  onClose,
}: {
  vendors: WithId<Vendor>[];
  accounts: WithId<AccountingAccount>[];
  isOpen: boolean;
  onClose: () => void;
}) {
    const { db } = useFirebase();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [vendorSearch, setVendorSearch] = useState("");
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const form = useForm<z.infer<typeof addCreditorSchema>>({ resolver: zodResolver(addCreditorSchema), defaultValues: { docDate: "", amountTotal: 0 } });
    useEffect(() => { if (isOpen) { form.reset({ docDate: dfFormat(new Date(), "yyyy-MM-dd"), amountTotal: 0 }); } }, [isOpen, form]);
    const filteredVendors = useMemo(() => { if (!vendorSearch) return vendors; return vendors.filter(v => v.shortName.toLowerCase().includes(vendorSearch.toLowerCase()) || v.companyName.toLowerCase().includes(vendorSearch.toLowerCase())); }, [vendors, vendorSearch]);
    const handleSave = async (data: z.infer<typeof addCreditorSchema>) => {
        if (!db) return;
        setIsSubmitting(true);
        const selectedVendor = vendors.find(v => v.id === data.vendorId);
        if (!selectedVendor) { toast({ variant: 'destructive', title: 'ไม่พบ Vendor' }); setIsSubmitting(false); return; }
        try {
            const expAcc = data.expectedPaymentAccountId?.trim();
            const expectedPaymentAccountId = expAcc && expAcc !== "__none__" ? expAcc : null;
            await addDoc(collection(db, 'accountingObligations'), { type: 'AP', status: 'UNPAID', vendorId: selectedVendor.id, vendorShortNameSnapshot: selectedVendor.shortName, vendorNameSnapshot: selectedVendor.companyName, invoiceNo: data.invoiceNo, sourceDocNo: data.invoiceNo, sourceDocType: 'PURCHASE_ORDER', docDate: data.docDate, dueDate: data.dueDate || null, expectedPaymentAccountId, amountTotal: data.amountTotal, amountPaid: 0, balance: data.amountTotal, notes: data.notes || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            toast({ title: 'บันทึกเจ้าหนี้สำเร็จ' }); onClose(); form.reset();
        } catch (e: any) { toast({ variant: 'destructive', title: "เกิดข้อผิดพลาด", description: e.message }); } finally { setIsSubmitting(false); }
    };
    return (<Dialog open={isOpen} onOpenChange={onClose}><DialogContent className="max-h-[90vh] flex flex-col p-0 overflow-hidden"><DialogHeader className="p-6 pb-0"><DialogTitle>เพิ่มเจ้าหนี้ใหม่</DialogTitle><DialogDescription>บันทึกบิลที่ได้รับจากร้านค้าภายนอก</DialogDescription></DialogHeader><div className="flex-1 overflow-y-auto px-6 py-4"><Form {...form}><form id="add-creditor-form" onSubmit={form.handleSubmit(handleSave)} className="space-y-4"><FormField name="vendorId" control={form.control} render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>Vendor</FormLabel><Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}><PopoverTrigger asChild><FormControl><Button variant="outline" role="combobox" className="justify-between">{field.value ? vendors.find(v => v.id === field.value)?.shortName : "เลือก Vendor..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start"><Command><CommandInput placeholder="ค้นหา..." value={vendorSearch} onValueChange={setVendorSearch}/><CommandList><CommandEmpty>ไม่พบ Vendor</CommandEmpty><CommandGroup>{filteredVendors.map((v) => (<CommandItem value={v.shortName} key={v.id} onSelect={() => { field.onChange(v.id); setIsPopoverOpen(false); }}>{v.shortName} - {v.companyName}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent></Popover><FormMessage/></FormItem>)}/><FormField name="invoiceNo" render={({ field }) => (<FormItem><FormLabel>เลขที่บิล (Invoice No.)</FormLabel><FormControl><Input {...field}/></FormControl><FormMessage/></FormItem>)}/><FormField name="amountTotal" render={({ field }) => (<FormItem><FormLabel>ยอดเงินรวม</FormLabel><FormControl><Input type="number" {...field}/></FormControl><FormMessage/></FormItem>)}/><div className="grid grid-cols-2 gap-4"><FormField control={form.control} name="docDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>วันที่บนบิล</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>{field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")} initialFocus/></PopoverContent></Popover><FormMessage/></FormItem>)}/><FormField control={form.control} name="dueDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>วันครบกำหนดจ่าย (ไม่บังคับ)</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal h-10", !field.value && "text-muted-foreground")}>{field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}<CalendarDays className="ml-auto h-4 w-4 opacity-50"/></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value ? parseISO(field.value) : undefined} onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")} initialFocus/></PopoverContent></Popover><FormMessage/></FormItem>)} /></div><FormField control={form.control} name="expectedPaymentAccountId" render={({ field }) => (<FormItem><FormLabel>บัญชีที่คาดว่าจะจ่าย (ไม่บังคับ)</FormLabel><Select onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)} value={field.value && field.value !== "__none__" ? field.value : "__none__"}><FormControl><SelectTrigger><SelectValue placeholder="ไม่ระบุ"/></SelectTrigger></FormControl><SelectContent><SelectItem value="__none__">ไม่ระบุ</SelectItem>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></FormItem>)}/><FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>)}/></form></Form></div><DialogFooter className="p-6 pt-4 border-t bg-muted/10"><Button variant="outline" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button><Button type="submit" form="add-creditor-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}บันทึก</Button></DialogFooter></DialogContent></Dialog>)
}

function ObligationList({ type, searchTerm, monthFilter, paymentFilter, accounts, vendors, onSummaryChange, isAdmin }: { type: 'AR' | 'AP', searchTerm: string, monthFilter?: string, paymentFilter: PaymentStatusFilter, accounts: WithId<AccountingAccount>[], vendors: WithId<Vendor>[], onSummaryChange: (s: ReceivablesPayablesSummary) => void; isAdmin?: boolean }) {
    const { db } = useFirebase();
    const router = useRouter();
    const [obligations, setObligations] = useState<WithId<AccountingObligation>[]>([]);
    const [loading, setLoading] = useState(true);
    const [docDetails, setDocDetails] = useState<
      Record<
        string,
        {
          receiptStatus?: string;
          billingNoteNo?: string;
          customerId?: string;
          customerNameFromDoc?: string;
          customerTaxNameFromDoc?: string;
          netAmount?: number;
          vatAmount?: number;
          grandTotal?: number;
          paymentSummary?: DocumentType["paymentSummary"];
        }
      >
    >({});
    const [payingAR, setPayingAR] = useState<WithId<AccountingObligation> | null>(null);
    const [payingAP, setPayingAP] = useState<WithId<AccountingObligation> | null>(null);
    const [editingAp, setEditingAp] = useState<WithId<AccountingObligation> | null>(null);
    const [obToDelete, setObToDelete] = useState<WithId<AccountingObligation> | null>(null);
    const [isDeletingOb, setIsDeletingOb] = useState(false);
    const { toast } = useToast();

    const confirmDeleteObligation = useCallback(async () => {
        if (!db || !obToDelete) return;
        const ob = obToDelete;
        setIsDeletingOb(true);
        try {
            const obRef = doc(db, "accountingObligations", ob.id);
            const batch = writeBatch(db);
            batch.delete(obRef);
            if (ob.sourceDocId) {
                if (ob.type === "AR") {
                    const srcRef = doc(db, "documents", ob.sourceDocId);
                    const snap = await getDoc(srcRef);
                    if (snap.exists()) {
                        const data = snap.data() as { arObligationId?: string };
                        if (data.arObligationId === ob.id) {
                            batch.update(srcRef, { arObligationId: deleteField(), updatedAt: serverTimestamp() });
                        }
                    }
                } else if (ob.type === "AP" && ob.sourceDocType === "PURCHASE") {
                    const srcRef = doc(db, "purchaseDocs", ob.sourceDocId);
                    const snap = await getDoc(srcRef);
                    if (snap.exists()) {
                        const data = snap.data() as { apObligationId?: string };
                        if (data.apObligationId === ob.id) {
                            batch.update(srcRef, { apObligationId: deleteField(), updatedAt: serverTimestamp() });
                        }
                    }
                }
            }
            await batch.commit();
            toast({ title: "ลบรายการแล้ว", description: `${type === "AR" ? "ลูกหนี้" : "เจ้าหนี้"} ${ob.sourceDocNo || ob.invoiceNo || ob.id}` });
            setObToDelete(null);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast({ variant: "destructive", title: "ลบรายการไม่สำเร็จ", description: msg });
        } finally {
            setIsDeletingOb(false);
        }
    }, [db, obToDelete, toast, type]);

    /**
     * ซ่อมความไม่สอดคล้องระหว่าง Inbox (documents) กับหน้าลูกหนี้ (accountingObligations):
     * 1) obligation PAID แต่ใบกำกับกลับเป็น APPROVED รอใบเสร็จ → รีเซ็ต UNPAID
     * 2) ใบกำกับ APPROVED รอใบเสร็จ แต่ไม่มี AR_<docId> → สร้าง obligation (ดึงแบบแบ่งหน้า + orderBy ไม่ให้พลาดใบนอก limit แรก)
     */
    useEffect(() => {
        if (!db || type !== 'AR') return;
        let cancelled = false;
        (async () => {
            try {
                const obSnap = await getDocs(query(collection(db, 'accountingObligations'), where('type', '==', 'AR'), limit(500)));
                if (cancelled) return;
                const batchPaid = writeBatch(db);
                let nPaid = 0;
                for (const d of obSnap.docs) {
                    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
                    if (ob.status !== 'PAID' || ob.sourceDocType !== 'TAX_INVOICE' || !ob.sourceDocId) continue;
                    const src = await getDoc(doc(db, 'documents', ob.sourceDocId));
                    if (!src.exists()) continue;
                    const docData = src.data() as DocumentType;
                    if (docData.status === 'APPROVED' && !docData.receiptDocId) {
                        const total = typeof ob.amountTotal === 'number' ? ob.amountTotal : docData.grandTotal;
                        batchPaid.update(doc(db, 'accountingObligations', ob.id), {
                            status: 'UNPAID',
                            amountPaid: 0,
                            balance: total,
                            lastPaymentDate: deleteField(),
                            paidOffDate: deleteField(),
                            updatedAt: serverTimestamp(),
                        });
                        nPaid++;
                    }
                }
                if (nPaid > 0 && !cancelled) await batchPaid.commit();

                let invDocs: QueryDocumentSnapshot<DocumentData>[] = [];
                try {
                    invDocs = await getApprovedTaxInvoiceSnapshotsPaged(db);
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
                    if (urlMatch) {
                        toast({
                            variant: 'destructive',
                            title: 'ต้องสร้าง Firestore index',
                            description: `เปิดลิงก์นี้ในเบราว์เซอร์แล้วกดสร้างดัชนี จากนั้นรีเฟรชหน้าลูกหนี้: ${urlMatch[0]}`,
                        });
                    }
                    const snap = await getDocs(
                        query(collection(db, 'documents'), where('status', '==', 'APPROVED'), where('docType', '==', 'TAX_INVOICE'), limit(500))
                    );
                    invDocs = snap.docs;
                }
                if (cancelled) return;

                const arAll = await getDocs(query(collection(db, 'accountingObligations'), where('type', '==', 'AR'), limit(1000)));
                if (cancelled) return;

                const pendingArKeys = new Set<string>();
                for (const snap of arAll.docs) {
                    const ob = { id: snap.id, ...snap.data() } as WithId<AccountingObligation>;
                    if (ob.status !== 'UNPAID' && ob.status !== 'PARTIAL') continue;
                    if (!isArDedupeDocType(ob.sourceDocType) || !(ob.sourceDocNo || '').trim()) continue;
                    pendingArKeys.add(
                        arInvoiceDedupeKey({
                            sourceDocNo: ob.sourceDocNo,
                            customerId: ob.customerId,
                            customerNameSnapshot: ob.customerNameSnapshot,
                        })
                    );
                }

                const batchMissing = writeBatch(db);
                let nMissing = 0;
                for (const d of invDocs) {
                    const docData = { id: d.id, ...d.data() } as DocumentType;
                    if (docData.receiptDocId) continue;
                    const dupKey = arInvoiceDedupeKey({
                        sourceDocNo: docData.docNo,
                        customerId: docData.customerId || docData.customerSnapshot?.id,
                        customerNameSnapshot: docData.customerSnapshot?.name || '',
                    });
                    if (pendingArKeys.has(dupKey)) continue;
                    const arId = `AR_${d.id}`;
                    const arRef = doc(db, 'accountingObligations', arId);
                    const arExisting = await getDoc(arRef);
                    if (arExisting.exists()) continue;
                    const balance = docData.paymentSummary?.balance ?? docData.grandTotal;
                    const customerName = docData.customerSnapshot?.name || 'Unknown';
                    batchMissing.set(
                        arRef,
                        sanitizeForFirestore({
                            id: arId,
                            type: 'AR',
                            status: 'UNPAID',
                            sourceDocType: 'TAX_INVOICE',
                            sourceDocId: d.id,
                            sourceDocNo: docData.docNo,
                            amountTotal: docData.grandTotal,
                            amountPaid: 0,
                            balance,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            customerId: docData.customerId || docData.customerSnapshot?.id || null,
                            customerNameSnapshot: customerName,
                            jobId: docData.jobId || null,
                            dueDate: docData.dueDate || null,
                            docDate: docData.docDate,
                        })
                    );
                    batchMissing.update(doc(db, 'documents', d.id), {
                        arObligationId: arId,
                        arStatus: docData.arStatus || 'UNPAID',
                        updatedAt: serverTimestamp(),
                    });
                    pendingArKeys.add(dupKey);
                    nMissing++;
                }
                if (nMissing > 0 && !cancelled) {
                    await batchMissing.commit();
                    toast({ title: 'ซ่อมข้อมูลลูกหนี้', description: `สร้างรายการลูกหนี้ที่ขาด ${nMissing} รายการแล้ว` });
                }

                // ชื่อลูกค้าว่างบน obligation → ค้นหาตามชื่อไม่เจอ; ดึงจากเอกสารต้นทางแล้วอัปเดต
                if (cancelled) return;
                const batchNames = writeBatch(db);
                let nNames = 0;
                for (const d of arAll.docs) {
                    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
                    if (!ob.sourceDocId) continue;
                    if (String(ob.customerNameSnapshot || '').trim().length > 0) continue;
                    const src = await getDoc(doc(db, 'documents', ob.sourceDocId));
                    if (!src.exists()) continue;
                    const dd = src.data() as DocumentType;
                    const nm = dd.customerSnapshot?.name || dd.customerSnapshot?.taxName;
                    if (!nm) continue;
                    batchNames.update(doc(db, 'accountingObligations', ob.id), {
                        customerNameSnapshot: dd.customerSnapshot?.name || nm,
                        customerId: dd.customerId || dd.customerSnapshot?.id || ob.customerId || null,
                        updatedAt: serverTimestamp(),
                    });
                    nNames++;
                    if (nNames >= 400) break;
                }
                if (nNames > 0 && !cancelled) {
                    await batchNames.commit();
                    toast({ title: 'อัปเดตชื่อลูกค้าในลูกหนี้', description: `เติมชื่อจากเอกสารต้นทาง ${nNames} รายการ (ให้ค้นหาตามชื่อตรงกับรายการจริง)` });
                }

                // ซิงก์ amountPaid/balance บน obligation ให้ตรงกับใบกำกับ (grandTotal − paymentSummary.paidTotal)
                if (cancelled) return;
                const batchBalance = writeBatch(db);
                let nBalance = 0;
                for (const d of arAll.docs) {
                    const ob = { id: d.id, ...d.data() } as WithId<AccountingObligation>;
                    if (ob.status === "PAID" || !ob.sourceDocId || ob.sourceDocType === "CREDIT_NOTE") continue;
                    const src = await getDoc(doc(db, "documents", ob.sourceDocId));
                    if (!src.exists()) continue;
                    const dd = src.data() as DocumentType;
                    const resolvedPaid = resolveArPaidAmount(ob, dd);
                    const resolvedBalance = resolveArOutstandingBalance(ob, dd);
                    const resolvedTotal = Number(dd.grandTotal ?? ob.amountTotal ?? 0);
                    const resolvedStatus: AccountingObligation["status"] =
                      resolvedBalance <= 0.009 ? "PAID" : resolvedPaid > 0.009 ? "PARTIAL" : "UNPAID";

                    const needsObUpdate =
                      Math.abs((ob.amountPaid ?? 0) - resolvedPaid) > 0.009 ||
                      Math.abs((ob.balance ?? 0) - resolvedBalance) > 0.009 ||
                      Math.abs((ob.amountTotal ?? 0) - resolvedTotal) > 0.009 ||
                      ob.status !== resolvedStatus;

                    if (needsObUpdate) {
                        batchBalance.update(doc(db, "accountingObligations", ob.id), {
                            amountPaid: resolvedPaid,
                            balance: resolvedBalance,
                            amountTotal: resolvedTotal,
                            status: resolvedStatus,
                            updatedAt: serverTimestamp(),
                        });
                        nBalance++;
                    }

                    const ps = dd.paymentSummary;
                    const psBalance = ps?.balance;
                    const psPaid = ps?.paidTotal;
                    const needsDocUpdate =
                      resolvedTotal > 0 &&
                      ps != null &&
                      (Math.abs((psBalance ?? 0) - resolvedBalance) > 0.009 ||
                        Math.abs((psPaid ?? 0) - resolvedPaid) > 0.009);

                    if (needsDocUpdate) {
                        batchBalance.update(doc(db, "documents", ob.sourceDocId), {
                            paymentSummary: {
                                paidTotal: resolvedPaid,
                                balance: resolvedBalance,
                                paymentStatus: resolvedStatus,
                            },
                            updatedAt: serverTimestamp(),
                        });
                    }

                    if (nBalance >= 400) break;
                }
                if (nBalance > 0 && !cancelled) {
                    await batchBalance.commit();
                    toast({ title: "ซิงก์ยอดลูกหนี้", description: `อัปเดตยอดคงค้างให้ตรงกับใบกำกับ ${nBalance} รายการ` });
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                toast({ variant: 'destructive', title: 'ซ่อมข้อมูลลูกหนี้ไม่สำเร็จ', description: msg });
            }
        })();
        return () => { cancelled = true; };
    }, [db, type, toast]);

    const obligationsQuery = useMemo(() => {
        if (!db) return null;
        // ไม่ใช้ orderBy(updatedAt) — เอกสารเก่าอาจไม่มีฟิลด์นี้แล้วหลุดจาก query ทั้งก้อน
        return query(collection(db, "accountingObligations"), where("type", "==", type), limit(1000));
    }, [db, type]);

    useEffect(() => {
        if (!obligationsQuery) return;
        setLoading(true);
        const unsubscribe = onSnapshot(obligationsQuery, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingObligation>));
            const rank = (s: AccountingObligation["status"]) => (s === "PAID" ? 2 : s === "PARTIAL" ? 1 : 0);
            const sorted = [...data].sort((a, b) => {
                const r = rank(a.status) - rank(b.status);
                if (r !== 0) return r;
                const da = a.dueDate ? parseISO(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
                const db = b.dueDate ? parseISO(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
                return da - db;
            });
            setObligations(sorted);
            setLoading(false);
        }, (err: FirestoreError) => {
            if (err.code === 'permission-denied') {
                errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'accountingObligations', operation: 'list' }));
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, [obligationsQuery, type]);

    useEffect(() => {
        if (obligations.length === 0 || !db) return;
        const sourceIds = Array.from(new Set(obligations.map(ob => ob.sourceDocId).filter(Boolean)));
        const unsubscribes = sourceIds.map((sourceId) => {
            const ob = obligations.find((x) => x.sourceDocId === sourceId);
            const sourceCol = ob?.sourceDocType === "PURCHASE" ? "purchaseDocs" : "documents";
            return onSnapshot(doc(db, sourceCol, sourceId!), (docSnap) => {
                if (!docSnap.exists()) return;
                const data = docSnap.data() as Record<string, any>;
                const snap = data.customerSnapshot as { name?: string; taxName?: string } | undefined;
                const grandTotal = Number(data.grandTotal ?? ob?.amountTotal ?? 0);
                const vatAmount = Number(data.vatAmount ?? 0);
                const netAmount = Number(data.net ?? data.subtotal ?? Math.max(0, grandTotal - vatAmount));
                setDocDetails((prev) => ({
                  ...prev,
                  [sourceId!]: {
                    receiptStatus: data.receiptStatus || "NONE",
                    billingNoteNo: data.billingNoteNo,
                    customerId: data.customerId || data.customerSnapshot?.id,
                    customerNameFromDoc: snap?.name,
                    customerTaxNameFromDoc: snap?.taxName,
                    netAmount,
                    vatAmount,
                    grandTotal,
                    paymentSummary: data.paymentSummary,
                  },
                }));
            }, () => {});
        });
        return () => unsubscribes.forEach((unsub) => unsub());
    }, [obligations, db]);

    const filteredObligations = useMemo(() => {
        let result = [...obligations];
        if (monthFilter && monthFilter !== 'ALL') {
            result = result.filter(ob => {
                const docDate = ob.docDate || (ob as any).createdAt?.toDate?.()?.toISOString()?.split('T')[0];
                return docDate?.startsWith(monthFilter);
            });
        }
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            result = result.filter((ob) => {
                const det = docDetails[ob.sourceDocId || ""];
                const names = [
                    ob.customerNameSnapshot,
                    ob.vendorShortNameSnapshot,
                    ob.vendorNameSnapshot,
                    det?.customerNameFromDoc,
                    det?.customerTaxNameFromDoc,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                const nums = [ob.sourceDocNo, ob.invoiceNo]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return names.includes(lowerSearch) || nums.includes(lowerSearch);
            });
        }
        if (type === 'AR') {
            result = dedupeArBySalesDocNo(result);
        }
        if (paymentFilter !== "ALL") {
            result = result.filter((ob) => {
                const det = docDetails[ob.sourceDocId || ""];
                const balance =
                  type === "AR"
                    ? resolveArOutstandingBalance(ob, det)
                    : Number(ob.balance) || 0;
                const paid =
                  type === "AR"
                    ? resolveArPaidAmount(ob, det)
                    : Number(ob.amountPaid) || 0;
                if (paymentFilter === "OUTSTANDING") return balance > 0.009;
                return paid > 0.009 && balance <= 0.009;
            });
        }
        return result;
    }, [obligations, searchTerm, monthFilter, paymentFilter, docDetails, type]);

    useEffect(() => {
        let paidNet = 0;
        let paidVat = 0;
        let paidGrand = 0;
        let outNet = 0;
        let outVat = 0;
        let outGrand = 0;
        let outstandingCount = 0;
        let paidLineCount = 0;

        for (const ob of filteredObligations) {
            const det = docDetails[ob.sourceDocId || ""];
            const split = splitObligationPaidOutstanding(ob, det, type);

            paidNet += split.paidNet;
            paidVat += split.paidVat;
            outNet += split.outNet;
            outVat += split.outVat;
            paidGrand += split.paid;
            outGrand += split.balance;
            if (split.balance > 0.009) outstandingCount += 1;
            if (split.paid > 0.009 && split.balance <= 0.009) paidLineCount += 1;
        }

        onSummaryChange({
            paid: {
                net: roundMoney2(paidNet),
                vat: roundMoney2(paidVat),
                grand: roundMoney2(paidGrand),
                lineCount: paidLineCount,
            },
            outstanding: {
                net: roundMoney2(outNet),
                vat: roundMoney2(outVat),
                grand: roundMoney2(outGrand),
                count: outstandingCount,
            },
        });
    }, [filteredObligations, docDetails, onSummaryChange, type]);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;

    return (
        <>
            <div className="border rounded-md overflow-hidden">
                <Table className="w-full table-fixed"><TableHeader><TableRow><TableHead className="w-[10%] whitespace-nowrap">วันที่</TableHead><TableHead className="w-[14%] whitespace-nowrap">{type === 'AR' ? 'เลขที่เอกสาร' : 'เลขที่บิล'}</TableHead><TableHead className="w-[18%]">{type === 'AR' ? 'ลูกค้า' : 'ร้านค้า'}</TableHead><TableHead className="w-[11%] whitespace-nowrap text-right">ยอดก่อนภาษี</TableHead><TableHead className="w-[8%] whitespace-nowrap text-right">ภาษี</TableHead><TableHead className="w-[11%] whitespace-nowrap text-right">ยอดรวม</TableHead><TableHead className="w-[8%] whitespace-nowrap text-right">ชำระแล้ว</TableHead><TableHead className="w-[12%] whitespace-nowrap text-right">ยอดคงค้าง</TableHead><TableHead className="w-[8%] whitespace-nowrap text-right">จัดการ</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredObligations.length > 0 ? filteredObligations.map(ob => {
                            const details = docDetails[ob.sourceDocId || ''];
                            const amounts = splitObligationPaidOutstanding(ob, details, type);
                            const paidAmount = amounts.paid;
                            const outstandingBalance = amounts.balance;
                            const isReceiptIssued = details?.receiptStatus === 'ISSUED_NOT_CONFIRMED' || details?.receiptStatus === 'CONFIRMED';
                            const billDateRaw = ob.docDate || (ob as any).createdAt?.toDate?.();
                            const customerIdForReceipt = ob.customerId || details?.customerId || '';
                            const canIssueReceipt = type === "AR" && (ob.sourceDocType === "TAX_INVOICE" || ob.sourceDocType === "DEBIT_NOTE");
                            const requireReceiptBeforeReceive = ob.sourceDocType === "TAX_INVOICE" || ob.sourceDocType === "DEBIT_NOTE";
                            const arReceiveDisabled =
                              type === "AR" &&
                              (ob.sourceDocType === "CREDIT_NOTE" ||
                                outstandingBalance <= 0.009 ||
                                (requireReceiptBeforeReceive && !isReceiptIssued));
                            const receiptHref = (() => {
                              const q = new URLSearchParams();
                              q.set('tab', 'new');
                              q.set('from', 'receivables');
                              if (customerIdForReceipt) q.set('customerId', customerIdForReceipt);
                              q.set('sourceDocId', ob.sourceDocId);
                              q.set('presetAmount', String(outstandingBalance));
                              return `/app/management/accounting/documents/receipt?${q.toString()}`;
                            })();
                            const apPayDisabled = type === "AP" && (ob.status === "PAID" || outstandingBalance <= 0.009);
                            return (
                              <TableRow key={ob.id} className="hover:bg-muted/30">
                                <TableCell className="text-xs whitespace-nowrap">{billDateRaw ? safeFormat(new Date(billDateRaw), APP_DATE_FORMAT) : '-'}</TableCell>
                                <TableCell>
                                  <div className="font-medium whitespace-nowrap">{type === 'AR' ? ob.sourceDocNo : (ob.invoiceNo || ob.sourceDocNo)}</div>
                                  {type === "AR" && ob.sourceDocType === "CREDIT_NOTE" && (
                                    <Badge variant="outline" className="text-[9px] h-4 mt-1 border-rose-200 text-rose-800 bg-rose-50">
                                      ใบลดหนี้ (หักยอดเก็บ)
                                    </Badge>
                                  )}
                                  {type === "AR" && ob.sourceDocType === "DEBIT_NOTE" && (
                                    <Badge variant="outline" className="text-[9px] h-4 mt-1 border-blue-200 text-blue-800 bg-blue-50">
                                      ใบเพิ่มหนี้
                                    </Badge>
                                  )}
                                  {details?.billingNoteNo && (
                                    <Badge variant="secondary" className="text-[9px] h-4 mt-1 bg-amber-50 text-amber-700 border-amber-200">
                                      <FileStack className="h-2.5 w-2.5 mr-1" /> วางบิลแล้ว: {details.billingNoteNo}
                                    </Badge>
                                  )}
                                  {ob.status === "PAID" && (
                                    <Badge variant="outline" className="text-[9px] h-4 mt-1 border-emerald-200 text-emerald-800 bg-emerald-50">
                                      ชำระครบแล้ว
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm truncate" title={type === 'AR'
                                    ? ob.customerNameSnapshot || details?.customerNameFromDoc || details?.customerTaxNameFromDoc || '—'
                                    : ob.vendorShortNameSnapshot || ob.vendorNameSnapshot}>
                                  {type === 'AR'
                                    ? ob.customerNameSnapshot || details?.customerNameFromDoc || details?.customerTaxNameFromDoc || '—'
                                    : ob.vendorShortNameSnapshot || ob.vendorNameSnapshot}
                                </TableCell>
                                <TableCell className="text-right text-xs whitespace-nowrap">{formatCurrency(amounts.net)}</TableCell>
                                <TableCell className="text-right text-xs whitespace-nowrap">{amounts.vat > 0 ? formatCurrency(amounts.vat) : ""}</TableCell>
                                <TableCell className="text-right text-xs whitespace-nowrap">{formatCurrency(amounts.grand)}</TableCell>
                                <TableCell className="text-right text-xs text-green-600 whitespace-nowrap">{formatCurrency(paidAmount)}</TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-bold whitespace-nowrap",
                                    type === "AR" && outstandingBalance < 0 && "text-rose-700"
                                  )}
                                >
                                  {formatCurrency(outstandingBalance)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" aria-label="จัดการ">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {canIssueReceipt && (
                                        <DropdownMenuItem
                                          disabled={isReceiptIssued}
                                          onSelect={() => router.push(receiptHref)}
                                        >
                                          {isReceiptIssued ? `ออกใบเสร็จแล้ว (${details?.receiptStatus})` : "ออกใบเสร็จ"}
                                        </DropdownMenuItem>
                                      )}
                                      {type === "AR" ? (
                                        <DropdownMenuItem
                                          disabled={arReceiveDisabled}
                                          onSelect={() => setPayingAR(ob)}
                                        >
                                          รับชำระ
                                        </DropdownMenuItem>
                                      ) : (
                                        <>
                                          <DropdownMenuItem disabled={apPayDisabled} onSelect={() => setPayingAP(ob)}>
                                            {apPayDisabled ? "ชำระครบแล้ว" : "จ่ายบิล"}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onSelect={() => setEditingAp(ob)}>แก้ไขกำหนด/บัญชีคาดจ่าย</DropdownMenuItem>
                                        </>
                                      )}
                                      {isAdmin && (
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onSelect={() => setObToDelete(ob)}
                                        >
                                          ลบรายการ
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            );
                        }) : (<TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground italic">ไม่พบรายการ{type === 'AR' ? 'ลูกหนี้' : 'เจ้าหนี้'}ในช่วงที่เลือก (รวมทั้งชำระแล้ว)</TableCell></TableRow>)}
                    </TableBody>
                </Table>
            </div>
            {payingAR && (<ReceiveArPaymentDialog isOpen={!!payingAR} onClose={() => setPayingAR(null)} obligation={payingAR} accounts={accounts} />)}
            {payingAP && (<PayCreditorDialog isOpen={!!payingAP} onClose={() => setPayingAP(null)} obligation={payingAP} accounts={accounts} />)}
            <EditApTermsDialog obligation={editingAp} accounts={accounts} isOpen={!!editingAp} onClose={() => setEditingAp(null)} />
            <AlertDialog open={!!obToDelete} onOpenChange={(open) => !open && !isDeletingOb && setObToDelete(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ลบรายการนี้?</AlertDialogTitle>
                  <AlertDialogDescription>
                    จะลบรายการ{type === "AR" ? "ลูกหนี้" : "เจ้าหนี้"}{" "}
                    <span className="font-mono font-medium text-foreground">
                      {obToDelete?.sourceDocNo || obToDelete?.invoiceNo || obToDelete?.id}
                    </span>{" "}
                    ออกจากระบบ การกระทำนี้ไม่สามารถยกเลิกได้
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingOb}>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={isDeletingOb}
                    onClick={(e) => {
                      e.preventDefault();
                      void confirmDeleteObligation();
                    }}
                  >
                    {isDeletingOb ? <Loader2 className="h-4 w-4 animate-spin" /> : "ลบ"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function ReceivablesPayablesContent({ profile }: { profile: UserProfile }) {
    const searchParams = useSearchParams();
    const defaultTab = searchParams.get('tab') === 'creditors' ? 'creditors' : 'debtors';
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [searchTerm, setSearchTerm] = useState("");
    const [monthFilter, setMonthFilter] = useState<string>(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [paymentFilter, setPaymentFilter] = useState<PaymentStatusFilter>("ALL");
    const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
    const [vendors, setVendors] = useState<WithId<Vendor>[]>([]);
    const [isAddingCreditor, setIsAddingCreditor] = useState(false);
    const [summary, setSummary] = useState<ReceivablesPayablesSummary>({
        paid: { net: 0, vat: 0, grand: 0, lineCount: 0 },
        outstanding: { net: 0, vat: 0, grand: 0, count: 0 },
    });
    const { db } = useFirebase();

    useEffect(() => {
        if (!db) return;
        const accountsQ = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
        const unsubAccounts = onSnapshot(accountsQ, (snap) => {
            setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>)));
        }, (err) => {
            if (err.code === 'permission-denied') errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'accountingAccounts', operation: 'list' }));
        });
        const vendorsQ = query(collection(db, "vendors"), where("isActive", "==", true));
        const unsubVendors = onSnapshot(vendorsQ, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Vendor>));
            data.sort((a, b) => String(a.shortName || "").localeCompare(String(b.shortName || ""), 'th'));
            setVendors(data);
        });
        return () => { unsubAccounts(); unsubVendors(); };
    }, [db]);

    const handleSummaryChange = useCallback((s: ReceivablesPayablesSummary) => {
        setSummary((prev) => {
            if (
                prev.paid.net === s.paid.net &&
                prev.paid.vat === s.paid.vat &&
                prev.paid.grand === s.paid.grand &&
                prev.paid.lineCount === s.paid.lineCount &&
                prev.outstanding.net === s.outstanding.net &&
                prev.outstanding.vat === s.outstanding.vat &&
                prev.outstanding.grand === s.outstanding.grand &&
                prev.outstanding.count === s.outstanding.count
            ) {
                return prev;
            }
            return s;
        });
    }, []);

    useEffect(() => {
        setSummary({
            paid: { net: 0, vat: 0, grand: 0, lineCount: 0 },
            outstanding: { net: 0, vat: 0, grand: 0, count: 0 },
        });
    }, [activeTab]);

    const monthOptions = useMemo(() => {
        const options = [{ value: "ALL", label: "ทุกเดือน" }];
        const now = new Date();
        for (let i = 0; i < 24; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            options.push({ value: m, label: m });
        }
        return options;
    }, []);

    return (
        <>
        <PageHeader title="ลูกหนี้/เจ้าหนี้" description="จัดการและติดตามข้อมูลลูกหนี้และเจ้าหนี้">
            <div className="flex flex-col items-end gap-2">
                <div className="text-[10px] text-muted-foreground w-full text-right max-w-xl">
                    สรุปตามรายการที่แสดง (กรองเดือน/สถานะชำระ/ค้นหา)
                </div>
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap justify-end gap-2">
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[180px] text-right">
                            <div className="text-[11px] text-muted-foreground">
                                ยอดก่อนภาษี — ชำระแล้ว ({summary.paid.lineCount} รายการ)
                            </div>
                            <div className="text-sm font-bold">{formatCurrency(summary.paid.net)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[140px] text-right">
                            <div className="text-[11px] text-muted-foreground">ภาษี</div>
                            <div className="text-sm font-bold">{formatCurrency(summary.paid.vat)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[180px] text-right">
                            <div className="text-[11px] text-muted-foreground">ยอดรวม — ชำระแล้ว</div>
                            <div className="text-sm font-bold">{formatCurrency(summary.paid.grand)}</div>
                        </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[180px] text-right">
                            <div className="text-[11px] text-muted-foreground">
                                ยอดก่อนภาษี — ค้างชำระ ({summary.outstanding.count} รายการ)
                            </div>
                            <div className="text-sm font-bold">{formatCurrency(summary.outstanding.net)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[140px] text-right">
                            <div className="text-[11px] text-muted-foreground">ภาษี</div>
                            <div className="text-sm font-bold">{formatCurrency(summary.outstanding.vat)}</div>
                        </div>
                        <div className="rounded-md border bg-background px-4 py-2 min-w-[180px] text-right">
                            <div className="text-[11px] text-muted-foreground">ยอดรวม — ค้างชำระ</div>
                            <div className="text-sm font-bold">{formatCurrency(summary.outstanding.grand)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </PageHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-center md:items-center gap-4">
                <TabsList><TabsTrigger value="debtors">ลูกหนี้ (Debtors)</TabsTrigger><TabsTrigger value="creditors">เจ้าหนี้ (Creditors)</TabsTrigger></TabsList>
                <div className="flex flex-wrap w-full md:w-auto items-center gap-2">
                    {activeTab === 'creditors' && (<Button onClick={() => setIsAddingCreditor(true)}><PlusCircle className="mr-2 h-4 w-4"/> เพิ่มเจ้าหนี้</Button>)}
                    <div className="w-full md:w-40">
                      <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as PaymentStatusFilter)}>
                        <SelectTrigger className="bg-background">
                          <div className="flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="สถานะชำระ..." />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PAYMENT_FILTER_LABELS) as PaymentStatusFilter[]).map((key) => (
                            <SelectItem key={key} value={key}>{PAYMENT_FILTER_LABELS[key]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full md:w-40">
                      <Select value={monthFilter} onValueChange={setMonthFilter}>
                        <SelectTrigger className="bg-background">
                          <div className="flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="เดือน..." />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {monthOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full md:w-64 relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input placeholder="ค้นหาชื่อ, เลขที่บิล..." className="pl-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
                </div>
            </div>
            <Card>
              <CardContent className="pt-6">
                <TabsContent value="debtors" className="mt-0">{activeTab === 'debtors' && (<ObligationList type="AR" searchTerm={searchTerm} monthFilter={monthFilter} paymentFilter={paymentFilter} accounts={accounts} vendors={vendors} onSummaryChange={handleSummaryChange} isAdmin={profile.role === "ADMIN"} />)}</TabsContent>
                <TabsContent value="creditors" className="mt-0">{activeTab === 'creditors' && (<ObligationList type="AP" searchTerm={searchTerm} monthFilter={monthFilter} paymentFilter={paymentFilter} accounts={accounts} vendors={vendors} onSummaryChange={handleSummaryChange} isAdmin={profile.role === "ADMIN"} />)}</TabsContent>
              </CardContent>
            </Card>
        </Tabs>
        <AddCreditorDialog vendors={vendors} accounts={accounts} isOpen={isAddingCreditor} onClose={() => setIsAddingCreditor(false)} />
        </>
    );
}

export default function ReceivablesPayablesPage() {
    const { profile, loading } = useAuth();
    const hasPermission = useMemo(() => profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT' || profile?.department === 'ACCOUNTING_HR', [profile]);
    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (!profile || !hasPermission) return (<div className="w-full"><PageHeader title="ลูกหนี้/เจ้าหนี้" /><Card className="text-center py-12"><CardHeader><CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle><CardDescription>หน้านี้สงวนไว้สำหรับผู้ดูแลระบบหรือฝ่ายบริหารเท่านั้น</CardDescription></CardHeader></Card></div>);
    return (<Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}><ReceivablesPayablesContent profile={profile} /></Suspense>);
}