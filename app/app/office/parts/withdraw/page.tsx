"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  collection,
  query,
  where,
  onSnapshot,
  limit,
  orderBy,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  PlusCircle,
  ClipboardList,
  Search,
  Eye,
  Edit,
  MoreHorizontal,
  Trash2,
  RotateCcw,
  Check,
  ListChecks,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import type { Document, DocumentItem } from "@/lib/types";
import { withdrawalListStatusLabel } from "@/lib/ui-labels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function remainingWithdrawQty(item: DocumentItem): number {
  return Math.max(0, Number(item.quantity || 0) - Number(item.returnedToStockQty || 0));
}

function recalcWithdrawalLineTotals(items: DocumentItem[]): DocumentItem[] {
  return items.map((i) => {
    const rem = remainingWithdrawQty(i);
    const unit = Number(i.unitPrice) || 0;
    return { ...i, total: Math.round(rem * unit * 100) / 100 };
  });
}

function sumWithdrawalGrand(items: DocumentItem[]): number {
  return Math.round(items.reduce((s, i) => s + (i.total || 0), 0) * 100) / 100;
}

type PartialLineState = { selected: boolean; qty: number };

export default function OfficePartsWithdrawPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [withdrawals, setWithdrawals] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isActionLoading, setIsActionLoading] = useState(false);
  const [docToDelete, setDocToDelete] = useState<Document | null>(null);
  const [docToCancel, setDocToCancel] = useState<Document | null>(null);
  const [cancelMode, setCancelMode] = useState<"full" | "partial">("full");
  const [partialLineState, setPartialLineState] = useState<PartialLineState[]>([]);

  const isAdmin = profile?.role === "ADMIN" || profile?.role === "MANAGER";

  useEffect(() => {
    if (!db) return;
    const q = query(
      collection(db, "documents"),
      where("docType", "==", "WITHDRAWAL"),
      orderBy("docNo", "desc"),
      limit(200)
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Document)));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    if (!docToCancel) {
      setPartialLineState([]);
      setCancelMode("full");
      return;
    }
    setCancelMode("full");
    setPartialLineState(
      docToCancel.items.map((item) => ({
        selected: false,
        qty: remainingWithdrawQty(item),
      }))
    );
  }, [docToCancel]);

  const handleConfirmDelete = async () => {
    if (!db || !docToDelete || !profile) return;
    setIsActionLoading(true);

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, "documents", docToDelete.id);
        const docSnap = await transaction.get(docRef);

        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        const docData = docSnap.data() as Document;

        if (docData.status === "ISSUED") {
          for (const item of docData.items) {
            if (!item.partId) continue;
            const revertQty = remainingWithdrawQty(item);
            if (revertQty <= 0) continue;

            const partRef = doc(db, "parts", item.partId);
            const partSnap = await transaction.get(partRef);

            if (partSnap.exists()) {
              const currentQty = partSnap.data().stockQty || 0;

              transaction.update(partRef, {
                stockQty: currentQty + revertQty,
                updatedAt: serverTimestamp(),
              });

              const actRef = doc(collection(db, "stockActivities"));
              transaction.set(
                actRef,
                sanitizeForFirestore({
                  partId: item.partId,
                  partCode: item.code,
                  partName: item.description,
                  type: "ADJUST_ADD",
                  diffQty: revertQty,
                  beforeQty: currentQty,
                  afterQty: currentQty + revertQty,
                  notes: `คืนสต็อกเนื่องจากการลบใบเบิก ${docData.docNo} โดย ${profile.displayName}`,
                  createdByUid: profile.uid,
                  createdByName: profile.displayName,
                  createdAt: serverTimestamp(),
                })
              );
            }
          }
        }
        transaction.delete(docRef);
      });

      toast({
        title: "ลบรายการเบิกสำเร็จ",
        description:
          docToDelete.status === "ISSUED"
            ? "ระบบได้คืนยอดสต็อกเฉพาะจำนวนที่ยังไม่ถูกคืนก่อนหน้า (ถ้ามี) แล้วลบเอกสารค่ะ"
            : "ลบข้อมูลฉบับร่างเรียบร้อยแล้วค่ะ",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setIsActionLoading(false);
      setDocToDelete(null);
    }
  };

  const handleApplyCancelReturn = async () => {
    if (!db || !docToCancel || !profile) return;
    const docId = docToCancel.id;
    const mode = cancelMode;
    const linesSnapshot = partialLineState;

    if (docToCancel.status === "ISSUED" && mode === "partial") {
      const hasAny =
        linesSnapshot.some((l, idx) => {
          const item = docToCancel.items[idx];
          if (!item) return false;
          const max = remainingWithdrawQty(item);
          return l.selected && max > 0 && Number(l.qty) > 0;
        }) ?? false;
      if (!hasAny) {
        toast({
          variant: "destructive",
          title: "ยังไม่ได้เลือกรายการคืน",
          description: "เลือกบรรทัดและจำนวนที่จะคืนสต็อก หรือเปลี่ยนเป็น «ยกเลิกทั้งใบ»",
        });
        return;
      }
    }

    setIsActionLoading(true);

    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, "documents", docId);
        const docSnap = await transaction.get(docRef);

        if (!docSnap.exists()) throw new Error("ไม่พบเอกสารในระบบ");
        const docData = docSnap.data() as Document;

        const appendNote = (msg: string) =>
          (docData.notes || "") + `\n[System] ${msg} (${new Date().toLocaleString()} โดย ${profile.displayName})`;

        if (docData.status === "DRAFT") {
          transaction.update(
            docRef,
            sanitizeForFirestore({
              status: "CANCELLED",
              updatedAt: serverTimestamp(),
              notes: appendNote("ยกเลิกฉบับร่าง"),
            })
          );
          return;
        }

        if (docData.status !== "ISSUED") {
          throw new Error("เอกสารนี้ไม่สามารถคืนสต็อกได้ในสถานะปัจจุบัน");
        }

        let newItems = docData.items.map((i) => ({ ...i }));

        if (mode === "full") {
          for (let i = 0; i < newItems.length; i++) {
            const item = newItems[i];
            const rev = remainingWithdrawQty(item);
            if (rev <= 0) continue;
            if (!item.partId) continue;

            const partRef = doc(db, "parts", item.partId);
            const partSnap = await transaction.get(partRef);
            if (!partSnap.exists()) continue;

            const currentQty = partSnap.data().stockQty || 0;
            transaction.update(partRef, {
              stockQty: currentQty + rev,
              updatedAt: serverTimestamp(),
            });

            const actRef = doc(collection(db, "stockActivities"));
            transaction.set(
              actRef,
              sanitizeForFirestore({
                partId: item.partId,
                partCode: item.code,
                partName: item.description,
                type: "ADJUST_ADD",
                diffQty: rev,
                beforeQty: currentQty,
                afterQty: currentQty + rev,
                notes: `คืนสต็อก (ยกเลิกทั้งใบเบิก ${docData.docNo}) โดย ${profile.displayName}`,
                createdByUid: profile.uid,
                createdByName: profile.displayName,
                createdAt: serverTimestamp(),
              })
            );

            newItems[i] = { ...item, returnedToStockQty: Number(item.quantity) };
          }

          newItems = recalcWithdrawalLineTotals(newItems);
          const grandTotal = sumWithdrawalGrand(newItems);

          transaction.update(
            docRef,
            sanitizeForFirestore({
              items: newItems,
              subtotal: grandTotal,
              net: grandTotal,
              grandTotal,
              status: "CANCELLED",
              updatedAt: serverTimestamp(),
              notes: appendNote(`ยกเลิกทั้งใบเบิก ${docData.docNo} (คืนสต็อกครบทุกบรรทัดที่เหลือ)`),
            })
          );
          return;
        }

        // partial
        const lineNotes: string[] = [];
        for (let idx = 0; idx < newItems.length; idx++) {
          const st = linesSnapshot[idx];
          const item = newItems[idx];
          if (!st?.selected || !item.partId) continue;

          const maxRem = remainingWithdrawQty(item);
          const want = Math.min(maxRem, Math.max(0, Number(st.qty) || 0));
          if (want <= 0) continue;

          const partRef = doc(db, "parts", item.partId);
          const partSnap = await transaction.get(partRef);
          if (!partSnap.exists()) continue;

          const currentQty = partSnap.data().stockQty || 0;
          transaction.update(partRef, {
            stockQty: currentQty + want,
            updatedAt: serverTimestamp(),
          });

          const actRef = doc(collection(db, "stockActivities"));
          transaction.set(
            actRef,
            sanitizeForFirestore({
              partId: item.partId,
              partCode: item.code,
              partName: item.description,
              type: "ADJUST_ADD",
              diffQty: want,
              beforeQty: currentQty,
              afterQty: currentQty + want,
              notes: `คืนสต็อกบางส่วน (ใบเบิก ${docData.docNo}) ${item.code || item.description} จำนวน ${want} โดย ${profile.displayName}`,
              createdByUid: profile.uid,
              createdByName: profile.displayName,
              createdAt: serverTimestamp(),
            })
          );

          const prevRet = Number(item.returnedToStockQty || 0);
          newItems[idx] = { ...item, returnedToStockQty: prevRet + want };
          lineNotes.push(`${item.code || item.description}: คืน ${want}`);
        }

        newItems = recalcWithdrawalLineTotals(newItems);
        const grandTotal = sumWithdrawalGrand(newItems);
        const allReturned = newItems.every((i) => remainingWithdrawQty(i) <= 1e-9);

        transaction.update(
          docRef,
          sanitizeForFirestore({
            items: newItems,
            subtotal: grandTotal,
            net: grandTotal,
            grandTotal,
            status: allReturned ? "CANCELLED" : "ISSUED",
            updatedAt: serverTimestamp(),
            notes: appendNote(
              allReturned
                ? `คืนสต็อกครบทุกบรรทัด — ปิดใบเบิก ${docData.docNo}`
                : `คืนสต็อกบางส่วน: ${lineNotes.join("; ")}`
            ),
          })
        );
      });

      toast({
        title: mode === "full" ? "ยกเลิกทั้งใบและคืนสต็อกแล้ว" : "คืนสต็อกตามที่เลือกแล้ว",
        description:
          mode === "full"
            ? "สถานะเอกสารเป็น «ยกเลิก» และยอดคลังถูกปรับแล้ว"
            : "คืนสต็อกเฉพาะบรรทัดที่เลือก — ใบเบิกยังคงใช้ได้หากมียอดคงเบิก",
      });
      setDocToCancel(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ดำเนินการไม่สำเร็จ", description: e.message });
    } finally {
      setIsActionLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!searchTerm) return withdrawals;
    const q = searchTerm.toLowerCase();
    return withdrawals.filter(
      (w) =>
        w.docNo.toLowerCase().includes(q) ||
        w.customerSnapshot?.name?.toLowerCase().includes(q) ||
        w.jobId?.toLowerCase().includes(q) ||
        w.quotationDocNo?.toLowerCase().includes(q)
    );
  }, [withdrawals, searchTerm]);

  const issuableLinesCount = docToCancel
    ? docToCancel.items.filter((it) => remainingWithdrawQty(it) > 0 && it.partId).length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="รายการเบิกสินค้า" description="ตรวจสอบและจัดการเอกสารใบเบิกอะไหล่เพื่อใช้ในการซ่อม">
        <Button asChild className="shadow-md">
          <Link href="/app/office/parts/withdraw/new">
            <PlusCircle className="mr-2 h-4 w-4" /> สร้างรายการเบิกใหม่
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              รายการเบิกทั้งหมด
            </CardTitle>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาเลขที่ใบเบิก, ใบเสนอราคา, ชื่อลูกค้า, เลขงาน..."
                className="pl-10 h-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[110px]">เลขที่ใบเบิก</TableHead>
                    <TableHead className="w-[100px]">วันที่</TableHead>
                    <TableHead className="min-w-[120px]">อ้างอิง</TableHead>
                    <TableHead className="max-w-[180px]">ผู้รับ/ลูกค้า</TableHead>
                    <TableHead className="text-center w-[120px]">สถานะ</TableHead>
                    <TableHead className="text-right w-[120px]">มูลค่ารวม</TableHead>
                    <TableHead className="text-right w-[60px]">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        <Loader2 className="animate-spin mx-auto text-primary" />
                      </TableCell>
                    </TableRow>
                  ) : filtered.length > 0 ? (
                    filtered.map((w) => {
                      const s = w.status?.toUpperCase() || "DRAFT";
                      const statusLabel = withdrawalListStatusLabel(w);
                      const partialStock = w.items?.some((i) => (i.returnedToStockQty || 0) > 0);
                      return (
                        <TableRow
                          key={w.id}
                          className={cn(
                            "hover:bg-muted/30 transition-colors",
                            s === "CANCELLED" && "opacity-50 grayscale"
                          )}
                        >
                          <TableCell className="font-bold font-mono text-primary text-xs whitespace-nowrap">
                            {w.docNo}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {safeFormat(new Date(w.docDate), APP_DATE_FORMAT)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 min-w-0">
                              {w.quotationDocNo ? (
                                <Badge
                                  variant="secondary"
                                  className="font-mono text-[10px] w-fit max-w-full truncate"
                                  title={w.quotationDocNo}
                                >
                                  QT {w.quotationDocNo}
                                </Badge>
                              ) : null}
                              {w.jobId ? (
                                <Button variant="link" className="h-auto p-0 text-[10px] font-mono justify-start" asChild>
                                  <Link href={`/app/jobs/${w.jobId}`} title={w.jobId}>
                                    งาน: {w.jobId.slice(0, 8)}…
                                  </Link>
                                </Button>
                              ) : !w.quotationDocNo ? (
                                <span className="text-muted-foreground text-xs">-</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div
                              className="text-sm font-semibold max-w-[180px] truncate"
                              title={w.customerSnapshot?.name}
                            >
                              {w.customerSnapshot?.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                s === "DRAFT" ? "secondary" : s === "CANCELLED" ? "destructive" : "default"
                              }
                              className={cn(
                                "text-[9px] min-w-[72px] justify-center h-auto py-1 px-1.5 whitespace-normal text-center leading-tight",
                                s === "ISSUED" &&
                                  !partialStock &&
                                  "bg-green-600",
                                s === "ISSUED" && partialStock && "bg-amber-600"
                              )}
                            >
                              {statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-black text-sm">
                            ฿{w.grandTotal.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuItem onClick={() => router.push(`/app/documents/${w.id}`)}>
                                  <Eye className="mr-2 h-4 w-4" /> ดูรายละเอียด
                                </DropdownMenuItem>

                                {s === "DRAFT" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      router.push(`/app/office/parts/withdraw/new?editDocId=${w.id}`)
                                    }
                                  >
                                    <Edit className="mr-2 h-4 w-4" /> แก้ไขฉบับร่าง
                                  </DropdownMenuItem>
                                )}

                                {s !== "CANCELLED" && (
                                  <DropdownMenuItem
                                    className="text-orange-600 focus:text-orange-600 font-medium"
                                    onClick={() => setDocToCancel(w)}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" /> ยกเลิก / คืนสต็อก
                                  </DropdownMenuItem>
                                )}

                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDocToDelete(w)}
                                  disabled={!isAdmin}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> ลบถาวร
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic">
                        ไม่พบรายการเบิกอะไหล่
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!docToDelete} onOpenChange={(o) => !o && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              ยืนยันการลบรายการถาวร?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  คุณต้องการลบใบเบิกเลขที่ <span className="font-bold">{docToDelete?.docNo}</span>{" "}
                  ใช่หรือไม่? ข้อมูลนี้จะหายไปจากฐานข้อมูลถาวร
                </p>
                {docToDelete?.status === "ISSUED" && (
                  <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 text-destructive">
                    <RotateCcw className="h-4 w-4" />
                    <AlertTitle className="text-xs font-bold">คืนสต็อกก่อนลบ</AlertTitle>
                    <AlertDescription className="text-[10px]">
                      ระบบจะบวกคืนสต็อกเฉพาะจำนวนที่ยังไม่ถูกคืนจากใบนี้ (หลังหักคืนบางส่วนแล้ว) จากนั้นจึงลบเอกสาร
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>ปิด</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={isActionLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "ยืนยันลบถาวร"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!docToCancel}
        onOpenChange={(o) => {
          if (!o) setDocToCancel(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-orange-600" />
              ยกเลิก / คืนสต็อก
            </DialogTitle>
            <DialogDescription>
              ใบเบิก <span className="font-semibold text-foreground">{docToCancel?.docNo}</span> — เลือกคืนทั้งใบหรือคืนเฉพาะบรรทัด
            </DialogDescription>
          </DialogHeader>

          {docToCancel?.status === "DRAFT" && (
            <p className="text-sm text-muted-foreground">
              ฉบับร่างยังไม่ตัดสต็อก — ยกเลิกแล้วจะเปลี่ยนสถานะเป็น «ยกเลิก» เท่านั้น
            </p>
          )}

          {docToCancel?.status === "ISSUED" && issuableLinesCount === 0 && (
            <Alert>
              <AlertTitle className="text-sm">ไม่มียอดให้คืน</AlertTitle>
              <AlertDescription className="text-xs">
                ทุกบรรทัดถูกคืนสต็อกครบแล้ว หรือไม่มีรหัสอะไหล่ — ใช้ลบถาวรถ้าต้องการเอาเอกสารออก
              </AlertDescription>
            </Alert>
          )}

          {docToCancel?.status === "ISSUED" && issuableLinesCount > 0 && (
            <div className="space-y-4">
              <RadioGroup
                value={cancelMode}
                onValueChange={(v) => setCancelMode(v as "full" | "partial")}
                className="gap-3"
              >
                <div className="flex items-start space-x-2 rounded-lg border p-3">
                  <RadioGroupItem value="full" id="cancel-full" className="mt-1" />
                  <Label htmlFor="cancel-full" className="font-normal cursor-pointer flex-1">
                    <span className="font-semibold text-foreground">ยกเลิกทั้งใบ</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      คืนสต็อกทุกบรรทัดที่เหลือ และปิดใบเบิก (สถานะ «ยกเลิก»)
                    </p>
                  </Label>
                </div>
                <div className="flex items-start space-x-2 rounded-lg border p-3">
                  <RadioGroupItem value="partial" id="cancel-partial" className="mt-1" />
                  <Label htmlFor="cancel-partial" className="font-normal cursor-pointer flex-1">
                    <span className="font-semibold text-foreground">คืนสต็อกบางรายการ</span>
                    <p className="text-xs text-muted-foreground mt-1">
                      เลือกบรรทัดและจำนวนที่คืน — ใบเบิกยังคงอยู่จนกว่าจะคืนครบทุกบรรทัด
                    </p>
                  </Label>
                </div>
              </RadioGroup>

              {cancelMode === "partial" && (
                <ScrollArea className="h-[220px] border rounded-md p-2">
                  <div className="space-y-3 pr-2">
                    {docToCancel.items.map((item, idx) => {
                      const max = remainingWithdrawQty(item);
                      if (max <= 0 || !item.partId) return null;
                      const st = partialLineState[idx] ?? { selected: false, qty: max };
                      return (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 border-b pb-2 last:border-0"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Checkbox
                              checked={st.selected}
                              onCheckedChange={(c) => {
                                setPartialLineState((prev) => {
                                  const next = [...prev];
                                  next[idx] = {
                                    ...next[idx],
                                    selected: c === true,
                                    qty: next[idx]?.qty ?? max,
                                  };
                                  return next;
                                });
                              }}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{item.description}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {item.code} · คงเหลือเบิก {max} / เบิกไป {item.quantity}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Label className="text-xs whitespace-nowrap">คืน</Label>
                            <Input
                              type="number"
                              step="any"
                              className="w-20 h-8 text-right"
                              disabled={!st.selected}
                              value={st.qty}
                              min={0}
                              max={max}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                setPartialLineState((prev) => {
                                  const next = [...prev];
                                  next[idx] = {
                                    ...next[idx],
                                    qty: Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0,
                                  };
                                  return next;
                                });
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}

              {cancelMode === "full" && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800 space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <Check className="h-4 w-4" /> สรุป
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>คืนสต็อกเท่าที่ยังไม่เคยคืนจากแต่ละบรรทัด</li>
                    <li>สถานะเอกสาร → ยกเลิก</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDocToCancel(null)} disabled={isActionLoading}>
              ปิด
            </Button>
            <Button
              type="button"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={
                isActionLoading ||
                (docToCancel?.status === "ISSUED" && issuableLinesCount === 0)
              }
              onClick={() => void handleApplyCancelReturn()}
            >
              {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
