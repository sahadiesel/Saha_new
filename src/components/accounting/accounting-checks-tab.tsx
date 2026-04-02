"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  doc,
  writeBatch,
  serverTimestamp,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  runTransaction,
} from "firebase/firestore";
import { format, parseISO, isBefore, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { UserProfile, Customer, Document as SalesDocument, AccountingObligation, DocumentSettings, StoreSettings, PurchaseDoc } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Plus, Pencil, Trash2, MoreHorizontal, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { AccountingAccount, AccountingCheckItem, DocType } from "@/lib/types";
import type { Firestore } from "firebase/firestore";
import type { WithId } from "@/firebase/index";
import { sanitizeForFirestore } from "@/lib/utils";
import { validateAccountingEntryDate } from "@/lib/accounting-entry-date";

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function receiveAnchorTh(t: string | undefined) {
  if (t === "RECEIPT") return "ใบเสร็จ";
  if (t === "DELIVERY_NOTE") return "ใบส่งของ";
  if (t === "BILLING_NOTE") return "ใบวางบิล";
  return "";
}

function formatReceiveRef(row: AccountingCheckItem): string {
  const t = row.receiveAnchorDocType;
  const no = row.receiveAnchorDocNo;
  if (t && no) return `${receiveAnchorTh(t)} ${no}`;
  if (row.receiptDocNo) return `ใบเสร็จ ${row.receiptDocNo}`;
  return row.notes || "—";
}

function isEligibleReceiveAnchorDoc(d: SalesDocument): boolean {
  const s = (d.status || "").toUpperCase();
  if (d.docType === "TAX_INVOICE" || d.docType === "QUOTATION") return false;
  if (d.docType === "RECEIPT") return s === "ISSUED";
  if (d.docType === "DELIVERY_NOTE") return s !== "CANCELLED";
  if (d.docType === "BILLING_NOTE") return s !== "CANCELLED" && s !== "PAID";
  return false;
}

function suggestedAnchorAmount(d: SalesDocument): number {
  if (d.docType === "RECEIPT") return Number(d.grandTotal) || 0;
  const b = d.paymentSummary?.balance;
  if (typeof b === "number" && !Number.isNaN(b)) return b;
  return Number(d.grandTotal) || 0;
}

type Props = {
  db: Firestore | null;
  accounts: WithId<AccountingAccount>[];
  profile: UserProfile | null;
};

export function AccountingChecksTab({ db, accounts, profile }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<WithId<AccountingCheckItem>[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<WithId<AccountingCheckItem> | null>(null);
  const [clearedDate, setClearedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const [addOpen, setAddOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [addCustomerId, setAddCustomerId] = useState("");
  const [addCustomerSearch, setAddCustomerSearch] = useState("");
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [addCandidateDocs, setAddCandidateDocs] = useState<SalesDocument[]>([]);
  const [addSelectedDocId, setAddSelectedDocId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDue, setAddDue] = useState(format(new Date(), "yyyy-MM-dd"));
  const [addAccountId, setAddAccountId] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);
  const [addPayOpen, setAddPayOpen] = useState(false);
  const [apObligations, setApObligations] = useState<WithId<AccountingObligation>[]>([]);
  const [addPayObligationId, setAddPayObligationId] = useState("");
  const [addPayAmount, setAddPayAmount] = useState("");
  const [addPayDue, setAddPayDue] = useState(format(new Date(), "yyyy-MM-dd"));
  const [addPayAccountId, setAddPayAccountId] = useState("");
  const [addPayNotes, setAddPayNotes] = useState("");
  const [addPayWithholdingEnabled, setAddPayWithholdingEnabled] = useState(false);
  const [addPayWithholdingPercent, setAddPayWithholdingPercent] = useState("3");
  const [savingAddPay, setSavingAddPay] = useState(false);

  const [editItem, setEditItem] = useState<WithId<AccountingCheckItem> | null>(null);
  const [editDue, setEditDue] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<WithId<AccountingCheckItem> | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, "accountingCheckItems"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingCheckItem>)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    });
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db || !addOpen || !addCustomerId) {
      if (!addCustomerId) setAddCandidateDocs([]);
      return;
    }
    const q = query(collection(db, "documents"), where("customerId", "==", addCustomerId), limit(150));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SalesDocument));
        const filtered = all
          .filter(isEligibleReceiveAnchorDoc)
          .sort((a, b) => (b.docDate || "").localeCompare(a.docDate || ""));
        setAddCandidateDocs(filtered);
      },
      () => setAddCandidateDocs([])
    );
    return () => unsub();
  }, [db, addOpen, addCustomerId]);

  useEffect(() => {
    if (!addSelectedDocId) return;
    const d = addCandidateDocs.find((x) => x.id === addSelectedDocId);
    if (d) setAddAmount(String(suggestedAnchorAmount(d)));
  }, [addSelectedDocId, addCandidateDocs]);

  useEffect(() => {
    if (!db || !addPayOpen) return;
    const q = query(
      collection(db, "accountingObligations"),
      where("type", "==", "AP"),
      where("status", "in", ["UNPAID", "PARTIAL"]),
      limit(300)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setApObligations(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingObligation>))
            .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
        );
      },
      () => setApObligations([])
    );
    return () => unsub();
  }, [db, addPayOpen]);

  const resetAddForm = () => {
    setAddCustomerId("");
    setAddCustomerSearch("");
    setAddCandidateDocs([]);
    setAddSelectedDocId("");
    setAddAmount("");
    setAddDue(format(new Date(), "yyyy-MM-dd"));
    setAddAccountId("");
    setAddNotes("");
  };

  const resetAddPayForm = () => {
    setAddPayObligationId("");
    setAddPayAmount("");
    setAddPayDue(format(new Date(), "yyyy-MM-dd"));
    setAddPayAccountId("");
    setAddPayNotes("");
    setAddPayWithholdingEnabled(false);
    setAddPayWithholdingPercent("3");
  };

  const receivePending = useMemo(
    () => items.filter((i) => i.direction === "RECEIVE" && i.status === "PENDING"),
    [items]
  );
  const payPending = useMemo(
    () => items.filter((i) => i.direction === "PAY" && i.status === "PENDING"),
    [items]
  );

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const isOverdue = (due: string) => isBefore(parseISO(due), startOfDay(new Date()));

  const confirmClear = async () => {
    if (!db || !profile || !confirmItem) return;
    const vd = validateAccountingEntryDate(clearedDate);
    if (!vd.ok) {
      toast({ variant: "destructive", title: "วันที่ตัดเช็คไม่ถูกต้อง", description: vd.message });
      return;
    }
    const clearedYmd = vd.normalized;
    setBusyId(confirmItem.id);
    try {
      const ch = confirmItem;
      const batch = writeBatch(db);
      const entryRef = doc(collection(db, "accountingEntries"));
      let whtDocId = "";

      if (ch.direction === "RECEIVE") {
        const anchorType =
          ch.receiveAnchorDocType ?? (ch.receiptId ? ("RECEIPT" as const) : undefined);
        const anchorId = ch.receiveAnchorDocId ?? ch.receiptId;
        const anchorNo = ch.receiveAnchorDocNo ?? ch.receiptDocNo;

        if (anchorType === "RECEIPT" && anchorId) {
          batch.set(
            entryRef,
            sanitizeForFirestore({
              entryType: "RECEIPT",
              entryDate: clearedYmd,
              amount: ch.amount,
              accountId: ch.accountId,
              paymentMethod: "TRANSFER",
              categoryMain: "เก็บเงินลูกหนี้",
              categorySub: "รับตามเช็ค (ใบเสร็จ)",
              description: anchorNo
                ? `รับเงินตามเช็ค — ใบเสร็จ ${anchorNo}`
                : ch.notes || "รับเช็คเข้าบัญชี",
              sourceDocType: "RECEIPT" as DocType,
              sourceDocId: anchorId,
              sourceDocNo: anchorNo,
              customerNameSnapshot: ch.customerNameSnapshot,
              createdAt: serverTimestamp(),
              createdByUid: profile.uid,
              createdByName: profile.displayName ?? "",
            })
          );
        } else if (
          (anchorType === "DELIVERY_NOTE" || anchorType === "BILLING_NOTE" || anchorType === "TAX_INVOICE") &&
          anchorId
        ) {
          const label =
            anchorType === "DELIVERY_NOTE"
              ? "ใบส่งของ"
              : anchorType === "BILLING_NOTE"
                ? "ใบวางบิล"
                : "ใบกำกับภาษี";
          batch.set(
            entryRef,
            sanitizeForFirestore({
              entryType: "CASH_IN",
              entryDate: clearedYmd,
              amount: ch.amount,
              accountId: ch.accountId,
              paymentMethod: "TRANSFER",
              categoryMain: "เก็บเงินลูกหนี้",
              categorySub: "รับเช็ค",
              description: `รับเงินตามเช็ค — ${label} ${anchorNo || ""}`.trim(),
              sourceDocType: anchorType as DocType,
              sourceDocId: anchorId,
              sourceDocNo: anchorNo,
              customerNameSnapshot: ch.customerNameSnapshot,
              createdAt: serverTimestamp(),
              createdByUid: profile.uid,
              createdByName: profile.displayName ?? "",
            })
          );
        } else {
          batch.set(
            entryRef,
            sanitizeForFirestore({
              entryType: "CASH_IN",
              entryDate: clearedYmd,
              amount: ch.amount,
              accountId: ch.accountId,
              paymentMethod: "TRANSFER",
              categoryMain: "รายรับอื่นๆ",
              categorySub: "รับเช็ค (บันทึกด้วยมือ)",
              description: ch.notes || "รับเช็คเข้าบัญชี",
              customerNameSnapshot: ch.customerNameSnapshot,
              createdAt: serverTimestamp(),
              createdByUid: profile.uid,
              createdByName: profile.displayName ?? "",
            })
          );
        }

        let targetObligationId = ch.obligationId;
        if (!targetObligationId && anchorId) {
          const q = query(
            collection(db, "accountingObligations"),
            where("type", "==", "AR"),
            where("sourceDocId", "==", anchorId),
            limit(1)
          );
          const snap = await getDocs(q);
          targetObligationId = snap.docs[0]?.id;
        }

        if (targetObligationId) {
          const obligationRef = doc(db, "accountingObligations", targetObligationId);
          const obligationSnap = await getDoc(obligationRef);
          if (obligationSnap.exists()) {
            const ob = obligationSnap.data() as AccountingObligation;
            const newAmountPaid = Math.round(((ob.amountPaid || 0) + ch.amount) * 100) / 100;
            const newBalance = Math.max(0, Math.round((ob.amountTotal - newAmountPaid) * 100) / 100);
            const newStatus = newBalance <= 0.05 ? "PAID" : "PARTIAL";
            batch.update(obligationRef, {
              amountPaid: newAmountPaid,
              balance: newBalance,
              status: newStatus,
              lastPaymentDate: clearedYmd,
              paidOffDate: newStatus === "PAID" ? clearedYmd : null,
              updatedAt: serverTimestamp(),
            });

            if (ob.sourceDocId) {
              const sourceDocRef = doc(db, "documents", ob.sourceDocId);
              const sourceDocSnap = await getDoc(sourceDocRef);
              if (sourceDocSnap.exists()) {
                const sourceDoc = sourceDocSnap.data() as SalesDocument;
                const currentPaidTotal = sourceDoc.paymentSummary?.paidTotal || 0;
                const updatedPaidTotal = Math.round((currentPaidTotal + ch.amount) * 100) / 100;
                const updatedBalance = Math.max(
                  0,
                  Math.round(((Number(sourceDoc.grandTotal) || 0) - updatedPaidTotal) * 100) / 100
                );
                const updatedStatus = updatedBalance <= 0.05 ? "PAID" : "PARTIAL";
                batch.update(
                  sourceDocRef,
                  sanitizeForFirestore({
                    status: updatedStatus,
                    arStatus: updatedStatus,
                    paymentSummary: {
                      paidTotal: updatedPaidTotal,
                      balance: updatedBalance,
                      paymentStatus: updatedStatus,
                    },
                    paymentDate: clearedYmd,
                    paymentMethod: "CHECK",
                    paymentInstrument: "CHECK",
                    checkDueDate: ch.dueDate,
                    receivedAccountId: ch.accountId,
                    cashReceived: ch.amount,
                    accountingEntryId: entryRef.id,
                    updatedAt: serverTimestamp(),
                  })
                );
              }
            }

            if (newStatus === "PAID" && ob.jobId) {
              const jobRef = doc(db, "jobs", ob.jobId);
              const jobSnap = await getDoc(jobRef);
              if (jobSnap.exists()) {
                batch.update(jobRef, {
                  status: "CLOSED",
                  updatedAt: serverTimestamp(),
                  lastActivityAt: serverTimestamp(),
                });
              }
            }
          }
        }
      } else {
        const obligationRef = ch.obligationId ? doc(db, "accountingObligations", ch.obligationId) : null;
        const obligationSnap = obligationRef ? await getDoc(obligationRef) : null;
        const obligation = obligationSnap?.exists() ? (obligationSnap.data() as AccountingObligation) : null;
        let whtAmount = 0;
        let whtBase = ch.amount;

        if (ch.withholdingEnabled && (ch.withholdingPercent || 0) > 0 && obligation && obligation.sourceDocType === "PURCHASE") {
          const sourceSnap = await getDoc(doc(db, "purchaseDocs", obligation.sourceDocId));
          const source = sourceSnap.exists() ? (sourceSnap.data() as PurchaseDoc) : null;
          if (source) {
            whtBase = source.withTax && (source.vatAmount || 0) > 0 ? source.subtotal : source.grandTotal;
            whtAmount = Math.round(whtBase * ((ch.withholdingPercent || 0) / 100) * 100) / 100;
            if (whtAmount > ch.amount) whtAmount = ch.amount;
          }
        }
        const cashOutAmount = Math.max(0, Math.round((ch.amount - whtAmount) * 100) / 100);

        if (whtAmount > 0 && obligation && obligation.sourceDocType === "PURCHASE") {
          await runTransaction(db, async (tx) => {
            const year = +clearedYmd.slice(0, 4);
            const counterRef = doc(db, "documentCounters", String(year));
            const settingsRef = doc(db, "settings", "documents");
            const storeSettingsRef = doc(db, "settings", "store");
            const [counterSnap, settingsSnap, storeSettingsSnap] = await Promise.all([
              tx.get(counterRef),
              tx.get(settingsRef),
              tx.get(storeSettingsRef),
            ]);
            const settings = (settingsSnap.exists() ? settingsSnap.data() : {}) as DocumentSettings;
            const storeSettings = (storeSettingsSnap.exists() ? storeSettingsSnap.data() : {}) as StoreSettings;
            const prefix = settings.withholdingTaxPrefix || "WHT";
            const counters = counterSnap.exists() ? (counterSnap.data() as any) : { year };
            const lastPrefix = counters.withholdingTaxPrefix;
            const lastCount = counters.withholdingTax || 0;
            const nextCount = lastPrefix !== prefix ? 1 : lastCount + 1;
            const whtDocNo = `${prefix}${year}-${String(nextCount).padStart(4, "0")}`;
            const whtRef = doc(collection(db, "documents"));
            whtDocId = whtRef.id;
            tx.set(
              whtRef,
              sanitizeForFirestore({
                id: whtDocId,
                docType: "WITHHOLDING_TAX",
                docNo: whtDocNo,
                docDate: clearedYmd,
                payerSnapshot: storeSettings,
                payeeSnapshot: {
                  name: obligation.vendorNameSnapshot || obligation.vendorShortNameSnapshot,
                },
                vendorId: obligation.vendorId,
                paidMonth: +clearedYmd.slice(5, 7),
                paidYear: year,
                incomeTypeCode: "ITEM5",
                paidAmountGross: whtBase,
                withholdingPercent: ch.withholdingPercent || 0,
                withholdingAmount: whtAmount,
                paidAmountNet: whtBase - whtAmount,
                status: "ISSUED",
                senderName: profile.displayName,
                receiverName: obligation.vendorNameSnapshot || obligation.vendorShortNameSnapshot,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            );
            tx.set(
              counterRef,
              { ...counters, withholdingTax: nextCount, withholdingTaxPrefix: prefix },
              { merge: true }
            );
          });
        }

        batch.set(
          entryRef,
          sanitizeForFirestore({
            entryType: "CASH_OUT",
            entryDate: clearedYmd,
            amount: cashOutAmount,
            grossAmount: ch.amount,
            accountId: ch.accountId,
            paymentMethod: "TRANSFER",
            categoryMain: "ค่าใช้จ่าย",
            categorySub: "จ่ายเช็ค",
            description:
              ch.vendorNameSnapshot || ch.notes
                ? `จ่ายเช็ค — ${ch.vendorNameSnapshot || ""} ${ch.notes || ""}`.trim()
                : "จ่ายเช็ค",
            sourceDocType: ch.sourceDocType,
            sourceDocId: ch.sourceDocId || ch.purchaseDocId,
            sourceDocNo: ch.sourceDocNo,
            obligationId: ch.obligationId,
            vendorId: ch.vendorId,
            vendorNameSnapshot: ch.vendorNameSnapshot,
            withholdingEnabled: !!ch.withholdingEnabled,
            withholdingPercent: ch.withholdingPercent || 0,
            withholdingAmount: whtAmount,
            withholdingTaxDocId: whtDocId || undefined,
            createdAt: serverTimestamp(),
            createdByUid: profile.uid,
            createdByName: profile.displayName ?? "",
          })
        );

        if (obligationRef && obligation) {
          const newAmountPaid = Math.round(((obligation.amountPaid || 0) + ch.amount) * 100) / 100;
          const newBalance = Math.max(0, Math.round((obligation.amountTotal - newAmountPaid) * 100) / 100);
          const newStatus = newBalance <= 0.05 ? "PAID" : "PARTIAL";
          batch.update(obligationRef, {
            amountPaid: newAmountPaid,
            balance: newBalance,
            status: newStatus,
            lastPaymentDate: clearedYmd,
            paidOffDate: newStatus === "PAID" ? clearedYmd : null,
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.update(doc(db, "accountingCheckItems", ch.id), {
        status: "CLEARED",
        clearedAt: serverTimestamp(),
        clearedEntryId: entryRef.id,
        clearedDate: clearedYmd,
        clearedByUid: profile.uid,
        clearedByName: profile.displayName ?? "",
        withholdingAmount: ch.withholdingAmount ?? undefined,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      toast({ title: "ยืนยันเช็คแล้ว", description: "บันทึกรายการบัญชีเรียบร้อย (เงินเข้า/ออกตามวันที่เลือก)" });
      setConfirmItem(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ไม่สำเร็จ", description: e.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async () => {
    if (!db || !profile) return;
    const sel = addCandidateDocs.find((x) => x.id === addSelectedDocId);
    if (!addCustomerId || !sel) {
      toast({ variant: "destructive", title: "กรุณาเลือกลูกค้าและเอกสารอ้างอิง" });
      return;
    }
    const amt = Math.round(parseFloat(addAmount) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0 || !addAccountId) {
      toast({ variant: "destructive", title: "กรุณากรอกยอดและบัญชี" });
      return;
    }
    const cust = customers.find((c) => c.id === addCustomerId);
    const anchorType =
      sel.docType === "RECEIPT"
        ? ("RECEIPT" as const)
        : sel.docType === "DELIVERY_NOTE"
          ? ("DELIVERY_NOTE" as const)
          : ("BILLING_NOTE" as const);
    setSavingAdd(true);
    try {
      const base = {
        direction: "RECEIVE" as const,
        status: "PENDING" as const,
        amount: amt,
        dueDate: addDue,
        accountId: addAccountId,
        receiveAnchorDocType: anchorType,
        receiveAnchorDocId: sel.id,
        receiveAnchorDocNo: sel.docNo,
        customerNameSnapshot: cust?.name,
        notes: addNotes.trim() ? addNotes.trim() : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName ?? "",
      };
      const withReceipt =
        anchorType === "RECEIPT"
          ? { ...base, receiptId: sel.id, receiptDocNo: sel.docNo }
          : base;
      await addDoc(collection(db, "accountingCheckItems"), withReceipt);
      toast({ title: "บันทึกรายการเช็ครับแล้ว" });
      setAddOpen(false);
      resetAddForm();
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setSavingAdd(false);
    }
  };

  const openEdit = (row: WithId<AccountingCheckItem>) => {
    setEditItem(row);
    setEditDue(row.dueDate);
    setEditAmount(String(row.amount));
    setEditAccountId(row.accountId);
    setEditNotes(row.notes ?? "");
  };

  const handleSaveEdit = async () => {
    if (!db || !editItem) return;
    const amt = Math.round(parseFloat(editAmount) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0 || !editAccountId) {
      toast({ variant: "destructive", title: "กรุณากรอกยอดและบัญชี" });
      return;
    }
    setSavingEdit(true);
    try {
      await updateDoc(
        doc(db, "accountingCheckItems", editItem.id),
        sanitizeForFirestore({
          dueDate: editDue,
          accountId: editAccountId,
          amount: amt,
          notes: editNotes.trim() ? editNotes.trim() : null,
          updatedAt: serverTimestamp(),
        })
      );
      toast({ title: "แก้ไขรายการแล้ว" });
      setEditItem(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "แก้ไขไม่สำเร็จ", description: e.message });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!db || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "accountingCheckItems", deleteTarget.id));
      toast({ title: "ลบรายการแล้ว" });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setDeleting(false);
    }
  };

  const handleAddPay = async () => {
    if (!db || !profile) return;
    const ob = apObligations.find((x) => x.id === addPayObligationId);
    if (!ob) {
      toast({ variant: "destructive", title: "กรุณาเลือกรายการเจ้าหนี้" });
      return;
    }
    const amt = Math.round(parseFloat(addPayAmount) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0 || !addPayAccountId) {
      toast({ variant: "destructive", title: "กรุณากรอกยอดและบัญชีจ่าย" });
      return;
    }
    setSavingAddPay(true);
    try {
      await addDoc(
        collection(db, "accountingCheckItems"),
        sanitizeForFirestore({
          direction: "PAY" as const,
          status: "PENDING" as const,
          amount: amt,
          dueDate: addPayDue,
          accountId: addPayAccountId,
          obligationId: ob.id,
          purchaseDocId: ob.sourceDocType === "PURCHASE" ? ob.sourceDocId : null,
          sourceDocType: ob.sourceDocType,
          sourceDocId: ob.sourceDocId,
          sourceDocNo: ob.invoiceNo || ob.sourceDocNo,
          vendorId: ob.vendorId,
          vendorNameSnapshot: ob.vendorNameSnapshot || ob.vendorShortNameSnapshot,
          withholdingEnabled: addPayWithholdingEnabled,
          withholdingPercent: addPayWithholdingEnabled ? Number(addPayWithholdingPercent || 0) : null,
          notes: addPayNotes.trim() || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: profile.uid,
          createdByName: profile.displayName ?? "",
        })
      );
      toast({ title: "สร้างรายการจ่ายเช็คแล้ว" });
      setAddPayOpen(false);
      resetAddPayForm();
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setSavingAddPay(false);
    }
  };

  const handleCancelCheck = async (row: WithId<AccountingCheckItem>) => {
    if (!db) return;
    setBusyId(row.id);
    try {
      await updateDoc(
        doc(db, "accountingCheckItems", row.id),
        sanitizeForFirestore({
          status: "CANCELLED",
          updatedAt: serverTimestamp(),
          notes: row.notes
            ? `${row.notes} | ยกเลิกรายการเมื่อ ${format(new Date(), "yyyy-MM-dd")}`
            : `ยกเลิกรายการเมื่อ ${format(new Date(), "yyyy-MM-dd")}`,
        })
      );
      toast({ title: "ยกเลิกรายการเช็คแล้ว" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ยกเลิกไม่สำเร็จ", description: e.message });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>เช็ครับ — เช็คจ่าย</CardTitle>
            <CardDescription>
              เช็ครับต้องอ้างอิงจากใบส่งของชั่วคราว ใบวางบิล หรือใบเสร็จรับเงินเท่านั้น — ไม่ผูกใบกำกับภาษีโดยตรง (รับเงินจริงยึดใบเสร็จเป็นหลัก)
              ยอดจะตัดบัญชีเมื่อกดยืนยันที่นี่ตามวันที่เงินเข้าจริง
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                resetAddPayForm();
                setAddPayOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              สร้างรายการจ่ายเช็ค
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                resetAddForm();
                setAddOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              เพิ่มเช็ครับ
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เช็ครับ (รอขึ้นเงิน)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ครบกำหนด</TableHead>
                <TableHead>บัญชีรับ</TableHead>
                <TableHead className="text-right">ยอด</TableHead>
                <TableHead>อ้างอิง</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receivePending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    ไม่มีเช็ครับค้าง
                  </TableCell>
                </TableRow>
              ) : (
                receivePending.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{format(parseISO(row.dueDate), "dd/MM/yyyy")}</TableCell>
                    <TableCell>{accountName(row.accountId)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(row.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate" title={formatReceiveRef(row)}>
                      {formatReceiveRef(row)}
                    </TableCell>
                    <TableCell>
                      {isOverdue(row.dueDate) ? (
                        <Badge variant="destructive">เกินกำหนด</Badge>
                      ) : (
                        <Badge variant="secondary">รอดำเนินการ</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            disabled={busyId === row.id}
                            aria-label="จัดการ"
                          >
                            {busyId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem
                            onClick={() => openEdit(row)}
                            disabled={busyId === row.id}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            แก้ไข
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-green-700 focus:text-green-700"
                            onClick={() => {
                              setConfirmItem(row);
                              setClearedDate(format(new Date(), "yyyy-MM-dd"));
                            }}
                            disabled={busyId === row.id}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            ยืนยันรับเงิน
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-amber-700 focus:text-amber-700"
                            onClick={() => handleCancelCheck(row)}
                            disabled={busyId === row.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            ยกเลิกรายการ
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            disabled={busyId === row.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            ลบ
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เช็คจ่าย (รอตัดบัญชี)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ครบกำหนด</TableHead>
                <TableHead>บัญชีจ่าย</TableHead>
                <TableHead className="text-right">ยอด</TableHead>
                <TableHead>เจ้าหนี้ / หมายเหตุ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payPending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    ไม่มีเช็คจ่ายค้าง
                  </TableCell>
                </TableRow>
              ) : (
                payPending.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{format(parseISO(row.dueDate), "dd/MM/yyyy")}</TableCell>
                    <TableCell>{accountName(row.accountId)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(row.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {row.vendorNameSnapshot || row.notes || "—"}
                    </TableCell>
                    <TableCell>
                      {isOverdue(row.dueDate) ? (
                        <Badge variant="destructive">เกินกำหนด</Badge>
                      ) : (
                        <Badge variant="secondary">รอดำเนินการ</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            disabled={busyId === row.id}
                            aria-label="จัดการ"
                          >
                            {busyId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem
                            onClick={() => openEdit(row)}
                            disabled={busyId === row.id}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            แก้ไข
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-orange-600 focus:text-orange-600"
                            onClick={() => {
                              setConfirmItem(row);
                              setClearedDate(format(new Date(), "yyyy-MM-dd"));
                            }}
                            disabled={busyId === row.id}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            ยืนยันจ่าย
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-amber-700 focus:text-amber-700"
                            onClick={() => handleCancelCheck(row)}
                            disabled={busyId === row.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            ยกเลิกรายการ
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            disabled={busyId === row.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            ลบ
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขรายการเช็ค</DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                ประเภท: {editItem.direction === "RECEIVE" ? "เช็ครับ" : "เช็คจ่าย"}
                {editItem.receiptId ||
                editItem.receiveAnchorDocId ||
                editItem.purchaseDocId ? (
                  <span className="block mt-1 text-amber-700 dark:text-amber-500">
                    รายการเชื่อมเอกสาร — ตรวจสอบความสอดคล้องกับใบเสร็จ/เอกสารอ้างอิงหลังแก้ไข
                  </span>
                ) : null}
              </p>
              <div className="space-y-2">
                <Label>วันครบกำหนดเช็ค</Label>
                <Input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>บัญชีธนาคาร/เงินสด</Label>
                <Select value={editAccountId} onValueChange={setEditAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกบัญชี" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.isActive)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>จำนวนเงิน</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} disabled={savingEdit}>
              ยกเลิก
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "บันทึกการแก้ไข"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmItem} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันเช็ค — ตัดบัญชี</DialogTitle>
          </DialogHeader>
          {confirmItem && (
            <div className="space-y-3 text-sm">
              <p>
                {confirmItem.direction === "RECEIVE" ? "รับ" : "จ่าย"} จำนวน{" "}
                <strong>{fmt(confirmItem.amount)}</strong> บาท — บัญชี {accountName(confirmItem.accountId)}
              </p>
              <div className="space-y-2">
                <Label>วันที่เงินเข้า/ออกจริง (ใช้ในรายการบัญชี)</Label>
                <Input type="date" value={clearedDate} onChange={(e) => setClearedDate(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmItem(null)}>
              ยกเลิก
            </Button>
            <Button onClick={confirmClear} disabled={!clearedDate || busyId !== null}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              ยืนยันและบันทึกบัญชี
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>เพิ่มเช็ครับ (อ้างอิงเอกสาร)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>ลูกค้า</Label>
              <Popover open={isAddCustomerOpen} onOpenChange={setIsAddCustomerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {addCustomerId
                        ? customers.find((c) => c.id === addCustomerId)?.name ?? "—"
                        : "เลือกลูกค้า..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <div className="p-2 border-b">
                    <Input
                      placeholder="ค้นหาชื่อ..."
                      value={addCustomerSearch}
                      onChange={(e) => setAddCustomerSearch(e.target.value)}
                    />
                  </div>
                  <ScrollArea className="h-56">
                    {customers
                      .filter((c) => {
                        if (!addCustomerSearch.trim()) return true;
                        const q = addCustomerSearch.toLowerCase();
                        return (
                          c.name.toLowerCase().includes(q) ||
                          (c.phone && c.phone.includes(addCustomerSearch))
                        );
                      })
                      .map((c) => (
                        <Button
                          key={c.id}
                          type="button"
                          variant="ghost"
                          className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 px-3 text-left"
                          onClick={() => {
                            setAddCustomerId(c.id);
                            setAddSelectedDocId("");
                            setIsAddCustomerOpen(false);
                          }}
                        >
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.phone}</span>
                          </div>
                        </Button>
                      ))}
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>เอกสารอ้างอิง (ใบส่งของ / ใบวางบิล / ใบเสร็จ)</Label>
              <Select
                value={addSelectedDocId || "__none__"}
                onValueChange={(v) => setAddSelectedDocId(v === "__none__" ? "" : v)}
                disabled={!addCustomerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={addCustomerId ? "เลือกเอกสาร" : "เลือกลูกค้าก่อน"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— เลือก —</SelectItem>
                  {addCandidateDocs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="font-mono text-xs">{d.docNo}</span>
                      <span className="ml-2 text-muted-foreground">
                        {d.docType === "DELIVERY_NOTE"
                          ? "ใบส่งของ"
                          : d.docType === "BILLING_NOTE"
                            ? "ใบวางบิล"
                            : "ใบเสร็จ"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {addCustomerId && addCandidateDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">ไม่พบเอกสารที่ใช้อ้างอิงได้สำหรับลูกค้านี้</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>วันครบกำหนดเช็ค</Label>
              <Input type="date" value={addDue} onChange={(e) => setAddDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>บัญชีธนาคาร/เงินสด</Label>
              <Select value={addAccountId} onValueChange={setAddAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกบัญชี" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>จำนวนเงิน</Label>
              <Input
                type="number"
                step="0.01"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleAdd} disabled={savingAdd}>
              {savingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addPayOpen}
        onOpenChange={(open) => {
          setAddPayOpen(open);
          if (!open) resetAddPayForm();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>สร้างรายการจ่ายเช็ค</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>เจ้าหนี้อ้างอิง</Label>
              <Select
                value={addPayObligationId || "__none__"}
                onValueChange={(v) => {
                  const id = v === "__none__" ? "" : v;
                  setAddPayObligationId(id);
                  const ob = apObligations.find((x) => x.id === id);
                  if (ob) {
                    setAddPayAmount(String(Math.max(0, ob.balance || 0)));
                    if (ob.dueDate) setAddPayDue(ob.dueDate);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกเจ้าหนี้..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— เลือก —</SelectItem>
                  {apObligations.map((ob) => (
                    <SelectItem key={ob.id} value={ob.id}>
                      {(ob.vendorNameSnapshot || ob.vendorShortNameSnapshot || "ไม่ระบุร้านค้า") +
                        " • " +
                        (ob.invoiceNo || ob.sourceDocNo || ob.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>วันครบกำหนดเช็ค</Label>
              <Input type="date" value={addPayDue} onChange={(e) => setAddPayDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>บัญชีที่จ่ายเช็ค</Label>
              <Select value={addPayAccountId} onValueChange={setAddPayAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกบัญชี" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>จำนวนเงิน</Label>
              <Input
                type="number"
                step="0.01"
                value={addPayAmount}
                onChange={(e) => setAddPayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-primary">หักภาษี ณ ที่จ่าย (ตอนคอนเฟิร์ม)</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={addPayWithholdingEnabled} onCheckedChange={(v: any) => setAddPayWithholdingEnabled(!!v)} />
                <span className="text-sm">เปิดใช้งาน WHT</span>
              </div>
              {addPayWithholdingEnabled ? (
                <Select value={addPayWithholdingPercent} onValueChange={setAddPayWithholdingPercent}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1%</SelectItem>
                    <SelectItem value="3">3%</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea value={addPayNotes} onChange={(e) => setAddPayNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPayOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleAddPay} disabled={savingAddPay}>
              {savingAddPay ? <Loader2 className="h-4 w-4 animate-spin" /> : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบรายการเช็ค?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `ลบรายการ ${deleteTarget.direction === "RECEIVE" ? "เช็ครับ" : "เช็คจ่าย"} จำนวน ${fmt(deleteTarget.amount)} บาท — การลบไม่ส่งผลต่อรายการบัญชีที่ตัดไปแล้ว`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ลบรายการ
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
