"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react';
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
  billingRowUiStatus,
  billingSignedGrandTotal,
  billingRowPreviewItems,
  billingTargetBucket,
  billingRowMatchesTarget,
  billingRowCanCreateNote,
  billingRowCanEditGrouping,
  billingRowCollectBucketInvoices,
  billingInvoicesForNoteCreate,
  billingRowFallbackCustomer,
  explodeSeparateSubRows,
  excludeInvoicesDeferredToFutureMonth,
  fetchDeferredRollInDocuments,
  isUnpaidBillingCandidate,
  customerForBillingNoteDocument,
  appendBillingNoteLinkToInvoiceBatch,
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
  AlertCircle,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import type { Customer, CustomerTaxProfile, Document, BillingRun, StoreSettings } from '@/lib/types';
import type { WithId } from '@/firebase/firestore/use-collection';
import { BillingNoteBatchEditDialog } from '@/components/billing-note-batch-edit-dialog';
import { createDocument } from '@/firebase/documents';
import { safeFormat } from '@/lib/date-utils';
import {
  billingBucketId,
  collapseBillingBucketMerges,
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

export default function BatchBillingNotePage() {
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
  const [isPurgingBucket, setIsPurgingBucket] = useState<string | null>(null);
  const [billingTaxPick, setBillingTaxPick] = useState<{
    row: GroupedCustomerData;
    profiles: CustomerTaxProfile[];
    selectedProfileId: string;
  } | null>(null);
  const [billingTaxPickBusy, setBillingTaxPickBusy] = useState(false);
  const billingRunSuppressSnapshotUntil = useRef(0);

  const isAdminUser = profile?.role === 'ADMIN';
  
  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);
  
  const monthId = format(currentMonth, 'yyyy-MM');
  const billingRunRef = useMemo(() => (db ? doc(db, "billingRuns", monthId) : null), [db, monthId]);

  // Real-time listener for the billing run summary
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

      // Query documents specifically for the selected month
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
      unpaidInvoices.forEach(inv => {
        const bucket = billingBucketId(inv);
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

        invoices.forEach(inv => {
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

        const createdNoteIds = activeBillingRun?.createdBillingNotes?.[customer.id];
        const mergedFollowerCount = Object.entries(mergedMap).filter(([, leader]) => leader === customer.id).length;
        return {
          customer,
          includedInvoices,
          deferredInvoices,
          separateGroups,
          totalIncludedAmount: includedInvoices.reduce((sum, inv) => sum + billingSignedGrandTotal(inv), 0),
          createdNoteIds,
          parentBillingNotesSnapshot: createdNoteIds,
          mergedFollowerCount,
        };
      });

      setCustomerData(rowsBeforeExplode.flatMap((row) => explodeSeparateSubRows(row)));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error fetching data', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth, db, toast, billingRun]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const editDialogInvoices = useMemo(() => {
    if (!editingCustomerData) return [];
    const bucket = billingTargetBucket(editingCustomerData);
    return billingRowCollectBucketInvoices(bucket, customerData);
  }, [editingCustomerData, customerData]);

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
          appendBillingNoteLinkToInvoiceBatch(batch, db, inv, docId, docNo);
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
        toast({ title: "สร้างใบวางบิลแล้ว" });
      } else if (result.error) {
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
        toast({ title: "สร้างใบวางบิลแล้ว" });
        setBillingTaxPick(null);
      } else if (result.error) {
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
          ? ` — ข้าม ${skippedMultiTaxProfile} รายที่มีหลายชุดภาษี (ให้สร้างทีละรายจากปุ่มสร้างใบวางบิลเพื่อเลือกชื่อบนใบวางบิล)`
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
    const separateCount = customerData.reduce(
      (sum, d) => sum + (d.splitInvoiceGroupKey ? d.includedInvoices.length : 0),
      0
    );

    return { totalCustomers, totalInvoices, totalAmount, deferredCount, separateCount };
  }, [customerData]);

  const handlePreview = (docId: string) => router.push(`/app/documents/${docId}`);

  return (
    <>
      <PageHeader title="ใบวางบิล (Batch)" description="รวบรวมใบกำกับภาษีและใบส่งของเครดิตที่ต้องวางบิลประจำเดือน">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}><ChevronLeft /></Button>
          <span className="font-semibold text-lg w-36 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}><ChevronRight /></Button>
          <Button onClick={fetchData} variant="outline" size="icon" disabled={isLoading}><RefreshCw className={isLoading ? "animate-spin" : ""} /></Button>
          <Button onClick={handleBulkCreate} disabled={isLoading || isBulkCreating}>
            {isBulkCreating ? <Loader2 className="animate-spin mr-2" /> : <Rocket className="mr-2" />}
            สร้างทั้งหมด
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-6">
        <Card><CardHeader><CardTitle className="text-2xl">{summary.totalCustomers}</CardTitle><CardDescription>ลูกค้าที่ต้องวางบิล</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle className="text-2xl">{summary.totalInvoices}</CardTitle><CardDescription>บิลที่รวบรวมได้</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle className="text-2xl">฿{formatCurrency(summary.totalAmount)}</CardTitle><CardDescription>ยอดรวมที่จะวางบิล</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle className="text-2xl">{summary.deferredCount}</CardTitle><CardDescription>บิลที่เลื่อนไป</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle className="text-2xl">{summary.separateCount}</CardTitle><CardDescription>บิลที่แยกเล่ม</CardDescription></CardHeader></Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>ลูกค้า</TableHead><TableHead>จำนวนบิล</TableHead><TableHead>ยอดรวม</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="animate-spin" /></TableCell></TableRow>
              ) : customerData.length > 0 ? (
                customerData.map((data) => {
                  const rowStatus = billingRowUiStatus(data);
                  const canEditGrouping = billingRowCanEditGrouping(data, customerData);
                  const canCreate = billingRowCanCreateNote(data);
                  const previewItems = billingRowPreviewItems(data);
                  return (
                  <Fragment key={data.customer.id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        {data.customer.useTax ? (data.customer.taxName || data.customer.name) : data.customer.name}
                        {data.splitInvoiceGroupKey ? (
                          <Badge variant="secondary" className="ml-2 text-[10px]">แยก</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {data.includedInvoices.length +
                          data.deferredInvoices.length +
                          Object.values(data.separateGroups).flat().length}
                      </TableCell>
                      <TableCell>฿{formatCurrency(data.totalIncludedAmount)}</TableCell>
                      <TableCell>
                        {rowStatus === "created" ? (
                          <Badge variant="default">สร้างแล้ว</Badge>
                        ) : rowStatus === "pending" ? (
                          <Badge variant="outline">รอดำเนินการ</Badge>
                        ) : (
                          <Badge variant="secondary">ไม่มีรายการ</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                        <Button variant="outline" size="sm" className="mr-2" onClick={() => setEditingCustomerData(data)} disabled={!canEditGrouping}><Edit className="mr-2 h-3 w-3"/> แก้ไข</Button>
                        {rowStatus !== "created" ? (
                            <>
                            <Button size="sm" onClick={() => void beginCreateBillingNotesForCustomer(data)} disabled={!canCreate}>สร้างใบวางบิล</Button>
                            {isAdminUser && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon" aria-label="เมนู Admin">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
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
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            </>
                        ) : (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="secondary">ดูเอกสาร <ChevronDown className="ml-2 h-4 w-4"/></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {previewItems.map(({ docId, label }) => (
                                      <DropdownMenuItem key={docId} onClick={() => handlePreview(docId)}>
                                        <FileText className="mr-2 h-4 w-4" /> {label}
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
                        )}
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
                })
              ) : (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">ไม่พบเอกสารเครดิตที่ต้องวางบิลในเดือนนี้</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
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
    </>
  );
}
