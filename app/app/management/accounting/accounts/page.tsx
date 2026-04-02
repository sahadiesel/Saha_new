
"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, writeBatch, where } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { AccountingChecksTab } from "@/components/accounting/accounting-checks-tab";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Search, MoreHorizontal, Edit, ToggleLeft, ToggleRight, BookOpen, ShieldAlert, ArrowRightLeft, Save, AlertCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountingAccount, AccountingEntry } from "@/lib/types";
import { computeCashAccountCurrentBalance } from "@/lib/accounting-balance";
import { validateAccountingEntryDate } from "@/lib/accounting-entry-date";
import type { WithId } from "@/firebase/index";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

// --- Transfer Schema ---
const transferSchema = z.object({
  fromAccountId: z.string().min(1, "กรุณาเลือกบัญชีต้นทาง"),
  toAccountId: z.string().min(1, "กรุณาเลือกบัญชีปลายทาง"),
  amount: z.coerce.number().min(0.01, "จำนวนเงินต้องมากกว่า 0"),
  transferDate: z.string().min(1, "กรุณาเลือกวันที่"),
  notes: z.string().optional(),
}).refine(data => data.fromAccountId !== data.toAccountId, {
  message: "บัญชีต้นทางและปลายทางต้องไม่เป็นบัญชีเดียวกัน",
  path: ["toAccountId"],
});

type TransferFormData = z.infer<typeof transferSchema>;

