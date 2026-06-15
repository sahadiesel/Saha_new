
"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Fragment, Suspense } from 'react';
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
  FieldPath,
} from 'firebase/firestore';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import {
  type BillingTableRow,
  billingDocLineLabel,
  explodeSeparateSubRows,
  billingRowUiStatus,
  billingSignedGrandTotal,
  billingRowPreviewItems,
  billingTargetBucket,
  billingRowMatchesTarget,
  billingRowIsMergeSelectable,
  billingRowCanCreateNote,
  billingRowCanEditGrouping,
  billingRowCollectBucketInvoices,
  billingInvoicesForNoteCreate,
  billingRowFallbackCustomer,
  fetchDeferredRollInDocuments,
  excludeInvoicesDeferredToFutureMonth,
  isUnpaidBillingCandidate,
  customerForBillingNoteDocument,
} from '@/lib/billing-note-batch-helpers';
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
import type { Customer, CustomerTaxProfile, Document, BillingRun, StoreSettings } from '@/lib/types';
import type { WithId } from '@/firebase/firestore/use-collection';
import { BillingNoteBatchEditDialog } from '@/components/billing-note-batch-edit-dialog';
import { createDocument } from '@/firebase/documents';
import { safeFormat } from '@/lib/date-utils';
import { DocumentList } from '@/components/document-list';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import {
  billingBucketId,
  collapseBillingBucketMerges,
  normalizeBillingBucketKey,
  sanitizeBillingMergedBuckets,
} from '@/lib/billing-bucket-merge';
import {
  billingPersistRunOverrides,
  billingResolveOverrideScopeIds,
  billingFetchRunFromServer,
} from '@/lib/billing-run-overrides';
import { fpBillingRunCreatedBucket, fpBillingRunCreatedSeparate } from '@/lib/billing-run-field-paths';
import {
  getInvoiceableTaxProfiles,
  guessTaxProfileFromInvoices,
  overlayTaxProfileForBillingNote,
} from '@/lib/customer-utils';
import { BillingNoteTaxProfilePickDialog } from '@/components/billing-note-tax-profile-pick-dialog';

