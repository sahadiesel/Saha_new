
"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { collection, query, onSnapshot, where, doc, serverTimestamp, type FirestoreError, updateDoc, runTransaction, limit, deleteField, addDoc, getDoc, getDocs, writeBatch, deleteDoc, orderBy } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, CheckCircle, Ban, HandCoins, MoreHorizontal, Eye, AlertCircle, ExternalLink, Calendar, Info, RefreshCw, Save, Wallet, PlusCircle, CheckCircle2, Send, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { WithId } from "@/firebase";
import type { Document as DocumentType, AccountingAccount } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";
import { Label } from "@/components/ui/label";
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
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { validateAccountingEntryDate } from "@/lib/accounting-entry-date";

const formatCurrency = (value: number | null | undefined) => (value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const roundMoney = (n: number) => Math.round(n * 100) / 100;

const docTypeThaiLabel = (docType?: string) => {
  if (docType === "TAX_INVOICE") return "ใบกำกับภาษี";
  if (docType === "DELIVERY_NOTE") return "ใบส่งของชั่วคราว";
  if (docType === "CREDIT_NOTE") return "ใบลดหนี้";
  if (docType === "DEBIT_NOTE") return "ใบเพิ่มหนี้";
  return docType || "-";
};

const docViewHref = (doc?: Pick<DocumentType, "id" | "docType">, tab?: string) => {
  if (!doc) return "#";
  const base =
    doc.docType === "DELIVERY_NOTE"
      ? `/app/office/documents/delivery-note/${doc.id}`
      : doc.docType === "TAX_INVOICE"
      ? `/app/office/documents/tax-invoice/${doc.id}`
      : `/app/office/documents/${doc.id}`;
  return tab ? `${base}?from=inbox&tab=${tab}` : base;
};

/** ค้นหาเลขที่เอกสาร / ชื่อลูกค้า / ชื่อในใบกำกับ / เบอร์โทร */
function matchesInboxSearch(
  doc: Pick<DocumentType, "docNo" | "customerSnapshot">,
  rawSearch: string
): boolean {
  const t = rawSearch.trim();
  if (!t) return true;
  const q = t.toLowerCase();
  if ((doc.docNo || "").toLowerCase().includes(q)) return true;
  const s = doc.customerSnapshot;
  if (!s) return false;
  if ((s.name || "").toLowerCase().includes(q)) return true;
  if ((s.taxName || "").toLowerCase().includes(q)) return true;
  const phone = (s.phone || "").replace(/\s|-/g, "");
  const qDigits = t.replace(/\s|-/g, "");
  if (phone && qDigits && phone.includes(qDigits)) return true;
  if ((s.phone || "").includes(t)) return true;
  return false;
}

function AccountingInboxPageContent() {
  const { profile, loading: authLoading } = useAuth();
  const { db, app: firebaseApp } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const activeTab = (searchParams.get('tab') as "receive" | "ar" | "receipts") || "receive";

  const [documents, setDocuments] = useState<WithId<DocumentType>[]>([]);
  const [approvedDocs, setApprovedDocs] = useState<WithId<DocumentType>[]>([]);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [indexCreationUrl, setIndexErrorUrl] = useState<string | null>(null);

  const [confirmingDoc, setConfirmingDoc] = useState<WithId<DocumentType> | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [disputingDoc, setDisputingDoc] = useState<WithId<DocumentType> | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [closingJobId, setClosingJobId] = useState<string | null>(null);

  const [selectedPaymentDate, setSelectedPaymentDate] = useState("");
  const [suggestedPayments, setSuggestedPayments] = useState<{accountId: string, amount: number}[]>([]);
  const [arDocToConfirm, setArDocToConfirm] = useState<WithId<DocumentType> | null>(null);

  const isUserAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';
  const isStrictAdmin = profile?.role === 'ADMIN';

  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT' || profile.department === 'OFFICE' || profile.department === 'ACCOUNTING_HR';
  }, [profile]);

  // STABILIZE QUERIES TO PREVENT ASSERTION ERRORS
  const docsQuery = useMemo(() => {
    if (!db || !hasPermission) return null;
    return query(
      collection(db, "documents"), 
      where("status", "in", ["PENDING_REVIEW", "APPROVED", "ISSUED", "UNPAID", "PARTIAL"]),
      orderBy("updatedAt", "desc"),
      limit(200)
    );
  }, [db, hasPermission]);

  const approvedQuery = useMemo(() => {
    if (!db || !hasPermission) return null;
    return query(
        collection(db, "documents"),
        where("status", "==", "APPROVED"),
        where("docType", "in", ["TAX_INVOICE", "DEBIT_NOTE"]),
        limit(100)
    );
  }, [db, hasPermission]);

  const accountsQuery = useMemo(() => {
    if (!db || !hasPermission) return null;
    return query(collection(db, "accountingAccounts"), where("isActive", "==", true));
  }, [db, hasPermission]);

  // DATA LISTENERS - Optimized to handle loading only on first success/failure
  useEffect(() => {
    if (!docsQuery || !db) return;
    
    const unsubscribe = onSnapshot(docsQuery, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<DocumentType>));
      const needingReview = all.filter(d => {
          // ตั้งลูกหนี้ / ผูก AR แล้ว → ไม่แสดงใน Inbox (ติดตามที่หน้าลูกหนี้-เจ้าหนี้ รวมใบลดหนี้ที่หักยอดเข้าใบกำกับแล้ว)
          if (
            (d.docType === 'DELIVERY_NOTE' ||
              d.docType === 'TAX_INVOICE' ||
              d.docType === 'CREDIT_NOTE' ||
              d.docType === 'DEBIT_NOTE') &&
            d.arObligationId
          ) {
            return false;
          }
          if (d.docType === 'DELIVERY_NOTE') return ['PENDING_REVIEW', 'APPROVED', 'UNPAID', 'PARTIAL'].includes(d.status);
          if (d.docType === 'TAX_INVOICE') return ['PENDING_REVIEW', 'APPROVED', 'UNPAID', 'PARTIAL'].includes(d.status);
          if (d.docType === 'CREDIT_NOTE' || d.docType === 'DEBIT_NOTE') return ['PENDING_REVIEW', 'APPROVED', 'UNPAID', 'PARTIAL'].includes(d.status);
          if (d.docType === 'RECEIPT') return d.status !== 'CANCELLED' && d.receiptStatus !== 'CONFIRMED';
          return false;
      });
      setDocuments(needingReview);
      setLoading(false);
      setIndexErrorUrl(null);
    }, (err: FirestoreError) => {
      if (err.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'documents', operation: 'list' }));
      } else if (err.message?.includes('requires an index')) {
        const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) setIndexErrorUrl(urlMatch[0]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [docsQuery, db]);

  useEffect(() => {
    if (!approvedQuery || !db) return;
    const unsubscribe = onSnapshot(approvedQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<DocumentType>)).filter(d => !d.receiptDocId);
      data.sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""));
      setApprovedDocs(data);
    });
    return () => unsubscribe();
  }, [approvedQuery, db]);

  useEffect(() => {
    if (!accountsQuery || !db) return;
    const unsubscribe = onSnapshot(accountsQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>));
      data.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      setAccounts(data);
    });
    return () => unsubscribe();
  }, [accountsQuery, db]);

  const filteredDocs = useMemo(() => {
    let result = documents.filter(doc => {
      if (activeTab === 'receive') {
        // ใบกำกับเงินสด: หลังบัญชียืนยันแล้วเป็น APPROVED → ไปขั้นตอนใบเสร็จ ไม่ให้ค้างในแท็บนี้
        if (doc.docType === 'TAX_INVOICE' && doc.status === 'APPROVED') return false;
        return (doc.paymentTerms === 'CASH' || !doc.paymentTerms) && doc.docType !== 'RECEIPT';
      }
      if (activeTab === 'ar') {
        return doc.paymentTerms === 'CREDIT' && doc.docType !== 'RECEIPT';
      }
      if (activeTab === 'receipts') {
        return doc.docType === 'RECEIPT';
      }
      return false;
    });

    if (searchTerm.trim()) {
      result = result.filter((doc) => matchesInboxSearch(doc, searchTerm));
    }
    return result;
  }, [documents, activeTab, searchTerm]);

  const filteredApprovedDocs = useMemo(() => {
    if (!searchTerm.trim()) return approvedDocs;
    return approvedDocs.filter((d) => matchesInboxSearch(d, searchTerm));
  }, [approvedDocs, searchTerm]);

  const receiptDocsInInbox = useMemo(
    () => documents.filter((d) => d.docType === "RECEIPT"),
    [documents]
  );

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const callCloseJobFunction = async (jobId: string, paymentStatus: 'PAID' | 'UNPAID' = 'UNPAID') => {
    if (!firebaseApp) return;
    const functions = getFunctions(firebaseApp, 'us-central1');
    const closeJob = httpsCallable(functions, "closeJobAfterAccounting");
    setClosingJobId(jobId);
    try {
      const result: any = await closeJob({ jobId, paymentStatus });
      if (result.data?.ok) {
        toast({ title: "ย้ายงานเข้าประวัติสำเร็จ", description: "ใบงานถูกปิดและเก็บลงประวัติเรียบร้อยแล้วค่ะ" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "ย้ายเข้าประวัติไม่สำเร็จ", description: "กรุณาแจ้งแอดมินเพื่อตรวจสอบข้อมูล" });
    } finally {
      setClosingJobId(null);
    }
  };

  const handleUpdatePaymentLine = (index: number, field: 'accountId' | 'amount', value: any) => {
    setSuggestedPayments(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleOpenConfirmDialog = (docObj: WithId<DocumentType>) => {
    setConfirmingDoc(docObj);
    setSelectedPaymentDate(docObj.docDate || format(new Date(), "yyyy-MM-dd"));
    
    if (docObj.suggestedPayments && docObj.suggestedPayments.length > 0) {
      setSuggestedPayments(docObj.suggestedPayments.map(p => ({ accountId: p.accountId, amount: p.amount })));
    } else {
      const defaultAccount = accounts.find(a => a.type === 'CASH') || accounts[0];
      setSuggestedPayments([{ accountId: defaultAccount?.id || "", amount: docObj.grandTotal }]);
    }
    setConfirmError(null);
  };

  const handleApproveSaleDocument = async () => {
    if (!db || !profile || !confirmingDoc) return;
    setConfirmError(null);
    const vdPay = validateAccountingEntryDate(selectedPaymentDate);
    if (!vdPay.ok) {
      setConfirmError(vdPay.message);
      return;
    }
    const payYmd = vdPay.normalized;
    setIsSubmitting(true);
    const jobId = confirmingDoc.jobId;
    const isDeliveryNote = confirmingDoc.docType === 'DELIVERY_NOTE';

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'documents', confirmingDoc.id);
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        const d = docSnap.data() as DocumentType;

        let jobSnap = null;
        if (jobId) {
            const jobRef = doc(db, 'jobs', jobId);
            jobSnap = await transaction.get(jobRef);
        }

        const customerName = d.customerSnapshot?.name || 'ลูกค้าทั่วไป';
        const finalPayments = suggestedPayments.map(p => {
            const acc = accounts.find(a => a.id === p.accountId);
            return { ...p, method: acc?.type === 'CASH' ? 'CASH' : 'TRANSFER' as const };
        });

        if (isDeliveryNote) {
            const payLines = finalPayments
                .map(p => ({ ...p, amount: roundMoney(p.amount || 0) }))
                .filter(p => p.amount > 0.01);
            const sumPaid = roundMoney(payLines.reduce((s, p) => s + p.amount, 0));
            const arBalance = roundMoney(Math.max(0, (d.grandTotal || 0) - sumPaid));
            if (sumPaid > (d.grandTotal || 0) + 0.01) {
                throw new Error("ยอดรับเงินรวมเกินยอดบิล กรุณาตรวจสอบจำนวนเงิน");
            }

            payLines.forEach((p, idx) => {
                const entryId = idx === 0 ? `AUTO_CASH_${d.id}` : `AUTO_CASH_${d.id}__${idx}`;
                const entryRef = doc(db, 'accountingEntries', entryId);
                transaction.set(
                    entryRef,
                    sanitizeForFirestore({
                        entryType: 'CASH_IN',
                        entryDate: payYmd,
                        amount: p.amount,
                        accountId: p.accountId,
                        paymentMethod: p.method,
                        categoryMain: 'งานซ่อม',
                        categorySub: 'หน้าร้าน (CARS)',
                        description: `รับเงินสด/โอนตามใบส่งของ: ${d.docNo} (${customerName})`,
                        sourceDocType: 'DELIVERY_NOTE',
                        sourceDocId: d.id,
                        sourceDocNo: d.docNo,
                        customerNameSnapshot: customerName,
                        createdAt: serverTimestamp(),
                    })
                );
            });

            if (arBalance > 0.01) {
                const arId = `AR_${d.id}`;
                const arRef = doc(db, 'accountingObligations', arId);
                transaction.set(
                    arRef,
                    sanitizeForFirestore({
                        id: arId,
                        type: 'AR',
                        status: 'UNPAID',
                        sourceDocType: 'DELIVERY_NOTE',
                        sourceDocId: d.id,
                        sourceDocNo: d.docNo,
                        amountTotal: arBalance,
                        amountPaid: 0,
                        balance: arBalance,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        customerNameSnapshot: customerName,
                        customerId: d.customerId || d.customerSnapshot?.id || null,
                        jobId: jobId || null,
                        dueDate: d.dueDate || null,
                        docDate: d.docDate || null,
                    })
                );
            }

            const fullySettled = arBalance <= 0.01;
            const hasImmediateCash = payLines.length > 0;
            const docArStatus: NonNullable<DocumentType['arStatus']> = fullySettled
                ? 'PAID'
                : hasImmediateCash
                  ? 'PARTIAL'
                  : 'UNPAID';
            const targetStatus = (fullySettled
                ? 'PAID'
                : hasImmediateCash
                  ? 'PARTIAL'
                  : 'UNPAID') as DocumentType['status'];
            const psStatus = fullySettled
                ? 'PAID'
                : hasImmediateCash
                  ? 'PARTIAL'
                  : 'UNPAID';

            transaction.update(docRef, {
                status: targetStatus,
                arStatus: docArStatus,
                paymentSummary: {
                    paidTotal: sumPaid,
                    balance: arBalance,
                    paymentStatus: psStatus,
                },
                paymentDate: payYmd,
                updatedAt: serverTimestamp(),
                ...(arBalance > 0.01
                    ? { arObligationId: `AR_${d.id}` as const }
                    : { arObligationId: deleteField() }),
                ...(hasImmediateCash
                    ? { accountingEntryId: `AUTO_CASH_${d.id}` as const, receivedAccountId: payLines[0]!.accountId }
                    : { accountingEntryId: deleteField(), receivedAccountId: deleteField() }),
            });

            if (jobId && jobSnap && jobSnap.exists()) {
                transaction.update(doc(db, 'jobs', jobId), {
                    status: 'CLOSED',
                    updatedAt: serverTimestamp(),
                    lastActivityAt: serverTimestamp(),
                });

                const activityRef = doc(collection(doc(db, 'jobs', jobId), 'activities'));
                const actText =
                    hasImmediateCash && arBalance > 0.01
                        ? `ฝ่ายบัญชีบันทึกรับเงิน ฿${formatCurrency(sumPaid)} และตั้งลูกหนี้ ฿${formatCurrency(arBalance)} ตาม ${d.docNo} แล้วปิดงาน`
                        : hasImmediateCash
                          ? `ฝ่ายบัญชียืนยันรับเงินเต็มจำนวน ฿${formatCurrency(sumPaid)} เลขที่บิล: ${d.docNo} แล้วปิดงาน`
                          : `ฝ่ายบัญชียืนยันตั้งลูกหนี้เต็มจำนวน ฿${formatCurrency(d.grandTotal)} ตาม ${d.docNo} แล้วปิดงาน`;
                transaction.set(activityRef, {
                    text: actText,
                    userName: profile.displayName,
                    userId: profile.uid,
                    createdAt: serverTimestamp(),
                });
            }
        } else {
            const arId = `AR_${confirmingDoc.id}`;
            const arRef = doc(db, 'accountingObligations', arId);

            transaction.update(docRef, { 
                status: 'APPROVED', 
                arStatus: 'UNPAID', 
                paymentSummary: { paidTotal: 0, balance: confirmingDoc.grandTotal, paymentStatus: 'UNPAID' },
                suggestedPayments: finalPayments,
                paymentDate: payYmd,
                arObligationId: arId,
                updatedAt: serverTimestamp()
            });

            transaction.set(arRef, sanitizeForFirestore({
                id: arId,
                type: 'AR', 
                status: 'UNPAID', 
                sourceDocType: confirmingDoc.docType, 
                sourceDocId: confirmingDoc.id, 
                sourceDocNo: confirmingDoc.docNo,
                amountTotal: confirmingDoc.grandTotal, 
                amountPaid: 0, 
                balance: confirmingDoc.grandTotal,
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp(), 
                customerNameSnapshot: customerName,
                customerId: confirmingDoc.customerId || confirmingDoc.customerSnapshot?.id || null,
                jobId: jobId || null,
                dueDate: confirmingDoc.dueDate || null,
                docDate: confirmingDoc.docDate || null,
            }));

            if (jobId && jobSnap && jobSnap.exists()) {
                const jobRef = doc(db, 'jobs', jobId);
                transaction.update(jobRef, { 
                    status: 'PICKED_UP',
                    updatedAt: serverTimestamp(),
                    lastActivityAt: serverTimestamp()
                });

                const activityRef = doc(collection(jobRef, 'activities'));
                transaction.set(activityRef, {
                    text: `ฝ่ายบัญชีตรวจสอบใบกำกับภาษีเลขที่: ${confirmingDoc.docNo} ถูกต้องแล้ว (รอการออกใบเสร็จ)`,
                    userName: profile.displayName,
                    userId: profile.uid,
                    createdAt: serverTimestamp()
                });
            }
        }
      });

      if (isDeliveryNote && jobId) {
          const paySum = roundMoney(
            suggestedPayments
              .filter(p => p.accountId && (p.amount || 0) > 0.01)
              .reduce((s, p) => s + (p.amount || 0), 0)
          );
          const arLeft = roundMoney(Math.max(0, (confirmingDoc.grandTotal || 0) - paySum));
          await callCloseJobFunction(jobId, arLeft > 0.01 ? 'UNPAID' : 'PAID');
      }
      
      setConfirmingDoc(null);
    } catch(e: any) {
      setConfirmError(e.message || "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispute = async () => {
    if (!db || !disputingDoc || !disputeReason.trim()) return;
    setIsSubmitting(true);
    const docRef = doc(db, 'documents', disputingDoc.id);
    const updateData = {
      status: 'REJECTED',
      dispute: { isDisputed: true, reason: disputeReason, createdAt: serverTimestamp() },
      updatedAt: serverTimestamp()
    };
    try {
      await updateDoc(docRef, updateData);
      if (disputingDoc.jobId) {
          const jobRef = doc(db, 'jobs', disputingDoc.jobId);
          const jobSnap = await getDoc(jobRef);
          if (jobSnap.exists()) {
              await addDoc(collection(jobRef, 'activities'), {
                  text: `ฝ่ายบัญชีตีกลับเอกสาร ${disputingDoc.docNo} ให้แก้ไข: ${disputeReason}`,
                  userName: profile?.displayName || "System",
                  userId: profile?.uid || "system",
                  createdAt: serverTimestamp()
              });
          }
      }
      toast({ title: "ส่งเอกสารกลับเพื่อแก้ไขแล้ว" });
      setDisputingDoc(null);
      setDisputeReason("");
    } catch(e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAR = async (docObj: WithId<DocumentType>) => {
    if (!db || !profile) return;
    setIsSubmitting(true);
    const docRef = doc(db, 'documents', docObj.id);
    const isDeliveryNote = docObj.docType === 'DELIVERY_NOTE';
    const isDebitNote = docObj.docType === 'DEBIT_NOTE';
    const isCreditNote = docObj.docType === 'CREDIT_NOTE';
    const arId = `AR_${docObj.id}`;
    const arRef = doc(db, 'accountingObligations', arId);

    try {
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(docRef);
        if (!docSnap.exists()) throw new Error("ไม่พบเอกสาร");
        const d = docSnap.data() as DocumentType;
        const customerName = d.customerSnapshot?.name || 'Unknown';

        if (isCreditNote) {
          const referencedTaxInvoiceId = d.referencesDocIds?.[0];
          if (!referencedTaxInvoiceId) throw new Error("ใบลดหนี้ต้องอ้างอิงใบกำกับภาษี");

          const referencedDocRef = doc(db, "documents", referencedTaxInvoiceId);
          const referencedDocSnap = await transaction.get(referencedDocRef);
          if (!referencedDocSnap.exists()) throw new Error("ไม่พบใบกำกับภาษีอ้างอิง");
          const referencedDoc = referencedDocSnap.data() as DocumentType;

          const creditAmount = Math.max(0, d.grandTotal || 0);
          const cnArId = `AR_${docObj.id}`;
          const cnArRef = doc(db, "accountingObligations", cnArId);

          transaction.set(
            cnArRef,
            sanitizeForFirestore({
              id: cnArId,
              type: "AR",
              status: "UNPAID",
              sourceDocType: "CREDIT_NOTE",
              sourceDocId: docObj.id,
              sourceDocNo: d.docNo,
              amountTotal: creditAmount,
              amountPaid: 0,
              balance: -creditAmount,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              customerId: d.customerId || d.customerSnapshot?.id || null,
              customerNameSnapshot: customerName,
              jobId: d.jobId || null,
              dueDate: d.dueDate || null,
              docDate: d.docDate || null,
              note: `อ้างอิงใบกำกับ ${referencedDoc.docNo || referencedTaxInvoiceId} (หักยอดเก็บ)`,
            })
          );

          transaction.update(docRef, {
            status: "APPROVED",
            arStatus: "UNPAID",
            arObligationId: cnArId,
            paymentSummary: {
              paidTotal: 0,
              balance: creditAmount,
              paymentStatus: "UNPAID",
            },
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (d.docType === "DELIVERY_NOTE") {
          const payLines = (d.suggestedPayments || [])
            .map((p) => {
              const m =
                p.method ||
                (accounts.find((a) => a.id === p.accountId)?.type === "CASH" ? "CASH" : "TRANSFER");
              return {
                accountId: p.accountId,
                amount: roundMoney(p.amount || 0),
                method: m as "CASH" | "TRANSFER",
              };
            })
            .filter((p) => p.accountId && p.amount > 0.01);
          const sumPaid = roundMoney(payLines.reduce((s, p) => s + p.amount, 0));
          const arAmount = roundMoney(Math.max(0, (d.grandTotal || 0) - sumPaid));
          if (sumPaid > (d.grandTotal || 0) + 0.01) {
            throw new Error("ยอดรับเงินรวมเกินยอดบิล กรุณาตรวจสอบ (ฝ่ายออฟฟิศ/บัญชี)");
          }

          const entryDateVd = validateAccountingEntryDate(d.docDate || format(new Date(), "yyyy-MM-dd"));
          const entryYmd = entryDateVd.ok ? entryDateVd.normalized : format(new Date(), "yyyy-MM-dd");

          payLines.forEach((p, idx) => {
            const eid = idx === 0 ? `AUTO_CASH_${docObj.id}` : `AUTO_CASH_${docObj.id}__${idx}`;
            const entryRef = doc(db, "accountingEntries", eid);
            transaction.set(
              entryRef,
              sanitizeForFirestore({
                entryType: "CASH_IN",
                entryDate: entryYmd,
                amount: p.amount,
                accountId: p.accountId,
                paymentMethod: p.method,
                categoryMain: "งานซ่อม",
                categorySub: "หน้าร้าน (CARS)",
                description: `รับเงินสด/โอนตามใบส่งของ: ${d.docNo} (${customerName})`,
                sourceDocType: "DELIVERY_NOTE",
                sourceDocId: docObj.id,
                sourceDocNo: d.docNo,
                customerNameSnapshot: customerName,
                createdAt: serverTimestamp(),
              })
            );
          });

          if (d.jobId) {
            transaction.update(doc(db, "jobs", d.jobId), {
              status: "CLOSED",
              updatedAt: serverTimestamp(),
              lastActivityAt: serverTimestamp(),
            });
            const actText =
              payLines.length > 0
                ? arAmount > 0.01
                  ? `ฝ่ายบัญชีบันทึกรับเงิน ฿${formatCurrency(sumPaid)} และตั้งลูกหนี้ ฿${formatCurrency(arAmount)} ตาม ${d.docNo} แล้วปิดงาน`
                  : `ฝ่ายบัญชียืนยันรับเงินเต็มจำนวน ฿${formatCurrency(sumPaid)} ตาม ${d.docNo} แล้วปิดงาน`
                : `ฝ่ายบัญชียืนยันตั้งยอดค้างชำระ (Credit) ฿${formatCurrency(d.grandTotal)} ตามเลขที่บิล: ${d.docNo} แล้วปิดงาน`;
            const activityRef = doc(collection(doc(db, "jobs", d.jobId), "activities"));
            transaction.set(activityRef, {
              text: actText,
              userName: profile.displayName,
              userId: profile.uid,
              createdAt: serverTimestamp(),
            });
          }

          if (arAmount > 0.01) {
            const dnArRef = doc(db, "accountingObligations", arId);
            transaction.set(
              dnArRef,
              sanitizeForFirestore({
                id: arId,
                type: "AR",
                status: "UNPAID",
                sourceDocType: "DELIVERY_NOTE",
                sourceDocId: docObj.id,
                sourceDocNo: d.docNo,
                amountTotal: arAmount,
                amountPaid: 0,
                balance: arAmount,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                customerId: d.customerId || d.customerSnapshot?.id || null,
                customerNameSnapshot: customerName,
                jobId: d.jobId || null,
                dueDate: d.dueDate || null,
                docDate: d.docDate || null,
              })
            );
          }

          const noCreditLeft = arAmount <= 0.01;
          const hasCash = payLines.length > 0;
          const arSt: NonNullable<DocumentType["arStatus"]> = noCreditLeft
            ? "PAID"
            : hasCash
              ? "PARTIAL"
              : "UNPAID";
          const docStat = noCreditLeft
            ? "PAID"
            : hasCash
              ? "PARTIAL"
              : "UNPAID";
          const ps: NonNullable<DocumentType["paymentSummary"]>["paymentStatus"] = noCreditLeft
            ? "PAID"
            : hasCash
              ? "PARTIAL"
              : "UNPAID";

          transaction.update(docRef, {
            status: docStat as DocumentType["status"],
            arStatus: arSt,
            paymentSummary: { paidTotal: sumPaid, balance: arAmount, paymentStatus: ps },
            updatedAt: serverTimestamp(),
            paymentDate: entryYmd,
            ...(arAmount > 0.01 ? { arObligationId: arId } : { arObligationId: deleteField() }),
            ...(hasCash
              ? { accountingEntryId: `AUTO_CASH_${docObj.id}`, receivedAccountId: payLines[0]!.accountId }
              : { accountingEntryId: deleteField(), receivedAccountId: deleteField() }),
          });
          return;
        }

        if (d.jobId) {
          transaction.update(doc(db, "jobs", d.jobId), {
            status: "PICKED_UP",
            updatedAt: serverTimestamp(),
            lastActivityAt: serverTimestamp(),
          });
          const activityRef = doc(collection(doc(db, "jobs", d.jobId), "activities"));
          transaction.set(activityRef, {
            text: `ฝ่ายบัญชียืนยันตั้งยอดค้างชำระ (Credit) ตามเลขที่บิล: ${d.docNo}`,
            userName: profile.displayName,
            userId: profile.uid,
            createdAt: serverTimestamp(),
          });
        }

        transaction.set(
          arRef,
          sanitizeForFirestore({
            id: arId,
            type: "AR",
            status: "UNPAID",
            sourceDocType: d.docType,
            sourceDocId: docObj.id,
            sourceDocNo: d.docNo,
            amountTotal: d.grandTotal,
            amountPaid: 0,
            balance: d.grandTotal,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            customerId: d.customerId || d.customerSnapshot?.id || null,
            customerNameSnapshot: customerName,
            jobId: d.jobId || null,
            dueDate: d.dueDate || null,
            docDate: d.docDate || null,
          })
        );

        const targetDocStatus: DocumentType["status"] = isDebitNote ? "UNPAID" : "APPROVED";
        transaction.update(docRef, {
          status: targetDocStatus,
          arStatus: "UNPAID",
          paymentSummary: { paidTotal: 0, balance: d.grandTotal, paymentStatus: "UNPAID" },
          arObligationId: arId,
          updatedAt: serverTimestamp(),
        });
      });
      toast({
        title: isCreditNote ? "อนุมัติใบลดหนี้สำเร็จ" : "ตั้งยอดลูกหนี้สำเร็จ",
        description: isCreditNote ? "แสดงในหน้าลูกหนี้และรวมในรอบวางบิลได้ (ยอดหักเป็นลบ)" : undefined,
      });
      if (isDeliveryNote && docObj.jobId) {
        const paySum = roundMoney(
          (docObj.suggestedPayments || [])
            .filter((p) => p?.accountId && (p.amount || 0) > 0.01)
            .reduce((s, p) => s + (p.amount || 0), 0)
        );
        const arLeft = roundMoney(Math.max(0, (docObj.grandTotal || 0) - paySum));
        await callCloseJobFunction(docObj.jobId, arLeft > 0.01 ? "UNPAID" : "PAID");
      }
      setArDocToConfirm(null);
    } catch(e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** ลบเอกสารจาก Inbox (เฉพาะ Admin) — ล้าง obligation/claim ที่อ้าง sourceDocId เดียวกัน */
  const handleDeleteInboxDocument = async (docObj: WithId<DocumentType>) => {
    if (!db || !profile || !isStrictAdmin) return;
    if (
      !confirm(
        `ยืนยันลบเอกสาร ${docObj.docNo} ออกจากระบบอย่างถาวร?\nการกระทำนี้ไม่สามารถยกเลิกได้`
      )
    )
      return;

    setIsSubmitting(true);
    try {
      const docRef = doc(db, "documents", docObj.id);
      const mainDocSnap = await getDoc(docRef);

      const [obSnap, entrySnap, claimSnap] = await Promise.all([
        getDocs(query(collection(db, "accountingObligations"), where("sourceDocId", "==", docObj.id))),
        getDocs(query(collection(db, "accountingEntries"), where("sourceDocId", "==", docObj.id))),
        getDocs(query(collection(db, "paymentClaims"), where("sourceDocId", "==", docObj.id))),
      ]);

      const batch = writeBatch(db);
      obSnap.docs.forEach((d) => batch.delete(d.ref));
      entrySnap.docs.forEach((d) => batch.delete(d.ref));
      claimSnap.docs.forEach((d) => batch.delete(d.ref));

      if (docObj.jobId) {
        const jobRef = doc(db, "jobs", docObj.jobId);
        const jobSnap = await getDoc(jobRef);
        if (jobSnap.exists()) {
          const jobData = jobSnap.data();
          if (jobData.salesDocId === docObj.id) {
            batch.update(jobRef, {
              status: "DONE",
              salesDocId: deleteField(),
              salesDocNo: deleteField(),
              salesDocType: deleteField(),
              lastActivityAt: serverTimestamp(),
            });
            batch.set(doc(collection(jobRef, "activities")), {
              text: `[Admin] ลบเอกสาร ${docObj.docNo} จาก Inbox — คืนสถานะงานเพื่อออกบิลใหม่`,
              userName: profile.displayName,
              userId: profile.uid,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      if (mainDocSnap.exists()) {
        batch.delete(docRef);
      }
      await batch.commit();

      if (docObj.docType === "BILLING_NOTE") {
        const monthId = docObj.billingRunId || docObj.docDate?.substring(0, 7);
        const customerId = docObj.customerId || docObj.customerSnapshot?.id;
        if (monthId && customerId) {
          try {
            await updateDoc(doc(db, "billingRuns", monthId), {
              [`createdBillingNotes.${customerId}`]: deleteField(),
              updatedAt: serverTimestamp(),
            });
          } catch {
            /* ignore */
          }
        }
      }

      toast({
        title: mainDocSnap.exists() ? "ลบเอกสารแล้ว" : "ล้างรายการที่ค้างแล้ว",
        description: mainDocSnap.exists()
          ? undefined
          : "เอกสารหลักถูกลบไปก่อนแล้ว — ระบบล้างข้อมูลที่เกี่ยวข้องให้แล้ว",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteReceipt = async (receipt: WithId<DocumentType>) => {
    if (!db || !profile || !isUserAdmin) return;
    if (!confirm(`ยืนยันการลบใบเสร็จเลขที่ ${receipt.docNo} ใช่หรือไม่?`)) return;
    
    setIsSubmitting(true);
    try {
        const batch = writeBatch(db);
        if (receipt.referencesDocIds && receipt.referencesDocIds.length > 0) {
            for (const docId of receipt.referencesDocIds) {
                batch.update(doc(db, 'documents', docId), {
                    receiptStatus: deleteField(),
                    receiptDocId: deleteField(),
                    receiptDocNo: deleteField(),
                    updatedAt: serverTimestamp()
                });
            }
        }
        batch.delete(doc(db, 'documents', receipt.id));
        await batch.commit();
        toast({ title: "ลบใบเสร็จเรียบร้อยแล้ว" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };

  if (authLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
  if (!hasPermission) return <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4"><AlertCircle className="h-12 w-12 text-destructive/50" /><p className="text-lg">ไม่มีสิทธิ์เข้าถึง</p></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Inbox บัญชี (ตรวจสอบรายการขาย)" description="ตรวจสอบความถูกต้องของบิลก่อนลงสมุดบัญชีรายวัน" />
      
      {indexCreationUrl && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องสร้างดัชนี (Index) ก่อนดูรายการ</AlertTitle>
          <Button asChild variant="outline" size="sm" className="mt-2 bg-white text-destructive">
            <a href={indexCreationUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />สร้าง Index</a>
          </Button>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <TabsList>
            <TabsTrigger value="receive">รอตรวจสอบ (Cash/Mixed)</TabsTrigger>
            <TabsTrigger value="ar">รอตั้งลูกหนี้ (Credit)</TabsTrigger>
            <TabsTrigger value="receipts">ขั้นตอนใบเสร็จ</TabsTrigger>
          </TabsList>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="ค้นหาเลขที่เอกสาร, ชื่อลูกค้า..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10"/>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <TabsContent value="receive" className="mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>เอกสาร</TableHead>
                    <TableHead>ยอดเงิน</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                  ) : filteredDocs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">ไม่มีรายการรอตรวจสอบ (Cash)</TableCell></TableRow>
                  ) : filteredDocs.map(docItem => (
                    <TableRow key={docItem.id}>
                      <TableCell>{safeFormat(new Date(docItem.docDate))}</TableCell>
                      <TableCell>{docItem.customerSnapshot?.name || '--'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{docItem.docNo}</div>
                        <div className="text-xs text-muted-foreground">{docTypeThaiLabel(docItem.docType)}</div>
                        {docItem.jobId && <Badge variant="outline" className="text-[8px] h-4 mt-1 bg-blue-50">มี Job ผูกอยู่</Badge>}
                      </TableCell>
                      <TableCell className="font-bold text-primary">{formatCurrency(docItem.grandTotal)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {closingJobId === docItem.jobId ? (
                            <Badge variant="outline" className="animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin"/> ปิดจ๊อบ...</Badge>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={docViewHref(docItem, "receive")}>
                                    <Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleOpenConfirmDialog(docItem)} className="text-green-600 focus:text-green-600 font-bold">
                                  <CheckCircle className="mr-2 h-4 w-4"/> ยืนยันตรวจสอบและรับเงิน
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDisputingDoc(docItem)} className="text-destructive focus:text-destructive">
                                  <Ban className="mr-2 h-4 w-4"/> ตีกลับให้แก้ไข
                                </DropdownMenuItem>
                                {isStrictAdmin && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() => handleDeleteInboxDocument(docItem)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> ลบ
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="ar" className="mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>เอกสาร</TableHead>
                    <TableHead>ยอดเงิน</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                  ) : filteredDocs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">ไม่มีรายการรอตั้งลูกหนี้ (Credit)</TableCell></TableRow>
                  ) : filteredDocs.map(docItem => (
                    <TableRow key={docItem.id}>
                      <TableCell>{safeFormat(new Date(docItem.docDate))}</TableCell>
                      <TableCell>{docItem.customerSnapshot?.name || '--'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{docItem.docNo}</div>
                        <div className="text-xs text-muted-foreground">{docTypeThaiLabel(docItem.docType)}</div>
                        {docItem.jobId && <Badge variant="outline" className="text-[8px] h-4 mt-1 bg-blue-50">มี Job ผูกอยู่</Badge>}
                      </TableCell>
                      <TableCell className="font-bold text-amber-600">{formatCurrency(docItem.grandTotal)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {closingJobId === docItem.jobId ? (
                            <Badge variant="outline" className="animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin"/> ปิดจ๊อบ...</Badge>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={docViewHref(docItem, "ar")}>
                                    <Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setArDocToConfirm(docItem)} disabled={isSubmitting} className="font-bold text-amber-600 focus:text-amber-600">
                                  <HandCoins className="mr-2 h-4 w-4"/> {docItem.docType === 'CREDIT_NOTE' ? "อนุมัติและปรับยอดลูกหนี้" : "ยืนยันตั้งลูกหนี้"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDisputingDoc(docItem)} className="text-destructive focus:text-destructive">
                                  <Ban className="mr-2 h-4 w-4"/> ตีกลับให้แก้ไข
                                </DropdownMenuItem>
                                {isStrictAdmin && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() => handleDeleteInboxDocument(docItem)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> ลบ
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="receipts" className="mt-0 space-y-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2"><Info className="h-5 w-5 text-primary"/> 1. เอกสารที่ตรวจสอบแล้ว (รอออกใบเสร็จ)</h3>
                    <Badge variant="outline" className="bg-primary/5">
                      {searchTerm.trim() ? `${filteredApprovedDocs.length} / ${approvedDocs.length}` : filteredApprovedDocs.length} รายการ
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">ลิงก์เดียวกับหน้าลูกหนี้/เจ้าหนี้ — ออกใบเสร็จได้จากใบกำกับภาษี/ใบเพิ่มหนี้ ส่วนใบส่งของรับเงินที่หน้าลูกหนี้</p>
                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow>
                            <TableHead>เลขที่บิล</TableHead>
                            <TableHead>ลูกค้า</TableHead>
                            <TableHead className="text-right">ยอดเงิน</TableHead>
                            <TableHead className="text-right">จัดการ</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredApprovedDocs.length > 0 ? (
                          filteredApprovedDocs.map((docItem) => (
                            <TableRow key={docItem.id}>
                                <TableCell className="font-mono text-xs">{docItem.docNo}</TableCell>
                                <TableCell className="text-sm">{docItem.customerSnapshot?.name}</TableCell>
                                <TableCell className="text-right font-bold">{formatCurrency(docItem.grandTotal)}</TableCell>
                                <TableCell className="text-right">
                                    <Button asChild size="sm" variant="default" className="h-8">
                                        <Link href={`/app/management/accounting/documents/receipt?tab=new&customerId=${encodeURIComponent(docItem.customerId || "")}&sourceDocId=${docItem.id}&presetAmount=${encodeURIComponent(String(docItem.paymentSummary?.balance ?? docItem.grandTotal))}`}>
                                            <PlusCircle className="mr-2 h-4 w-4"/> ออกใบเสร็จ
                                        </Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                          ))
                        ) : approvedDocs.length > 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="h-20 text-center text-muted-foreground italic text-xs">
                                ไม่พบรายการที่ตรงกับ &quot;{searchTerm.trim()}&quot; — ลองเลขที่บิลหรือชื่อลูกค้า
                              </TableCell>
                            </TableRow>
                        ) : (
                            <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground italic text-xs">ไม่มีบิลค้างในขั้นตอนนี้</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-600"/> 2. ใบเสร็จที่รอตรวจสอบรับเงินจริง</h3>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  หลังออกใบเสร็จจากหน้านี้หรือจากหน้าลูกหนี้ รายการจะมาอยู่ที่นี่เหมือนกัน
                </p>
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead>เลขที่ใบเสร็จ</TableHead>
                        <TableHead>ยอดเงิน</TableHead>
                        <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {filteredDocs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center h-24 text-muted-foreground italic">
                            {receiptDocsInInbox.length > 0 && searchTerm.trim()
                              ? `ไม่พบรายการที่ตรงกับ "${searchTerm.trim()}" — ลองเลขที่ใบเสร็จหรือชื่อลูกค้า`
                              : "ไม่มีใบเสร็จที่รอยืนยันเงินเข้า"}
                          </TableCell>
                        </TableRow>
                    ) : filteredDocs.map(docItem => (
                        <TableRow key={docItem.id}>
                        <TableCell>{safeFormat(new Date(docItem.docDate))}</TableCell>
                        <TableCell>{docItem.customerSnapshot?.name || '--'}</TableCell>
                        <TableCell>
                            <div className="font-medium">{docItem.docNo}</div>
                            <div className="text-xs text-muted-foreground">อ้างอิง: {docItem.referencesDocIds?.join(', ') || '-'}</div>
                        </TableCell>
                        <TableCell className="font-bold text-green-600">{formatCurrency(docItem.grandTotal)}</TableCell>
                        <TableCell className="text-right">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                        <Link href={`/app/office/documents/${docItem.id}?from=inbox&tab=receipts`}>
                                            <Eye className="mr-2 h-4 w-4" /> ดูเอกสาร
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => router.push(`/app/management/accounting/documents/receipt/${docItem.id}/confirm`)} className="text-green-600 focus:text-green-600 font-bold">
                                        <CheckCircle2 className="mr-2 h-4 w-4" /> ยืนยันรับเงินจริง
                                    </DropdownMenuItem>
                                    {isUserAdmin && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleDeleteReceipt(docItem)} className="text-destructive focus:text-destructive">
                                                <Trash2 className="mr-2 h-4 w-4" /> ลบใบเสร็จ
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      <Dialog open={!!confirmingDoc} onOpenChange={(open) => !open && !isSubmitting && setConfirmingDoc(null)}>
        <DialogContent onInteractOutside={(e) => isSubmitting && e.preventDefault()} className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>ตรวจสอบรายการขาย</DialogTitle>
            <DialogDescription>
                {confirmingDoc?.docType === 'DELIVERY_NOTE' 
                  ? "ยืนยันการรับเงินสด/โอน และปิดงานซ่อมทันที" 
                  : "ตรวจสอบความถูกต้องของบิลก่อนส่งไปขั้นตอนออกใบเสร็จ"}
            </DialogDescription>
          </DialogHeader>
          
          {confirmError && (
            <div className="px-6 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>บันทึกไม่สำเร็จ</AlertTitle>
                <AlertDescription className="text-xs">{confirmError}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 text-center">
                <p className="text-sm text-muted-foreground">ยอดเงินรวมบิล</p>
                <p className="text-3xl font-black text-primary">฿{formatCurrency(confirmingDoc?.grandTotal ?? 0)}</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Calendar className="h-4 w-4"/> วันที่ออกเอกสาร</Label>
                    <Input type="date" className="w-40" value={selectedPaymentDate} onChange={(e) => setSelectedPaymentDate(e.target.value)} disabled={isSubmitting} />
                </div>

                <div className="space-y-3">
                    <Label className="flex items-center gap-2"><Wallet className="h-4 w-4" /> รายการรับเงิน (ตามที่ออฟฟิศระบุ)</Label>
                    <div className="border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>บัญชี (Account)</TableHead>
                                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {suggestedPayments.map((p, index) => (
                                    <TableRow key={index}>
                                        <TableCell className="p-2">
                                            <Select value={p.accountId} onValueChange={(v) => handleUpdatePaymentLine(index, 'accountId', v)} disabled={isSubmitting}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
                                                <SelectContent>
                                                    {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'โอน'})</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="p-2 text-right">
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-bold text-xs" 
                                                value={p.amount || ''} 
                                                onChange={(e) => handleUpdatePaymentLine(index, 'amount', parseFloat(e.target.value) || 0)} 
                                                disabled={isSubmitting} 
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2 text-xs text-amber-800">
                        <Info className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                            <p className="font-bold">ขั้นตอนการบันทึกบัญชี</p>
                            {confirmingDoc?.docType === 'DELIVERY_NOTE' ? (
                                <p>เมื่อกดปุ่มด้านล่าง ระบบจะบันทึกรายรับเข้าสมุดบัญชี ปรับสถานะบิลเป็น "รับเงินแล้ว" และ <b>ปิดงานซ่อมย้ายเข้าประวัติทันที</b> ค่ะ</p>
                            ) : (
                                <>
                                    <p>เมื่อกดปุ่มด้านล่าง ระบบจะบันทึกสถานะบิลว่า "ตรวจสอบแล้ว" และเปิดให้ไปออกใบเสร็จรับเงินได้</p>
                                    <p className="text-destructive font-bold">เงินจะยังไม่เข้าบัญชีจริง จนกว่าใบเสร็จจะถูกสร้างและยืนยันรับเงินในภายหลังค่ะ</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
              </div>
          </div>
          <DialogFooter className="gap-2 bg-muted/20 p-6 border-t">
            <Button variant="outline" onClick={() => setConfirmingDoc(null)} disabled={isSubmitting}>ยกเลิก</Button>
            <Button onClick={handleApproveSaleDocument} disabled={isSubmitting || suggestedPayments.some(p => p.amount > 0 && !p.accountId)} className="bg-green-600 hover:bg-green-700 text-white min-w-[200px]">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 animate-spin h-4 w-4" />
                    กำลังบันทึก...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {confirmingDoc?.docType === 'DELIVERY_NOTE' ? "ยืนยันรับเงินและปิดงาน" : "ยืนยันความถูกต้องของรายการ"}
                  </>
                )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disputingDoc} onOpenChange={(open) => !open && setDisputingDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ส่งเอกสารกลับเพื่อแก้ไข</DialogTitle>
            <DialogDescription>สำหรับเอกสารเลขที่: {disputingDoc?.docNo}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="reason">ระบุเหตุผลที่ไม่ถูกต้อง</Label>
            <Textarea id="reason" placeholder="เช่น ยอดเงินไม่ตรง, เลือกประเภทลูกค้าผิด..." value={disputeReason} onChange={e => setDisputeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputingDoc(null)} disabled={isSubmitting}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDispute} disabled={isSubmitting || !disputeReason}>{isSubmitting && <Loader2 className="mr-2 animate-spin" />}ยืนยันตีกลับ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!arDocToConfirm} onOpenChange={(open) => !open && setArDocToConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันตั้งยอดลูกหนี้</AlertDialogTitle>
            <AlertDialogDescription>
              {arDocToConfirm?.docType === 'CREDIT_NOTE'
                ? `ยืนยันการอนุมัติใบลดหนี้และหักยอดลูกหนี้จำนวน ${formatCurrency(arDocToConfirm?.grandTotal || 0)} บาท สำหรับลูกค้า ${arDocToConfirm?.customerSnapshot?.name}`
                : `ยืนยันการตั้งยอดค้างชำระ (AR) จำนวน ${formatCurrency(arDocToConfirm?.grandTotal || 0)} บาท สำหรับลูกค้า ${arDocToConfirm?.customerSnapshot?.name}`}
              {arDocToConfirm?.docType === 'DELIVERY_NOTE' && <p className="mt-2 font-bold text-primary">ระบบจะทำการปิดงานซ่อมนี้ให้ทันทีหลังจากตั้งลูกหนี้ค่ะ</p>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => arDocToConfirm && handleCreateAR(arDocToConfirm)}>ตกลง ยืนยันข้อมูล</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

export default function AccountingInboxPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
            <AccountingInboxPageContent />
        </Suspense>
    );
}
