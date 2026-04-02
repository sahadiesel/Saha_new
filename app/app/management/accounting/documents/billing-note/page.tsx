
"use client";

import React, { useState, useMemo, useEffect, useCallback, Fragment, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { useFirebase, useDoc } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  deleteField,
  writeBatch,
} from 'firebase/firestore';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Rocket,
  Edit,
  FileText,
  Printer,
  ChevronDown,
  RotateCcw,
  History,
  LayoutGrid,
  Eye,
  MoreHorizontal,
  PlusCircle,
  AlertTriangle,
  Info,
  Link2,
  Unlink,
  Trash2,
} from 'lucide-react';
import type { Customer, Document, BillingRun, StoreSettings } from '@/lib/types';
import type { WithId } from '@/firebase/firestore/use-collection';
import { BillingNoteBatchEditDialog } from '@/components/billing-note-batch-edit-dialog';
import { createDocument } from '@/firebase/documents';
import { safeFormat } from '@/lib/date-utils';
import { DocumentList } from '@/components/document-list';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { billingBucketId, collapseBillingBucketMerges } from '@/lib/billing-bucket-merge';

const formatCurrency = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface GroupedCustomerData {
  customer: Customer;
  includedInvoices: Document[];
  deferredInvoices: Document[];
  separateGroups: Record<string, Document[]>;
  totalIncludedAmount: number;
  createdNoteIds?: { main?: string; separate?: Record<string, string> };
  warnings?: string[];
  mergedFollowerCount?: number;
}

