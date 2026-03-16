"use client";

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { useFirebase, type WithId } from "@/firebase";
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { DateRange } from "react-day-picker";
import { format, startOfMonth, endOfMonth, isBefore, parseISO, isAfter, startOfDay, endOfDay } from 'date-fns';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ArrowLeft, CalendarIcon, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeFormat, APP_DATE_FORMAT } from '@/lib/date-utils';
import type { AccountingAccount, AccountingEntry } from '@/lib/types';

const formatCurrency = (value: number) => {
    return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const hasPermission = useMemo(() => {
        if (!profile) return false;
        return (profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'ACCOUNTING_HR') && profile.role !== 'WORKER';
    }, [profile]);

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

    const processedData = useMemo(() => {
        if (!account) return { items: [], totals: { totalIncome: 0, totalExpense: 0, periodEndBalance: 0 }, periodStartingBalance: 0 };
    
        // 1. Sort ALL entries by date and time
        const sortedAllEntries = [...entries].sort((a, b) => {
            const dateA = parseISO(a.entryDate).getTime();
            const dateB = parseISO(b.entryDate).getTime();
            if (dateA !== dateB) return dateA - dateB;
            const timeA = (a as any).createdAt?.toMillis?.() || 0;
            const timeB = (b as any).createdAt?.toMillis?.() || 0;
            return timeA - timeB;
        });
    
        const openingBalanceDateStr = account.openingBalanceDate || "1970-01-01";
        const openingBalanceValue = account.openingBalance ?? 0;
        
        // 2. Calculate balance for every transaction relative to Opening Balance anchor
        // We calculate for the entire history to ensure absolute consistency
        let runningBalance = openingBalanceValue;
        
        const preOpening = sortedAllEntries.filter(e => e.entryDate < openingBalanceDateStr);
        const postOpening = sortedAllEntries.filter(e => e.entryDate >= openingBalanceDateStr);
        
        // Items AFTER opening balance date
        let currentBalance = openingBalanceValue;
        const processedPost = postOpening.map(entry => {
            const income = (entry.entryType === 'RECEIPT' || entry.entryType === 'CASH_IN') ? entry.amount : 0;
            const expense = (entry.entryType === 'CASH_OUT') ? entry.amount : 0;
            currentBalance = Math.round((currentBalance + income - expense) * 100) / 100;
            return { ...entry, income, expense, balance: currentBalance };
        });
        
        // Items BEFORE opening balance date (calculated backwards)
        let backBalance = openingBalanceValue;
        const processedPre = [...preOpening].reverse().map(entry => {
            const income = (entry.entryType === 'RECEIPT' || entry.entryType === 'CASH_IN') ? entry.amount : 0;
            const expense = (entry.entryType === 'CASH_OUT') ? entry.amount : 0;
            const itemBalance = backBalance;
            backBalance = Math.round((backBalance - (income - expense)) * 100) / 100;
            return { ...entry, income, expense, balance: itemBalance };
        }).reverse();
        
        const allProcessed = [...processedPre, ...processedPost];
        
        // 3. Filter for visibility based on user range and search
        const visibleItems = allProcessed.filter(entry => {
            const entryDate = parseISO(entry.entryDate);
            const isInRange = dateRange?.from && dateRange?.to ? (entryDate >= startOfDay(dateRange.from) && entryDate <= endOfDay(dateRange.to)) : true;
            if (!isInRange) return false;
    
            if (searchTerm) {
                const lowerSearch = searchTerm.toLowerCase();
                const match = entry.sourceDocNo?.toLowerCase().includes(lowerSearch) ||
                              entry.description?.toLowerCase().includes(lowerSearch) ||
                              (entry as any).customerNameSnapshot?.toLowerCase().includes(lowerSearch) ||
                              (entry as any).vendorNameSnapshot?.toLowerCase().includes(lowerSearch);
                if (!match) return false;
            }
            return true;
        });
        
        // 4. Summaries
        const totalIncome = visibleItems.reduce((sum, i) => sum + i.income, 0);
        const totalExpense = visibleItems.reduce((sum, i) => sum + i.expense, 0);
        
        let periodStartingBalance = openingBalanceValue;
        if (dateRange?.from) {
            const fromStr = format(dateRange.from, 'yyyy-MM-dd');
            const firstInRangeIdx = allProcessed.findIndex(item => item.entryDate >= fromStr);
            if (firstInRangeIdx !== -1) {
                const firstItem = allProcessed[firstInRangeIdx];
                periodStartingBalance = Math.round((firstItem.balance - (firstItem.income - firstItem.expense)) * 100) / 100;
            } else if (allProcessed.length > 0 && allProcessed[allProcessed.length-1].entryDate < fromStr) {
                periodStartingBalance = allProcessed[allProcessed.length-1].balance;
            }
        }

        return {
            periodStartingBalance,
            items: visibleItems,
            totals: {
                totalIncome,
                totalExpense,
                periodEndBalance: visibleItems.length > 0 ? visibleItems[visibleItems.length - 1].balance : periodStartingBalance,
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
                            <CardTitle>ยอดยกมาหลัก: {formatCurrency(account.openingBalance ?? 0)} บาท</CardTitle>
                            <CardDescription>ณ วันที่: {safeFormat(account.openingBalanceDate ? parseISO(account.openingBalanceDate) : null, APP_DATE_FORMAT)}</CardDescription>
                        </div>
                        <div className="flex flex-col md:flex-row gap-2">
                             <Popover>
                                <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn("w-full md:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRange?.from ? (
                                    dateRange.to ? (
                                        <>
                                        {format(dateRange.from, APP_DATE_FORMAT)} - {format(dateRange.to, APP_DATE_FORMAT)}
                                        </>
                                    ) : (
                                        format(dateRange.from, APP_DATE_FORMAT)
                                    )
                                    ) : (
                                    <span>เลือกช่วงวันที่</span>
                                    )}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2}/>
                                </PopoverContent>
                            </Popover>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                placeholder="ค้นหาจากรายการ, อ้างอิง..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
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
                                <TableHead className="text-right pr-6">คงเหลือ</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow className="font-semibold bg-muted/20 italic">
                                <TableCell colSpan={5} className="pl-6">ยอดยกมาสะสม (Balance Brought Forward)</TableCell>
                                <TableCell className="text-right pr-6 text-primary">{formatCurrency(processedData.periodStartingBalance)}</TableCell>
                            </TableRow>
                            {processedData.items.length > 0 ? (
                                processedData.items.map(item => (
                                    <TableRow key={item.id} className="hover:bg-muted/10">
                                        <TableCell className="pl-6 text-muted-foreground text-xs">{safeFormat(parseISO(item.entryDate), APP_DATE_FORMAT)}</TableCell>
                                        <TableCell className="text-sm">{item.description}</TableCell>
                                        <TableCell className="text-xs font-mono">{item.sourceDocNo || '-'}</TableCell>
                                        <TableCell className="text-right text-green-600 font-medium">{item.income > 0 ? formatCurrency(item.income) : ''}</TableCell>
                                        <TableCell className="text-right text-destructive font-medium">{item.expense > 0 ? formatCurrency(item.expense) : ''}</TableCell>
                                        <TableCell className="text-right pr-6 font-bold">{formatCurrency(item.balance)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">ไม่พบรายการในช่วงวันที่ที่เลือก</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                         <TableFooter>
                            <TableRow className="font-bold text-base bg-muted/30">
                                <TableCell colSpan={3} className="pl-6">รวมรายการในช่วงเวลา</TableCell>
                                <TableCell className="text-right text-green-700">{formatCurrency(processedData.totals.totalIncome)}</TableCell>
                                <TableCell className="text-right text-destructive">{formatCurrency(processedData.totals.totalExpense)}</TableCell>
                                <TableCell className="text-right pr-6 text-primary">{formatCurrency(processedData.totals.periodEndBalance)}</TableCell>
                            </TableRow>
                         </TableFooter>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
