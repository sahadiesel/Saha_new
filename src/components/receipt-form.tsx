"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, onSnapshot, query, where, updateDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ChevronsUpDown, AlertCircle, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

import { createDocument } from "@/firebase/documents";
import type { StoreSettings, Customer, Document as DocumentType, AccountingAccount } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const receiptFormSchema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  sourceDocId: z.string().min(1, "กรุณาเลือกเอกสารอ้างอิง"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  amount: z.coerce.number().min(0.01, "ยอดเงินต้องมากกว่า 0"),
  notes: z.string().optional(),
});

type ReceiptFormData = z.infer<typeof receiptFormSchema>;

export function ReceiptForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sourceDocs, setSourceDocs] = useState<DocumentType[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      paymentDate: new Date().toISOString().split("T")[0],
      amount: 0,
    },
  });

  const selectedCustomerId = form.watch('customerId');
  const selectedSourceDocId = form.watch('sourceDocId');

  useEffect(() => {
    const cId = searchParams.get('customerId');
    const sId = searchParams.get('sourceDocId');
    if (cId) form.setValue('customerId', cId);
    if (sId) form.setValue('sourceDocId', sId);
  }, [searchParams, form]);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "customers"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      setIsLoading(false);
    }, () => setIsLoading(false));
    return unsubscribe;
  }, [db]);
  
  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountingAccount)));
    });
    return unsubscribe;
  }, [db]);

  useEffect(() => {
    if (!db || !selectedCustomerId) {
      setSourceDocs([]);
      return;
    }
    const q = query(
      collection(db, "documents"),
      where("customerId", "==", selectedCustomerId),
      where("docType", "in", ["TAX_INVOICE", "BILLING_NOTE", "DELIVERY_NOTE"]),
      where("status", "in", ["UNPAID", "PARTIAL", "DRAFT", "PENDING_REVIEW", "APPROVED"])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentType));
      
      const filtered = allDocs.filter(doc => {
          if (doc.status === 'CANCELLED' || doc.status === 'PAID') return false;
          if (doc.receiptStatus === 'CONFIRMED') return false;
          
          if (doc.docType === 'TAX_INVOICE' && doc.billingRequired) {
              return false;
          }
          return true;
      });

      setSourceDocs(filtered);
    });
    return unsubscribe;
  }, [db, selectedCustomerId]);
  
  useEffect(() => {
    const selectedDoc = sourceDocs.find(d => d.id === selectedSourceDocId);
    if (selectedDoc) {
      const balance = selectedDoc.paymentSummary?.balance ?? selectedDoc.grandTotal;
      form.setValue('amount', balance);
    }
  }, [selectedSourceDocId, sourceDocs, form]);

  const onSubmit = async (data: ReceiptFormData) => {
    const customer = customers.find(c => c.id === data.customerId);
    const sourceDoc = sourceDocs.find(d => d.id === data.sourceDocId);
    const account = accounts.find(a => a.id === data.accountId);

    if (!db || !customer || !storeSettings || !profile || !sourceDoc || !account) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบถ้วน", description: "กรุณาเลือกข้อมูลลูกค้า บัญชี และเอกสารอ้างอิงให้ครบถ้วนก่อนบันทึก" });
      return;
    }
    
    const items = [{
      description: `ชำระค่าสินค้า/บริการ ตาม${sourceDoc.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : sourceDoc.docType === 'BILLING_NOTE' ? 'ใบวางบิล' : 'ใบส่งของชั่วคราว'} เลขที่ ${sourceDoc.docNo}`,
      quantity: 1,
      unitPrice: data.amount,
      total: data.amount
    }];

    try {
      const docData = {
        docDate: data.paymentDate,
        customerId: data.customerId,
        customerSnapshot: { ...customer },
        storeSnapshot: { ...storeSettings },
        items,
        subtotal: data.amount,
        discountAmount: 0,
        net: data.amount,
        withTax: sourceDoc.withTax,
        vatAmount: sourceDoc.withTax ? (data.amount / 1.07) * 0.07 : 0,
        grandTotal: data.amount,
        notes: data.notes,
        referencesDocIds: [data.sourceDocId],
        paymentMethod: account.type === 'CASH' ? 'CASH' : 'TRANSFER',
        paymentDate: data.paymentDate,
        receivedAccountId: data.accountId,
      };

      // Create Receipt with PENDING_REVIEW status so it shows in Inbox
      const { docId, docNo } = await createDocument(db, 'RECEIPT', docData, profile, undefined, { initialStatus: 'PENDING_REVIEW' });

      // Update source document to link to this Receipt
      const sourceDocRef = doc(db, 'documents', data.sourceDocId);
      const batch = writeBatch(db);
      batch.update(sourceDocRef, {
          receiptStatus: 'ISSUED_NOT_CONFIRMED',
          receiptDocId: docId,
          receiptDocNo: docNo,
          updatedAt: serverTimestamp()
      });
      await batch.commit();

      toast({ title: "ออกใบเสร็จรับเงินสำเร็จ", description: `เลขที่ใบเสร็จ: ${docNo}` });
      router.push(`/app/management/accounting/inbox`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ไม่สามารถออกใบเสร็จได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง" });
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));
  }, [customers, customerSearch]);

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-primary"><Info className="h-5 w-5" /> เลือกบิลที่ลูกค้าต้องการใบเสร็จ</h2>
            <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />}
                บันทึกและส่งตรวจสอบรับเงิน
            </Button>
        </div>
        <Card>
            <CardHeader><CardTitle className="text-base">1. ข้อมูลลูกค้าและเอกสารอ้างอิง</CardTitle></CardHeader>
            <CardContent className="space-y-4">
            <FormField name="customerId" render={({ field }) => (
                <FormItem>
                    <FormLabel>ชื่อลูกค้า</FormLabel>
                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                        <FormControl>
                        <Button variant="outline" role="combobox" className="w-full md:w-[400px] justify-between font-normal">
                            <span className="truncate">{field.value ? customers.find(c => c.id === field.value)?.name : "ค้นหาชื่อลูกค้า..."}</span>
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
                                <Button variant="ghost" key={c.id} onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); }} className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 text-left">
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
                <div className="space-y-4">
                    <FormField name="sourceDocId" render={({ field }) => (
                    <FormItem>
                        <FormLabel>เลือกบิล/ใบวางบิล ที่จะรับชำระ</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                            <SelectTrigger className="w-full md:w-[500px]"><SelectValue placeholder="เลือกเอกสารที่ยังไม่ปิดยอด..." /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {sourceDocs.length > 0 ? sourceDocs.map(doc => (
                            <SelectItem key={doc.id} value={doc.id}>
                                [{doc.docNo}] {doc.docType === 'BILLING_NOTE' ? '(ใบวางบิล)' : ''} วันที่: {safeFormat(new Date(doc.docDate), "dd/MM/yy")} - ยอดคงค้าง: {(doc.paymentSummary?.balance ?? doc.grandTotal).toLocaleString()} บาท
                            </SelectItem>
                            )) : <div className="p-4 text-sm text-muted-foreground text-center">ไม่พบเอกสารค้างชำระที่ออกใบเสร็จรายใบได้</div>}
                        </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                    )} />
                    
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-md text-xs text-amber-800">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <div>
                            <strong>นโยบายบริษัท:</strong>
                            <ul className="list-disc pl-4 mt-1">
                                <li>ใบกำกับภาษีที่ระบุว่า "ต้องวางบิล" จะไม่ปรากฏที่นี่ กรุณาใช้ระบบ "ใบวางบิล" เพื่อรวบรวมก่อน</li>
                                <li>การออกใบเสร็จจะลดภาระหนี้ของบิลอ้างอิงทันทีเมื่อฝ่ายบัญชีและยืนยันรับเงิน</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}
            </CardContent>
        </Card>

        {selectedSourceDocId && (
        <Card>
            <CardHeader><CardTitle className="text-base">2. รายละเอียดการรับเงิน (คาดการณ์)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField name="paymentDate" render={({ field }) => (<FormItem><FormLabel>วันที่ออกใบเสร็จ</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField name="amount" render={({ field }) => (<FormItem><FormLabel>ยอดเงินตามใบเสร็จ (บาท)</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="font-bold text-lg" /></FormControl><FormMessage /></FormItem>)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField name="accountId" render={({ field }) => (
                    <FormItem>
                        <FormLabel>เข้าบัญชี (คาดการณ์)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่จะนำเงินเข้า..." /></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'ธนาคาร'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormDescription className="text-[10px]">ระบบจะบันทึกวิธีชำระ (เงินสด/โอน) ให้อัตโนมัติตามประเภทบัญชีที่เลือกค่ะ</FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>บันทึกเพิ่มเติม</FormLabel><FormControl><Textarea {...field} placeholder="เช่น เลขที่เช็ค, ธนาคารต้นทาง, หรือข้อมูลอื่นที่ฝ่ายบัญชีควรทราบ..." /></FormControl></FormItem>)} />
            </CardContent>
        </Card>
        )}
      </form>
    </Form>
  );
}
