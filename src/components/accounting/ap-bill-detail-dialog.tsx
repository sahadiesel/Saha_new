"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useFirebase, type WithId } from "@/firebase";
import type { AccountingObligation, PurchaseDoc } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";

const formatCurrency = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type Props = {
  obligation: WithId<AccountingObligation> | null;
  isOpen: boolean;
  onClose: () => void;
};

/** ดูรายการในบิลเจ้าหนี้แบบอ่านอย่างเดียว — ไม่มีปุ่มแก้ไข */
export function ApBillDetailDialog({ obligation, isOpen, onClose }: Props) {
  const { db } = useFirebase();
  const [purchase, setPurchase] = useState<WithId<PurchaseDoc> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !obligation || !db) {
      setPurchase(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const canLoadPurchase =
      obligation.sourceDocType === "PURCHASE" && Boolean(obligation.sourceDocId);

    if (!canLoadPurchase) {
      setPurchase(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPurchase(null);

    (async () => {
      try {
        const snap = await getDoc(doc(db, "purchaseDocs", obligation.sourceDocId!));
        if (cancelled) return;
        if (!snap.exists()) {
          setLoadError("ไม่พบเอกสารซื้อที่เชื่อมกับรายการนี้");
          setPurchase(null);
          return;
        }
        setPurchase({ id: snap.id, ...(snap.data() as PurchaseDoc) });
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "โหลดรายละเอียดไม่สำเร็จ");
        setPurchase(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, obligation, db]);

  const vendorLabel =
    obligation?.vendorNameSnapshot ||
    obligation?.vendorShortNameSnapshot ||
    purchase?.vendorSnapshot?.companyName ||
    "—";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 shrink-0">
          <DialogTitle>รายละเอียดบิลเจ้าหนี้</DialogTitle>
          <DialogDescription>
            ดูรายการอย่างเดียว — ไม่สามารถแก้ไขจากหน้านี้
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">ร้านค้า</div>
              <div className="font-medium">{vendorLabel}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">เลขที่บิล</div>
              <div className="font-mono font-medium">
                {obligation?.invoiceNo || obligation?.sourceDocNo || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">วันที่</div>
              <div>
                {obligation?.docDate
                  ? safeFormat(new Date(obligation.docDate), APP_DATE_FORMAT)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">สถานะ</div>
              <Badge variant="outline" className="mt-0.5">
                {obligation?.status === "PAID"
                  ? "ชำระครบแล้ว"
                  : obligation?.status === "PARTIAL"
                    ? "ชำระบางส่วน"
                    : "ค้างชำระ"}
              </Badge>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive py-6 text-center">{loadError}</p>
          ) : purchase ? (
            <>
              {purchase.docNo ? (
                <p className="text-xs text-muted-foreground">
                  เลขที่ระบบ: <span className="font-mono">{purchase.docNo}</span>
                </p>
              ) : null}
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>รายการ</TableHead>
                      <TableHead className="text-right w-20">จำนวน</TableHead>
                      <TableHead className="text-right w-28">ราคา/หน่วย</TableHead>
                      <TableHead className="text-right w-28">จำนวนเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(purchase.items || []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="h-20 text-center text-muted-foreground italic"
                        >
                          ไม่มีรายการในบิล
                        </TableCell>
                      </TableRow>
                    ) : (
                      purchase.items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-center text-xs">{index + 1}</TableCell>
                          <TableCell className="text-sm whitespace-pre-wrap">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatCurrency(item.total)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>ยอดก่อนภาษี</span>
                  <span className="font-mono">{formatCurrency(purchase.net)}</span>
                </div>
                {purchase.withTax ? (
                  <div className="flex justify-between">
                    <span>ภาษี</span>
                    <span className="font-mono">{formatCurrency(purchase.vatAmount)}</span>
                  </div>
                ) : null}
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>ยอดรวม</span>
                  <span className="font-mono">{formatCurrency(purchase.grandTotal)}</span>
                </div>
              </div>

              {purchase.note ? (
                <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                  <span className="font-semibold text-xs text-muted-foreground uppercase">
                    หมายเหตุ:{" "}
                  </span>
                  {purchase.note}
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-3 rounded-md border p-4 text-sm">
              <p className="text-muted-foreground">
                รายการนี้ไม่มีเอกสารซื้อผูกไว้ (บันทึกเจ้าหนี้ด้วยมือ) — ไม่มีรายการสินค้าให้แสดง
              </p>
              <div className="flex justify-between">
                <span>ยอดรวม</span>
                <span className="font-mono font-medium">
                  {formatCurrency(obligation?.amountTotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>ชำระแล้ว</span>
                <span className="font-mono">{formatCurrency(obligation?.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>คงค้าง</span>
                <span className="font-mono">{formatCurrency(obligation?.balance)}</span>
              </div>
              {obligation?.notes ? (
                <p className="whitespace-pre-wrap border-t pt-3">{obligation.notes}</p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="p-6 pt-3 border-t shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
