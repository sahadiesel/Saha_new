
"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { collection, onSnapshot, query, orderBy, Timestamp, limit, where, type FirestoreError } from "firebase/firestore";
import { DateRange } from "react-day-picker";
import { 
  subDays, 
  startOfMonth, 
  endOfMonth, 
  startOfToday, 
  subMonths, 
  format, 
  differenceInDays, 
  startOfYear, 
  isWithinInterval,
  isBefore,
  parseISO,
  startOfDay,
  endOfDay,
  set,
  subYears,
} from "date-fns";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  LineChart, 
  Line, 
  CartesianGrid, 
  Legend 
} from "recharts";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar as CalendarIcon, TrendingUp, TrendingDown, AlertCircle, Clock, ArrowRight, Wallet, Users, Receipt, CheckCircle2, PieChart as PieIcon, Landmark, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { Job, Document, AccountingEntry, JobDepartment, AccountingObligation, PurchaseDoc, Customer } from "@/lib/types";
import { JOB_DEPARTMENTS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { deptLabel } from "@/lib/ui-labels";

export const dynamic = 'force-dynamic';

// --- Helper Functions ---
const toDateSafe = (ts: any): Date | null => {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts.seconds !== undefined) return new Date(ts.seconds * 1000);
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const formatCurrency = (value: number) => {
  return (value || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
};

/** อ่าน YYYY-MM-DD ในกราฟภาษี — คืน null ถ้า parse ไม่ได้ */
const parseDocDateYmd = (s: string | undefined): Date | null => {
  if (!s || typeof s !== "string") return null;
  try {
    const d = parseISO(s);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
};

/** ภาษีขายสุทธิในงวด: ใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ (เฉพาะ withTax, ยังไม่นับฉบับร่าง/รออนุมัติ) */
const documentSalesVatSigned = (d: Document, interval: { start: Date; end: Date }): number => {
  const s = d.status;
  if (s === "CANCELLED" || s === "REJECTED" || s === "DRAFT" || s === "PENDING_REVIEW") return 0;
  if (!d.withTax) return 0;
  const dt = parseDocDateYmd(d.docDate);
  if (!dt || !isWithinInterval(dt, interval)) return 0;
  const vat = d.vatAmount || 0;
  if (d.docType === "TAX_INVOICE" || d.docType === "DEBIT_NOTE") return vat;
  if (d.docType === "CREDIT_NOTE") return -vat;
  return 0;
};

/** ภาษีซื้อ: เฉพาะบิลแวตและสถานะออกบิลแล้ว (ไม่นับฉบับร่าง/รออนุมัติ) */
const purchaseInputVat = (p: PurchaseDoc, interval: { start: Date; end: Date }): number => {
  const s = p.status;
  if (s === "CANCELLED" || s === "REJECTED" || s === "DRAFT" || s === "PENDING_REVIEW") return 0;
  if (!p.withTax) return 0;
  const pt = parseDocDateYmd(p.docDate);
  if (!pt || !isWithinInterval(pt, interval)) return 0;
  return p.vatAmount || 0;
};

const getTrend = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const TrendIndicator = ({ value }: { value: number }) => {
  if (value === 0) return null;
  const isUp = value > 0;
  return (
    <div className={cn("flex items-center text-xs font-medium", isUp ? "text-green-600" : "text-destructive")}>
      {isUp ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
      {Math.abs(value).toFixed(1)}%
    </div>
  );
};

const isOutflow = (job: Job) => ["DONE", "WAITING_CUSTOMER_PICKUP", "PICKED_UP", "CLOSED"].includes(job.status);

/** รายรับ-รายจ่ายเชิงดำเนินงาน: ไม่นับโอนระหว่างบัญชี (มี transferRefId คู่กับอีกรายการ) */
const isInterAccountTransferEntry = (e: AccountingEntry) => Boolean(e.transferRefId);

const isOperatingCashIn = (e: AccountingEntry) =>
  (e.entryType === "RECEIPT" || e.entryType === "CASH_IN") && !isInterAccountTransferEntry(e);

const isOperatingCashOut = (e: AccountingEntry) => e.entryType === "CASH_OUT" && !isInterAccountTransferEntry(e);

// --- Main Dashboard Component ---
function AppDashboardPage() {
  const { db } = useFirebase();
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [archivedJobs, setArchivedJobs] = useState<Job[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [obligations, setObligations] = useState<AccountingObligation[]>([]);
  const [purchaseDocs, setPurchaseDocs] = useState<PurchaseDoc[]>([]);
  /** โหลดตาม docDate ย้อนหลัง 2 ปี — กราฟ VAT 6 เดือน ไม่อิง limit(500) ดิบ ที่เฉือนข้อมูลเดิม */
  const [vatDocuments, setVatDocuments] = useState<Document[]>([]);
  const [vatPurchaseDocs, setVatPurchaseDocs] = useState<PurchaseDoc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Initialize date range on client only
  useEffect(() => {
    const today = startOfToday();
    setDateRange({
      from: startOfMonth(today),
      to: endOfMonth(today),
    });
  }, []);

  const selectedYear = useMemo(() => dateRange?.from ? dateRange.from.getFullYear() : new Date().getFullYear(), [dateRange]);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    setIndexErrorUrl(null);

    // Fetch active jobs
    const unsubJobs = onSnapshot(query(collection(db, "jobs"), limit(500)), (snap) => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    });

    // Fetch archived jobs
    const archivedQuery = query(collection(db, `jobsArchive_${selectedYear}`), orderBy("lastActivityAt", "desc"), limit(200));
    const unsubArchived = onSnapshot(archivedQuery, (snap) => {
      setArchivedJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    });

    // Fetch documents
    const unsubDocs = onSnapshot(query(collection(db, "documents"), limit(500)), (snap) => {
      setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Document)));
    });
    
    // Fetch accounting entries
    const unsubEntries = onSnapshot(query(collection(db, "accountingEntries"), orderBy("entryDate", "desc"), limit(1000)), (snap) => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingEntry)));
    });
    
    // FETCH OBLIGATIONS (AR/AP)
    const unsubObligations = onSnapshot(query(
      collection(db, "accountingObligations"), 
      where("status", "in", ["UNPAID", "PARTIAL"]),
      limit(1000)
    ), (snap) => {
      setObligations(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingObligation)));
    }, (err: FirestoreError) => {
      if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexErrorUrl(urlMatch[0]);
      }
    });
    
    // Fetch purchases
    const unsubPurchases = onSnapshot(query(collection(db, "purchaseDocs"), limit(200)), (snap) => {
      setPurchaseDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseDoc)));
    });

    const vatLookbackYmd = format(subYears(startOfToday(), 7), "yyyy-MM-dd");
    const unsubVatDocs = onSnapshot(
      query(
        collection(db, "documents"),
        where("docDate", ">=", vatLookbackYmd),
        orderBy("docDate", "desc"),
        limit(8000)
      ),
      (snap) => {
        setVatDocuments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Document)));
      },
      (err: FirestoreError) => {
        if (err.message?.includes("requires an index")) {
          const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
          if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        console.error("Dashboard VAT documents", err);
      }
    );
    const unsubVatPurchases = onSnapshot(
      query(
        collection(db, "purchaseDocs"),
        where("docDate", ">=", vatLookbackYmd),
        orderBy("docDate", "desc"),
        limit(5000)
      ),
      (snap) => {
        setVatPurchaseDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseDoc)));
      },
      (err: FirestoreError) => {
        if (err.message?.includes("requires an index")) {
          const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
          if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        console.error("Dashboard VAT purchaseDocs", err);
      }
    );
    
    // Fetch customers
    const unsubCustomers = onSnapshot(query(collection(db, "customers"), limit(1000)), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
      setLoading(false);
    });

    return () => {
      unsubJobs();
      unsubArchived();
      unsubDocs();
      unsubEntries();
      unsubObligations();
      unsubPurchases();
      unsubVatDocs();
      unsubVatPurchases();
      unsubCustomers();
    };
  }, [db, selectedYear]);

  const stats = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return null;

    const from = dateRange.from;
    const to = dateRange.to;
    const diff = differenceInDays(to, from) + 1;
    const prevFrom = subDays(from, diff);
    const prevTo = subDays(to, diff);

    const isInPeriod = (d: Date | null) => d && isWithinInterval(d, { start: startOfDay(from), end: endOfDay(to) });
    const isInPrevPeriod = (d: Date | null) => d && isWithinInterval(d, { start: startOfDay(prevFrom), end: endOfDay(prevTo) });

    // 1. KPI Calculations
    const currentInflow = jobs.filter(j => isInPeriod(toDateSafe(j.createdAt)));
    const prevInflow = jobs.filter(j => isInPrevPeriod(toDateSafe(j.createdAt)));

    const currentOutflow = jobs.filter(j => isOutflow(j) && isInPeriod(toDateSafe(j.lastActivityAt)));
    const prevOutflow = jobs.filter(j => isOutflow(j) && isInPrevPeriod(toDateSafe(j.lastActivityAt)));

    const backlog = jobs.filter(j => !isOutflow(j));
    
    const currentCashIn = entries
      .filter((e) => isOperatingCashIn(e) && isInPeriod(toDateSafe(e.entryDate)))
      .reduce((s, e) => s + e.amount, 0);
    const prevCashIn = entries
      .filter((e) => isOperatingCashIn(e) && isInPrevPeriod(toDateSafe(e.entryDate)))
      .reduce((s, e) => s + e.amount, 0);
    const currentCashOut = entries
      .filter((e) => isOperatingCashOut(e) && isInPeriod(toDateSafe(e.entryDate)))
      .reduce((s, e) => s + e.amount, 0);
    const prevCashOut = entries
      .filter((e) => isOperatingCashOut(e) && isInPrevPeriod(toDateSafe(e.entryDate)))
      .reduce((s, e) => s + e.amount, 0);

    const arBalance = obligations.filter(o => o.type === 'AR' && o.status !== 'PAID').reduce((s, o) => s + (o.balance || 0), 0);
    const apBalance = obligations.filter(o => o.type === 'AP' && o.status !== 'PAID').reduce((s, o) => s + (o.balance || 0), 0);

    // 2. Charts: Job Volume (6 Months)
    const last6Months = Array.from({ length: 6 }).map((_, i) => {
      const mStart = startOfMonth(subMonths(from, 5 - i));
      const mEnd = endOfMonth(mStart);
      const interval = { start: mStart, end: mEnd };
      
      const inf = jobs.filter(j => {
        const d = toDateSafe(j.createdAt);
        return d && isWithinInterval(d, interval);
      }).length;
      const outf = jobs.filter(j => {
        const d = toDateSafe(j.lastActivityAt);
        return isOutflow(j) && d && isWithinInterval(d, interval);
      }).length;
      
      return { 
        name: format(mStart, "MM/yy"), 
        Inflow: inf, 
        Outflow: outf,
        net: inf - outf
      };
    });

    // 3. Dept Breakdown
    const deptStats = JOB_DEPARTMENTS.map(dept => {
      const deptJobs = backlog.filter(j => j.department === dept);
      const now = new Date();
      return {
        dept,
        label: deptLabel(dept),
        count: deptJobs.length,
        over7: deptJobs.filter(j => {
            const dt = toDateSafe(j.createdAt);
            return dt && differenceInDays(now, dt) > 7;
        }).length,
        over14: deptJobs.filter(j => {
            const dt = toDateSafe(j.createdAt);
            return dt && differenceInDays(now, dt) > 14;
        }).length,
      };
    }).filter(d => d.count > 0);

    const currentInflowByDept = JOB_DEPARTMENTS.map(dept => ({
      name: deptLabel(dept),
      value: currentInflow.filter(j => j.department === dept).length
    })).filter(v => v.value > 0);

    // 4. Financial Flow (3 Months - Bi-weekly points)
    const cashFlowData = Array.from({ length: 6 }).map((_, i) => {
      // 6 points = 3 months * 2 (bi-weekly)
      const monthsAgo = Math.floor((5 - i) / 2);
      const isSecondHalf = (5 - i) % 2 === 0;
      
      const targetMonth = subMonths(from, monthsAgo);
      let rangeStart, rangeEnd;
      
      if (isSecondHalf) {
        rangeStart = set(targetMonth, { date: 16, hours: 0, minutes: 0, seconds: 0 });
        rangeEnd = endOfMonth(targetMonth);
      } else {
        rangeStart = startOfMonth(targetMonth);
        rangeEnd = set(targetMonth, { date: 15, hours: 23, minutes: 59, seconds: 59 });
      }
      
      const interval = { start: rangeStart, end: rangeEnd };
      
      const cin = entries
        .filter((e) => {
          if (!isOperatingCashIn(e)) return false;
          const d = toDateSafe(e.entryDate);
          return d && isWithinInterval(d, interval);
        })
        .reduce((s, e) => s + e.amount, 0);

      const cout = entries
        .filter((e) => {
          if (!isOperatingCashOut(e)) return false;
          const d = toDateSafe(e.entryDate);
          return d && isWithinInterval(d, interval);
        })
        .reduce((s, e) => s + e.amount, 0);
      
      return { 
        name: format(rangeStart, "dd/MM"), 
        "เงินรับเข้า": cin, 
        "เงินจ่ายออก": cout, 
        Net: cin - cout 
      };
    });

    // 5. VAT Trend (6 Months)
    const vatTrendData = Array.from({ length: 6 }).map((_, i) => {
      const mStart = startOfMonth(subMonths(from, 5 - i));
      const mEnd = endOfMonth(mStart);
      const interval = { start: mStart, end: mEnd };

      const salesVat = vatDocuments.reduce(
        (sum, d) => sum + documentSalesVatSigned(d, interval),
        0
      );

      const purchaseVat = vatPurchaseDocs.reduce(
        (sum, p) => sum + purchaseInputVat(p, interval),
        0
      );

      return {
        name: format(mStart, "MM/yy"),
        "ภาษีขาย": salesVat,
        "ภาษีซื้อ": purchaseVat,
        Net: salesVat - purchaseVat
      };
    });

    // 6. Customer Acquisition Stats
    const acqCounts = {
      EXISTING: 0,
      REFERRAL: 0,
      GOOGLE: 0,
      FACEBOOK: 0,
      TIKTOK: 0,
      YOUTUBE: 0,
      OTHER: 0,
    };

    const periodStart = startOfDay(from);
    const customerMap = new Map<string, Customer>();
    customers.forEach(c => customerMap.set(c.id, c));

    const allJobsInPeriod = [
      ...jobs.filter(j => isInPeriod(toDateSafe(j.createdAt))),
      ...archivedJobs.filter(j => isInPeriod(toDateSafe(j.createdAt)))
    ];

    const uniqueCidsInPeriod = Array.from(new Set(allJobsInPeriod.map(j => j.customerId).filter(Boolean)));

    uniqueCidsInPeriod.forEach(cid => {
      const customer = customerMap.get(cid);
      if (!customer) return;

      const customerCreatedAt = toDateSafe(customer.createdAt);

      if (customerCreatedAt && isBefore(startOfDay(customerCreatedAt), periodStart)) {
        acqCounts.EXISTING++;
      } else {
        const representativeJob = allJobsInPeriod.find(j => j.customerId === cid);
        const rawSrc = (representativeJob?.customerAcquisitionSource || customer.acquisitionSource || 'OTHER').toString().toUpperCase();
        
        if (rawSrc === 'REFERRAL') acqCounts.REFERRAL++;
        else if (rawSrc === 'GOOGLE') acqCounts.GOOGLE++;
        else if (rawSrc === 'FACEBOOK') acqCounts.FACEBOOK++;
        else if (rawSrc === 'TIKTOK') acqCounts.TIKTOK++;
        else if (rawSrc === 'YOUTUBE') acqCounts.YOUTUBE++;
        else acqCounts.OTHER++;
      }
    });

    const acquisitionData = [
      { name: "ลูกค้าเก่า", value: acqCounts.EXISTING, color: "hsl(var(--muted-foreground))" },
      { name: "ลูกค้าแนะนำ", value: acqCounts.REFERRAL, color: "hsl(var(--chart-1))" },
      { name: "Google", value: acqCounts.GOOGLE, color: "hsl(var(--chart-2))" },
      { name: "Facebook", value: acqCounts.FACEBOOK, color: "hsl(var(--chart-3))" },
      { name: "Tiktok", value: acqCounts.TIKTOK, color: "hsl(var(--chart-4))" },
      { name: "Youtube", value: acqCounts.YOUTUBE, color: "hsl(var(--chart-5))" },
      { name: "อื่นๆ", value: acqCounts.OTHER, color: "hsl(var(--primary))" },
    ].filter(v => v.value > 0);

    // 7. Alerts
    const alerts = [
      { 
        label: "เอกสารรอตรวจสอบรายการขาย", 
        count: documents.filter(d => d.status === 'PENDING_REVIEW').length, 
        link: "/app/management/accounting/inbox",
        icon: Receipt
      },
      { 
        label: "ใบเสร็จออกแล้วรอยืนยัน", 
        count: documents.filter(d => d.docType === 'RECEIPT' && d.receiptStatus === 'ISSUED_NOT_CONFIRMED').length, 
        link: "/app/management/accounting/inbox",
        icon: CheckCircle2
      },
      { 
        label: "ลูกหนี้เกินกำหนดชำระ", 
        count: obligations.filter(o => o.type === 'AR' && o.status !== 'PAID' && o.dueDate && isBefore(parseISO(o.dueDate), startOfToday())).length, 
        link: "/app/management/accounting/receivables-payables?tab=debtors",
        icon: Wallet
      },
      { 
        label: "งานค้างเกิน 14 วัน", 
        count: backlog.filter(j => {
            const dt = toDateSafe(j.createdAt);
            return dt && differenceInDays(new Date(), dt) > 14;
        }).length, 
        link: "/app/jobs",
        icon: AlertCircle,
        variant: "destructive"
      }
    ].filter(a => a.count > 0);

    return {
      kpis: [
        { label: "งานเข้าใหม่", value: currentInflow.length, trend: getTrend(currentInflow.length, prevInflow.length), desc: "งานที่เปิดใหม่ในช่วงเวลานี้", link: "/app/jobs" },
        { label: "งานซ่อมเสร็จ", value: currentOutflow.length, trend: getTrend(currentOutflow.length, prevOutflow.length), desc: "งานที่ส่งมอบในช่วงเวลานี้", link: "/app/jobs" },
        { label: "งานคงค้าง", value: backlog.length, desc: "งานที่ยังอยู่ระหว่างดำเนินการ", link: "/app/jobs", isNeutral: true },
        { label: "เงินหมุนเวียน", value: currentCashIn - currentCashOut, trend: getTrend(currentCashIn - currentCashOut, prevCashIn - prevCashOut), desc: "รับ-จ่ายสุทธิ (ไม่รวมโอนระหว่างบัญชี)", link: "/app/management/accounting/cashbook", isCurrency: true },
      ],
      fin: [
        { label: "เงินรับเข้า", value: currentCashIn, trend: getTrend(currentCashIn, prevCashIn), link: "/app/management/accounting/cashbook?tab=in" },
        { label: "เงินจ่ายออก", value: currentCashOut, trend: getTrend(currentCashOut, prevCashOut), link: "/app/management/accounting/cashbook?tab=out" },
        { label: "ยอดลูกหนี้คงค้าง", value: arBalance, link: "/app/management/accounting/receivables-payables?tab=debtors" },
        { label: "ยอดเจ้าหนี้คงค้าง", value: apBalance, link: "/app/management/accounting/receivables-payables?tab=creditors" },
      ],
      last6Months,
      deptStats,
      currentInflowByDept,
      cashFlowData,
      vatTrendData,
      acquisitionData,
      alerts
    };
  }, [jobs, archivedJobs, documents, vatDocuments, vatPurchaseDocs, entries, obligations, purchaseDocs, customers, dateRange]);

  const handleDatePreset = (preset: string) => {
    const today = startOfToday();
    switch (preset) {
      case "TODAY": setDateRange({ from: today, to: today }); break;
      case "LAST_7_DAYS": setDateRange({ from: subDays(today, 6), to: today }); break;
      case "THIS_MONTH": setDateRange({ from: startOfMonth(today), to: endOfMonth(today) }); break;
      case "LAST_3_MONTHS": setDateRange({ from: startOfMonth(subMonths(today, 2)), to: endOfMonth(today) }); break;
    }
  };

  if (loading || !stats) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="แดชบอร์ดผู้บริหาร" description="ภาพรวมธุรกิจและการดำเนินงานของ Sahadiesel">
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-start text-left font-normal min-w-[220px]">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "dd/MM/yy")} - {format(dateRange.to, "dd/MM/yy")}</> : format(dateRange.from, "dd/MM/yy")) : <span>เลือกช่วงเวลา</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
            </PopoverContent>
          </Popover>
          <Select onValueChange={handleDatePreset} defaultValue="THIS_MONTH">
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TODAY">วันนี้</SelectItem>
              <SelectItem value="LAST_7_DAYS">7 วันที่ผ่านมา</SelectItem>
              <SelectItem value="THIS_MONTH">เดือนนี้</SelectItem>
              <SelectItem value="LAST_3_MONTHS">3 เดือนที่ผ่านมา</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      {indexErrorUrl && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้าง Index เพื่อคำนวณยอดลูกหนี้/เจ้าหนี้</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 mt-2">
            <span>ฐานข้อมูลต้องการดัชนีพิเศษเพื่อกรองยอดค้างชำระมาแสดงผล กรุณากดปุ่มเพื่อสร้าง Index ค่ะ</span>
            <Button asChild variant="outline" size="sm" className="w-fit bg-white text-destructive hover:bg-muted">
              <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> สร้าง Index (Firebase)
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.kpis.map((kpi, i) => (
          <Card key={i} className="h-[130px] flex flex-col hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => router.push(kpi.link)}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
              {!kpi.isNeutral && <TrendIndicator value={kpi.trend!} />}
            </CardHeader>
            <CardContent className="flex-1">
              <div className="text-2xl font-bold">
                {kpi.isCurrency ? `฿${formatCurrency(kpi.value)}` : kpi.value.toLocaleString()}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{kpi.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>ปริมาณงาน (6 เดือน)</CardTitle>
            <CardDescription>เปรียบเทียบงานเข้าและงานเสร็จ</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.last6Months}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => Number.isInteger(v) ? v : ''} />
                  <Tooltip cursor={{fill: 'transparent'}} />
                  <Legend iconType="circle" />
                  <Bar dataKey="Inflow" name="งานเข้า" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Outflow" name="งานเสร็จ" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>วิเคราะห์ภาษีซื้อ-ขาย (6 เดือน)</CardTitle>
            <CardDescription>
              ภาษีขาย = ใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ (รายเดือน, อิงวันที่เอกสาร, เฉพาะที่ออกบิลแล้ว) · ภาษีซื้อ = บิลที่มี VAT
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.vatTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis tickFormatter={(v) => `${v / 1000}k`} fontSize={12} />
                  <Tooltip formatter={(v: any) => `฿${formatCurrency(Number(v))}`} />
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <Bar dataKey="ภาษีขาย" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ภาษีซื้อ" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>กระแสเงินสด (3 เดือน)</CardTitle>
            <CardDescription>
              ภาพรวมเงินเข้า–ออกทุกครึ่งเดือน (ไม่นับโอนระหว่างบัญชีธนาคาร — นับเฉพาะรายรับ/รายจ่ายดำเนินงาน)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.cashFlowData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} fontSize={12} />
                  <Tooltip formatter={(v: any) => `฿${formatCurrency(Number(v))}`} />
                  <Legend verticalAlign="bottom" iconType="circle" />
                  <Line type="monotone" dataKey="เงินรับเข้า" stroke="hsl(var(--chart-2))" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="เงินจ่ายออก" stroke="hsl(var(--chart-5))" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>งานใหม่แยกตามแผนก</CardTitle>
            <CardDescription>ปริมาณงานเปิดใหม่ในงวดนี้</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="h-[240px]">
              {stats.currentInflowByDept.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.currentInflowByDept} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={100} fontSize={11} />
                    <Tooltip cursor={{fill: 'transparent'}} />
                    <Bar dataKey="value" name="งานใหม่" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground italic">ไม่มีข้อมูล</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>วิเคราะห์งานค้าง</CardTitle>
            <CardDescription>งานค้างแยกตามแผนกและระยะเวลา</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.deptStats} dataKey="count" nameKey="label" innerRadius={50} outerRadius={70} paddingAngle={5}>
                    {stats.deptStats.map((_, i) => <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              {stats.deptStats.map((d, i) => (
                <div key={i} className="flex items-center justify-between border-b border-muted pb-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `hsl(var(--chart-${(i % 5) + 1}))` }} />
                    <span className="truncate">{d.label}</span>
                  </div>
                  <span className="font-bold ml-1">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle>แหล่งที่มาของลูกค้า</CardTitle>
            <CardDescription>สัดส่วนลูกค้าที่เปิดงานซ่อมในช่วงเวลานี้</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.acquisitionData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={70} paddingAngle={5}>
                    {stats.acquisitionData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${v} ราย`, 'จำนวน']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              {stats.acquisitionData.map((d, i) => (
                <div key={i} className="flex items-center justify-between border-b border-muted pb-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="truncate">{d.name}</span>
                  </div>
                  <span className="font-bold ml-1">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="h-full flex flex-col min-h-[260px]">
          <CardHeader>
            <CardTitle>สรุปสถานะการเงิน (Financial Snapshot)</CardTitle>
            <CardDescription>ข้อมูลลูกหนี้ เจ้าหนี้ และกระแสเงินสดปัจจุบัน</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="grid grid-cols-2 gap-4 h-full content-center">
              {stats.fin.map((item, i) => (
                <div key={i} className="p-3 border rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => router.push(item.link)}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{item.label}</span>
                    {item.trend !== undefined && <TrendIndicator value={item.trend} />}
                  </div>
                  <div className="text-lg font-bold">฿{formatCurrency(item.value)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full flex flex-col min-h-[260px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              แจ้งเตือนและสิ่งที่ต้องทำ
            </CardTitle>
            <CardDescription>รายการเร่งด่วนที่ฝ่ายบริหารและบัญชีควรตรวจสอบ</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-2">
            {stats.alerts.length > 0 ? stats.alerts.map((alert, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => router.push(alert.link)}>
                <div className="flex items-center gap-3">
                  <div className={cn("p-1.5 rounded-full", alert.variant === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
                    <alert.icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-medium">{alert.label}</span>
                </div>
                <Badge variant={alert.variant === "destructive" ? "destructive" : "secondary"} className="h-5">{alert.count}</Badge>
              </div>
            )) : (
              <div className="flex h-full items-center justify-center text-muted-foreground italic text-sm py-10">ไม่พบรายการเร่งด่วน</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Wrapper with Auth Guard
export default function ManagementDashboardPage() {
  const { profile, loading } = useAuth();
  const isAllowed = profile?.department === "MANAGEMENT" || profile?.department === "ACCOUNTING_HR" || profile?.role === "ADMIN" || profile?.role === "MANAGER";

  if (loading) return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <Card className="max-w-md text-center">
          <CardHeader>
            <CardTitle>เข้าถึงไม่ได้</CardTitle>
            <CardDescription>หน้าจอนี้สำหรับผู้บริหารและผู้ดูแลระบบเท่านั้น</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link href="/app/jobs">กลับไปยังหน้างาน</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AppDashboardPage />;
}
