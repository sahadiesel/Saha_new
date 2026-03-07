"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  collection, query, where, onSnapshot, doc, writeBatch, 
  serverTimestamp, getDocs, limit, orderBy, runTransaction 
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BrowserMultiFormatReader } from '@zxing/browser';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { 
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle 
} from "@/components/ui/dialog";
import { 
  Loader2, PlusCircle, Trash2, Save, ArrowLeft, Search, 
  ScanBarcode, AlertCircle, Info, Package, User, FileText, ChevronsUpDown, X
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import type { Customer, Job, Part, Document as DocumentType } from "@/lib/types";
import { useRouter } from "next/navigation";

const withdrawalItemSchema = z.object({
  partId: z.string().min(1, "กรุณาเลือกอะไหล่"),
  code: z.string().optional(),
  name: z.string().optional(),
  stockQty: z.number().optional(),
  quantity: z.coerce.number().min(0.01, "ต้องระบุจำนวน"),
}).superRefine((data, ctx) => {
  if (data.stockQty !== undefined && data.quantity > data.stockQty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "จำนวนเบิกห้ามเกินสต็อกที่มี",
      path: ["quantity"],
    });
  }
});

const withdrawalSchema = z.object({
  refType: z.enum(["JOB", "SALES_DOC", "LOAN"]),
  refId: z.string().min(1, "กรุณาระบุรายการอ้างอิง"),
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  items: z.array(withdrawalItemSchema).min(1, "ต้องมีอย่างน้อย 1 รายการ"),
  notes: z.string().optional(),
});

type WithdrawalFormData = z.infer<typeof withdrawalSchema>;

