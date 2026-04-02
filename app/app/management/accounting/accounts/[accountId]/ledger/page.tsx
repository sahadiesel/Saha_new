"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, collection, query, where, getDocs, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useFirebase, type WithId } from "@/firebase";
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { DateRange } from "react-day-picker";
import { format, parseISO, startOfDay, startOfMonth, endOfMonth, isBefore, isValid } from 'date-fns';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Loader2, Search, ArrowLeft, CalendarIcon, ShieldAlert, ListTree, CalendarDays, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from '@/lib/utils';
import { safeFormat, APP_DATE_FORMAT, normalizeGregorianDateOnlyString } from '@/lib/date-utils';
import type { AccountingAccount, AccountingEntry, AccountingCheckItem } from '@/lib/types';
import {
    computeCashAccountCurrentBalance,
    entryIncomeExpense,
    normalizeAccountingEntriesForComputation,
    roundMoney,
} from '@/lib/accounting-balance';
import { validateAccountingEntryDateAdminCorrection } from "@/lib/accounting-entry-date";

const formatCurrency = (value: number) => {
    return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

type HiddenLedgerRow = {
    id: string;
    entryDate: string;
    description: string;
    sourceDocNo: string;
    income: number;
    expense: number;
};

export default function AccountLedgerPage() {
    const { db } = useFirebase();
    const { profile } = useAuth();
    const { toast } = useToast();
    const params = useParams();
    const router = useRouter();
    const accountId = params.accountId as string;

    const [account, setAccount] = useState<WithId<AccountingAccount> | null>(null);
    const [entries, setEntries] = useState<WithId<AccountingEntry>[]>([]);
    /** ค่าเริ่มต้น: เดือนปัจจุบัน (ครบทั้งเดือน) — ใช้ปุ่มล้างช่วงเพื่อดูทุกช่วงเวลา */
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const now = new Date();
        return { from: startOfMonth(now), to: endOfMonth(now) };
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingChecks, setPendingChecks] = useState<WithId<AccountingCheckItem>[]>([]);
    const [hiddenLedgerDialogOpen, setHiddenLedgerDialogOpen] = useState(false);
    const [entryDateFixTarget, setEntryDateFixTarget] = useState<HiddenLedgerRow | null>(null);
    const [fixEntryDateValue, setFixEntryDateValue] = useState("");
    const [fixEntryDateSaving, setFixEntryDateSaving] = useState(false);

    const hasPermission = useMemo(() => {
        if (!profile) return false;
        return (profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'ACCOUNTING_HR') && profile.role !== 'WORKER';
    }, [profile]);

    /** แก้ entryDate ของรายการเดินบัญชี — จำกัด Admin/Manager เพื่อลดความเสี่ยงข้อมูล */
    const canCorrectEntryDate = useMemo(() => {
        return profile?.role === "ADMIN" || profile?.role === "MANAGER";
    }, [profile]);

    const refreshAccountEntries = useCallback(async () => {
        if (!db || !accountId) return;
        const entriesQuery = query(collection(db, "accountingEntries"), where("accountId", "==", accountId));
        const entriesSnap = await getDocs(entriesQuery);
        setEntries(entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingEntry>)));
    }, [db, accountId]);

    useEffect(() => {
        if (!db || !accountId || !hasPermission) {
            if (!hasPermission) setLoading(false);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const entriesQuery = query(collection(db, 'accountingEntries'), where('accountId', '==', accountId));
                const accountDocRef = doc(db, 'accountingAccounts', accountId);

                const [accountSnap, entriesSnap] = await Promise.all([
                    getDoc(accountDocRef),
                    getDocs(entriesQuery),
                ]);

                if (!accountSnap.exists()) {
                    throw new Error("ไม่พบบัญชีที่ระบุ");
                }
                setAccount({ id: accountSnap.id, ...accountSnap.data() } as WithId<AccountingAccount>);
                
                const entriesData = entriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<AccountingEntry>));
                setEntries(entriesData);

            } catch (e: any) {
                console.error("Failed to load ledger data:", e);
                setError("ไม่สามารถโหลดข้อมูลบัญชีได้ หรือคุณไม่มีสิทธิ์เข้าถึง");
                toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: e.message || 'ไม่สามารถโหลดข้อมูลได้' });
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [db, accountId, toast, hasPermission]);

    useEffect(() => {
        if (!entryDateFixTarget) {
            setFixEntryDateValue("");
            return;
        }
        const norm = normalizeGregorianDateOnlyString(entryDateFixTarget.entryDate);
        setFixEntryDateValue(/^\d{4}-\d{2}-\d{2}$/.test(norm) ? norm : format(new Date(), "yyyy-MM-dd"));
    }, [entryDateFixTarget]);

    const handleSaveCorrectedEntryDate = async () => {
        if (!db || !entryDateFixTarget || !fixEntryDateValue.trim()) return;
        const vd = validateAccountingEntryDateAdminCorrection(fixEntryDateValue);
        if (!vd.ok) {
            toast({ variant: "destructive", title: "วันที่ไม่ถูกต้อง", description: vd.message });
            return;
        }
        const ymd = vd.normalized;
        setFixEntryDateSaving(true);
        try {
            await updateDoc(doc(db, "accountingEntries", entryDateFixTarget.id), {
                entryDate: ymd,
                updatedAt: serverTimestamp(),
            });
            await refreshAccountEntries();
            toast({ title: "อัปเดตวันที่รายการแล้ว", description: `บันทึกเป็น ${safeFormat(parseISO(ymd), APP_DATE_FORMAT)}` });
            setEntryDateFixTarget(null);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: msg });
        } finally {
            setFixEntryDateSaving(false);
        }
    };

    useEffect(() => {
        if (!db || !accountId || !hasPermission) return;
        const q = query(collection(db, "accountingCheckItems"), where("accountId", "==", accountId));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const list = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingCheckItem>))
                    .filter((c) => c.status === "PENDING");
                setPendingChecks(list);
            },
            () => setPendingChecks([])
        );
        return () => unsub();
    }, [db, accountId, hasPermission]);

    const receiveChecksPending = useMemo(() => {
        return [...pendingChecks.filter((i) => i.direction === "RECEIVE")].sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate)
        );
    }, [pendingChecks]);

    const payChecksPending = useMemo(() => {
        return [...pendingChecks.filter((i) => i.direction === "PAY")].sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate)
        );
    }, [pendingChecks]);

    const checkDueLabel = (due: string) =>
        safeFormat(parseISO(normalizeGregorianDateOnlyString(due)), APP_DATE_FORMAT);

    const checkIsOverdue = (due: string) =>
        isBefore(parseISO(normalizeGregorianDateOnlyString(due)), startOfDay(new Date()));

    const processedData = useMemo(() => {
        if (!account)
            return {
                items: [],
                displayRows: [],
                showBridge: false,
                bridgeDateLabel: "—",
                totals: { totalIncome: 0, totalExpense: 0 },
                periodStartingBalance: 0,
                listPageBalance: 0,
                hiddenLedgerEntries: [] as { id: string; entryDate: string; description: string; sourceDocNo: string; income: number; expense: number }[],
            };
    
        // 1. แปลงปี พ.ศ. ในสตริงวันที่เป็น ค.ศ. ก่อนเรียง/กรอง (กันข้อมูลเก่าปนใน DB)
        const entriesNorm = normalizeAccountingEntriesForComputation(entries);
        const sortedAllEntries = [...entriesNorm].sort((a, b) => {
            const dateA = parseISO(a.entryDate).getTime();
            const dateB = parseISO(b.entryDate).getTime();
            if (dateA !== dateB) return dateA - dateB;
            const timeA = (a as any).createdAt?.toMillis?.() || 0;
            const timeB = (b as any).createdAt?.toMillis?.() || 0;
            return timeA - timeB;
        });

        const openingBalanceDateStr = normalizeGregorianDateOnlyString(account.openingBalanceDate || "1970-01-01");
        const openingBalanceValue = Number(account.openingBalance ?? 0);
        
        // 2. Calculate balance for every transaction relative to Opening Balance anchor
        const preOpening = sortedAllEntries.filter(e => e.entryDate < openingBalanceDateStr);
        const postOpening = sortedAllEntries.filter(e => e.entryDate >= openingBalanceDateStr);
        
        // Items AFTER opening balance date
        let currentBalance = openingBalanceValue;
        const processedPost = postOpening.map((entry) => {
            const { income, expense } = entryIncomeExpense(entry);
            currentBalance = roundMoney(currentBalance + income - expense);
            return { ...entry, income, expense, balance: currentBalance };
        });

        let backBalance = openingBalanceValue;
        const processedPre = [...preOpening].reverse().map((entry) => {
            const { income, expense } = entryIncomeExpense(entry);
            const itemBalance = backBalance;
            backBalance = roundMoney(backBalance - (income - expense));
            return { ...entry, income, expense, balance: itemBalance };
        }).reverse();
        
        const allProcessed = [...processedPre, ...processedPost];
        
        // 3. Filter for visibility based on user range and search
        const visibleItems = allProcessed.filter((entry) => {
            if (dateRange?.from && dateRange?.to) {
                const entryKey = normalizeGregorianDateOnlyString(entry.entryDate);
                const fromKey = format(startOfDay(dateRange.from), "yyyy-MM-dd");
                const toKey = format(startOfDay(dateRange.to), "yyyy-MM-dd");
                if (!(entryKey >= fromKey && entryKey <= toKey)) return false;
            }
    
            if (searchTerm.trim()) {
                const raw = searchTerm.trim();
                const lowerSearch = raw.toLowerCase();
                const compactNum = raw.replace(/[, ]/g, "");
                const dateNorm = normalizeGregorianDateOnlyString(entry.entryDate);
                let dateDisplay = "";
                try {
                    dateDisplay = safeFormat(parseISO(dateNorm), APP_DATE_FORMAT);
                } catch {
                    /* ignore */
                }
                const e = entry as AccountingEntry & { notes?: string };
                const textFields = [
                    e.sourceDocNo,
                    e.description,
                    e.customerNameSnapshot,
                    e.vendorNameSnapshot,
                    e.vendorShortNameSnapshot,
                    e.counterpartyNameSnapshot,
                    e.categoryMain,
                    e.categorySub,
                    e.notes,
                    e.entryDate,
                    dateDisplay,
                ];
                const textMatch = textFields.some((f) => f && String(f).toLowerCase().includes(lowerSearch));
                const amt = Number(e.amount ?? 0);
                const amountMatch =
                    compactNum.length > 0 &&
                    (String(amt).includes(compactNum) ||
                        amt
                            .toLocaleString("th-TH", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            })
                            .replace(/\s/g, "")
                            .includes(compactNum));
                if (!textMatch && !amountMatch) return false;
            }
            return true;
        });

        const visibleIdSet = new Set(visibleItems.map((v) => v.id));
        const notShownEntries = allProcessed.filter((e) => !visibleIdSet.has(e.id));
        
        // 4. Summaries
        const totalIncome = visibleItems.reduce((sum, i) => sum + i.income, 0);
        const totalExpense = visibleItems.reduce((sum, i) => sum + i.expense, 0);

        // ยอดก่อนรายการแรกที่แสดง (= ยอดยกมาของช่วงนี้ในแบบเดียวกับตัวอย่าง: ยกมา 1000 + เข้า 200 − ออก 100 = 1100)
        let periodStartingBalance = openingBalanceValue;
        if (visibleItems.length > 0) {
            const first = visibleItems[0];
            periodStartingBalance = Math.round((first.balance - (first.income - first.expense)) * 100) / 100;
        } else if (dateRange?.from) {
            const fromStr = format(dateRange.from, 'yyyy-MM-dd');
            const firstInRangeIdx = allProcessed.findIndex(item => item.entryDate >= fromStr);
            if (firstInRangeIdx !== -1) {
                const firstItem = allProcessed[firstInRangeIdx];
                periodStartingBalance = Math.round((firstItem.balance - (firstItem.income - firstItem.expense)) * 100) / 100;
            } else if (allProcessed.length > 0 && allProcessed[allProcessed.length - 1].entryDate < fromStr) {
                periodStartingBalance = allProcessed[allProcessed.length - 1].balance;
            }
        }

        const listPageBalance = computeCashAccountCurrentBalance(account, entries);

        const tailAfterVisible =
            visibleItems.length > 0 ? visibleItems[visibleItems.length - 1].balance : periodStartingBalance;
        const gapToCurrent = roundMoney(listPageBalance - tailAfterVisible);
        const showBridge = Math.abs(gapToCurrent) >= 0.01;
        const bridgeIncome = gapToCurrent > 0 ? gapToCurrent : 0;
        const bridgeExpense = gapToCurrent < 0 ? -gapToCurrent : 0;

        let bridgeDateLabel = "—";
        if (showBridge && notShownEntries.length > 0) {
            const dSorted = notShownEntries.map((e) => e.entryDate).sort();
            const d0 = dSorted[0];
            const d1 = dSorted[dSorted.length - 1];
            const f0 = safeFormat(parseISO(d0), APP_DATE_FORMAT);
            const f1 = safeFormat(parseISO(d1), APP_DATE_FORMAT);
            bridgeDateLabel = d0 === d1 ? f0 : `${f0} – ${f1}`;
        }

        const hiddenCount = notShownEntries.length;
        const hiddenCountSuffix = hiddenCount > 0 ? ` (${hiddenCount} รายการ)` : "";

        const bridgeRow = showBridge
            ? ({
                  id: "__ledger_reconcile__",
                  entryDate: "",
                  description: searchTerm.trim()
                      ? `สรุปส่วนต่าง (รายการในตารางไม่ครบทุกรายการ — ล้างช่องค้นหาหรือขยายช่วงวันที่เพื่อดูรายการทั้งหมด)${hiddenCountSuffix}`
                      : `สรุปรายการที่ไม่ได้แสดงในตารางด้านบน (นอกช่วงวันที่ / หลังรายการสุดท้ายในช่วง — ให้ยอดสุดท้ายตรงยอดคงเหลือปัจจุบัน)${hiddenCountSuffix}`,
                  sourceDocNo: "—",
                  income: bridgeIncome,
                  expense: bridgeExpense,
                  balance: listPageBalance,
              } as (typeof visibleItems)[number] & { id: string })
            : null;

        const displayRows = bridgeRow ? [...visibleItems, bridgeRow] : visibleItems;

        const totalIncomeWithBridge = roundMoney(totalIncome + bridgeIncome);
        const totalExpenseWithBridge = roundMoney(totalExpense + bridgeExpense);

        const hiddenLedgerEntries = [...notShownEntries]
            .sort((a, b) => {
                const da = parseISO(a.entryDate).getTime();
                const db = parseISO(b.entryDate).getTime();
                if (da !== db) return da - db;
                const timeA = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
                const timeB = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
                return timeA - timeB;
            })
            .map((e) => ({
                id: e.id,
                entryDate: e.entryDate,
                description: e.description || "—",
                sourceDocNo: e.sourceDocNo || "—",
                income: e.income,
                expense: e.expense,
            }));

        return {
            periodStartingBalance,
            items: visibleItems,
            displayRows,
            showBridge,
            bridgeDateLabel,
            listPageBalance,
            hiddenLedgerEntries,
            totals: {
                totalIncome: totalIncomeWithBridge,
                totalExpense: totalExpenseWithBridge,
            },
        };
    }, [account, entries, dateRange, searchTerm]);

    if (!profile) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    
    if (!hasPermission) {
        return (
          <div className="w-full flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <ShieldAlert className="h-16 w-16 text-destructive" />
            <Card className="max-w-md text-center">
                <CardHeader>
                    <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
                    <CardDescription>พนักงานตำแหน่งช่างไม่ได้รับอนุญาตให้ดูรายการเดินบัญชีค่ะ</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="outline" onClick={() => router.back()}>กลับ</Button>
                </CardContent>
            </Card>
          </div>
        );
    }

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (error) return <PageHeader title="เกิดข้อผิดพลาด" description={error} />;
    if (!account) return <PageHeader title="ไม่พบบัญชี" />;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> กลับ</Button>
                <div className="flex items-center gap-2">
                    <Badge variant={account.isActive ? 'default' : 'secondary'}>{account.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</Badge>
                </div>
            </div>

            <PageHeader title={account.name} description={`ประเภท: ${account.type === 'CASH' ? 'เงินสด' : 'ธนาคาร'} | เลขที่: ${account.accountNo || '-'}`} />
            
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="text-base">ยอดยกมาตั้งต้นระบบ (ยอดยกมาหลัก)</CardTitle>
                            <CardDescription>
                                {formatCurrency(account.openingBalance ?? 0)} บาท ณ{" "}
                                {account.openingBalanceDate
                                    ? safeFormat(parseISO(normalizeGregorianDateOnlyString(account.openingBalanceDate)), APP_DATE_FORMAT)
                                    : "N/A"}
                                <span className="block mt-1 text-xs">ใช้เป็นจุดอ้างอิงตอนตั้งบัญชี — ไม่ใช่ยอดยกมาของช่วงวันที่ในตาราง (แถวแรกในตารางคือยอดก่อนรายการแรกในช่วงที่เลือก)</span>
                            </CardDescription>
                            <p className="text-lg font-bold text-primary pt-2">
                                ยอดคงเหลือปัจจุบัน: {formatCurrency(processedData.listPageBalance)} บาท
                            </p>
                            <p className="text-xs text-muted-foreground max-w-xl">
                                ยอดเดียวกับหน้ารายการบัญชี (ยอดยกมาหลัก + รายการหลังวันยกมาทั้งหมด) ช่วงวันที่ใช้แค่กรองรายการในตาราง ไม่เปลี่ยนยอดคงเหลือจริง
                            </p>
                        </div>
                        <div className="flex flex-col gap-3 w-full md:max-w-xl shrink-0">
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                                "w-full sm:min-w-[260px] justify-start text-left font-normal",
                                                !dateRange && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <>
                                                        {format(dateRange.from, APP_DATE_FORMAT)} -{" "}
                                                        {format(dateRange.to, APP_DATE_FORMAT)}
                                                    </>
                                                ) : (
                                                    format(dateRange.from, APP_DATE_FORMAT)
                                                )
                                            ) : (
                                                <span>ทุกช่วงเวลา</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="end">
                                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                                    </PopoverContent>
                                </Popover>
                                {dateRange != null && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="shrink-0 w-full sm:w-auto"
                                        onClick={() => setDateRange(undefined)}
                                    >
                                        ล้างช่วง (แสดงทั้งหมด)
                                    </Button>
                                )}
                            </div>
                            <div className="relative w-full">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                <Input
                                    placeholder="ค้นหา รายการ, เลขที่อ้างอิง, วันที่ (dd/mm/yyyy หรือ yyyy-mm-dd), หมวดหมู่, ยอดเงิน..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 w-full"
                                    aria-label="ค้นหารายการในสมุดบัญชี"
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="pl-6 w-24">วันที่</TableHead>
                                <TableHead>รายการ</TableHead>
                                <TableHead>อ้างอิง</TableHead>
                                <TableHead className="text-right">เงินเข้า</TableHead>
                                <TableHead className="text-right">เงินออก</TableHead>
                                <TableHead className="text-right pr-6">คงเหลือสะสม ณ วันที่รายการ</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow className="font-semibold bg-muted/20 italic">
                                <TableCell colSpan={5} className="pl-6">ยอดยกมา (ก่อนรายการแรกในตารางนี้)</TableCell>
                                <TableCell className="text-right pr-6 text-primary">{formatCurrency(processedData.periodStartingBalance)}</TableCell>
                            </TableRow>
                            {processedData.displayRows.length > 0 ? (
                                processedData.displayRows.map((item) => {
                                    const isBridge = item.id === "__ledger_reconcile__";
                                    return (
                                        <TableRow
                                            key={item.id}
                                            className={cn(
                                                "hover:bg-muted/10",
                                                isBridge && "bg-muted/40 border-t border-dashed"
                                            )}
                                        >
                                            <TableCell className="pl-6 text-muted-foreground text-xs whitespace-normal min-w-[7rem]">
                                                {isBridge
                                                    ? processedData.bridgeDateLabel
                                                    : safeFormat(parseISO(item.entryDate), APP_DATE_FORMAT)}
                                            </TableCell>
                                            <TableCell className={cn("text-sm", isBridge && "text-muted-foreground")}>
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                                    <span className={cn(isBridge && "italic")}>{item.description}</span>
                                                    {isBridge && processedData.hiddenLedgerEntries.length > 0 && (
                                                        <Button
                                                            type="button"
                                                            variant="secondary"
                                                            size="sm"
                                                            className="shrink-0 w-fit"
                                                            onClick={() => setHiddenLedgerDialogOpen(true)}
                                                        >
                                                            <ListTree className="mr-2 h-4 w-4" />
                                                            ดูรายการที่ไม่ได้แสดง ({processedData.hiddenLedgerEntries.length})
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs font-mono">{item.sourceDocNo || "-"}</TableCell>
                                            <TableCell className="text-right text-green-600 font-medium">
                                                {item.income > 0 ? formatCurrency(item.income) : ""}
                                            </TableCell>
                                            <TableCell className="text-right text-destructive font-medium">
                                                {item.expense > 0 ? formatCurrency(item.expense) : ""}
                                            </TableCell>
                                            <TableCell className="text-right pr-6 font-bold">{formatCurrency(item.balance)}</TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                        ไม่พบรายการในช่วงวันที่ที่เลือก
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                         <TableFooter>
                            <TableRow className="font-bold text-base bg-muted/30">
                                <TableCell colSpan={3} className="pl-6">
                                    รวมเงินเข้า–ออก (รวมแถวสรุปส่วนต่างถ้ามี)
                                </TableCell>
                                <TableCell className="text-right text-green-700">{formatCurrency(processedData.totals.totalIncome)}</TableCell>
                                <TableCell className="text-right text-destructive">{formatCurrency(processedData.totals.totalExpense)}</TableCell>
                                <TableCell className="text-right pr-6 text-primary">
                                    <span className="block leading-tight">{formatCurrency(processedData.listPageBalance)}</span>
                                    <span className="block text-[10px] font-normal text-muted-foreground mt-0.5">ยอดคงเหลือปัจจุบัน</span>
                                </TableCell>
                            </TableRow>
                         </TableFooter>
                    </Table>
                    <p className="px-6 py-3 text-xs text-muted-foreground border-t">
                        {processedData.showBridge
                            ? "แถวสรุปส่วนต่าง (เส้นประ) รวมผลของรายการที่ไม่อยู่ในช่วงที่เลือกหรือถูกซ่อนจากการค้นหา — หลังแถวนี้ยอดสะสมจะเท่ากับยอดคงเหลือปัจจุบัน และผลรวมเข้า/ออกด้านล่างจะตรงกับสมการ ยกมา + เข้า − ออก"
                            : "คอลัมน์คงเหลือในแต่ละแถวคือยอดสะสมหลังรายการนั้น ณ วันที่รายการ — ยอดคงเหลือปัจจุบันด้านบนและช่องสรุปคือยอดตามบัญชีทั้งหมด"}
                    </p>
                </CardContent>
            </Card>

            <Dialog open={hiddenLedgerDialogOpen} onOpenChange={setHiddenLedgerDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="p-6 pb-2 shrink-0">
                        <DialogTitle>รายการที่ไม่ได้แสดงในตารางสมุด</DialogTitle>
                        <DialogDescription>
                            รายการนี้อยู่นอกช่วงที่เลือกในปฏิทิน (เช่น เลือกเฉพาะมี.ค. แต่รายการเป็น ม.ค.–ก.พ.) หรือถูกซ่อนจากช่องค้นหา
                            — ล้างช่วงวันที่หรือขยายช่วงเพื่อให้รายการแสดงในตารางหลักโดยไม่ต้องแก้ข้อมูล
                            {canCorrectEntryDate
                                ? " — «แก้วันที่» ปรับเฉพาะวันที่ในสมุดบัญชี ไม่แก้วันที่บิลขาย"
                                : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[6.5rem]">วันที่ (entryDate)</TableHead>
                                    <TableHead>รายการ</TableHead>
                                    <TableHead className="w-28">อ้างอิง</TableHead>
                                    <TableHead className="text-right w-24">เข้า</TableHead>
                                    <TableHead className="text-right w-24">ออก</TableHead>
                                    <TableHead className="w-[7.5rem] text-center">ปรับวันที่</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {processedData.hiddenLedgerEntries.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="text-xs font-mono align-top whitespace-nowrap">
                                            {safeFormat(
                                                parseISO(normalizeGregorianDateOnlyString(row.entryDate)),
                                                APP_DATE_FORMAT
                                            )}
                                            <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">
                                                {row.entryDate}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm align-top max-w-[220px] break-words">
                                            {row.description}
                                        </TableCell>
                                        <TableCell className="text-xs font-mono align-top">{row.sourceDocNo}</TableCell>
                                        <TableCell className="text-right text-green-600 text-sm align-top">
                                            {row.income > 0 ? formatCurrency(row.income) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-destructive text-sm align-top">
                                            {row.expense > 0 ? formatCurrency(row.expense) : "—"}
                                        </TableCell>
                                        <TableCell className="align-top text-center">
                                            {canCorrectEntryDate ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 text-xs"
                                                    onClick={() => setEntryDateFixTarget(row)}
                                                >
                                                    <Pencil className="h-3 w-3 mr-1 shrink-0" />
                                                    แก้วันที่
                                                </Button>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!entryDateFixTarget}
                onOpenChange={(open) => {
                    if (!open) setEntryDateFixTarget(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>แก้วันที่รายการเดินบัญชี</DialogTitle>
                        <DialogDescription className="space-y-2">
                            <span>
                                ปรับเฉพาะ <strong className="text-foreground">วันที่ทำรายการในสมุดบัญชี</strong> (วันที่ตัดเงินเข้า–ออกบัญชีนี้)
                                เพื่อให้ยอดคงเหลือและช่วงวันที่ในตารางสมุดถูกต้อง
                            </span>
                            <span className="block text-amber-800 dark:text-amber-200/90">
                                ไม่แก้วันที่ออกบิลขายหรือวันที่บนใบกำกับ/ใบส่งของ — เอกสารขายในระบบยังเป็นวันเดิม จึงไม่กระทบลำดับเลขที่หรือรายงานภาษีตามวันที่บิล
                            </span>
                            <span className="block">
                                รูปแบบบันทึก: <span className="font-mono">yyyy-mm-dd</span> (ค.ศ.) แสดงในตารางเป็น {APP_DATE_FORMAT}
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    {entryDateFixTarget ? (
                        <div className="space-y-4 py-2">
                            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                                <p className="font-medium line-clamp-3">{entryDateFixTarget.description}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                    อ้างอิง: {entryDateFixTarget.sourceDocNo} · id: {entryDateFixTarget.id.slice(0, 8)}…
                                </p>
                                <p className="text-xs">
                                    วันที่เดิมใน DB:{" "}
                                    <span className="font-mono">{entryDateFixTarget.entryDate}</span>
                                </p>
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-medium">วันที่ที่ถูกต้อง (ค.ศ.)</p>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !fixEntryDateValue && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarDays className="mr-2 h-4 w-4 shrink-0" />
                                            {fixEntryDateValue && isValid(parseISO(fixEntryDateValue))
                                                ? safeFormat(parseISO(fixEntryDateValue), APP_DATE_FORMAT)
                                                : "เลือกวันที่"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={
                                                fixEntryDateValue && isValid(parseISO(fixEntryDateValue))
                                                    ? parseISO(fixEntryDateValue)
                                                    : undefined
                                            }
                                            onSelect={(d) =>
                                                setFixEntryDateValue(d ? format(d, "yyyy-MM-dd") : "")
                                            }
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <Input
                                    className="font-mono text-sm"
                                    value={fixEntryDateValue}
                                    onChange={(e) => setFixEntryDateValue(e.target.value.trim())}
                                    placeholder="yyyy-MM-dd"
                                    spellCheck={false}
                                />
                            </div>
                        </div>
                    ) : null}
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEntryDateFixTarget(null)}
                            disabled={fixEntryDateSaving}
                        >
                            ยกเลิก
                        </Button>
                        <Button type="button" onClick={handleSaveCorrectedEntryDate} disabled={fixEntryDateSaving}>
                            {fixEntryDateSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    กำลังบันทึก…
                                </>
                            ) : (
                                "บันทึกวันที่"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">เช็คที่รอรับ / รอจ่าย (บัญชีนี้)</CardTitle>
                    <CardDescription>
                        รายการเดียวกับแท็บ «เช็ค» ในหน้าบัญชีเงินสด/ธนาคาร — ยังไม่ตัดยอดในตารางด้านบนจนกว่าจะกดยืนยันรับหรือจ่ายที่นั่น
                        <Link
                            href="/app/management/accounting/accounts?tab=checks"
                            className="block mt-1 text-primary underline-offset-4 hover:underline"
                        >
                            ไปยืนยันเช็ค
                        </Link>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 p-0">
                    <div>
                        <p className="px-6 pt-3 pb-2 text-sm font-medium text-muted-foreground">เช็ครับ (รอขึ้นเงิน)</p>
                        <div className="overflow-x-auto border-t">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead className="pl-6 w-28">ครบกำหนด</TableHead>
                                        <TableHead className="text-right">ยอดคาดรับ</TableHead>
                                        <TableHead>อ้างอิง</TableHead>
                                        <TableHead className="pr-6">สถานะ</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {receiveChecksPending.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="pl-6 py-8 text-center text-muted-foreground">
                                                ไม่มีเช็ครับค้างสำหรับบัญชีนี้
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        receiveChecksPending.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="pl-6">{checkDueLabel(row.dueDate)}</TableCell>
                                                <TableCell className="text-right font-medium text-green-600">
                                                    {formatCurrency(row.amount)}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground max-w-[240px]">
                                                    {row.receiptDocNo || row.notes || "—"}
                                                </TableCell>
                                                <TableCell className="pr-6">
                                                    {checkIsOverdue(row.dueDate) ? (
                                                        <Badge variant="destructive">เกินกำหนด</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">รอดำเนินการ</Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                    <div>
                        <p className="px-6 pt-3 pb-2 text-sm font-medium text-muted-foreground">เช็คจ่าย (รอตัดบัญชี)</p>
                        <div className="overflow-x-auto border-t">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead className="pl-6 w-28">ครบกำหนด</TableHead>
                                        <TableHead className="text-right">ยอดคาดจ่าย</TableHead>
                                        <TableHead>เจ้าหนี้ / หมายเหตุ</TableHead>
                                        <TableHead className="pr-6">สถานะ</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {payChecksPending.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="pl-6 py-8 text-center text-muted-foreground">
                                                ไม่มีเช็คจ่ายค้างสำหรับบัญชีนี้
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        payChecksPending.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="pl-6">{checkDueLabel(row.dueDate)}</TableCell>
                                                <TableCell className="text-right font-medium text-destructive">
                                                    {formatCurrency(row.amount)}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground max-w-[240px]">
                                                    {row.vendorNameSnapshot || row.notes || "—"}
                                                </TableCell>
                                                <TableCell className="pr-6">
                                                    {checkIsOverdue(row.dueDate) ? (
                                                        <Badge variant="destructive">เกินกำหนด</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">รอดำเนินการ</Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