const formatCurrency = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type GroupedCustomerData = BillingTableRow;

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
  /** เลือกชุดภาษีก่อนสร้างใบวางบิล (ลูกค้ามีหลายชุด) */
  const [billingTaxPick, setBillingTaxPick] = useState<{
    row: GroupedCustomerData;
    profiles: CustomerTaxProfile[];
    selectedProfileId: string;
  } | null>(null);
  const [billingTaxPickBusy, setBillingTaxPickBusy] = useState(false);
  /** กัน onSnapshot ทับ state หลังบันทึก merge/แผนด้วยมือ */
  const billingRunSuppressSnapshotUntil = useRef(0);

  const isAdminUser = profile?.role === 'ADMIN';
  
  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);
  
  const monthId = format(currentMonth, 'yyyy-MM');
  const billingRunRef = useMemo(() => (db ? doc(db, "billingRuns", monthId) : null), [db, monthId]);

  useEffect(() => {
    if (!db || !billingRunRef) return;
    return onSnapshot(billingRunRef, (snap) => {
      if (Date.now() < billingRunSuppressSnapshotUntil.current) return;
      if (snap.exists()) {
        setBillingRun({ id: snap.id, ...snap.data() } as WithId<BillingRun>);
      } else {
        setBillingRun(null);
      }
    });
  }, [db, billingRunRef]);

  const fetchData = useCallback(async (overrideBillingRun?: WithId<BillingRun> | null) => {
    if (!db) return;
    const activeBillingRun =
      overrideBillingRun !== undefined ? overrideBillingRun : billingRun;
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

      const inMonthUnpaid = allDocs.filter(isUnpaidBillingCandidate);
      const fromRange = excludeInvoicesDeferredToFutureMonth(inMonthUnpaid, monthId);
      const rollIn = await fetchDeferredRollInDocuments(db, monthId);
      const byId = new Map<string, Document>();
      for (const inv of [...fromRange, ...rollIn]) {
        if (!byId.has(inv.id)) byId.set(inv.id, inv);
      }
      const unpaidInvoices = Array.from(byId.values());

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

      collapseBillingBucketMerges(groupedByCustomer, activeBillingRun?.billingMergedBuckets);

      const mergedMap = sanitizeBillingMergedBuckets(activeBillingRun?.billingMergedBuckets);
      const rowsBeforeExplode: BillingTableRow[] = Object.values(groupedByCustomer).map(({ customer, invoices }) => {
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

          if (activeBillingRun?.deferredInvoices?.[inv.id]) {
            deferredInvoices.push(inv);
          } else if (activeBillingRun?.separateInvoiceGroups?.[inv.id]) {
            const groupKey = activeBillingRun.separateInvoiceGroups[inv.id];
            if (!separateGroups[groupKey]) separateGroups[groupKey] = [];
            separateGroups[groupKey].push(inv);
          } else {
            includedInvoices.push(inv);
          }
        });
        
        const mergedFollowerCount = Object.entries(mergedMap).filter(([, leader]) => leader === customer.id).length;
        const createdNoteIds = activeBillingRun?.createdBillingNotes?.[customer.id];

        return {
          customer,
          includedInvoices,
          deferredInvoices,
          separateGroups,
          totalIncludedAmount: includedInvoices.reduce((sum, inv) => sum + billingSignedGrandTotal(inv), 0),
          createdNoteIds,
          parentBillingNotesSnapshot: createdNoteIds,
          warnings: Array.from(new Set(warnings)),
          mergedFollowerCount,
        };
      });

      const finalData = rowsBeforeExplode.flatMap((row) => explodeSeparateSubRows(row));

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

  const refreshBillingRunAfterWrite = useCallback(async () => {
    if (!db) return null;
    billingRunSuppressSnapshotUntil.current = Date.now() + 3000;
    const fresh = await billingFetchRunFromServer(db, monthId);
    setBillingRun(fresh);
    await fetchData(fresh);
    return fresh;
  }, [db, monthId, fetchData]);

  const handleSaveOverrides = async (
    bucketId: string,
    touchedInvoiceIds: string[],
    deferred: Record<string, boolean>,
    separate: Record<string, string>,
    selectedRows?: GroupedCustomerData[]
  ) => {
    if (!profile || !billingRunRef || !db) return;

    const nextMonthId = format(addMonths(startOfMonth(currentMonth), 1), 'yyyy-MM');
    const prevDef = billingRun?.deferredInvoices || {};
    const prevSep = billingRun?.separateInvoiceGroups || {};

    const scopeIds = billingResolveOverrideScopeIds({
      anchorBucket: bucketId,
      customerData,
      merged: billingRun?.billingMergedBuckets,
      selectedRows,
      existingSeparate: prevSep,
    });
    for (const id of touchedInvoiceIds) {
      if (!scopeIds.includes(id)) scopeIds.push(id);
    }

    const docBatch = writeBatch(db);
    for (const id of scopeIds) {
      const ref = doc(db, 'documents', id);
      if (deferred[id]) {
        docBatch.update(ref, { billingDeferUntilMonth: nextMonthId, updatedAt: serverTimestamp() });
      } else {
        docBatch.update(ref, { billingDeferUntilMonth: deleteField(), updatedAt: serverTimestamp() });
      }
    }
    await docBatch.commit();

    await billingPersistRunOverrides(billingRunRef, {
      monthId,
      profile,
      scopeIds,
      prevDeferred: prevDef,
      prevSeparate: prevSep,
      deferred,
      separate,
    });

    await refreshBillingRunAfterWrite();

    const nDefer = Object.keys(deferred).length;
    const nSeparate = Object.keys(separate).length;
    const nIncluded = scopeIds.length - nDefer - nSeparate;
    toast({
      title: 'บันทึกการตั้งค่าแล้ว',
      description:
        nDefer > 0
          ? `บิลที่เลื่อน ${nDefer} ใบ จะแสดงในเดือน ${nextMonthId} · รวม ${nIncluded} ใบ · แยก ${nSeparate} ใบ`
          : nSeparate > 0
            ? `รวม ${nIncluded} ใบ · แยก ${nSeparate} ใบ`
            : `รวมบิล ${nIncluded} ใบในชุดเดียว — แสดงเป็นแถวเดียวในตาราง`,
    });
  };

  const toggleBucketSelect = (bucketId: string, checked?: boolean) => {
    setSelectedBucketIds((prev) => {
      const isOn = checked ?? !prev.includes(bucketId);
      if (isOn) return prev.includes(bucketId) ? prev : [...prev, bucketId];
      return prev.filter((x) => x !== bucketId);
    });
  };

  const editDialogInvoices = useMemo(() => {
    if (!editingCustomerData) return [];
    const bucket = billingTargetBucket(editingCustomerData);
    return billingRowCollectBucketInvoices(bucket, customerData);
  }, [editingCustomerData, customerData]);

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

    const rowById = new Map(customerData.map((d) => [d.customer.id, d]));
    const rows = ids
      .map((id) => rowById.get(id))
      .filter((row): row is GroupedCustomerData => !!row);
    if (rows.length < 2) {
      toast({
        variant: "destructive",
        title: "ไม่พบแถวที่เลือก",
        description: "กรุณาเลือกแถวในตารางแล้วลองใหม่",
      });
      return;
    }

    for (const row of rows) {
      if (!billingRowIsMergeSelectable(row)) {
        toast({
          variant: "destructive",
          title: "ไม่สามารถรวมกลุ่ม",
          description: "มีแถวที่สร้างใบวางบิลแล้ว — รีเซ็ตสถานะการสร้างก่อน",
        });
        return;
      }
    }

    const order = new Map(customerData.map((d, i) => [d.customer.id, i]));
    rows.sort((a, b) => (order.get(a.customer.id) ?? 0) - (order.get(b.customer.id) ?? 0));
    const leaderRow = rows[0]!;
    const followerRows = rows.slice(1);
    const leaderBucket = billingTargetBucket(leaderRow);

    const existing = sanitizeBillingMergedBuckets(billingRun?.billingMergedBuckets);
    let crossBucketCount = 0;
    let sameBucketCount = 0;

    for (const followerRow of followerRows) {
      const followerBucket = billingTargetBucket(followerRow);

      if (followerBucket === leaderBucket) {
        sameBucketCount++;
        continue;
      }

      existing[followerBucket] = leaderBucket;
      crossBucketCount++;
      for (const key of Object.keys(existing)) {
        if (existing[key] === followerBucket) {
          existing[key] = leaderBucket;
        }
      }
    }

    const mergedBuckets = sanitizeBillingMergedBuckets(existing);

    if (crossBucketCount === 0 && sameBucketCount === 0) {
      toast({
        variant: "destructive",
        title: "ไม่มีรายการที่รวมได้",
        description: "เลือกแถวจากคนละกลุ่มลูกค้า หรือแถวแยกเล่มที่จะรวมเข้าแถวหลัก",
      });
      return;
    }

    const prevDef = billingRun?.deferredInvoices || {};
    const prevSep = billingRun?.separateInvoiceGroups || {};
    const scopeIds = billingResolveOverrideScopeIds({
      anchorBucket: leaderBucket,
      customerData,
      merged: mergedBuckets,
      selectedRows: rows,
      existingSeparate: prevSep,
    });

    setIsSavingMerge(true);
    try {
      await billingPersistRunOverrides(billingRunRef, {
        monthId,
        profile,
        scopeIds,
        prevDeferred: prevDef,
        prevSeparate: prevSep,
        deferred: {},
        separate: {},
        billingMergedBuckets: mergedBuckets,
      });

      await refreshBillingRunAfterWrite();
      setSelectedBucketIds([]);
      const mergedRowCount = crossBucketCount + sameBucketCount;
      toast({
        title: "รวมกลุ่มแล้ว",
        description:
          crossBucketCount > 0
            ? `รวม ${mergedRowCount} แถวเข้าหัวกลุ่ม "${leaderRow.customer.taxName || leaderRow.customer.name}" — แสดงเป็นแถวเดียวในตาราง`
            : `รวมแถวแยก ${mergedRowCount} แถวในกลุ่มเดียวกัน — แสดงเป็นแถวเดียวในตาราง`,
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
    const leaderBucket = normalizeBillingBucketKey(leaderId);
    const existing = sanitizeBillingMergedBuckets(billingRun?.billingMergedBuckets);
    let n = 0;
    for (const k of Object.keys(existing)) {
      if (existing[k] === leaderBucket) {
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
      const freshSnap = await getDoc(billingRunRef);
      const freshBillingRun = freshSnap.exists()
        ? ({ id: freshSnap.id, ...freshSnap.data() } as WithId<BillingRun>)
        : null;
      setBillingRun(freshBillingRun);
      await fetchData(freshBillingRun);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "ล้มเหลว", description: msg });
    } finally {
      setIsSavingMerge(false);
    }
  };

  const createBillingNotesForCustomer = async (
    targetCustomerData: GroupedCustomerData,
    headerTaxProfile?: CustomerTaxProfile,
    resolvedCustomer?: Customer
  ) => {
    if (!profile || !storeSettings || !db || !billingRunRef) return { success: false, error: "Required data missing." };

    const { splitInvoiceGroupKey } = targetCustomerData;
    const customer = resolvedCustomer ?? targetCustomerData.customer;
    const targetBucket = billingTargetBucket(targetCustomerData);

    const freshSnap = await getDoc(billingRunRef);
    const freshRun = freshSnap.exists() ? freshSnap.data() : null;
    const freshCreated = freshRun?.createdBillingNotes?.[targetBucket] ?? null;

    const groupInvoicesForCreate = billingInvoicesForNoteCreate(
      targetCustomerData,
      customerData,
      freshRun as BillingRun | null
    );

    let hasError = false;

    const createNote = async (groupInvoices: Document[], groupKey: string) => {
      if (groupInvoices.length === 0) return;

      const totalAmount = groupInvoices.reduce((sum, inv) => sum + billingSignedGrandTotal(inv), 0);
      const itemsForDoc = groupInvoices.map((inv) => {
        const signed = billingSignedGrandTotal(inv);
        const typeLabel = billingDocLineLabel(inv);
        return {
          description: `${typeLabel} เลขที่ ${inv.docNo} (วันที่: ${safeFormat(new Date(inv.docDate), 'dd/MM/yy')})`,
          quantity: 1,
          unitPrice: signed,
          total: signed,
        };
      });

      try {
        let billingCustomer = customerForBillingNoteDocument(groupInvoices, customer);
        if (headerTaxProfile) {
          billingCustomer = overlayTaxProfileForBillingNote(billingCustomer, headerTaxProfile);
        }
        const { docId, docNo } = await createDocument(
          db,
          'BILLING_NOTE',
          {
            customerId: billingCustomer.id,
            docDate: format(new Date(), 'yyyy-MM-dd'),
            customerSnapshot: billingCustomer,
            storeSnapshot: storeSettings,
            items: itemsForDoc,
            invoiceIds: groupInvoices.map((inv) => inv.id),
            subtotal: totalAmount,
            discountAmount: 0,
            net: totalAmount,
            withTax: false,
            vatAmount: 0,
            grandTotal: totalAmount,
            notes: groupKey === 'MAIN' ? '' : `เอกสารกลุ่ม: ${groupKey}`,
            senderName: profile.displayName,
            receiverName: billingCustomer.useTax
              ? billingCustomer.taxName || billingCustomer.name
              : billingCustomer.name,
            billingRunId: monthId,
          },
          profile
        );

        const batch = writeBatch(db);
        groupInvoices.forEach((inv) => {
          batch.update(doc(db, 'documents', inv.id), {
            billingNoteId: docId,
            billingNoteNo: docNo,
            billingDeferUntilMonth: deleteField(),
            updatedAt: serverTimestamp(),
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

    if (splitInvoiceGroupKey) {
      if (groupInvoicesForCreate.length === 0) return { success: false, error: "No invoices" };
      if (freshCreated?.separate?.[splitInvoiceGroupKey]) return { success: true, error: "Already created" };
      const sid = await createNote(groupInvoicesForCreate, splitInvoiceGroupKey);
      if (!hasError && sid) {
        if (!freshSnap.exists()) {
          await setDoc(
            billingRunRef,
            {
              monthId,
              createdBillingNotes: { [targetBucket]: { separate: { [splitInvoiceGroupKey]: sid } } },
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          await updateDoc(
            billingRunRef,
            fpBillingRunCreatedSeparate(targetBucket, splitInvoiceGroupKey),
            sid,
            'updatedAt',
            serverTimestamp()
          );
        }
      }
      return { success: !hasError, error: hasError ? "Some notes failed." : "" };
    }

    if (groupInvoicesForCreate.length === 0) {
      return { success: false, error: "ไม่มีบิลในแถวนี้ — ให้สร้างจากแถวย่อยที่แยกเล่ม" };
    }
    if (freshCreated?.main) {
      return { success: true, error: "Already created" };
    }
    const mainId = await createNote(groupInvoicesForCreate, "MAIN");
    if (!hasError && mainId) {
      if (!freshSnap.exists()) {
        await setDoc(billingRunRef, {
          monthId,
          createdBillingNotes: { [targetBucket]: { main: mainId, separate: freshCreated?.separate || {} } },
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(billingRunRef, {
          [`createdBillingNotes.${targetBucket}.main`]: mainId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    return { success: !hasError, error: hasError ? "Some notes failed." : "" };
  };

  const resolveBillingRowCustomer = async (data: GroupedCustomerData): Promise<Customer | null> => {
    if (!db) return null;
    const bucketId = billingTargetBucket(data);
    const custSnap = await getDoc(doc(db, "customers", bucketId));
    if (custSnap.exists()) {
      return { id: custSnap.id, ...custSnap.data() } as Customer;
    }
    return billingRowFallbackCustomer(data);
  };

  const beginCreateBillingNotesForCustomer = async (data: GroupedCustomerData) => {
    if (!db || !profile || !storeSettings || !billingRunRef) return;
    if (!billingRowCanCreateNote(data)) {
      toast({
        variant: "destructive",
        title: "ไม่สามารถสร้างใบวางบิล",
        description: "แถวนี้ไม่มีบิลรอสร้าง — ให้สร้างจากแถวย่อยที่มีรายการ",
      });
      return;
    }
    try {
      const full = await resolveBillingRowCustomer(data);
      if (!full) {
        toast({
          variant: "destructive",
          title: "ไม่พบลูกค้า",
          description: "ไม่สามารถโหลดข้อมูลลูกค้าจากระบบหรือจากบิลต้นทางสำหรับแถวนี้",
        });
        return;
      }
      const profiles = getInvoiceableTaxProfiles(full);
      if (full.useTax && profiles.length > 1) {
        const guess =
          guessTaxProfileFromInvoices(data.includedInvoices, profiles) ?? profiles[0];
        setBillingTaxPick({
          row: data,
          profiles,
          selectedProfileId: guess!.id,
        });
        return;
      }
      const result = await createBillingNotesForCustomer(data, undefined, full);
      if (result.success) {
        await refreshBillingRunAfterWrite();
        toast({
          title: "สร้างใบวางบิลแล้ว",
          description: `รวม ${billingInvoicesForNoteCreate(data, customerData, billingRun).length} ใบในใบวางบิล`,
        });
      } else if (result.error && result.error !== "Already created") {
        toast({ variant: "destructive", title: "สร้างใบวางบิลไม่สำเร็จ", description: result.error });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "ผิดพลาด", description: msg });
    }
  };

  const confirmBillingTaxPick = async () => {
    if (!billingTaxPick) return;
    const profile = billingTaxPick.profiles.find((p) => p.id === billingTaxPick.selectedProfileId);
    if (!profile) return;
    setBillingTaxPickBusy(true);
    try {
      const full = await resolveBillingRowCustomer(billingTaxPick.row);
      const result = await createBillingNotesForCustomer(
        billingTaxPick.row,
        profile,
        full ?? undefined
      );
      if (result.success) {
        await refreshBillingRunAfterWrite();
        toast({
          title: "สร้างใบวางบิลแล้ว",
          description: `รวม ${billingInvoicesForNoteCreate(billingTaxPick.row, customerData, billingRun).length} ใบในใบวางบิล`,
        });
        setBillingTaxPick(null);
      } else if (result.error && result.error !== "Already created") {
        toast({ variant: "destructive", title: "สร้างใบวางบิลไม่สำเร็จ", description: result.error });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "สร้างใบวางบิลไม่สำเร็จ", description: msg });
    } finally {
      setBillingTaxPickBusy(false);
    }
  };

  const handleBulkCreate = async () => {
    setIsBulkCreating(true);
    let successCount = 0;
    let skippedCount = 0;
    let skippedMultiTaxProfile = 0;

    for (const data of customerData) {
      const st = billingRowUiStatus(data);
      if (st === "created") {
        skippedCount++;
        continue;
      }
      if (st === "empty") continue;
      if (!billingRowCanCreateNote(data)) continue;
      const resolved = db ? await resolveBillingRowCustomer(data) : null;
      if (resolved?.useTax && getInvoiceableTaxProfiles(resolved).length > 1) {
        skippedMultiTaxProfile++;
        continue;
      }
      const result = await createBillingNotesForCustomer(data, undefined, resolved ?? undefined);
      if (result.success) successCount++;
    }
    toast({
      title: "สร้างใบวางบิลเสร็จสิ้น",
      description:
        `สร้างใหม่ ${successCount} รายการ, ข้ามรายที่ทำไปแล้ว ${skippedCount} รายการ` +
        (skippedMultiTaxProfile > 0
          ? ` — ข้าม ${skippedMultiTaxProfile} รายที่มีหลายชุดภาษี (ให้สร้างทีละรายจากเมนูเพื่อเลือกชื่อบนใบวางบิล)`
          : ""),
    });
    setIsBulkCreating(false);
  };

  const handleResetStatus = async (data: GroupedCustomerData) => {
    if (!db || !billingRunRef || !profile) return;
    const target = billingTargetBucket(data);
    const splitKey = data.splitInvoiceGroupKey;
    setIsResetting(data.customer.id);
    try {
      if (splitKey) {
        await updateDoc(
          billingRunRef,
          fpBillingRunCreatedSeparate(target, splitKey),
          deleteField(),
          'updatedAt',
          serverTimestamp()
        );
      } else {
        await updateDoc(
          billingRunRef,
          fpBillingRunCreatedBucket(target),
          deleteField(),
          'updatedAt',
          serverTimestamp()
        );
      }
      toast({
        title: "รีเซ็ตสถานะสำเร็จ",
        description: "ตอนนี้คุณสามารถกดสร้างใบวางบิลให้แถวนี้ได้ใหม่แล้วค่ะ",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "รีเซ็ตล้มเหลว", description: e.message });
    } finally {
      setIsResetting(null);
    }
  };

  /** Admin: ล้างทุกอย่างที่ผูกแถวนี้กับ billing run + ถอดลิงก์ใบวางบิลจากบิลต้นทาง (ไม่ลบเอกสาร BILLING_NOTE) */
  const handleAdminPurgeRow = async (data: GroupedCustomerData) => {
    if (!profile || profile.role !== 'ADMIN' || !db || !billingRunRef) return;
    const mergeKey = data.customer.id;
    const targetBucket = billingTargetBucket(data);
    const splitKey = data.splitInvoiceGroupKey;
    const allInvoices = [
      ...data.includedInvoices,
      ...data.deferredInvoices,
      ...Object.values(data.separateGroups).flat(),
    ];
    const displayName = data.customer.useTax ? (data.customer.taxName || data.customer.name) : data.customer.name;
    const nextMonthId = format(addMonths(startOfMonth(currentMonth), 1), 'yyyy-MM');
    if (
      !window.confirm(
        `ลบข้อมูลการวางบิลของ “${displayName}” ในเดือน ${monthId} ออกจากรันนี้\n\n` +
          `จะล้าง: การรวมกลุ่ม เลื่อน แยกเล่ม และสถานะสร้างใบวางบิล พร้อมถอดลิงก์จากบิลต้นทางในแถวนี้\n` +
          `บิลในแถวนี้จะเลื่อนไปเดือน ${nextMonthId} (ไม่แสดงในเดือนนี้อีก)\n` +
          `ไม่ลบไฟล์ใบวางบิลในระบบ — ตรวจจากเมนูเอกสารหากต้องการลบจริง`
      )
    ) {
      return;
    }

    setIsPurgingBucket(mergeKey);
    try {
      const snap = await getDoc(billingRunRef);
      const br = (snap.exists() ? snap.data() : {}) as Partial<BillingRun>;
      const batch = writeBatch(db);
      const billingRunUpdates: unknown[] = [
        'updatedAt',
        serverTimestamp(),
        'updatedByUid',
        profile.uid,
        'updatedByName',
        profile.displayName,
      ];
      if (splitKey) {
        billingRunUpdates.push(fpBillingRunCreatedSeparate(targetBucket, splitKey), deleteField());
      } else {
        billingRunUpdates.push(fpBillingRunCreatedBucket(targetBucket), deleteField());
      }

      const merged = br.billingMergedBuckets || {};
      for (const [k, v] of Object.entries(merged)) {
        if (k === mergeKey || v === mergeKey) {
          billingRunUpdates.push(`billingMergedBuckets.${k}`, deleteField());
        }
      }

      for (const inv of allInvoices) {
        billingRunUpdates.push(`deferredInvoices.${inv.id}`, deleteField());
        billingRunUpdates.push(`separateInvoiceGroups.${inv.id}`, deleteField());
      }

      for (const inv of allInvoices) {
        batch.update(doc(db, 'documents', inv.id), {
          billingNoteId: deleteField(),
          billingNoteNo: deleteField(),
          billingDeferUntilMonth: nextMonthId,
          updatedAt: serverTimestamp(),
        });
      }

      batch.update(
        billingRunRef,
        billingRunUpdates[0] as string | FieldPath,
        billingRunUpdates[1],
        ...(billingRunUpdates.slice(2) as unknown[])
      );
      await batch.commit();

      setCustomerData((prev) => prev.filter((row) => !billingRowMatchesTarget(row, data)));
      setSelectedBucketIds((prev) => prev.filter((id) => id !== mergeKey));
      toast({
        title: 'ลบข้อมูลการวางบิลในแถวนี้แล้ว',
        description: `แถวนี้ถูกนำออกจากเดือน ${monthId} — บิลเลื่อนไปเดือน ${nextMonthId}`,
      });
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
                  customerData.map((data) => {
                    const rowStatus = billingRowUiStatus(data);
                    const mergeSelectable = billingRowIsMergeSelectable(data);
                    const canEditGrouping = billingRowCanEditGrouping(data, customerData);
                    const canCreate = billingRowCanCreateNote(data);
                    const previewItems = billingRowPreviewItems(data);
                    return (
                    <TableRow key={data.customer.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedBucketIds.includes(data.customer.id)}
                          onCheckedChange={(checked) =>
                            toggleBucketSelect(data.customer.id, checked === true)
                          }
                          disabled={!mergeSelectable}
                          aria-label="เลือกแถวเพื่อรวมกลุ่ม"
                        />
                      </TableCell>
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2 flex-wrap">
                          {data.customer.useTax ? (data.customer.taxName || data.customer.name) : data.customer.name}
                          {data.splitInvoiceGroupKey && (
                            <Badge variant="secondary" className="text-[10px] h-5">แยก</Badge>
                          )}
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
                      <TableCell className="text-center">
                        {data.includedInvoices.length +
                          data.deferredInvoices.length +
                          Object.values(data.separateGroups).flat().length}
                      </TableCell>
                      <TableCell className="text-right font-mono">฿{formatCurrency(data.totalIncludedAmount)}</TableCell>
                      <TableCell>
                        {rowStatus === "created" ? (
                          <Badge variant="default" className="bg-green-600">สร้างแล้ว</Badge>
                        ) : rowStatus === "pending" ? (
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
                            {rowStatus !== "created" ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => setEditingCustomerData(data)}
                                  disabled={!canEditGrouping}
                                >
                                  <Edit className="mr-2 h-4 w-4" /> แก้ไขการรวบรวม
                                </DropdownMenuItem>
                                {(data.mergedFollowerCount ?? 0) > 0 && !data.splitInvoiceGroupKey && (
                                  <DropdownMenuItem
                                    onClick={() => void handleUnmergeBucketLeader(data.customer.id)}
                                    disabled={isSavingMerge}
                                  >
                                    <Unlink className="mr-2 h-4 w-4" /> เลิกรวมกลุ่มย่อย
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => void beginCreateBillingNotesForCustomer(data)}
                                  disabled={!canCreate}
                                  className="text-primary focus:text-primary font-bold"
                                >
                                  <PlusCircle className="mr-2 h-4 w-4" /> สร้างใบวางบิล
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {previewItems.map(({ docId, label }) => (
                                  <DropdownMenuItem key={docId} onClick={() => handlePreview(docId)}>
                                    <Eye className="mr-2 h-4 w-4" /> {label}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => void handleResetStatus(data)}
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
                  );
                  })
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic">ไม่พบเอกสารเครดิตที่ต้องวางบิลในเดือนนี้</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TooltipProvider>
      
      <BillingNoteTaxProfilePickDialog
        open={!!billingTaxPick}
        onOpenChange={(open) => {
          if (!open && !billingTaxPickBusy) setBillingTaxPick(null);
        }}
        profiles={billingTaxPick?.profiles ?? []}
        selectedProfileId={billingTaxPick?.selectedProfileId ?? ""}
        onSelectedProfileIdChange={(id) =>
          setBillingTaxPick((prev) => (prev ? { ...prev, selectedProfileId: id } : prev))
        }
        onConfirm={confirmBillingTaxPick}
        confirming={billingTaxPickBusy}
      />

      {editingCustomerData && (
        <BillingNoteBatchEditDialog
          isOpen={!!editingCustomerData}
          onClose={() => setEditingCustomerData(null)}
          customer={editingCustomerData.customer}
          invoices={editDialogInvoices}
          initialOverrides={{ deferred: billingRun?.deferredInvoices || {}, separate: billingRun?.separateInvoiceGroups || {} }}
          onSave={(_customerId, deferred, separate, touchedIds) => {
            if (!editingCustomerData) return;
            const bucket = billingTargetBucket(editingCustomerData);
            const relatedRows = customerData.filter((r) => billingTargetBucket(r) === bucket);
            void handleSaveOverrides(bucket, touchedIds, deferred, separate, relatedRows);
          }}
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