export default function PartWithdrawalForm() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [activeSalesDocs, setActiveSalesDocs] = useState<DocumentType[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const [customerSearch, setCustomerSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [activePartSearchIdx, setActivePartSearchIdx] = useState<number | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<any>(null);

  const form = useForm<WithdrawalFormData>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: {
      refType: "JOB",
      refId: "",
      customerId: "",
      items: [{ partId: "", code: "", name: "", stockQty: 0, quantity: 1 }],
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchedRefType = form.watch("refType");
  const watchedCustomerId = form.watch("customerId");

  useEffect(() => {
    if (!db) return;
    
    const unsubCustomers = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    const unsubJobs = onSnapshot(query(collection(db, "jobs"), where("status", "!=", "CLOSED")), (snap) => {
      setActiveJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    });

    const unsubDocs = onSnapshot(query(collection(db, "documents"), where("status", "in", ["DRAFT", "PENDING_REVIEW", "APPROVED", "UNPAID", "PARTIAL"])), (snap) => {
      setActiveSalesDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentType)));
    });

    const unsubParts = onSnapshot(collection(db, "parts"), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
      setIsLoadingData(false);
    });

    return () => { unsubCustomers(); unsubJobs(); unsubDocs(); unsubParts(); };
  }, [db]);

  const filteredJobs = useMemo(() => activeJobs.filter(j => j.customerId === watchedCustomerId), [activeJobs, watchedCustomerId]);
  const filteredSalesDocs = useMemo(() => activeSalesDocs.filter(d => d.customerId === watchedCustomerId), [activeSalesDocs, watchedCustomerId]);

  const handleSelectPart = (index: number, part: Part) => {
    form.setValue(`items.${index}.partId`, part.id);
    form.setValue(`items.${index}.code`, part.code);
    form.setValue(`items.${index}.name`, part.name);
    form.setValue(`items.${index}.stockQty`, part.stockQty);
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

  const onSubmit = async (data: WithdrawalFormData) => {
    if (!db || !profile) return;
    setIsSubmitting(true);

    try {
      await runTransaction(db, async (transaction) => {
        for (const item of data.items) {
          const partRef = doc(db, "parts", item.partId);
          const partSnap = await transaction.get(partRef);
          if (!partSnap.exists()) throw new Error(`ไม่พบสินค้า ${item.code}`);
          const currentQty = partSnap.data().stockQty || 0;
          if (currentQty < item.quantity) throw new Error(`สินค้า ${item.code} สต็อกไม่พอ (เหลือ ${currentQty})`);
          
          transaction.update(partRef, {
            stockQty: currentQty - item.quantity,
            updatedAt: serverTimestamp()
          });

          const actRef = doc(collection(db, "stockActivities"));
          transaction.set(actRef, sanitizeForFirestore({
            partId: item.partId,
            partCode: item.code,
            partName: item.name,
            type: 'WITHDRAW',
            diffQty: item.quantity,
            beforeQty: currentQty,
            afterQty: currentQty - item.quantity,
            notes: `เบิกใส่ ${data.refType}: ${data.refId}. หมายเหตุ: ${data.notes || "-"}`,
            createdByUid: profile.uid,
            createdByName: profile.displayName,
            createdAt: serverTimestamp(),
          }));
        }

        if (data.refType === 'JOB') {
          const jobRef = doc(db, "jobs", data.refId);
          const actRef = doc(collection(jobRef, "activities"));
          const itemText = data.items.map(i => `${i.name} (${i.quantity} ชิ้น)`).join(", ");
          transaction.set(actRef, {
            text: `มีการเบิกอะไหล่ใส่ใบงาน: ${itemText}`,
            userName: profile.displayName,
            userId: profile.uid,
            createdAt: serverTimestamp(),
          });
        }

        const wdRef = doc(collection(db, "partWithdrawals"));
        transaction.set(wdRef, sanitizeForFirestore({
          ...data,
          status: 'COMPLETED',
          createdByUid: profile.uid,
          createdByName: profile.displayName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });

      toast({ title: "บันทึกการเบิกสำเร็จ", description: "สต็อกถูกหักเรียบร้อยแล้วค่ะ" });
      router.push("/app/office/parts/withdraw");
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingData) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex justify-between items-center">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}><ArrowLeft className="mr-2 h-4 w-4" /> กลับ</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              ยืนยันการเบิกอะไหล่
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4 text-primary"/> 1. ข้อมูลลูกค้า</CardTitle></CardHeader>
              <CardContent>
                <FormField name="customerId" control={form.control} render={({ field }) => (
                  <FormItem>
                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? customers.find(c => c.id === field.value)?.name : "ค้นหาชื่อลูกค้า..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <div className="p-2 border-b"><Input placeholder="พิมพ์ชื่อเพื่อค้นหา..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} /></div>
                        <ScrollArea className="h-60">
                          {customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase())).map(c => (
                            <Button key={c.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b last:border-0 rounded-none text-left" onClick={() => { field.onChange(c.id); setIsCustomerPopoverOpen(false); form.setValue("refId", ""); }}>
                              <div className="flex flex-col"><span className="font-medium">{c.name}</span><span className="text-xs text-muted-foreground">{c.phone}</span></div>
                            </Button>
                          ))}
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary"/> 2. อ้างอิงรายการ</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <FormField name="refType" control={form.control} render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทการเบิก</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); form.setValue("refId", ""); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="JOB">งานซ่อม (Job)</SelectItem>
                        <SelectItem value="SALES_DOC">บิลขาย (DN/TI)</SelectItem>
                        <SelectItem value="LOAN">ยืมอะไหล่</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                {watchedCustomerId && (
                  <FormField name="refId" control={form.control} render={({ field }) => (
                    <FormItem className="animate-in fade-in slide-in-from-top-1">
                      <FormLabel>เลือกรายการอ้างอิง</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {watchedRefType === 'JOB' && filteredJobs.map(j => <SelectItem key={j.id} value={j.id}>Job: {j.id.slice(0,8)} - {j.description.slice(0,20)}...</SelectItem>)}
                          {watchedRefType === 'SALES_DOC' && filteredSalesDocs.map(d => <SelectItem key={d.id} value={d.id}>{d.docNo} ({d.grandTotal.toLocaleString()}.-)</SelectItem>)}
                          {watchedRefType === 'LOAN' && <SelectItem value="MANUAL_LOAN">ระบุมือ (ยืมของ)</SelectItem>}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4 text-primary"/> 3. รายการอะไหล่ที่เบิก</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-md overflow-hidden">
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
                              <PopoverTrigger asChild><Button variant="outline" size="icon" onClick={() => setActivePartSearchIdx(index)}><Search className="h-4 w-4" /></Button></PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="start">
                                <div className="p-2 border-b"><Input placeholder="ค้นหาอะไหล่..." value={partSearch} onChange={e => setPartSearch(e.target.value)} /></div>
                                <ScrollArea className="h-64">
                                  {parts.filter(p => p.name.toLowerCase().includes(partSearch.toLowerCase()) || p.code.toLowerCase().includes(partSearch.toLowerCase())).map(p => (
                                    <Button key={p.id} variant="ghost" className="w-full justify-start h-auto py-2 px-3 border-b text-left" onClick={() => handleSelectPart(index, p)}>
                                      <div className="flex flex-col"><p className="font-bold text-sm">{p.code}</p><p className="text-xs">{p.name}</p><p className="text-[10px] text-primary">คงเหลือ: {p.stockQty}</p></div>
                                    </Button>
                                  ))}
                                </ScrollArea>
                              </PopoverContent>
                            </Popover>
                            <Button variant="outline" size="icon" onClick={() => startScanner(index)}><ScanBarcode className="h-4 w-4" /></Button>
                            <Input readOnly placeholder="คลิกแว่นขยายเพื่อเลือกอะไหล่..." value={form.watch(`items.${index}.name`) || ""} className="bg-muted/30 cursor-not-allowed" />
                          </div>
                          {form.watch(`items.${index}.code`) && <p className="text-[10px] font-mono text-primary mt-1 ml-20">รหัส: {form.watch(`items.${index}.code`)}</p>}
                        </TableCell>
                        <TableCell className="text-right font-bold text-muted-foreground">{form.watch(`items.${index}.stockQty`) ?? "-"}</TableCell>
                        <TableCell><FormField name={`items.${index}.quantity`} control={form.control} render={({ field }) => (<Input type="number" step="any" className="text-right" {...field} />)} /></TableCell>
                        <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ partId: "", quantity: 1, name: "", code: "", stockQty: 0 })} disabled={isSubmitting || fields.length >= 50}><PlusCircle className="mr-2 h-4 w-4" /> เพิ่มรายการ</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">4. หมายเหตุเพิ่มเติม</CardTitle></CardHeader>
            <CardContent>
              <FormField name="notes" control={form.control} render={({ field }) => (<Textarea placeholder="เช่น เบิกให้ช่างตู่, ใช้ประกอบเครื่องยนต์ Revo..." {...field} />)} />
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
    </div>
  );
}