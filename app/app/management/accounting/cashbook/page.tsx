"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  doc, 
  deleteDoc, 
  serverTimestamp, 
  Timestamp,
  limit,
  type FirestoreError
} from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval, subMonths, addMonths } from "date-fns";

import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { ACCOUNTING_CATEGORIES } from "@/lib/constants";
import type { AccountingAccount, AccountingEntry } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage, 
  FormDescription 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, PlusCircle, Search, CalendarIcon, 
  ArrowDownCircle, ArrowUpCircle, Trash2, 
  ChevronLeft, ChevronRight, Filter, AlertCircle, FileText, Wallet, Save, ExternalLink
} from "lucide-react";
import { safeFormat } from "@/lib/date-utils";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const entrySchema = z.object({
  entryType: z.enum(["CASH_IN", "CASH_OUT"]),
  entryDate: z.string().min(1, "กรุณาเลือกวันที่"),
  amount: z.coerce.number().min(0.01, "ยอดเงินต้องมากกว่า 0"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  categoryMain: z.string().min(1, "กรุณาเลือกหมวดหมู่หลัก"),
  categorySub: z.string().min(1, "กรุณาเลือกหมวดหมู่ย่อย"),
  description: z.string().min(1, "กรุณาระบุรายละเอียด"),
});

type EntryFormData = z.infer<typeof entrySchema>;

const formatCurrency = (value: number) => {
  return (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export default function CashbookPage() {
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [entries, setEntries] = useState<WithId<AccountingEntry>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("ALL");
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<WithId<AccountingEntry> | null>(null);
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);

  const form = useForm<EntryFormData>({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      entryType: "CASH_IN",
      entryDate: format(new Date(), "yyyy-MM-dd"),
      amount: 0,
      description: "",
    },
  });

  const watchedType = form.watch("entryType");
  const watchedMainCat = form.watch("categoryMain");

  // Filter Categories based on Type
  const mainCategories = useMemo(() => {
    return watchedType === "CASH_IN" 
      ? Object.keys(ACCOUNTING_CATEGORIES.INCOME) 
      : Object.keys(ACCOUNTING_CATEGORIES.EXPENSE);
  }, [watchedType]);

  const subCategories = useMemo(() => {
    if (!watchedMainCat) return [];
    const source = watchedType === "CASH_IN" ? ACCOUNTING_CATEGORIES.INCOME : ACCOUNTING_CATEGORIES.EXPENSE;
    return (source as any)[watchedMainCat] || [];
  }, [watchedType, watchedMainCat]);

  // Permissions Check
  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'OFFICE';
  }, [profile]);

  useEffect(() => {
    if (!db || !hasPermission) return;

    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const startStr = format(start, "yyyy-MM-dd");
    const endStr = format(end, "yyyy-MM-dd");

    setLoading(true);
    setIndexErrorUrl(null);

    // Snapshot listener for entries
    const entriesQuery = query(
      collection(db, "accountingEntries"),
      where("entryDate", ">=", startStr),
      where("entryDate", "<=", endStr),
      orderBy("entryDate", "desc"),
      orderBy("createdAt", "desc")
    );

    const unsubEntries = onSnapshot(entriesQuery, {
      next: (snap) => {
        setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingEntry>)));
        setLoading(false);
      },
      error: (err: FirestoreError) => {
        console.error("Firestore Error in Cashbook:", err);
        if (err.message?.includes("requires an index")) {
          const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
          if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        setLoading(false);
      }
    });

    // Snapshot listener for active accounts
    const accountsQuery = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
    const unsubAccounts = onSnapshot(accountsQuery, (snap) => {
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>)));
    });

    return () => { 
      unsubEntries(); 
      unsubAccounts(); 
    };
  }, [db, currentMonth, hasPermission]);

  const summary = useMemo(() => {
    const income = entries
      .filter(e => e.entryType === 'RECEIPT' || e.entryType === 'CASH_IN')
      .reduce((sum, e) => sum + e.amount, 0);
    const expense = entries
      .filter(e => e.entryType === 'CASH_OUT')
      .reduce((sum, e) => sum + e.amount, 0);
    return { income, expense, net: income - expense };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (activeTab === "IN") result = result.filter(e => e.entryType === 'CASH_IN' || e.entryType === 'RECEIPT');
    if (activeTab === "OUT") result = result.filter(e => e.entryType === 'CASH_OUT');

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(e => 
        e.description?.toLowerCase().includes(q) || 
        e.sourceDocNo?.toLowerCase().includes(q) ||
        e.categoryMain?.toLowerCase().includes(q) ||
        e.categorySub?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [entries, activeTab, searchTerm]);

  const onSubmit = async (values: EntryFormData) => {
    if (!db || !profile) return;
    
    const account = accounts.find(a => a.id === values.accountId);
    if (!account) {
      toast({ variant: "destructive", title: "ไม่พบข้อมูลบัญชี" });
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "accountingEntries"), sanitizeForFirestore({
        ...values,
        paymentMethod: account.type === 'CASH' ? 'CASH' : 'TRANSFER',
        createdAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName,
      }));
      toast({ title: "บันทึกรายการสำเร็จ" });
      setIsAdding(false);
      form.reset({
        ...form.getValues(),
        amount: 0,
        description: "",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!db || !entryToDelete) return;
    try {
      await deleteDoc(doc(db, "accountingEntries", entryToDelete.id));
      toast({ title: "ลบรายการสำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setEntryToDelete(null);
    }
  };

  if (authLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>;

  if (!hasPermission) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
        <AlertCircle className="h-12 w-12 text-destructive/50" />
        <p className="text-lg">หน้านี้เฉพาะฝ่ายบริหารและบัญชีเท่านั้นค่ะ</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="รับ-จ่ายเงิน (Cashbook)" description="บันทึกและตรวจสอบรายการความเคลื่อนไหวทางการเงินทั้งหมด">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}><ChevronLeft /></Button>
          <span className="font-bold text-lg w-32 text-center">{format(currentMonth, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}><ChevronRight /></Button>
          <Button onClick={() => setIsAdding(true)} className="ml-4 shadow-lg bg-primary hover:bg-primary/90">
            <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มรายการใหม่
          </Button>
        </div>
      </PageHeader>

      {indexErrorUrl && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้างดัชนี (Index) สำหรับคิวรีนี้</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>ฐานข้อมูลต้องการดัชนีเพื่อจัดเรียงรายการในสมุดเงินสด กรุณากดปุ่มด้านล่างเพื่อสร้าง Index</span>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                กดเพื่อสร้าง Index (Firebase Console)
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-green-50 border-green-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700 uppercase tracking-wider">รายรับรวม</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-green-600">฿{formatCurrency(summary.income)}</div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-700 uppercase tracking-wider">รายจ่ายรวม</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-green-600">฿{formatCurrency(summary.expense)}</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase tracking-wider">ยอดสุทธิ (Net)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-black", summary.net >= 0 ? "text-primary" : "text-destructive")}>
              ฿{formatCurrency(summary.net)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
              <TabsList>
                <TabsTrigger value="ALL">ทั้งหมด</TabsTrigger>
                <TabsTrigger value="IN">รายรับ</TabsTrigger>
                <TabsTrigger value="OUT">รายจ่าย</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหารายการ..." 
                className="pl-10" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-24">วันที่</TableHead>
                  <TableHead>รายการ / หมวดหมู่</TableHead>
                  <TableHead>บัญชี</TableHead>
                  <TableHead className="text-right">รายรับ (+)</TableHead>
                  <TableHead className="text-right">รายจ่าย (-)</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                ) : filteredEntries.length > 0 ? (
                  filteredEntries.map(entry => (
                    <TableRow key={entry.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs text-muted-foreground">{safeFormat(parseISO(entry.entryDate), "dd/MM/yy")}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{entry.description}</p>
                          {entry.sourceDocId && (
                            <Badge variant="outline" className="h-4 px-1 text-[8px] border-primary/30 text-primary">AUTO</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground uppercase">{entry.categoryMain} › {entry.categorySub}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Wallet className="h-3 w-3 text-muted-foreground" />
                          {accounts.find(a => a.id === entry.accountId)?.name || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-green-600">
                        {(entry.entryType === 'CASH_IN' || entry.entryType === 'RECEIPT') ? `+${formatCurrency(entry.amount)}` : ""}
                      </TableCell>
                      <TableCell className="text-right font-bold text-red-600">
                        {entry.entryType === 'CASH_OUT' ? `-${formatCurrency(entry.amount)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setEntryToDelete(entry)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground italic">ไม่พบรายการในช่วงเวลานี้</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Entry Dialog */}
      <Dialog open={isAdding} onOpenChange={setIsAdding}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>บันทึกรายการบัญชีใหม่</DialogTitle>
            <DialogDescription>บันทึกรายรับหรือรายจ่ายเบ็ดเตล็ดเข้าสมุดเงินสด</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="entryType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภท</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); form.setValue("categoryMain", ""); form.setValue("categorySub", ""); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="CASH_IN">รายรับ (+)</SelectItem>
                        <SelectItem value="CASH_OUT">รายจ่าย (-)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="entryDate" render={({ field }) => (<FormItem><FormLabel>วันที่</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="categoryMain" render={({ field }) => (
                  <FormItem>
                    <FormLabel>หมวดหมู่หลัก</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); form.setValue("categorySub", ""); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                      <SelectContent>{mainCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="categorySub" render={({ field }) => (
                  <FormItem>
                    <FormLabel>หมวดหมู่ย่อย</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!watchedMainCat}>
                      <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                      <SelectContent>{subCategories.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="accountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>เข้า/ออกจากบัญชี</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger></FormControl>
                      <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (<FormItem><FormLabel>จำนวนเงิน (บาท)</FormLabel><FormControl><Input type="number" step="0.01" className="font-bold text-lg" {...field} /></FormControl></FormItem>)} />
              </div>

              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>คำอธิบายรายการ</FormLabel><FormControl><Input placeholder="ระบุรายละเอียด เช่น ค่าอะไหล่เบิกเงินสด, รับเงินค่าซ่อม..." {...field} /></FormControl></FormItem>)} />

              <DialogFooter className="pt-4">
                <Button variant="outline" type="button" onClick={() => setIsAdding(false)}>ยกเลิก</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  บันทึกรายการ
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!entryToDelete} onOpenChange={(o) => !o && setEntryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบรายการ?</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบรายการ "{entryToDelete?.description}" ใช่หรือไม่? หากรายการนี้ถูกสร้างโดยอัตโนมัติ การลบอาจทำให้ยอดเงินไม่ตรงกับเอกสารต้นทาง
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">ยืนยันการลบ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
