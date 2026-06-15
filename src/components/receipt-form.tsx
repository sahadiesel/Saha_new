"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  doc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
  writeBatch,
  deleteField,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ChevronsUpDown, AlertCircle, Info, Send, Trash2, XCircle, CalendarDays, ArrowLeft, UserPlus, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";

import { createDocument } from "@/firebase/documents";
import type { StoreSettings, Customer, Document as DocumentType, AccountingAccount } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const receiptFormSchema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  sourceDocIds: z.array(z.string()).min(1, "กรุณาเลือกบิลอย่างน้อย 1 รายการ"),
  paymentDate: z.string().min(1, "กรุณาเลือกวันที่"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  amount: z.coerce.number().min(0.01, "ยอดเงินต้องมากกว่า 0"),
  notes: z.string().optional(),
});

type ReceiptFormData = z.infer<typeof receiptFormSchema>;

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function ReceiptForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editDocId = searchParams.get("editDocId");
  const presetAmountParam = searchParams.get("presetAmount");
  const urlSourceDocIds = useMemo(() => {
    const multi = searchParams.get("sourceDocIds");
    if (multi)
      return multi
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const one = searchParams.get("sourceDocId");
    return one ? [one] : [];
  }, [searchParams]);
  const urlSourceKey = urlSourceDocIds.join("|");
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sourceDocs, setSourceDocs] = useState<DocumentType[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extraSourceDocs, setExtraSourceDocs] = useState<DocumentType[]>([]);
  /** ลูกค้าเพิ่มเติมสำหรับรวมใบเสร็จข้ามลูกค้า */
  const [additionalCustomerIds, setAdditionalCustomerIds] = useState<string[]>([]);
  const [isAddCustomerPopoverOpen, setIsAddCustomerPopoverOpen] = useState(false);
  const [addCustomerSearch, setAddCustomerSearch] = useState("");
  /** เลือกออกใบเสร็จตามใบวางบิล — กรองและเลือกอัตโนมัติ */
  const [selectedBillingNoteId, setSelectedBillingNoteId] = useState("");
  const urlBillingNoteId = searchParams.get("billingNoteId") || "";
  /** เอกสารแรกจากลิงก์ (sourceDocId) — ใช้ซิงก์ customerId / แสดงชื่อเมื่อไม่มีใน collection customers */
  const [bootstrapSourceDoc, setBootstrapSourceDoc] = useState<DocumentType | null>(null);

  const storeSettingsRef = useMemo(() => (db ? doc(db, "settings", "store") : null), [db]);
  const { data: storeSettings } = useDoc<StoreSettings>(storeSettingsRef);

  const docToEditRef = useMemo(() => (db && editDocId ? doc(db, "documents", editDocId) : null), [db, editDocId]);
  const { data: docToEdit, isLoading: isLoadingDoc } = useDoc<DocumentType>(docToEditRef);

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      paymentDate: "", // Set in useEffect
      amount: 0,
      customerId: searchParams.get("customerId") || "",
      sourceDocIds: [],
      accountId: "",
      notes: "",
    },
  });

  // Safe client-side initialization for paymentDate
  useEffect(() => {
    if (!editDocId && !form.getValues("paymentDate")) {
      form.setValue("paymentDate", format(new Date(), "yyyy-MM-dd"));
    }
  }, [editDocId, form]);

  const selectedCustomerId = form.watch('customerId');
  const watchedSourceDocIds = form.watch('sourceDocIds');

  const allCustomerIds = useMemo(() => {
    if (!selectedCustomerId) return [];
    return Array.from(new Set([selectedCustomerId, ...additionalCustomerIds]));
  }, [selectedCustomerId, additionalCustomerIds]);

  const allCustomerIdsKey = allCustomerIds.slice().sort().join("|");

  const resolveDocCustomerId = (d: DocumentType) => d.customerId || d.customerSnapshot?.id || "";

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    for (const d of [...sourceDocs, ...extraSourceDocs]) {
      const cid = resolveDocCustomerId(d);
      if (cid && !map.has(cid)) {
        map.set(cid, d.customerSnapshot?.name || d.customerSnapshot?.taxName || "ลูกค้า");
      }
    }
    if (bootstrapSourceDoc) {
      const cid = resolveDocCustomerId(bootstrapSourceDoc);
      if (cid && !map.has(cid)) {
        map.set(
          cid,
          bootstrapSourceDoc.customerSnapshot?.name ||
            bootstrapSourceDoc.customerSnapshot?.taxName ||
            "ลูกค้า"
        );
      }
    }
    return map;
  }, [customers, sourceDocs, extraSourceDocs, bootstrapSourceDoc]);

  useEffect(() => {
    if (editDocId || urlSourceDocIds.length === 0) return;
    form.setValue("sourceDocIds", urlSourceDocIds);
  }, [editDocId, urlSourceKey, form]);

  useEffect(() => {
    if (!db || editDocId || urlSourceDocIds.length === 0) {
      setBootstrapSourceDoc(null);
      return;
    }
    let cancelled = false;
    setBootstrapSourceDoc(null);
    (async () => {
      const s = await getDoc(doc(db, "documents", urlSourceDocIds[0]));
      if (cancelled || !s.exists()) return;
      const d = { id: s.id, ...s.data() } as DocumentType;
      setBootstrapSourceDoc(d);
      const cid = d.customerId || d.customerSnapshot?.id;
      if (cid) form.setValue("customerId", cid);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, editDocId, urlSourceKey, form]);

  useEffect(() => {
    if (!db || editDocId || !urlBillingNoteId) return;
    let cancelled = false;
    (async () => {
      const s = await getDoc(doc(db, "documents", urlBillingNoteId));
      if (cancelled || !s.exists()) return;
      const bn = { id: s.id, ...s.data() } as DocumentType;
      if (bn.docType !== "BILLING_NOTE") return;
      const cid = bn.customerId || bn.customerSnapshot?.id;
      if (cid) form.setValue("customerId", cid);
      setSelectedBillingNoteId(urlBillingNoteId);
      form.setValue("sourceDocIds", [urlBillingNoteId], { shouldValidate: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [db, editDocId, urlBillingNoteId, form]);

  useEffect(() => {
    if (!db) return;
    const unsubCustomers = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      setIsLoading(false);
    });
    const unsubAccounts = onSnapshot(query(collection(db, "accountingAccounts"), where("isActive", "==", true)), (snap) => {
        setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountingAccount)));
    });
    return () => { unsubCustomers(); unsubAccounts(); };
  }, [db]);

  useEffect(() => {
    if (docToEdit && !isSubmitting) {
      form.reset({
        customerId: docToEdit.customerId || docToEdit.customerSnapshot?.id || "",
        sourceDocIds: docToEdit.referencesDocIds || [],
        paymentDate: docToEdit.paymentDate || docToEdit.docDate || format(new Date(), "yyyy-MM-dd"),
        accountId: docToEdit.receivedAccountId || "",
        amount: docToEdit.grandTotal,
        notes: docToEdit.notes || "",
      });
    }
  }, [docToEdit, form, isSubmitting]);

  useEffect(() => {
    if (!db || !docToEdit || isSubmitting) return;
    const refs = docToEdit.referencesDocIds || [];
    if (refs.length === 0) return;
    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        refs.map((id) =>
          getDoc(doc(db, "documents", id)).then((s) =>
            s.exists() ? ({ id: s.id, ...s.data() } as DocumentType) : null
          )
        )
      );
      if (cancelled) return;
      const primaryId = docToEdit.customerId || docToEdit.customerSnapshot?.id || "";
      const others = Array.from(
        new Set(
          rows
            .filter(Boolean)
            .map((d) => resolveDocCustomerId(d!))
            .filter((id) => id && id !== primaryId)
        )
      ) as string[];
      setAdditionalCustomerIds(others);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, docToEdit, isSubmitting]);

  useEffect(() => {
    if (!db || !docToEdit || isSubmitting) return;
    const refs = docToEdit.referencesDocIds || [];
    if (refs.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const id of refs) {
        const s = await getDoc(doc(db, "documents", id));
        if (cancelled || !s.exists()) continue;
        if (s.data().docType === "BILLING_NOTE") {
          setSelectedBillingNoteId(id);
          break;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, docToEdit, isSubmitting]);

  useEffect(() => {
    if (!selectedBillingNoteId) return;
    const ids = watchedSourceDocIds;
    if (ids.length !== 1 || ids[0] !== selectedBillingNoteId) {
      setSelectedBillingNoteId("");
    }
  }, [watchedSourceDocIds, selectedBillingNoteId]);

  const displaySourceDocs = useMemo(() => {
    const allowedCustomers = new Set(allCustomerIds);
    const m = new Map<string, DocumentType>();
    for (const d of sourceDocs) {
      if (allowedCustomers.has(resolveDocCustomerId(d))) m.set(d.id, d);
    }
    for (const d of extraSourceDocs) m.set(d.id, d);
    return Array.from(m.values()).sort((a, b) => {
      const ca = resolveDocCustomerId(a);
      const cb = resolveDocCustomerId(b);
      if (ca !== cb) {
        const na = customerNameById.get(ca) || ca;
        const nb = customerNameById.get(cb) || cb;
        return na.localeCompare(nb, "th");
      }
      return String(b.docDate || "").localeCompare(String(a.docDate || ""));
    });
  }, [sourceDocs, extraSourceDocs, allCustomerIds, customerNameById]);

  const billingNoteOptions = useMemo(
    () =>
      displaySourceDocs
        .filter((d) => d.docType === "BILLING_NOTE")
        .sort((a, b) => String(b.docDate || "").localeCompare(String(a.docDate || ""))),
    [displaySourceDocs]
  );

  const tableDocs = useMemo(() => {
    if (selectedBillingNoteId) {
      const bn = displaySourceDocs.find((d) => d.id === selectedBillingNoteId);
      const invoiceIds = new Set(bn?.invoiceIds || []);
      return displaySourceDocs.filter(
        (d) => d.id === selectedBillingNoteId || invoiceIds.has(d.id)
      );
    }
    const billingNoteIds = new Set(billingNoteOptions.map((b) => b.id));
    return displaySourceDocs.filter((d) => {
      if (d.docType === "TAX_INVOICE" && d.billingNoteId && billingNoteIds.has(d.billingNoteId)) {
        return false;
      }
      return true;
    });
  }, [displaySourceDocs, selectedBillingNoteId, billingNoteOptions]);

  const isBillingNoteMode = !!selectedBillingNoteId;

  const isDocSelectable = (doc: DocumentType) => {
    if (!isBillingNoteMode) return true;
    return doc.id === selectedBillingNoteId;
  };

  useEffect(() => {
    if (!db || allCustomerIds.length === 0) {
      setSourceDocs([]);
      return;
    }

    const filterEligible = (allDocs: DocumentType[]) =>
      allDocs.filter((doc) => {
        if (doc.status === "CANCELLED" || doc.status === "PAID") return false;
        if (doc.receiptStatus === "CONFIRMED") return false;
        if (doc.receiptDocId && doc.receiptDocId !== editDocId) return false;
        if (doc.docType === "TAX_INVOICE" && doc.billingRequired && !doc.billingNoteId) {
          return false;
        }
        return true;
      });

    const unsubs = allCustomerIds.map((customerId) => {
      const q = query(
        collection(db, "documents"),
        where("customerId", "==", customerId),
        where("docType", "in", ["TAX_INVOICE", "BILLING_NOTE"]),
        where("status", "in", ["UNPAID", "PARTIAL", "APPROVED"])
      );
      return onSnapshot(q, (snapshot) => {
        const allDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentType));
        const filtered = filterEligible(allDocs);
        setSourceDocs((prev) => {
          const others = prev.filter((d) => resolveDocCustomerId(d) !== customerId);
          return [...others, ...filtered];
        });
      });
    });

    return () => unsubs.forEach((u) => u());
  }, [db, allCustomerIdsKey, editDocId]);

  useEffect(() => {
    if (!db || watchedSourceDocIds.length === 0) {
      setExtraSourceDocs([]);
      return;
    }
    const missing = watchedSourceDocIds.filter((id) => !sourceDocs.some((d) => d.id === id));
    if (missing.length === 0) {
      setExtraSourceDocs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        missing.map((id) =>
          getDoc(doc(db, "documents", id)).then((s) =>
            s.exists() ? ({ id: s.id, ...s.data() } as DocumentType) : null
          )
        )
      );
      if (cancelled) return;
      const docs = rows.filter(Boolean) as DocumentType[];
      setExtraSourceDocs(docs);
      const primaryId = form.getValues("customerId");
      const extraCustomerIds = Array.from(
        new Set(
          docs
            .map((d) => resolveDocCustomerId(d))
            .filter((id) => id && id !== primaryId)
        )
      ) as string[];
      if (extraCustomerIds.length > 0) {
        setAdditionalCustomerIds((prev) =>
          Array.from(new Set([...prev, ...extraCustomerIds]))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, watchedSourceDocIds, sourceDocs, form]);
  
  useEffect(() => {
    const selected = displaySourceDocs.filter(d => watchedSourceDocIds.includes(d.id));
    const total = selected.reduce((sum, d) => sum + (d.paymentSummary?.balance ?? d.grandTotal), 0);
    const rounded = Math.round(total * 100) / 100;
    if (presetAmountParam && selected.length === 1) {
      const p = parseFloat(presetAmountParam);
      if (Number.isFinite(p)) {
        form.setValue("amount", Math.round(p * 100) / 100);
        if (selected.length > 0 && selected[0].suggestedAccountId && !form.getValues('accountId') && !editDocId) {
          form.setValue('accountId', selected[0].suggestedAccountId);
        }
        return;
      }
    }
    form.setValue('amount', rounded);
    
    if (selected.length > 0 && selected[0].suggestedAccountId && !form.getValues('accountId') && !editDocId) {
        form.setValue('accountId', selected[0].suggestedAccountId);
    }
  }, [watchedSourceDocIds, displaySourceDocs, form, editDocId, presetAmountParam]);

  const customerDisplayName = useMemo(() => {
    if (!selectedCustomerId) return "";
    const fromList = customers.find((c) => c.id === selectedCustomerId)?.name;
    if (fromList) return fromList;
    const snap = displaySourceDocs.find(
      (d) => (d.customerId || d.customerSnapshot?.id) === selectedCustomerId
    )?.customerSnapshot;
    if (snap?.name || snap?.taxName) return snap.name || snap.taxName || "";
    if (bootstrapSourceDoc) {
      const bid = bootstrapSourceDoc.customerId || bootstrapSourceDoc.customerSnapshot?.id;
      if (bid === selectedCustomerId) {
        return (
          bootstrapSourceDoc.customerSnapshot?.name ||
          bootstrapSourceDoc.customerSnapshot?.taxName ||
          ""
        );
      }
    }
    return "";
  }, [selectedCustomerId, customers, displaySourceDocs, bootstrapSourceDoc]);

  const bootstrappingCustomer = !editDocId && urlSourceDocIds.length > 0 && !bootstrapSourceDoc;

  const buildCustomerFromSnapshot = (id: string, snap: DocumentType["customerSnapshot"]): Customer => ({
    id,
    name: snap?.name || snap?.taxName || "ลูกค้า",
    phone: (snap?.phone as string) || "",
    detail: "",
    useTax: !!(snap?.taxId || snap?.taxName),
    taxName: snap?.taxName,
    taxAddress: snap?.taxAddress,
    taxId: snap?.taxId,
    taxPhone: snap?.taxPhone,
    taxBranchType: snap?.taxBranchType,
    taxBranchNo: snap?.taxBranchNo,
    taxProfileId: snap?.taxProfileId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  const handleToggleDoc = (docId: string) => {
    const docRow = tableDocs.find((d) => d.id === docId);
    if (docRow && !isDocSelectable(docRow)) return;
    const currentIds = form.getValues('sourceDocIds');
    if (currentIds.includes(docId)) {
      form.setValue('sourceDocIds', currentIds.filter((id) => id !== docId), { shouldValidate: true });
    } else {
      form.setValue('sourceDocIds', [...currentIds, docId], { shouldValidate: true });
    }
    if (selectedBillingNoteId && docId !== selectedBillingNoteId) {
      setSelectedBillingNoteId("");
    }
  };

  const handleBillingNoteSelect = (value: string) => {
    if (value === "__none__") {
      setSelectedBillingNoteId("");
      return;
    }
    setSelectedBillingNoteId(value);
    form.setValue("sourceDocIds", [value], { shouldValidate: true });
  };

  const handleProcessSubmission = async (data: ReceiptFormData) => {
    if (isSubmitting) return;
    
    const selectedDocs = displaySourceDocs.filter(d => data.sourceDocIds.includes(d.id));
    const account = accounts.find(a => a.id === data.accountId);

    const canonicalCustomerId =
      data.customerId || selectedDocs[0]?.customerId || selectedDocs[0]?.customerSnapshot?.id || "";

    let customer: Customer | undefined = customers.find((c) => c.id === canonicalCustomerId);
    if (!customer && selectedDocs.length > 0) {
      const snap = selectedDocs[0].customerSnapshot;
      if (snap && (snap.name || snap.taxName)) {
        customer = buildCustomerFromSnapshot(canonicalCustomerId, snap);
      }
    }

    if (!db || !customer || !storeSettings || !profile || selectedDocs.length === 0 || !account) {
      toast({
        variant: "destructive",
        title: "ข้อมูลไม่ครบถ้วน",
        description: "กรุณาเลือกบัญชีและบิลอย่างน้อย 1 ใบ — ถ้าไม่มีชื่อลูกค้า ให้ตรวจว่าใบกำกับมีข้อมูลลูกค้าครบ",
      });
      return;
    }
    
    setIsSubmitting(true);
    const amount2dec = Math.round(data.amount * 100) / 100;
    const payInstrument = account.type === "CASH" ? "CASH" : "TRANSFER";
    const payMethodLegacy = payInstrument === "CASH" ? "CASH" : "TRANSFER";

    const items = selectedDocs.map(doc => {
      const docCustomerId = resolveDocCustomerId(doc);
      const docCustomerName = customerNameById.get(docCustomerId) || doc.customerSnapshot?.name || "";
      const customerLabel = allCustomerIds.length > 1 && docCustomerName ? ` (${docCustomerName})` : "";
      return {
        description: `ชำระค่าสินค้า/บริการ${customerLabel} ตาม${doc.docType === "TAX_INVOICE" ? "ใบกำกับภาษี" : "ใบวางบิล"} เลขที่ ${doc.docNo}`,
        quantity: 1,
        unitPrice: doc.paymentSummary?.balance ?? doc.grandTotal,
        total: doc.paymentSummary?.balance ?? doc.grandTotal,
      };
    });

    try {
      const docData = {
        docDate: data.paymentDate,
        customerId: canonicalCustomerId,
        customerSnapshot: { ...customer, id: canonicalCustomerId },
        storeSnapshot: { ...storeSettings },
        items,
        subtotal: amount2dec,
        discountAmount: 0,
        net: amount2dec,
        withTax: selectedDocs.some(d => d.withTax),
        vatAmount: selectedDocs.some(d => d.withTax) ? Math.round(((amount2dec / 1.07) * 0.07) * 100) / 100 : 0,
        grandTotal: amount2dec,
        notes: data.notes,
        referencesDocIds: data.sourceDocIds,
        paymentMethod: payMethodLegacy,
        paymentInstrument: payInstrument,
        paymentDate: data.paymentDate,
        receivedAccountId: data.accountId,
      };

      let finalDocId: string;
      let finalDocNo: string;

      if (editDocId) {
          await updateDoc(
            doc(db, "documents", editDocId),
            sanitizeForFirestore({
              ...docData,
              checkDueDate: deleteField(),
              status: "ISSUED",
              receiptStatus: "ISSUED_NOT_CONFIRMED",
              updatedAt: serverTimestamp(),
            })
          );
          finalDocId = editDocId;
          finalDocNo = docToEdit?.docNo || "";
      } else {
          // Direct to ISSUED status for accountants
          const result = await createDocument(db, 'RECEIPT', docData, profile, undefined, { initialStatus: 'ISSUED' });
          finalDocId = result.docId;
          finalDocNo = result.docNo;
          
          await updateDoc(doc(db, 'documents', finalDocId), {
              receiptStatus: 'ISSUED_NOT_CONFIRMED',
              updatedAt: serverTimestamp()
          });
      }

      const batch = writeBatch(db);
      
      if (editDocId && docToEdit?.referencesDocIds) {
          const removedDocIds = docToEdit.referencesDocIds.filter(id => !data.sourceDocIds.includes(id));
          removedDocIds.forEach(id => {
              batch.update(doc(db, 'documents', id), {
                  receiptStatus: deleteField(),
                  receiptDocId: deleteField(),
                  receiptDocNo: deleteField(),
                  updatedAt: serverTimestamp()
              });
          });
      }

      selectedDocs.forEach(sourceDoc => {
          batch.update(doc(db, 'documents', sourceDoc.id), {
              receiptStatus: 'ISSUED_NOT_CONFIRMED',
              receiptDocId: finalDocId,
              receiptDocNo: finalDocNo,
              updatedAt: serverTimestamp()
          });
      });
      await batch.commit();

      toast({
        title: "ออกใบเสร็จรับเงินสำเร็จ",
        description: `เลขที่ ${finalDocNo} — ไปขั้นตอนยืนยันรับเงินเข้าบัญชี (บันทึกรายรับ / ปิดลูกหนี้ / ปิดงาน)`,
      });
      setIsSubmitting(false);
      router.push(`/app/management/accounting/documents/receipt/${finalDocId}/confirm`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: error.message });
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch));
  }, [customers, customerSearch]);

  const filteredAddCustomers = useMemo(() => {
    const excluded = new Set([selectedCustomerId, ...additionalCustomerIds]);
    const q = addCustomerSearch.trim().toLowerCase();
    return customers.filter((c) => {
      if (excluded.has(c.id)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.phone.includes(q);
    });
  }, [customers, selectedCustomerId, additionalCustomerIds, addCustomerSearch]);

  const showCustomerColumn = allCustomerIds.length > 1;

  const handleAddCustomer = (customerId: string) => {
    if (!customerId || customerId === selectedCustomerId || additionalCustomerIds.includes(customerId)) return;
    setAdditionalCustomerIds((prev) => [...prev, customerId]);
    setIsAddCustomerPopoverOpen(false);
    setAddCustomerSearch("");
  };

  const handleRemoveAdditionalCustomer = (customerId: string) => {
    setAdditionalCustomerIds((prev) => prev.filter((id) => id !== customerId));
    const currentIds = form.getValues("sourceDocIds");
    form.setValue(
      "sourceDocIds",
      currentIds.filter((id) => {
        const docRow = displaySourceDocs.find((d) => d.id === id);
        if (!docRow) return true;
        return resolveDocCustomerId(docRow) !== customerId;
      }),
      { shouldValidate: true }
    );
  };

  const handlePrimaryCustomerChange = (newCustomerId: string) => {
    const prevCustomerId = form.getValues("customerId");
    form.setValue("customerId", newCustomerId);
    setSelectedBillingNoteId("");
    if (prevCustomerId && prevCustomerId !== newCustomerId) {
      form.setValue(
        "sourceDocIds",
        form.getValues("sourceDocIds").filter((id) => {
          const docRow = displaySourceDocs.find((d) => d.id === id);
          return !docRow || resolveDocCustomerId(docRow) !== prevCustomerId;
        }),
        { shouldValidate: true }
      );
      setAdditionalCustomerIds((prev) => prev.filter((id) => id !== newCustomerId));
    }
    setIsCustomerPopoverOpen(false);
  };

  const handleCancel = () => {
    const from = searchParams.get("from");
    if (from === "inbox") {
      router.push(`/app/management/accounting/inbox?tab=${searchParams.get("inboxTab") || "receipts"}`);
      return;
    }
    if (from === "receivables") {
      router.push("/app/management/accounting/receivables-payables?tab=debtors");
      return;
    }
    router.replace("/app/management/accounting/documents/receipt");
  };

  const isFormLoading = isLoading || (editDocId && isLoadingDoc);

  if (isFormLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-primary">
                <Info className="h-5 w-5" /> 
                {editDocId ? `แก้ไขใบเสร็จ ${docToEdit?.docNo}` : "เลือกบิลที่ต้องการรวมใบเสร็จ"}
            </h2>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    disabled={isSubmitting}
                    onClick={handleCancel}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    ยกเลิก
                </Button>
                <Button 
                    className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 font-bold"
                    disabled={isSubmitting || watchedSourceDocIds.length === 0}
                    onClick={form.handleSubmit(d => handleProcessSubmission(d))}
                >
                    {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    บันทึกและออกใบเสร็จ
                </Button>
            </div>
        </div>
        
        <Card>
            <CardHeader><CardTitle className="text-base">1. ข้อมูลลูกค้าและบิลที่ต้องการรวม</CardTitle></CardHeader>
            <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField name="customerId" render={({ field }) => (
                <FormItem>
                    <FormLabel>ชื่อลูกค้า</FormLabel>
                    <div className="flex flex-wrap items-start gap-2">
                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                    <PopoverTrigger asChild>
                        <FormControl>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={!!editDocId || isSubmitting}>
                            <span className="truncate text-left">
                              {!field.value
                                ? "ค้นหาชื่อลูกค้า..."
                                : bootstrappingCustomer
                                  ? "กำลังโหลดชื่อจากบิลอ้างอิง..."
                                  : customerDisplayName || "ลูกค้า (จากใบกำกับภาษี)"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                        </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                        <div className="p-2 border-b">
                            <Input placeholder="พิมพ์ชื่อลูกค้า..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                        </div>
                        <ScrollArea className="h-60">
                        {filteredCustomers.length > 0 ? (
                            filteredCustomers.map(c => (
                                <Button variant="ghost" key={c.id} onClick={() => { handlePrimaryCustomerChange(c.id); setIsCustomerPopoverOpen(false); }} className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 px-3 text-left">
                                    <div className="flex flex-col">
                                        <span>{c.name}</span>
                                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                                    </div>
                                </Button>
                            ))
                        ) : <div className="p-4 text-center text-sm text-muted-foreground">ไม่พบรายชื่อลูกค้า</div>}
                        </ScrollArea>
                    </PopoverContent>
                    </Popover>
                    {!editDocId && selectedCustomerId && (
                      <Popover open={isAddCustomerPopoverOpen} onOpenChange={setIsAddCustomerPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSubmitting}
                            className="shrink-0"
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            เพิ่มลูกค้า
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                          <div className="p-2 border-b">
                            <Input
                              placeholder="ค้นหาลูกค้าที่จะเพิ่ม..."
                              value={addCustomerSearch}
                              onChange={(e) => setAddCustomerSearch(e.target.value)}
                            />
                          </div>
                          <ScrollArea className="h-60">
                            {filteredAddCustomers.length > 0 ? (
                              filteredAddCustomers.map((c) => (
                                <Button
                                  variant="ghost"
                                  key={c.id}
                                  onClick={() => handleAddCustomer(c.id)}
                                  className="w-full justify-start rounded-none border-b last:border-0 h-auto py-2 px-3 text-left"
                                >
                                  <div className="flex flex-col">
                                    <span>{c.name}</span>
                                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                                  </div>
                                </Button>
                              ))
                            ) : (
                              <div className="p-4 text-center text-sm text-muted-foreground">
                                ไม่มีลูกค้าที่เพิ่มได้
                              </div>
                            )}
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    )}
                    </div>
                    {additionalCustomerIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {additionalCustomerIds.map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1 pr-1">
                            {customerNameById.get(id) || "ลูกค้า"}
                            {!editDocId && (
                              <button
                                type="button"
                                className="ml-1 rounded-full p-0.5 hover:bg-muted"
                                onClick={() => handleRemoveAdditionalCustomer(id)}
                                aria-label={`ลบ ${customerNameById.get(id) || "ลูกค้า"}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {showCustomerColumn && (
                      <FormDescription>
                        รวมบิลจาก {allCustomerIds.length} ลูกค้าในใบเสร็จเดียว — ชื่อบนหัวใบเสร็จใช้ลูกค้าหลักที่เลือกด้านบน
                      </FormDescription>
                    )}
                    <FormMessage />
                </FormItem>
            )} />

            {selectedCustomerId && (
              <FormItem>
                <FormLabel>ออกใบเสร็จตามใบวางบิล</FormLabel>
                <Select
                  value={selectedBillingNoteId || "__none__"}
                  onValueChange={handleBillingNoteSelect}
                  disabled={!!editDocId || isSubmitting || billingNoteOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        billingNoteOptions.length === 0
                          ? "ไม่มีใบวางบิลค้างชำระ"
                          : "เลือกเลขที่ใบวางบิล..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— เลือกเองจากตาราง —</SelectItem>
                    {billingNoteOptions.map((bn) => (
                      <SelectItem key={bn.id} value={bn.id}>
                        {bn.docNo} · ฿{formatCurrency(bn.paymentSummary?.balance ?? bn.grandTotal)}
                        {bn.docDate ? ` (${safeFormat(new Date(bn.docDate), "dd/MM/yy")})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {selectedBillingNoteId
                    ? "เลือกใบวางบิลแล้ว — ระบบเลือกใบวางบิลให้อัตโนมัติ (แสดงใบกำกับในใบวางบิลด้านล่าง)"
                    : "เลือกใบวางบิลเพื่อออกใบเสร็จตามยอดรวมใบวางบิล หรือเลือกบิลเองจากตาราง"}
                </FormDescription>
              </FormItem>
            )}
            </div>

            {selectedCustomerId && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                    <FormLabel>
                      {isBillingNoteMode
                        ? "รายการในใบวางบิลที่เลือก"
                        : "เลือกเอกสารที่ต้องการออกใบเสร็จ (ใบกำกับภาษี / ใบวางบิล — ไม่รวมใบส่งของ)"}
                    </FormLabel>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12 text-center">เลือก</TableHead>
                                    {showCustomerColumn && <TableHead>ลูกค้า</TableHead>}
                                    <TableHead>เลขที่เอกสาร</TableHead>
                                    <TableHead>วันที่</TableHead>
                                    <TableHead className="text-right">ยอดคงค้าง</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tableDocs.length > 0 ? tableDocs.map(doc => {
                                    const selectable = isDocSelectable(doc);
                                    return (
                                    <TableRow
                                      key={doc.id}
                                      className={cn(
                                        selectable ? "hover:bg-muted/30 cursor-pointer" : "opacity-70",
                                        watchedSourceDocIds.includes(doc.id) && "bg-primary/5"
                                      )}
                                      onClick={() => !isSubmitting && selectable && handleToggleDoc(doc.id)}
                                    >
                                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                            <Checkbox 
                                                checked={watchedSourceDocIds.includes(doc.id)} 
                                                onCheckedChange={() => !isSubmitting && selectable && handleToggleDoc(doc.id)} 
                                                disabled={isSubmitting || !selectable}
                                            />
                                        </TableCell>
                                        {showCustomerColumn && (
                                          <TableCell className="text-xs max-w-[140px] truncate">
                                            {customerNameById.get(resolveDocCustomerId(doc)) || doc.customerSnapshot?.name || "—"}
                                          </TableCell>
                                        )}
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs">{doc.docNo}</span>
                                                <Badge variant="outline" className="text-[8px] h-4 px-1">{doc.docType === 'BILLING_NOTE' ? 'วางบิล' : 'กำกับภาษี'}</Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs">{safeFormat(new Date(doc.docDate), "dd/MM/yy")}</TableCell>
                                        <TableCell className="text-right font-bold text-primary">
                                            {formatCurrency(doc.paymentSummary?.balance ?? doc.grandTotal)}
                                        </TableCell>
                                    </TableRow>
                                    );
                                }) : (
                                    <TableRow>
                                        <TableCell colSpan={showCustomerColumn ? 5 : 4} className="h-24 text-sm text-muted-foreground text-center italic">
                                            {isBillingNoteMode
                                              ? "ไม่พบรายการในใบวางบิลนี้"
                                              : "ไม่พบเอกสารค้างชำระที่สามารถออกใบเสร็จได้"}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
            </CardContent>
        </Card>

        {watchedSourceDocIds.length > 0 && (
        <Card className="animate-in zoom-in-95">
            <CardHeader><CardTitle className="text-base">2. รายละเอียดใบเสร็จ (บันทึกบัญชีจริงเมื่อรับเงินที่หน้าลูกหนี้)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>วันที่ออกใบเสร็จ</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal h-10",
                                !field.value && "text-muted-foreground"
                              )}
                              disabled={isSubmitting}
                            >
                              {field.value ? format(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                              <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField name="amount" render={({ field }) => (
                    <FormItem>
                        <FormLabel>ยอดเงินรวมตามใบเสร็จ (บาท)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} className="font-black text-xl text-primary" readOnly /></FormControl>
                        <FormDescription className="text-right text-[10px]">รวมยอดจากบิล {watchedSourceDocIds.length} รายการ</FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField name="accountId" render={({ field }) => (
                    <FormItem>
                        <FormLabel>เข้าบัญชี (คาดการณ์)</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกบัญชีที่จะนำเงินเข้า..." /></SelectTrigger></FormControl>
                            <SelectContent>
                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.type === 'CASH' ? 'เงินสด' : 'ธนาคาร'})</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormLabel>บันทึกเพิ่มเติม</FormLabel><FormControl><Textarea {...field} placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)..." disabled={isSubmitting} /></FormControl></FormItem>)} />
            </CardContent>
        </Card>
        )}
      </form>
    </Form>
  );
}