function ManagementAccountingAccountsPageContent() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") === "checks" ? "checks" : "cash";
  const { db } = useFirebase();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [entries, setEntries] = useState<WithId<AccountingEntry>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [accountToAction, setAccountToAction] = useState<WithId<AccountingAccount> | null>(null);
  const [isDeactivateAlertOpen, setIsDeactivateAlertOpen] = useState(false);
  
  // Transfer State
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  const transferForm = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      transferDate: format(new Date(), 'yyyy-MM-dd'),
      amount: 0,
      notes: "",
    },
  });

  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return (profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'ACCOUNTING_HR') && profile.role !== 'WORKER';
  }, [profile]);

  useEffect(() => {
    if (!db || !hasPermission) {
      if (!hasPermission && !authLoading) setLoading(false);
      return;
    }
    setLoading(true);

    // 1. Listen to Accounts
    const unsubAccounts = onSnapshot(query(collection(db, "accountingAccounts"), orderBy("createdAt", "desc")), (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<AccountingAccount>)));
    }, (error: any) => {
      if (error.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'accountingAccounts', operation: 'list' }));
      }
    });

    // 2. Listen to Entries for Balance Calculation
    const unsubEntries = onSnapshot(query(collection(db, "accountingEntries")), (snapshot) => {
      setEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<AccountingEntry>)));
      setLoading(false);
    }, (error: any) => {
      console.error("Entries listener error:", error);
      setLoading(false);
    });

    return () => { unsubAccounts(); unsubEntries(); };
  }, [db, hasPermission, authLoading]);

  const accountsWithBalances = useMemo(() => {
    return accounts.map((acc) => {
      const accEntries = entries.filter((e) => e.accountId === acc.id);
      const currentBalance = computeCashAccountCurrentBalance(acc, accEntries);
      return { ...acc, currentBalance };
    });
  }, [accounts, entries]);

  const filteredAccounts = useMemo(() => {
    if (!searchTerm.trim()) return accountsWithBalances;
    const lowercasedFilter = searchTerm.toLowerCase();
    return accountsWithBalances.filter(acc =>
      acc.name.toLowerCase().includes(lowercasedFilter) ||
      (acc.accountNo && acc.accountNo.includes(searchTerm))
    );
  }, [accountsWithBalances, searchTerm]);

  const handleToggleActive = (account: WithId<AccountingAccount>) => {
    setAccountToAction(account);
    setIsDeactivateAlertOpen(true);
  };

  const confirmToggleActive = async () => {
    if (!db || !accountToAction) return;
    const accountRef = doc(db, "accountingAccounts", accountToAction.id);
    const newStatus = !accountToAction.isActive;
    const updateData = {
      isActive: newStatus,
      updatedAt: serverTimestamp()
    };

    updateDoc(accountRef, updateData)
      .then(() => {
        toast({ title: `เปลี่ยนสถานะบัญชีสำเร็จ` });
      })
      .catch(async (error: any) => {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: accountRef.path,
            operation: 'update',
            requestResourceData: updateData,
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        } else {
          toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: error.message });
        }
      })
      .finally(() => {
        setIsDeactivateAlertOpen(false);
        setAccountToAction(null);
      });
  };

  const onTransferSubmit = async (values: TransferFormData) => {
    if (!db || !profile) return;

    const fromAccount = accounts.find(a => a.id === values.fromAccountId);
    const toAccount = accounts.find(a => a.id === values.toAccountId);

    if (!fromAccount || !toAccount) {
        toast({ variant: 'destructive', title: 'ไม่พบข้อมูลบัญชี' });
        return;
    }

    const vd = validateAccountingEntryDate(values.transferDate);
    if (!vd.ok) {
        toast({ variant: "destructive", title: "วันที่โอนไม่ถูกต้อง", description: vd.message });
        return;
    }
    const transferYmd = vd.normalized;

    setIsTransferring(true);
    try {
        const batch = writeBatch(db);
        const sourceEntryRef = doc(collection(db, "accountingEntries"));
        const destEntryRef = doc(collection(db, "accountingEntries"));

        // 1. Source Account: Cash Out
        batch.set(sourceEntryRef, {
            entryType: 'CASH_OUT',
            entryDate: transferYmd,
            amount: values.amount,
            accountId: values.fromAccountId,
            paymentMethod: fromAccount.type === 'CASH' ? 'CASH' : 'TRANSFER',
            categoryMain: 'อื่นๆ/บริหาร',
            categorySub: 'เบ็ดเตล็ด',
            description: `โอนเงินไปบัญชี: ${toAccount.name}`,
            notes: values.notes || "",
            transferRefId: destEntryRef.id,
            createdAt: serverTimestamp(),
            createdByUid: profile.uid,
            createdByName: profile.displayName
        });

        // 2. Destination Account: Cash In
        batch.set(destEntryRef, {
            entryType: 'CASH_IN',
            entryDate: transferYmd,
            amount: values.amount,
            accountId: values.toAccountId,
            paymentMethod: toAccount.type === 'CASH' ? 'CASH' : 'TRANSFER',
            categoryMain: 'รายรับอื่นๆ',
            categorySub: 'รายรับเบ็ดเตล็ด',
            description: `รับโอนจากบัญชี: ${fromAccount.name}`,
            notes: values.notes || "",
            transferRefId: sourceEntryRef.id,
            createdAt: serverTimestamp(),
            createdByUid: profile.uid,
            createdByName: profile.displayName
        });

        await batch.commit();
        toast({ title: "โอนเงินสำเร็จ", description: `โอนเงินจำนวน ${values.amount.toLocaleString()} บาท เรียบร้อยแล้ว` });
        setIsTransferDialogOpen(false);
        transferForm.reset();
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'โอนเงินไม่สำเร็จ', description: e.message });
    } finally {
        setIsTransferring(false);
    }
  };

  if (authLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
  }

  if (!hasPermission) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
        <AlertCircle className="h-12 w-12 text-destructive/50" />
        <p className="text-lg">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="บัญชีเงินสด/ธนาคาร" description="จัดการและดูข้อมูลบัญชีการเงิน">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsTransferDialogOpen(true)} className="border-green-600 text-green-600 hover:bg-green-50">
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            โอนเงินระหว่างบัญชี
          </Button>
          <Button asChild>
            <Link href="/app/management/accounting/accounts/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              เพิ่มบัญชี
            </Link>
          </Button>
        </div>
      </PageHeader>

      <Tabs defaultValue={defaultTab} key={defaultTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="cash">รับ-จ่าย</TabsTrigger>
          <TabsTrigger value="checks">เช็ค</TabsTrigger>
        </TabsList>
        <TabsContent value="cash" className="mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ค้นหาจากชื่อบัญชี หรือ เลขที่บัญชี..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อบัญชี</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>ธนาคาร</TableHead>
                      <TableHead>เลขที่บัญชี</TableHead>
                      <TableHead className="text-right">ยอดคงเหลือปัจจุบัน</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="mx-auto animate-spin" /></TableCell></TableRow>
                    ) : filteredAccounts.length > 0 ? (
                      filteredAccounts.map(account => (
                        <TableRow key={account.id}>
                          <TableCell className="font-medium">{account.name}</TableCell>
                          <TableCell>{account.type}</TableCell>
                          <TableCell>{account.bankName || '-'}</TableCell>
                          <TableCell>{account.accountNo || '-'}</TableCell>
                          <TableCell className="text-right font-bold text-primary">{(account.currentBalance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell>
                            <Badge variant={account.isActive ? 'default' : 'secondary'}>{account.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild><Link href={`/app/management/accounting/accounts/${account.id}/ledger`}><BookOpen className="mr-2 h-4 w-4"/> ดูรายการเข้า-ออก</Link></DropdownMenuItem>
                                <DropdownMenuItem asChild><Link href={`/app/management/accounting/accounts/${account.id}`}><Edit className="mr-2 h-4 w-4"/> แก้ไข</Link></DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleActive(account)}>
                                  {account.isActive ? <ToggleLeft className="mr-2 h-4 w-4"/> : <ToggleRight className="mr-2 h-4 w-4"/>}
                                  {account.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center">ยังไม่มีบัญชี กรุณากด ‘เพิ่มบัญชี’</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="checks" className="mt-4">
          <AccountingChecksTab db={db} accounts={accounts} profile={profile} />
        </TabsContent>
      </Tabs>

      {/* Transfer Dialog */}
      <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>โอนเงินระหว่างบัญชี</DialogTitle>
            <DialogDescription>บันทึกการโยกย้ายเงินจากบัญชีหนึ่งไปอีกบัญชีหนึ่ง เช่น ฝากเงินสดเข้าธนาคาร</DialogDescription>
          </DialogHeader>
          <Form {...transferForm}>
            <form onSubmit={transferForm.handleSubmit(onTransferSubmit)} className="space-y-4 py-4">
              <FormField control={transferForm.control} name="transferDate" render={({ field }) => (
                <FormItem><FormLabel>วันที่โอน</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              
              <div className="grid grid-cols-1 gap-4">
                <FormField control={transferForm.control} name="fromAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>โอนจากบัญชี (ต้นทาง)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีต้นทาง..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {accounts.filter(a => a.isActive).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-center -my-2">
                    <ArrowRightLeft className="h-4 w-4 text-muted-foreground rotate-90" />
                </div>

                <FormField control={transferForm.control} name="toAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ไปที่บัญชี (ปลายทาง)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีปลายทาง..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {accounts.filter(a => a.isActive).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={transferForm.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>จำนวนเงิน (บาท)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} className="text-lg font-bold" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={transferForm.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field} placeholder="ระบุเหตุผล เช่น ฝากเงินสดประจำวัน" /></FormControl><FormMessage /></FormItem>
              )} />

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsTransferDialogOpen(false)} disabled={isTransferring}>ยกเลิก</Button>
                <Button type="submit" disabled={isTransferring}>
                  {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  ยืนยันการโอนเงิน
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeactivateAlertOpen} onOpenChange={setIsDeactivateAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการเปลี่ยนสถานะ</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการ {accountToAction?.isActive ? "ปิด" : "เปิด"} ใช้งานบัญชี "{accountToAction?.name}" ใช่หรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggleActive}>ยืนยัน</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ManagementAccountingAccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-64">
          <Loader2 className="animate-spin h-10 w-10 text-primary" />
        </div>
      }
    >
      <ManagementAccountingAccountsPageContent />
    </Suspense>
  );
}
