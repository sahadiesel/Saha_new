"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, collection, onSnapshot, query, where } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useDoc } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, PlusCircle, Trash2, Save, ChevronsUpDown, AlertCircle, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import { createDocument } from "@/firebase/documents";
import type { StoreSettings, Customer, Document as DocumentType } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const lineItemSchema = z.object({
  description: z.string().min(1, "กรุณากรอกรายละเอียดรายการ"),
  quantity: z.coerce.number().min(0.01, "จำนวนต้องมากกว่า 0"),
  unitPrice: z.coerce.number().min(0, "ราคาต่อหน่วยห้ามติดลบ"),
  total: z.coerce.number(),
});

function createCreditNoteFormSchema(isDebit: boolean) {
  return z
    .object({
      customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
      taxInvoiceId: z.string().min(1, isDebit ? "กรุณาเลือกใบกำกับภาษีอ้างอิง" : "กรุณาเลือกใบกำกับภาษีที่ต้องการลดหนี้"),
      docDate: z.string().min(1, "กรุณาเลือกวันที่"),
      reason: z.string().min(1, isDebit ? "กรุณาระบุเหตุผลการเพิ่มหนี้" : "กรุณาระบุเหตุผลการลดหนี้"),
      notes: z.string().optional(),
      /** แก้ทีละรายการจากบิลเดิม หรือ ระบุยอดรวมสุทธิ (รวม VAT) */
      reductionMode: z.enum(["LINE_ITEMS", "SIMPLE_AMOUNT"]),
      /** ใช้เฉพาะโหมด SIMPLE — ไม่ coerce เพื่อกัน NaN ตอนไม่ได้กรอก */
      simpleGrandTotal: z.union([z.number().min(0), z.undefined()]).optional(),
      items: z.array(lineItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
      subtotal: z.coerce.number(),
      net: z.coerce.number(),
      withTax: z.boolean().default(true),
      vatAmount: z.coerce.number(),
      grandTotal: z.coerce.number(),
    })
    .superRefine((data, ctx) => {
      if (data.reductionMode === "SIMPLE_AMOUNT") {
        const g = data.simpleGrandTotal;
        if (g == null || !Number.isFinite(g) || g <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: isDebit
              ? "กรุณาระบุยอดเพิ่มหนี้รวม (รวม VAT)"
              : "กรุณาระบุยอดลดหนี้รวม (รวม VAT)",
            path: ["simpleGrandTotal"],
          });
        }
      }
    });
}

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function CreditNoteForm({
  mode = "CREDIT_NOTE",
  onCancel,
}: {
  mode?: "CREDIT_NOTE" | "DEBIT_NOTE";
  /** ถ้ามี (เช่น หน้าแท็บรายการ/สร้างใหม่) จะกลับไปแท็บรายการแทน history.back() */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isDebit = mode === "DEBIT_NOTE";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<DocumentType[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings, isLoading: isLoadingStore } = useDoc<StoreSettings>(storeSettingsRef);

  const formSchema = useMemo(() => createCreditNoteFormSchema(isDebit), [isDebit]);

  const formDefaultValues = useMemo(
    () => ({
      docDate: new Date().toISOString().split("T")[0],
      customerId: "",
      taxInvoiceId: "",
      reductionMode: "LINE_ITEMS" as const,
      simpleGrandTotal: undefined as number | undefined,
      items: [{ description: "", quantity: 1, unitPrice: 0, total: 0 }],
      withTax: true,
      subtotal: 0,
      net: 0,
      vatAmount: 0,
      grandTotal: 0,
      reason: "",
      notes: "",
    }),
    []
  );

  const form = useForm<z.infer<ReturnType<typeof createCreditNoteFormSchema>>>({
    resolver: zodResolver(formSchema),
    defaultValues: formDefaultValues,
  });
  const { setValue } = form;

  const selectedCustomerId = form.watch("customerId");
  const selectedInvoiceId = form.watch("taxInvoiceId");

  const prevCustomerIdRef = useRef<string | undefined>(undefined);
  /** เปลี่ยนลูกค้าแล้วเคลียร์ใบกำกับ — ไม่รันครั้งแรกตอน mount เพื่อไม่ชนกับ reset ภายหลัง */
  useEffect(() => {
    const cur = String(selectedCustomerId || "").trim();
    const prev = prevCustomerIdRef.current;
    if (prev !== undefined && prev !== cur) {
      setValue("taxInvoiceId", "");
    }
    prevCustomerIdRef.current = cur;
  }, [selectedCustomerId, setValue]);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "customers"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      setIsLoadingCustomers(false);
    });
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    if (!db || !selectedCustomerId) {
      setInvoices([]);
      return;
    }
    const q = query(collection(db, "documents"), where("customerId", "==", selectedCustomerId), where("docType", "==", "TAX_INVOICE"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const customerDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentType));
      const validInvoices = customerDocs.filter(doc => doc.status !== 'CANCELLED');
      setInvoices(validInvoices);
    });
    return () => unsubscribe();
  }, [db, selectedCustomerId]);
  
  const reductionMode = form.watch("reductionMode");

  useEffect(() => {
    const selectedInvoice = invoices.find((inv) => inv.id === selectedInvoiceId);
    if (!selectedInvoice) return;
    form.setValue("withTax", selectedInvoice.withTax);
    form.setValue("notes", `อ้างอิงใบกำกับภาษีเลขที่ ${selectedInvoice.docNo}`);
    if (reductionMode === "LINE_ITEMS") {
      form.setValue("items", selectedInvoice.items.map((i) => ({ ...i })));
    }
  }, [selectedInvoiceId, invoices, form, reductionMode]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedWithTax = useWatch({ control: form.control, name: "withTax" });
  const watchedSimpleGrand = useWatch({ control: form.control, name: "simpleGrandTotal" });

  /** โหมดระบุยอดรวม: สร้าง 1 บรรทัดสรุปให้สอดคล้องกับยอดรวมสุทธิ (รวม VAT) — ยึดตามรายการในตารางเท่านั้น */
  useEffect(() => {
    if (!selectedInvoiceId || reductionMode !== "SIMPLE_AMOUNT") return;
    const G = Number(watchedSimpleGrand);
    if (!Number.isFinite(G) || G <= 0) {
      form.setValue("items", [
        {
          description: isDebit
            ? "ปรับเพิ่มหนี้ตามยอดที่กำหนด (ระบุยอดรวมด้านบน)"
            : "ปรับลดหนี้ตามยอดที่กำหนด (ระบุยอดรวมด้านบน)",
          quantity: 1,
          unitPrice: 0,
          total: 0,
        },
      ]);
      return;
    }
    const divisor = watchedWithTax ? 1.07 : 1;
    const subtotal = Math.round((G / divisor) * 100) / 100;
    const desc = isDebit
      ? `เพิ่มหนี้ตามยอดรวมที่ระบุ (อ้างอิงบิล)`
      : `ลดหนี้ตามยอดรวมที่ระบุ (อ้างอิงบิล)`;
    form.setValue("items", [{ description: desc, quantity: 1, unitPrice: subtotal, total: subtotal }]);
  }, [
    selectedInvoiceId,
    reductionMode,
    watchedSimpleGrand,
    watchedWithTax,
    isDebit,
    form,
  ]);

  useEffect(() => {
    const subtotal = Math.round(watchedItems.reduce((sum, item) => sum + (item.total || 0), 0) * 100) / 100;
    const net = Math.max(0, subtotal);
    const vatAmount = watchedWithTax ? Math.round((net * 0.07) * 100) / 100 : 0;
    const grandTotal = Math.round((net + vatAmount) * 100) / 100;

    form.setValue("subtotal", subtotal);
    form.setValue("net", net);
    form.setValue("vatAmount", vatAmount);
    form.setValue("grandTotal", grandTotal);
  }, [watchedItems, watchedWithTax, form]);

  const onSubmit = async (data: z.infer<ReturnType<typeof createCreditNoteFormSchema>>) => {
    const customerObj = customers.find(c => c.id === data.customerId);
    const invoiceObj = invoices.find(inv => inv.id === data.taxInvoiceId);
    
    if (!db || !customerObj || !storeSettings || !profile || !invoiceObj) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบถ้วน", description: "กรุณาตรวจสอบข้อมูลลูกค้าและใบกำกับภาษีอ้างอิงอีกครั้งค่ะ" });
      return;
    }
    
    setIsSubmitting(true);
    
    const documentData = {
      docDate: data.docDate,
      customerId: data.customerId,
      customerSnapshot: { ...customerObj },
      storeSnapshot: { ...storeSettings },
      items: data.items,
      subtotal: data.subtotal,
      discountAmount: 0,
      net: data.net,
      withTax: data.withTax,
      vatAmount: data.vatAmount,
      grandTotal: data.grandTotal,
      reason: data.reason,
      notes: data.notes,
      referencesDocIds: [data.taxInvoiceId],
    };

    try {
      const { docId, docNo } = await createDocument(
        db,
        mode,
        {
          ...documentData,
          paymentTerms: invoiceObj.paymentTerms || 'CREDIT',
          dueDate: invoiceObj.dueDate || null,
        },
        profile,
        undefined,
        { initialStatus: 'PENDING_REVIEW' }
      );
      toast({ title: isDebit ? "สร้างใบเพิ่มหนี้สำเร็จ" : "สร้างใบลดหนี้สำเร็จ", description: `เลขที่เอกสาร: ${docNo}` });
      router.push(`/app/office/documents/${docId}`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const lowercasedFilter = customerSearch.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(lowercasedFilter) ||
        c.phone.includes(customerSearch)
    );
  }, [customers, customerSearch]);
  
  const isLoading = isLoadingCustomers || isLoadingStore;

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) => {
          const first = Object.entries(errors)[0];
          const msg = first ? `${String(first[0])}: ${(first[1] as { message?: string })?.message || "ไม่ถูกต้อง"}` : "กรุณาตรวจสอบข้อมูลในฟอร์ม";
          toast({ variant: "destructive", title: "กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง", description: msg });
        })}
        className="space-y-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center bg-muted/30 p-4 rounded-lg border border-dashed">
            <div className="flex items-center gap-2 text-primary font-bold">
                <Info className="h-5 w-5" />
                <span>{isDebit ? "การสร้างใบเพิ่มหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ" : "การสร้างใบลดหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ"}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => (onCancel ? onCancel() : router.back())}
                disabled={isSubmitting}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={isSubmitting || !String(selectedInvoiceId || "").trim()}>
                {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                {isDebit ? "บันทึกใบเพิ่มหนี้" : "บันทึกใบลดหนี้"}
              </Button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-bold uppercase tracking-wider">1. ข้อมูลลูกค้าและบิลอ้างอิง</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormField
                        name="customerId"
                        control={form.control}
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>เลือกพนักงาน/ลูกค้า</FormLabel>
                                <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !String(field.value || "").trim() && "text-muted-foreground")}>
                                                {String(field.value || "").trim() ? customers.find(c => c.id === field.value)?.name : "ค้นหาชื่อลูกค้า..."}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                        <div className="p-2 border-b">
                                            <Input autoFocus placeholder="พิมพ์ชื่อเพื่อค้นหา..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                                        </div>
                                        <ScrollArea className="h-60">
                                            {filteredCustomers.length > 0 ? (
                                                filteredCustomers.map(c => (
                                                    <Button key={c.id} variant="ghost" className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 text-left" onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); }}>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{c.name}</span>
                                                            <span className="text-xs text-muted-foreground">{c.phone}</span>
                                                        </div>
                                                    </Button>
                                                ))
                                            ) : <div className="p-4 text-center text-sm text-muted-foreground italic">ไม่พบรายชื่อ</div>}
                                        </ScrollArea>
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {String(selectedCustomerId || "").trim() ? (
                        <FormField
                            name="taxInvoiceId"
                            control={form.control}
                            render={({ field }) => {
                              const invoiceValue =
                                field.value && invoices.some((i) => i.id === field.value) ? field.value : undefined;
                              return (
                                <FormItem className="animate-in fade-in slide-in-from-top-1">
                                    <FormLabel>{isDebit ? "เลือกใบกำกับภาษีที่ต้องการเพิ่มหนี้" : "เลือกใบกำกับภาษีที่ต้องการลดหนี้"}</FormLabel>
                                    <Select
                                      onValueChange={field.onChange}
                                      value={invoiceValue}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="เลือกเลขที่บิล..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {invoices.length > 0 ? invoices.map(inv => (
                                                <SelectItem key={inv.id} value={inv.id}>
                                                    {inv.docNo} ({safeFormat(new Date(inv.docDate), 'dd/MM/yy')}) - ฿{formatCurrency(inv.grandTotal)}
                                                </SelectItem>
                                            )) : <div className="p-4 text-center text-sm text-muted-foreground">ไม่พบใบกำกับภาษีของลูกค้ารายนี้</div>}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                              );
                            }}
                        />
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-bold uppercase tracking-wider">2. ข้อมูล{isDebit ? "ใบเพิ่มหนี้" : "ใบลดหนี้"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormField
                        control={form.control}
                        name="docDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>วันที่ออก{isDebit ? "ใบเพิ่มหนี้" : "ใบลดหนี้"}</FormLabel>
                                <FormControl>
                                    <Input type="date" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{isDebit ? "สาเหตุการเพิ่มหนี้ (ระบุในบิล)" : "สาเหตุการลดหนี้ (ระบุในบิล)"}</FormLabel>
                                <FormControl>
                                    <Input placeholder={isDebit ? "เช่น คิดบริการเพิ่ม, คิดค่าวัสดุเพิ่ม..." : "เช่น คืนสินค้า, คำนวณราคาสินค้าผิดพลาด..."} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </CardContent>
            </Card>
        </div>

        {selectedInvoiceId && (
            <Card className="animate-in fade-in duration-500">
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                        {isDebit ? "มูลค่าใบเพิ่มหนี้" : "มูลค่าใบลดหนี้"}
                    </CardTitle>
                    <CardDescription>
                        {isDebit
                            ? "ยอดเอกสารคำนวณจากรายการในตารางเท่านั้น — แก้ทีละรายการจากบิลเดิม หรือระบุยอดรวม (รวม VAT) ให้ระบบสร้างบรรทัดสรุป"
                            : "ยอดเอกสารคำนวณจากรายการในตารางเท่านั้น — ลดทีละรายการจากบิลเดิม หรือระบุยอดลดรวม (รวม VAT) ให้ระบบสร้างบรรทัดสรุป"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <FormField
                        control={form.control}
                        name="reductionMode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{isDebit ? "วิธีกำหนดมูลค่า" : "วิธีกำหนดมูลค่า"}</FormLabel>
                                <FormControl>
                                    <RadioGroup
                                        onValueChange={(v) => {
                                            const next = v as "LINE_ITEMS" | "SIMPLE_AMOUNT";
                                            if (next === "SIMPLE_AMOUNT") {
                                                const g = form.getValues("grandTotal");
                                                if (g > 0) form.setValue("simpleGrandTotal", g);
                                            } else {
                                                const inv = invoices.find((i) => i.id === selectedInvoiceId);
                                                if (inv) {
                                                    form.setValue("items", inv.items.map((i) => ({ ...i })));
                                                }
                                            }
                                            field.onChange(next);
                                        }}
                                        value={field.value}
                                        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="LINE_ITEMS" id="cn-rm-line" />
                                            <Label htmlFor="cn-rm-line" className="font-normal cursor-pointer">
                                                {isDebit ? "เพิ่มเป็นทีละรายการ (จากบิลเดิม)" : "ลด/คืนเป็นทีละรายการ"}
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="SIMPLE_AMOUNT" id="cn-rm-simple" />
                                            <Label htmlFor="cn-rm-simple" className="font-normal cursor-pointer">
                                                {isDebit ? "ระบุยอดเพิ่มรวม (รวม VAT)" : "ระบุยอดลดรวม (รวม VAT)"}
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {reductionMode === "SIMPLE_AMOUNT" ? (
                        <FormField
                            control={form.control}
                            name="simpleGrandTotal"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {isDebit ? "ยอดเพิ่มหนี้รวม (รวม VAT)" : "ยอดลดหนี้รวม (รวม VAT)"}
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            step="any"
                                            className="max-w-xs"
                                            {...field}
                                            value={field.value === undefined || field.value === null ? "" : field.value}
                                            onChange={(e) => {
                                                const raw = e.target.value;
                                                field.onChange(raw === "" ? undefined : parseFloat(raw));
                                            }}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        คำนวณฐานภาษีและ VAT 7% ให้อัตโนมัติจากยอดรวมนี้ (สอดคล้องกับติ๊ก VAT ด้านล่าง)
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    ) : null}

                    <div className="border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-12 text-center">#</TableHead>
                                    <TableHead>รายละเอียดรายการ</TableHead>
                                    <TableHead className="w-32 text-right">จำนวน</TableHead>
                                    <TableHead className="w-40 text-right">ราคา/หน่วย</TableHead>
                                    <TableHead className="w-40 text-right">ยอดรวม</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {fields.map((field, index) => (
                                    <TableRow key={field.id} className="hover:bg-transparent">
                                        <TableCell className="text-center">{index + 1}</TableCell>
                                        <TableCell>
                                            <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (
                                                <Input {...field} placeholder="ชื่อสินค้า/บริการ" disabled={reductionMode === "SIMPLE_AMOUNT"} />
                                            )} />
                                        </TableCell>
                                        <TableCell>
                                            <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (
                                                <Input 
                                                    type="number" step="any" className="text-right" 
                                                    {...field} 
                                                    disabled={reductionMode === "SIMPLE_AMOUNT"}
                                                    onChange={e => {
                                                        const v = parseFloat(e.target.value) || 0;
                                                        field.onChange(v);
                                                        form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.unitPrice`)) * 100) / 100);
                                                    }}
                                                />
                                            )} />
                                        </TableCell>
                                        <TableCell>
                                            <FormField control={form.control} name={`items.${index}.unitPrice`} render={({ field }) => (
                                                <Input 
                                                    type="number" step="any" className="text-right" 
                                                    {...field} 
                                                    disabled={reductionMode === "SIMPLE_AMOUNT"}
                                                    onChange={e => {
                                                        const v = parseFloat(e.target.value) || 0;
                                                        field.onChange(v);
                                                        form.setValue(`items.${index}.total`, Math.round((v * form.getValues(`items.${index}.quantity`)) * 100) / 100);
                                                    }}
                                                />
                                            )} />
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCurrency(watchedItems[index]?.total)}
                                        </TableCell>
                                        <TableCell>
                                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive" disabled={reductionMode === "SIMPLE_AMOUNT"}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="mt-4" disabled={reductionMode === "SIMPLE_AMOUNT"} onClick={() => append({ description: "", quantity: 1, unitPrice: 0, total: 0 })}>
                        <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มรายการใหม่
                    </Button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                        <div>
                            <FormField control={form.control} name="notes" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>หมายเหตุเพิ่มเติม (ถ้ามี)</FormLabel>
                                    <FormControl><Textarea {...field} rows={4} /></FormControl>
                                </FormItem>
                            )} />
                        </div>
                        <div className="space-y-3 p-6 rounded-xl border bg-muted/20">
                            <div className="flex justify-between items-center text-sm font-medium">
                                <span className="text-muted-foreground">{isDebit ? "ยอดเพิ่มหนี้รวม (ตามรายการ):" : "ยอดลดหนี้รวม (ตามรายการ):"}</span>
                                <span>{formatCurrency(form.watch("subtotal"))}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <div className="flex items-center gap-2">
                                    <Checkbox id="isVat" checked={watchedWithTax} onCheckedChange={(v) => form.setValue('withTax', !!v)} />
                                    <Label htmlFor="isVat" className="font-normal cursor-pointer">ภาษีมูลค่าเพิ่ม 7%:</Label>
                                </div>
                                <span className={cn(!watchedWithTax && "text-muted-foreground italic")}>
                                    {watchedWithTax ? formatCurrency(form.watch('vatAmount')) : "ไม่รวม VAT"}
                                </span>
                            </div>
                            <Separator className="bg-primary/20" />
                            <div className="flex justify-between items-center text-xl font-black text-primary">
                                <span>{isDebit ? "มูลค่าที่เพิ่มขึ้นรวมทั้งสิ้น:" : "มูลค่าที่ลดลงรวมทั้งสิ้น:"}</span>
                                <span>฿{formatCurrency(form.watch('grandTotal'))}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )}
      </form>
    </Form>
  );
}
