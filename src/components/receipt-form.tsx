
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
import { Loader2, Save, ChevronsUpDown, AlertCircle, Info, Send, FileText, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

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

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      paymentDate: new Date().toISOString().split("T")[0],
      amount: 0,
      customerId: searchParams.get('customerId') || "",
      sourceDocIds: searchParams.get('sourceDocId') ? [searchParams.get('sourceDocId')!] : [],
    },
  });

  const selectedCustomerId = form.watch('customerId');
  const watchedSourceDocIds = form.watch('sourceDocIds');

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
        setAccounts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
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
      where("status", "in", ["UNPAID", "PARTIAL", "APPROVED"])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentType));
      
      const filtered = allDocs.filter(doc => {
          if (doc.status === 'CANCELLED' || doc.status === 'PAID') return false;
          if (doc.receiptStatus === 'CONFIRMED') return false;
          
          // บิลที่ระบุว่าต้องวางบิล จะต้องผ่านการวางบิลก่อน (ยกเว้นเรากำลังออกบิลจากใบวางบิลโดยตรง)
          if (doc.docType === 'TAX_INVOICE' && doc.billingRequired && !doc.billingNoteId) {
              return false;
          }
          return true;
      });

      setSourceDocs(filtered);
    });
    return unsubscribe;
  }, [db, selectedCustomerId]);
  
  // Calculate total amount whenever selection changes
  useEffect(() => {
    const selected = sourceDocs.filter(d => watchedSourceDocIds.includes(d.id));
    const total = selected.reduce((sum, d) => sum + (d.paymentSummary?.balance ?? d.grandTotal), 0);
    form.setValue('amount', Math.round(total * 100) / 100);
    
    // Auto-set account if the first selected doc has a suggested one
    if (selected.length > 0 && selected[0].suggestedAccountId && !form.getValues('accountId')) {
        form.setValue('accountId', selected[0].suggestedAccountId);
    }
  }, [watchedSourceDocIds, sourceDocs, form]);

  const handleToggleDoc = (docId: string) => {
    const currentIds = form.getValues('sourceDocIds');
    if (currentIds.includes(docId)) {
      form.setValue('sourceDocIds', currentIds.filter(id => id !== docId));
    } else {
      form.setValue('sourceDocIds', [...currentIds, docId]);
    }
  };

  const handleProcessSubmission = async (data: ReceiptFormData, status: 'DRAFT' | 'PENDING_REVIEW') => {
    const customer = customers.find(c => c.id === data.customerId);
    const selectedDocs = sourceDocs.filter(d => data.sourceDocIds.includes(d.id));
    const account = accounts.find(a => a.id === data.accountId);

    if (!db || !customer || !storeSettings || !profile || selectedDocs.length === 0 || !account) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบถ้วน", description: "กรุณาเลือกข้อมูลลูกค้า บัญชี และเลือกบิลอย่างน้อย 1 ใบก่อนบันทึก" });
      return;
    }
    
    setIsSubmitting(true);
    const amount2dec = Math.round(data.amount * 100) / 100;
    
    // Create detailed items list for the receipt
    const items = selectedDocs.map(doc => ({
      description: `ชำระค่าสินค้า/บริการ ตาม${doc.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : doc.docType === 'BILLING_NOTE' ? 'ใบวางบิล' : 'ใบส่งของชั่วคราว'} เลขที่ ${doc.docNo}`,
      quantity: 1,
      unitPrice: doc.paymentSummary?.balance ?? doc.grandTotal,
      total: doc.paymentSummary?.balance ?? doc.grandTotal
    }));

    try {
      const docData = {
        docDate: data.paymentDate,
        customerId: data.customerId,
        customerSnapshot: { ...customer },
        storeSnapshot: { ...storeSettings },
        items,
        subtotal: amount2dec,
        discountAmount: 0,
        net: amount2dec,
        // Using withTax logic: if any selected doc has tax, mark receipt as withTax for calculations
        withTax: selectedDocs.some(d => d.withTax),
        vatAmount: selectedDocs.some(d => d.withTax) ? Math.round(((amount2dec / 1.07) * 0.07) * 100) / 100 : 0,
        grandTotal: amount2dec,
        notes: data.notes,
        referencesDocIds: data.sourceDocIds,
        paymentMethod: account.type === 'CASH' ? 'CASH' : 'TRANSFER',
        paymentDate: data.paymentDate,
        receivedAccountId: data.accountId,
      };

      const { docId, docNo } = await createDocument(db, 'RECEIPT', docData, profile, undefined, { initialStatus: status });

      // Update all source documents status
      const batch = writeBatch(db);
      selectedDocs.forEach(sourceDoc => {
          batch.update(doc(db, 'documents', sourceDoc.id), {
              receiptStatus: 'ISSUED_NOT_CONFIRMED',
              receiptDocId: docId,
              receiptDocNo: docNo,
              updatedAt: serverTimestamp()
          });
      });
      await batch.commit();

      toast({ title: status === 'DRAFT' ? "บันทึกร่างสำเร็จ" : "ส่งตรวจสอบสำเร็จ", description: `เลขที่ใบเสร็จ: ${docNo}` });
      
      if (status === 'DRAFT') {
          router.push(`/app/office/documents/${docId}`);
      } else {
          router.push(`/app/management/accounting/inbox`);
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch));
  }, [customers, customerSearch]);

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-primary"><Info className="h-5 w-5" /> เลือกบิลที่ลูกค้าต้องการรวมใบเสร็จ</h2>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                    variant="secondary" 
                    className="flex-1 sm:flex-none"
                    disabled={isSubmitting || watchedSourceDocIds.length === 0}
                    onClick={form.handleSubmit(d => handleProcessSubmission(d, 'DRAFT'))}
                >
                    {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    บันทึกฉบับร่าง
                </Button>
                <Button 
                    className="flex-1 sm:flex-none"
                    disabled={isSubmitting || watchedSourceDocIds.length === 0}
                    onClick={form.handleSubmit(d => handleProcessSubmission(d, 'PENDING_REVIEW'))}
                >
                    {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                    บันทึกและส่งตรวจสอบรับเงิน
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
                        <Button variant="outline" role="combobox" className="w-full md:w-[400px] justify-between font-normal">
                            <span className="truncate">{field.value ? (customers.find(c => c.id === field.value)?.name || "กำลังโหลด...") : "ค้นหาชื่อลูกค้า..."}</span>
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
                                <Button variant="ghost" key={c.id} onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); form.setValue('sourceDocIds', []); }} className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 text-left">
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
                    <FormLabel>เลือกเอกสารที่ต้องการออกใบเสร็จ (เลือกได้หลายรายการ)</FormLabel>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-12 text-center">เลือก</TableHead>
                                    <TableHead>เลขที่เอกสาร</TableHead>
                                    <TableHead>วันที่</TableHead>
                                    <TableHead className="text-right">ยอดคงค้าง</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sourceDocs.length > 0 ? sourceDocs.map(doc => (
                                    <TableRow key={doc.id} className={cn("hover:bg-muted/30 cursor-pointer", watchedSourceDocIds.includes(doc.id) && "bg-primary/5")} onClick={() => handleToggleDoc(doc.id)}>
                                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                            <Checkbox 
                                                checked={watchedSourceDocIds.includes(doc.id)} 
                                                onCheckedChange={() => handleToggleDoc(doc.id)} 
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs">{doc.docNo}</span>
                                                <Badge variant="outline" className="text-[8px] h-4 px-1">{doc.docType === 'BILLING_NOTE' ? 'วางบิล' : doc.docType === 'TAX_INVOICE' ? 'กำกับภาษี' : 'ใบส่งของ'}</Badge>
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
                    
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-md text-xs text-amber-800">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <div>
                            <strong>คำแนะนำ:</strong>
                            <ul className="list-disc pl-4 mt-1">
                                <li>ระบบจะแสดงเฉพาะบิลที่ค้างชำระ และบิลภาษีที่ระบุ "ต้องวางบิล" จะต้องทำใบวางบิลก่อนถึงจะขึ้นที่นี่ค่ะ</li>
                                <li>การรวมบิลหลายใบในใบเสร็จเดียว ยอดเงินจะถูกนำไปจัดสรรตัดหนี้รายใบเมื่อฝ่ายบัญชียืนยันรับเงินจริงครับ</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}
            </CardContent>
        </Card>

        {watchedSourceDocIds.length > 0 && (
        <Card className="animate-in zoom-in-95">
            <CardHeader><CardTitle className="text-base">2. รายละเอียดการรับเงินรวม (คาดการณ์)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField name="paymentDate" render={({ field }) => (
                    <FormItem>
                        <FormLabel>วันที่ออกใบเสร็จ</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
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
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่จะนำเงินเข้า..." /></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'ธนาคาร'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormDescription className="text-[10px]">ระบบจะบันทึกวิธีชำระให้อัตโนมัติตามประเภทบัญชีที่เลือกค่ะ</FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>บันทึกเพิ่มเติม</FormLabel><FormControl><Textarea {...field} placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)..." /></FormControl></FormItem>)} />
            </CardContent>
        </Card>
        )}
      </form>
    </Form>
  );
}
