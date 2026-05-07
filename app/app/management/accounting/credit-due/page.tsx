"use client";

import { useMemo, Suspense, useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/auth-context";
import { useFirebase, type WithId } from "@/firebase";
import { collection, query, where, onSnapshot, limit, type FirestoreError } from "firebase/firestore";
import { format as dfFormat } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, HandCoins, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { AccountingObligation, AccountingAccount } from "@/lib/types";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";
import { PayCreditorDialog } from "@/components/accounting/pay-creditor-dialog";

const formatCurrency = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CreditDueContent() {
  const { db } = useFirebase();
  const [rows, setRows] = useState<WithId<AccountingObligation>[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<WithId<AccountingAccount>[]>([]);
  const [paying, setPaying] = useState<WithId<AccountingObligation> | null>(null);

  const todayYmd = useMemo(() => dfFormat(new Date(), "yyyy-MM-dd"), []);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "accountingAccounts"), where("isActive", "==", true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingAccount>)));
      },
      (err) => {
        if (err.code === "permission-denied") {
          errorEmitter.emit("permission-error", new FirestorePermissionError({ path: "accountingAccounts", operation: "list" }));
        }
      }
    );
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, "accountingObligations"), where("type", "==", "AP"), limit(1000));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithId<AccountingObligation>));
        const due = list.filter((ob) => {
          if (ob.status === "PAID") return false;
          const dueStr = ob.dueDate?.trim();
          if (!dueStr) return false;
          return dueStr <= todayYmd;
        });
        due.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
        setRows(due);
        setLoading(false);
      },
      (err: FirestoreError) => {
        if (err.code === "permission-denied") {
          errorEmitter.emit("permission-error", new FirestorePermissionError({ path: "accountingObligations", operation: "list" }));
        }
        setLoading(false);
      }
    );
    return () => unsub();
  }, [db, todayYmd]);

  const accountName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "—";
      return accounts.find((a) => a.id === id)?.name || id;
    },
    [accounts]
  );

  return (
    <>
      <PageHeader
        title="ครบกำหนดจ่ายเครดิต"
        description="รายการเจ้าหนี้ที่ถึงหรือเลยวันครบกำหนด — ต้องกดยืนยันการจ่ายและเลือกบัญชีเอง ระบบไม่ตัดจ่ายอัตโนมัติ"
      />
      <Alert className="mb-4 border-amber-200 bg-amber-50/80">
        <Info className="h-4 w-4 text-amber-700" />
        <AlertTitle className="text-amber-900">ยืนยันก่อนจ่ายจริง</AlertTitle>
        <AlertDescription className="text-amber-900/90 text-sm">
          หน้านี้ใช้แจ้งเตือนเท่านั้น การตัดบัญชีเกิดขึ้นเมื่อกด &quot;ยืนยันจ่าย&quot; และบันทึกในหน้าต่างจ่ายเจ้าหนี้เท่านั้น
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>รายการถึงกำหนด ({rows.length})</CardTitle>
          <CardDescription>เฉพาะเจ้าหนี้ที่มีวันครบกำหนดจ่ายและยังมียอดค้าง — วันนี้ {safeFormat(new Date(), APP_DATE_FORMAT)}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 italic">ไม่มีรายการเครดิตที่ถึงกำหนดในขณะนี้</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ครบกำหนด</TableHead>
                    <TableHead>เลขที่บิล</TableHead>
                    <TableHead>ร้านค้า</TableHead>
                    <TableHead className="text-right">ยอดคงค้าง</TableHead>
                    <TableHead>บัญชีคาดจ่าย</TableHead>
                    <TableHead className="text-right">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((ob) => (
                    <TableRow key={ob.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {ob.dueDate ? safeFormat(new Date(ob.dueDate + "T12:00:00"), APP_DATE_FORMAT) : "—"}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{ob.invoiceNo || ob.sourceDocNo}</TableCell>
                      <TableCell className="text-sm">{ob.vendorShortNameSnapshot || ob.vendorNameSnapshot}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(ob.balance)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={accountName(ob.expectedPaymentAccountId)}>
                        {accountName(ob.expectedPaymentAccountId)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => setPaying(ob)}>
                          <HandCoins className="h-4 w-4 mr-1" />
                          ยืนยันจ่าย
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {paying && <PayCreditorDialog isOpen={!!paying} onClose={() => setPaying(null)} obligation={paying} accounts={accounts} />}
    </>
  );
}

export default function CreditDuePage() {
  const { profile, loading } = useAuth();
  const hasPermission = useMemo(
    () =>
      profile?.role === "ADMIN" ||
      profile?.role === "MANAGER" ||
      profile?.department === "MANAGEMENT" ||
      profile?.department === "ACCOUNTING_HR",
    [profile]
  );

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!profile || !hasPermission) {
    return (
      <div className="w-full">
        <PageHeader title="ครบกำหนดจ่ายเครดิต" />
        <Card className="text-center py-12">
          <CardHeader>
            <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
            <CardDescription>หน้านี้สงวนไว้สำหรับฝ่ายบัญชีหรือผู้ดูแลระบบ</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <CreditDueContent />
    </Suspense>
  );
}