function BillingNoteBatchTab() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [customerData, setCustomerData] = useState<GroupedCustomerData[]>([]);
  
  const [editingCustomerData, setEditingCustomerData] = useState<GroupedCustomerData | null>(null);
  const [billingRun, setBillingRun] = useState<WithId<BillingRun> | null>(null);
  
  const [isBulkCreating, setIsBulkCreating] = useState(false);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [selectedBucketIds, setSelectedBucketIds] = useState<string[]>([]);
  const [isSavingMerge, setIsSavingMerge] = useState(false);
  const [isPurgingBucket, setIsPurgingBucket] = useState<string | null>(null);

  const isAdminUser = profile?.role === 'ADMIN';
  
  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);
  
  const monthId = format(currentMonth, 'yyyy-MM');
  const billingRunRef = useMemo(() => (db ? doc(db, "billingRuns", monthId) : null), [db, monthId]);

  useEffect(() => {
    if (!db || !billingRunRef) return;
    return onSnapshot(billingRunRef, (snap) => {
      if (snap.exists()) {
        setBillingRun({ id: snap.id, ...snap.data() } as WithId<BillingRun>);
      } else {
        setBillingRun(null);
      }
    });
  }, [db, billingRunRef]);

  const fetchData = useCallback(async () => {
    if (!db) return;
    setIsLoading(true);

    try {
      const startDate = startOfMonth(currentMonth);
      const endDate = endOfMonth(currentMonth);

      const invoicesQuery = query(
        collection(db, 'documents'),
        where('docDate', '>=', format(startDate, 'yyyy-MM-dd')),
        where('docDate', '<=', format(endDate, 'yyyy-MM-dd'))
      );
      
      const invoicesSnap = await getDocs(invoicesQuery);
      const allDocs = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Document));
      
      const unpaidInvoices = allDocs.filter(doc =>
        (doc.docType === 'TAX_INVOICE' || doc.docType === 'DELIVERY_NOTE') &&
        doc.paymentTerms === 'CREDIT' &&
        !['PAID', 'CANCELLED', 'REJECTED'].includes(doc.status)
      );

      const groupedByCustomer: Record<string, { customer: Customer; invoices: Document[] }> = {};
      const docNoCount: Record<string, number> = {};

      unpaidInvoices.forEach(inv => {
        const bucket = billingBucketId(inv);

        docNoCount[inv.docNo] = (docNoCount[inv.docNo] || 0) + 1;

        if (!groupedByCustomer[bucket]) {
          groupedByCustomer[bucket] = {
            customer: {
              ...inv.customerSnapshot,
              id: bucket,
            } as Customer,
            invoices: [],
          };
        }
        groupedByCustomer[bucket].invoices.push(inv);
      });

      collapseBillingBucketMerges(groupedByCustomer, billingRun?.billingMergedBuckets);

      const mergedMap = billingRun?.billingMergedBuckets || {};
      const finalData = Object.values(groupedByCustomer).map(({ customer, invoices }) => {
        const includedInvoices: Document[] = [];
        const deferredInvoices: Document[] = [];
        const separateGroups: Record<string, Document[]> = {};
        const warnings: string[] = [];

        invoices.forEach(inv => {
          if (docNoCount[inv.docNo] > 1) {
            warnings.push(`พบเลขที่เอกสารซ้ำ (${inv.docNo}) กรุณาตรวจสอบว่าบิลซ้ำหรือไม่`);
          }
          
          const expectedName = customer.useTax ? (customer.taxName || customer.name) : customer.name;
          const invoiceName = inv.customerSnapshot?.useTax ? (inv.customerSnapshot?.taxName || inv.customerSnapshot?.name) : inv.customerSnapshot?.name;
          
          if (invoiceName && invoiceName !== expectedName) {
            warnings.push(`ชื่อในบิล ${inv.docNo} ไม่ตรงกับชื่อปัจจุบันของลูกค้า`);
          }

          if (billingRun?.deferredInvoices?.[inv.id]) {
            deferredInvoices.push(inv);
          } else if (billingRun?.separateInvoiceGroups?.[inv.id]) {
            const groupKey = billingRun.separateInvoiceGroups[inv.id];
            if (!separateGroups[groupKey]) separateGroups[groupKey] = [];
            separateGroups[groupKey].push(inv);
          } else {
            includedInvoices.push(inv);
          }
        });
        
        const mergedFollowerCount = Object.entries(mergedMap).filter(([, leader]) => leader === customer.id).length;

        return {
          customer,
          includedInvoices,
          deferredInvoices,
          separateGroups,
          totalIncludedAmount: includedInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
          createdNoteIds: billingRun?.createdBillingNotes?.[customer.id],
          warnings: Array.from(new Set(warnings)),
          mergedFollowerCount,
        };
      });

      setCustomerData(finalData);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error fetching data', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth, db, toast, billingRun]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveOverrides = async (customerId: string, deferred: Record<string, boolean>, separate: Record<string, string>) => {
    if (!profile || !billingRunRef) return;
    
    const newDeferred = { ...billingRun?.deferredInvoices, ...deferred };
    const newSeparate = { ...billingRun?.separateInvoiceGroups, ...separate };

    Object.keys(deferred).forEach(id => delete newSeparate[id]);
    Object.keys(separate).forEach(id => delete newDeferred[id]);
    
    await setDoc(billingRunRef, {
      monthId,
      deferredInvoices: newDeferred,
      separateInvoiceGroups: newSeparate,
      updatedAt: serverTimestamp(),
      updatedByUid: profile.uid,
      updatedByName: profile.displayName,
    }, { merge: true });

    toast({ title: 'บันทึกการตั้งค่าแล้ว' });
  };

  const toggleBucketSelect = (bucketId: string) => {
    setSelectedBucketIds((prev) =>
      prev.includes(bucketId) ? prev.filter((x) => x !== bucketId) : [...prev, bucketId]
    );
  };

  const handleMergeSelectedBuckets = async () => {
    if (!profile || !billingRunRef) return;
    const ids = [...selectedBucketIds];
    if (ids.length < 2) {
      toast({
        variant: "destructive",
        title: "เลือกอย่างน้อย 2 แถว",
        description: "จึงจะรวมเป็นหนึ่งกลุ่มสำหรับใบวางบิลได้",
      });
      return;
    }
    for (const id of ids) {
      const row = customerData.find((d) => d.customer.id === id);
      if (row?.createdNoteIds) {
        toast({
          variant: "destructive",
          title: "ไม่สามารถรวมกลุ่ม",
          description: "มีแถวที่สร้างใบวางบิลแล้ว — รีเซ็ตสถานะการสร้างก่อน",
        });
        return;
      }
    }
    const order = new Map(customerData.map((d, i) => [d.customer.id, i]));
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const leader = ids[0]!;
    const followers = ids.slice(1);
    const existing = { ...(billingRun?.billingMergedBuckets || {}) };
    for (const f of followers) {
      existing[f] = leader;
    }
    setIsSavingMerge(true);
    try {
      await setDoc(
        billingRunRef,
        {
          monthId,
          billingMergedBuckets: existing,
          updatedAt: serverTimestamp(),
          updatedByUid: profile.uid,
          updatedByName: profile.displayName,
        },
        { merge: true }
      );
      setSelectedBucketIds([]);
      toast({
        title: "รวมกลุ่มแล้ว",
        description: `ใช้แถวบนสุดของรายการที่เลือกเป็นหัวกลุ่ม — รวมอีก ${followers.length} แถว`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "บันทึกการรวมไม่สำเร็จ", description: msg });
    } finally {
      setIsSavingMerge(false);
    }
  };

  const handleUnmergeBucketLeader = async (leaderId: string) => {
    if (!profile || !billingRunRef) return;
    const existing = { ...(billingRun?.billingMergedBuckets || {}) };
    let n = 0;
    for (const k of Object.keys(existing)) {
      if (existing[k] === leaderId) {
        delete existing[k];
        n++;
      }
    }
    if (n === 0) return;
    setIsSavingMerge(true);
    try {
      await setDoc(
        billingRunRef,
        {
          monthId,
          billingMergedBuckets: existing,
          updatedAt: serverTimestamp(),
          updatedByUid: profile.uid,
          updatedByName: profile.displayName,
        },
        { merge: true }
      );
      toast({ title: "ยกเลิกการรวมกลุ่ม", description: `คืน ${n} แถวแยกกลับมา` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "ล้มเหลว", description: msg });
    } finally {
      setIsSavingMerge(false);
    }
  };

  const createBillingNotesForCustomer = async (targetCustomerData: GroupedCustomerData) => {
    if (!profile || !storeSettings || !db || !billingRunRef) return { success: false, error: "Required data missing." };
    
    const { customer, includedInvoices, separateGroups } = targetCustomerData;
    const freshSnap = await getDoc(billingRunRef);
    const freshCreatedNotes = freshSnap.exists() ? freshSnap.data().createdBillingNotes?.[customer.id] : null;
    if (freshCreatedNotes) return { success: true, error: "Already created" };

    const createdIds: { main?: string; separate: Record<string, string> } = { separate: {} };
    let hasError = false;

    const createNote = async (groupInvoices: Document[], groupKey: string) => {
      if (groupInvoices.length === 0) return;
      
      const totalAmount = groupInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
      const itemsForDoc = groupInvoices.map(inv => {
        const typeLabel = inv.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : 'ใบส่งของ';
        return {
          description: `${typeLabel}เลขที่ ${inv.docNo} (วันที่: ${safeFormat(new Date(inv.docDate), 'dd/MM/yy')})`,
          quantity: 1,
          unitPrice: inv.grandTotal,
          total: inv.grandTotal,
        };
      });
      
      try {
        const { docId, docNo } = await createDocument(db, 'BILLING_NOTE', {
          customerId: customer.id,
          docDate: format(new Date(), 'yyyy-MM-dd'),
          customerSnapshot: customer,
          storeSnapshot: storeSettings,
          items: itemsForDoc,
          invoiceIds: groupInvoices.map(inv => inv.id),
          subtotal: totalAmount, 
          discountAmount: 0,
          net: totalAmount,
          withTax: false,
          vatAmount: 0,
          grandTotal: totalAmount,
          notes: groupKey === 'MAIN' ? '' : `เอกสารกลุ่ม: ${groupKey}`,
          senderName: profile.displayName,
          receiverName: customer.useTax ? (customer.taxName || customer.name) : customer.name,
          billingRunId: monthId
        }, profile);

        const batch = writeBatch(db);
        groupInvoices.forEach(inv => {
            batch.update(doc(db, 'documents', inv.id), {
                billingNoteId: docId,
                billingNoteNo: docNo,
                updatedAt: serverTimestamp()
            });
        });
        await batch.commit();

        return docId;
      } catch (e: any) {
        toast({ variant: 'destructive', title: `Failed to create note for ${groupKey}`, description: e.message });
        hasError = true;
        return undefined;
      }
    };

    if (includedInvoices.length > 0) {
        const mainId = await createNote(includedInvoices, 'MAIN');
        if (mainId) createdIds.main = mainId;
    }
    for (const groupKey in separateGroups) {
        const groupId = await createNote(separateGroups[groupKey], groupKey);
        if (groupId) createdIds.separate[groupKey] = groupId;
    }
    
    if (!hasError && (createdIds.main || Object.keys(createdIds.separate).length > 0)) {
      if (!freshSnap.exists()) {
          await setDoc(billingRunRef, {
              monthId,
              createdBillingNotes: { [customer.id]: createdIds },
              updatedAt: serverTimestamp(),
          });
      } else {
          await updateDoc(billingRunRef, { 
            [`createdBillingNotes.${customer.id}`]: createdIds,
            updatedAt: serverTimestamp(),
          });
      }
    }

    return { success: !hasError, error: hasError ? "Some notes failed." : "" };
  };

  const handleBulkCreate = async () => {
    setIsBulkCreating(true);
    let successCount = 0;
    let skippedCount = 0;

    for (const data of customerData) {
        if (data.createdNoteIds) {
            skippedCount++;
            continue;
        }
        if (data.includedInvoices.length > 0 || Object.keys(data.separateGroups).length > 0) {
            const result = await createBillingNotesForCustomer(data);
            if (result.success) successCount++;
        }
    }
    toast({ title: "สร้างใบวางบิลเสร็จสิ้น", description: `สร้างใหม่ ${successCount} รายการ, ข้ามรายที่ทำไปแล้ว ${skippedCount} รายการ` });
    setIsBulkCreating(false);
  };

  const handleResetStatus = async (customerId: string) => {
    if (!db || !billingRunRef || !profile) return;
    setIsResetting(customerId);
    try {
        await updateDoc(billingRunRef, {
            [`createdBillingNotes.${customerId}`]: deleteField(),
            updatedAt: serverTimestamp()
        });
        toast({ title: "รีเซ็ตสถานะสำเร็จ", description: "ตอนนี้คุณสามารถกดสร้างใบวางบิลให้ลูกค้ารายนี้ได้ใหม่แล้วค่ะ" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: "รีเซ็ตล้มเหลว", description: e.message });
    } finally {
        setIsResetting(null);
    }
  };

  /** Admin: ล้างทุกอย่างที่ผูกแถวนี้กับ billing run + ถอดลิงก์ใบวางบิลจากบิลต้นทาง (ไม่ลบเอกสาร BILLING_NOTE) */
  const handleAdminPurgeRow = async (data: GroupedCustomerData) => {
    if (!profile || profile.role !== 'ADMIN' || !db || !billingRunRef) return;
    const bucketId = data.customer.id;
    const allInvoices = [
      ...data.includedInvoices,
      ...data.deferredInvoices,
      ...Object.values(data.separateGroups).flat(),
    ];
    const displayName = data.customer.useTax ? (data.customer.taxName || data.customer.name) : data.customer.name;
    if (
      !window.confirm(
        `ลบข้อมูลการวางบิลของ “${displayName}” ในเดือน ${monthId} ออกจากรันนี้\n\n` +
          `จะล้าง: การรวมกลุ่ม เลื่อน แยกเล่ม และสถานะสร้างใบวางบิล พร้อมถอดลิงก์จากบิลต้นทางในแถวนี้\n` +
          `ไม่ลบไฟล์ใบวางบิลในระบบ — ตรวจจากเมนูเอกสารหากต้องการลบจริง`
      )
    ) {
      return;
    }

    setIsPurgingBucket(bucketId);
    try {
      const snap = await getDoc(billingRunRef);
      const br = (snap.exists() ? snap.data() : {}) as Partial<BillingRun>;
      const batch = writeBatch(db);
      const runPatch: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
        updatedByUid: profile.uid,
        updatedByName: profile.displayName,
      };
      runPatch[`createdBillingNotes.${bucketId}`] = deleteField();

      const merged = br.billingMergedBuckets || {};
      for (const [k, v] of Object.entries(merged)) {
        if (k === bucketId || v === bucketId) {
          runPatch[`billingMergedBuckets.${k}`] = deleteField();
        }
      }

      for (const inv of allInvoices) {
        runPatch[`deferredInvoices.${inv.id}`] = deleteField();
        runPatch[`separateInvoiceGroups.${inv.id}`] = deleteField();
      }

      for (const inv of allInvoices) {
        batch.update(doc(db, 'documents', inv.id), {
          billingNoteId: deleteField(),
          billingNoteNo: deleteField(),
          updatedAt: serverTimestamp(),
        });
      }

      batch.update(billingRunRef, runPatch as Parameters<typeof updateDoc>[1]);
      await batch.commit();

      setSelectedBucketIds((prev) => prev.filter((id) => id !== bucketId));
      toast({ title: 'ลบข้อมูลการวางบิลในแถวนี้แล้ว' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: msg });
    } finally {
      setIsPurgingBucket(null);
    }
  };

  const summary = useMemo(() => {
    const totalCustomers = customerData.length;
    const totalInvoices = customerData.reduce((sum, d) => sum + d.includedInvoices.length + d.deferredInvoices.length + Object.values(d.separateGroups).flat().length, 0);
    const totalAmount = customerData.reduce((sum, d) => sum + d.totalIncludedAmount, 0);
    const deferredCount = customerData.reduce((sum, d) => sum + d.deferredInvoices.length, 0);
    const separateCount = customerData.reduce((sum, d) => sum + Object.values(d.separateGroups).flat().length, 0);
    return { totalCustomers, totalInvoices, totalAmount, deferredCount, separateCount };
  }, [customerData]);

  const handlePreview = (docId: string) => router.push(`/app/documents/${docId}`);
  const handlePrint = (docId: string) => router.push(`/app/documents/${docId}?print=1&autoprint=1`);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}><ChevronLeft /></Button>
          <span className="font-semibold text-lg w-36 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}><ChevronRight /></Button>
          <Button onClick={fetchData} variant="outline" size="icon" disabled={isLoading}><RefreshCw className={isLoading ? "animate-spin" : ""} /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading || isSavingMerge || selectedBucketIds.length < 2}
            onClick={() => void handleMergeSelectedBuckets()}
          >
            {isSavingMerge ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
            รวมกลุ่มที่เลือก ({selectedBucketIds.length})
          </Button>
          <Button onClick={handleBulkCreate} disabled={isLoading || isBulkCreating}>
            {isBulkCreating ? <Loader2 className="animate-spin mr-2" /> : <Rocket className="mr-2" />}
            สร้างใบวางบิลทั้งหมด ({summary.totalCustomers} ราย)
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        รวมกลุ่มด้วยมือเมื่อคนละคน/คนละเบอร์มาส่งงานแต่เจ้าของบิลเดียวกัน — เลือกหลายแถวแล้วกด &quot;รวมกลุ่มที่เลือก&quot;
        (แถวบนสุดของลำดับในตารางจะเป็นหัวกลุ่ม) ใช้ได้ทั้งใบกำกับและใบส่งของชั่วคราว ไม่กระทบการรับเงิน/ใบเสร็จจนกว่าจะสร้างใบวางบิล
      </p>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card className="bg-primary/5 border-primary/20"><CardHeader className="p-4"><CardTitle className="text-xl">{summary.totalCustomers}</CardTitle><CardDescription className="text-xs">ลูกค้าที่ต้องวางบิล</CardDescription></CardHeader></Card>
        <Card className="bg-primary/5 border-primary/20"><CardHeader className="p-4"><CardTitle className="text-xl">{summary.totalInvoices}</CardTitle><CardDescription className="text-xs">บิลที่รวบรวมได้</CardDescription></CardHeader></Card>
        <Card className="bg-primary/5 border-primary/20"><CardHeader className="p-4"><CardTitle className="text-xl font-black">฿{formatCurrency(summary.totalAmount)}</CardTitle><CardDescription className="text-xs">ยอดรวมที่จะวางบิล</CardDescription></CardHeader></Card>
        <Card className="bg-muted/50 border-dashed"><CardHeader className="p-4"><CardTitle className="text-xl text-muted-foreground">{summary.deferredCount}</CardTitle><CardDescription className="text-xs">บิลที่เลื่อนไป</CardDescription></CardHeader></Card>
        <Card className="bg-muted/50 border-dashed"><CardHeader className="p-4"><CardTitle className="text-xl text-muted-foreground">{summary.separateCount}</CardTitle><CardDescription className="text-xs">บิลที่แยกเล่ม</CardDescription></CardHeader></Card>
      </div>

      <TooltipProvider>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead className="w-10" /><TableHead>ลูกค้า (Customer)</TableHead><TableHead className="text-center">จำนวนบิล</TableHead><TableHead className="text-right">ยอดรวมสะสม</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="animate-spin" /></TableCell></TableRow>
                ) : customerData.length > 0 ? (
                  customerData.map(data => (
                    <TableRow key={data.customer.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="align-middle">
                        <Checkbox
                          checked={selectedBucketIds.includes(data.customer.id)}
                          onCheckedChange={() => toggleBucketSelect(data.customer.id)}
                          disabled={!!data.createdNoteIds}
                          aria-label="เลือกแถวเพื่อรวมกลุ่ม"
                        />
                      </TableCell>
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2 flex-wrap">
                          {data.customer.useTax ? (data.customer.taxName || data.customer.name) : data.customer.name}
                          {(data.mergedFollowerCount ?? 0) > 0 && (
                            <Badge variant="outline" className="text-[10px] h-5 border-primary/40 text-primary">
                              รวมกลุ่ม +{data.mergedFollowerCount}
                            </Badge>
                          )}
                          {data.warnings && data.warnings.length > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-4 w-4 text-orange-500 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs p-3">
                                <p className="font-bold text-orange-600 mb-1 flex items-center gap-1"><Info className="h-3 w-3"/> ข้อสังเกตข้อมูล:</p>
                                <ul className="list-disc pl-4 space-y-1 text-xs">
                                  {data.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{data.includedInvoices.length}</TableCell>
                      <TableCell className="text-right font-mono">฿{formatCurrency(data.totalIncludedAmount)}</TableCell>
                      <TableCell>
                        {data.createdNoteIds ? (
                          <Badge variant="default" className="bg-green-600">สร้างแล้ว</Badge>
                        ) : (data.includedInvoices.length > 0 || Object.keys(data.separateGroups).length > 0) ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">รอดำเนินการ</Badge>
                        ) : (
                          <Badge variant="secondary">ไม่มีรายการ</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!data.createdNoteIds ? (
                              <>
                                <DropdownMenuItem onClick={() => setEditingCustomerData(data)}>
                                  <Edit className="mr-2 h-4 w-4" /> แก้ไขการรวบรวม
                                </DropdownMenuItem>
                                {(data.mergedFollowerCount ?? 0) > 0 && (
                                  <DropdownMenuItem
                                    onClick={() => void handleUnmergeBucketLeader(data.customer.id)}
                                    disabled={isSavingMerge}
                                  >
                                    <Unlink className="mr-2 h-4 w-4" /> เลิกรวมกลุ่มย่อย
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem 
                                  onClick={() => createBillingNotesForCustomer(data)}
                                  disabled={(data.includedInvoices.length + Object.keys(data.separateGroups).length) === 0}
                                  className="text-primary focus:text-primary font-bold"
                                >
                                  <PlusCircle className="mr-2 h-4 w-4" /> สร้างใบวางบิล
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {data.createdNoteIds.main && (
                                  <DropdownMenuItem onClick={() => handlePreview(data.createdNoteIds!.main!)}>
                                    <Eye className="mr-2 h-4 w-4" /> พรีวิว (ใบหลัก)
                                  </DropdownMenuItem>
                                )}
                                {Object.entries(data.createdNoteIds.separate).map(([key, id]) => (
                                  <DropdownMenuItem key={id} onClick={() => handlePreview(id)}>
                                    <Eye className="mr-2 h-4 w-4" /> พรีวิว ({key})
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                {data.createdNoteIds.main && (
                                  <DropdownMenuItem onClick={() => handlePrint(data.createdNoteIds!.main!)}>
                                    <Printer className="mr-2 h-4 w-4" /> พิมพ์ PDF (ใบหลัก)
                                  </DropdownMenuItem>
                                )}
                                {Object.entries(data.createdNoteIds.separate).map(([key, id]) => (
                                  <DropdownMenuItem key={`p-${id}`} onClick={() => handlePrint(id)}>
                                    <Printer className="mr-2 h-4 w-4" /> พิมพ์ PDF ({key})
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-destructive focus:text-destructive" 
                                  onClick={() => handleResetStatus(data.customer.id)} 
                                  disabled={isResetting === data.customer.id}
                                >
                                  {isResetting === data.customer.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RotateCcw className="mr-2 h-4 w-4"/>}
                                  ล้างสถานะการสร้าง (Reset)
                                </DropdownMenuItem>
                              </>
                            )}
                            {isAdminUser && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  disabled={isPurgingBucket === data.customer.id}
                                  onClick={() => void handleAdminPurgeRow(data)}
                                >
                                  {isPurgingBucket === data.customer.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="mr-2 h-4 w-4" />
                                  )}
                                  ลบรายการออกจากรัน (Admin)
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic">ไม่พบเอกสารเครดิตที่ต้องวางบิลในเดือนนี้</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TooltipProvider>
      
      {editingCustomerData && (
        <BillingNoteBatchEditDialog
          isOpen={!!editingCustomerData}
          onClose={() => setEditingCustomerData(null)}
          customer={editingCustomerData.customer}
          invoices={[...editingCustomerData.includedInvoices, ...editingCustomerData.deferredInvoices, ...Object.values(editingCustomerData.separateGroups).flat()]}
          initialOverrides={{deferred: billingRun?.deferredInvoices || {}, separate: billingRun?.separateInvoiceGroups || {}}}
          onSave={handleSaveOverrides}
        />
      )}
    </div>
  );
}

export default function ManagementBillingNotesPage() {
    return (
        <div className="space-y-6">
            <PageHeader title="ใบวางบิล" description="สรุปรายการใบกำกับภาษีและใบส่งของเครดิตเพื่อวางบิลรายเดือน" />
            
            <Tabs defaultValue="batch" className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-2">
                    <TabsTrigger value="batch" className="flex items-center gap-2">
                        <LayoutGrid className="h-4 w-4" /> สรุปรายเดือน (Batch)
                    </TabsTrigger>
                    <TabsTrigger value="history" className="flex items-center gap-2">
                        <History className="h-4 w-4" /> ประวัติใบวางบิล
                    </TabsTrigger>
                </TabsList>
                
                <TabsContent value="batch" className="mt-6">
                    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>}>
                        <BillingNoteBatchTab />
                    </Suspense>
                </TabsContent>
                
                <TabsContent value="history" className="mt-6">
                    <DocumentList
                        docType="BILLING_NOTE"
                        baseContext="accounting"
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
