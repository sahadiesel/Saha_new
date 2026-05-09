"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  limit,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserCheck, UserX, KeyRound } from "lucide-react";
import type { CustomerPasswordResetRequest, UserProfile } from "@/lib/types";
import { callRejectPortalCustomerRegistration } from "@/lib/callable-customer-portal";
import { callAdminResetCustomerPasswordAfterForgot } from "@/lib/callable-customer-password-reset";
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

type CustomerResetRow = CustomerPasswordResetRequest & { id: string };

export default function AdminCustomerUsersPage() {
  const { db, app } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<UserProfile | null>(null);

  const [resetRows, setResetRows] = useState<CustomerResetRow[]>([]);
  const [resetLoading, setResetLoading] = useState(true);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<CustomerResetRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const isAdmin = profile?.role === "ADMIN";

  const load = async () => {
    if (!db || !isAdmin) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "users"),
        where("role", "==", "CUSTOMER"),
        where("status", "==", "PENDING"),
        limit(100)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile));
      list.sort((a, b) => {
        const ta = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        const tb = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      setRows(list);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "โหลดรายการไม่สำเร็จ",
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when admin gate resolves
  }, [db, isAdmin]);

  useEffect(() => {
    if (!db || !isAdmin) {
      setResetRows([]);
      setResetLoading(false);
      return;
    }
    setResetLoading(true);
    const q = query(
      collection(db, "customerPasswordResetRequests"),
      where("status", "==", "PENDING"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setResetRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CustomerResetRow)));
        setResetLoading(false);
      },
      (err) => {
        console.error(err);
        toast({
          variant: "destructive",
          title: "โหลดคำขอลืมรหัสไม่สำเร็จ",
          description: err.message,
        });
        setResetLoading(false);
      }
    );
    return () => unsub();
  }, [db, isAdmin, toast]);

  const approve = async (u: UserProfile) => {
    if (!db) return;
    setBusyUid(u.uid);
    try {
      await updateDoc(doc(db, "users", u.uid), {
        status: "ACTIVE",
        updatedAt: serverTimestamp(),
      });
      toast({ title: "อนุมัติแล้ว", description: `${u.displayName} ใช้งานพอร์ทัลลูกค้าได้แล้ว` });
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "อนุมัติไม่สำเร็จ",
        description: (e as Error).message,
      });
    } finally {
      setBusyUid(null);
    }
  };

  const openResetDialog = (r: CustomerResetRow) => {
    setResetTarget(r);
    setResetPassword("");
    setResetPasswordConfirm("");
    setResetDialogOpen(true);
  };

  const submitAdminReset = async () => {
    if (!resetTarget || !app) return;
    if (resetPassword.length < 6) {
      toast({ variant: "destructive", title: "รหัสผ่านสั้นเกินไป", description: "อย่างน้อย 6 ตัวอักษร" });
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      toast({ variant: "destructive", title: "รหัสผ่านไม่ตรงกัน", description: "กรอกให้เหมือนกันทั้งสองช่อง" });
      return;
    }
    setResetBusy(true);
    try {
      await callAdminResetCustomerPasswordAfterForgot(app, {
        requestDocId: resetTarget.id,
        newPassword: resetPassword,
      });
      toast({
        title: "รีเซ็ตรหัสผ่านแล้ว",
        description: "แจ้งลูกค้าให้เข้าสู่ระบบด้วยรหัสชั่วคราว แล้วตั้งรหัสใหม่ตามขั้นตอนบนพอร์ทัล",
      });
      setResetDialogOpen(false);
      setResetTarget(null);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "รีเซ็ตไม่สำเร็จ",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setResetBusy(false);
    }
  };

  const reject = async (u: UserProfile) => {
    setBusyUid(u.uid);
    try {
      await callRejectPortalCustomerRegistration(u.uid, u.phone);
      toast({ title: "ปฏิเสธการสมัครแล้ว", description: "บัญชีถูกลบและเลิกผูกกับรายชื่อลูกค้า" });
      setRejectTarget(null);
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "ดำเนินการไม่สำเร็จ",
        description: (e as Error).message,
      });
    } finally {
      setBusyUid(null);
    }
  };

  if (!profile) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container py-10">
        <Card>
          <CardHeader>
            <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
            <CardDescription>เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <PageHeader title="การจัดการ user ลูกค้า" description="อนุมัติหรือปฏิเสธการสมัครพอร์ทัลลูกค้า (ลงทะเบียนด้วยเบอร์โทร)" />

      <Card>
        <CardHeader>
          <CardTitle>รออนุมัติ</CardTitle>
          <CardDescription>
            เมื่ออนุมัติแล้ว ลูกค้าจะเข้าใช้งาน /customer ดูงานซ่อม และสั่งซื้ออะไหล่ได้
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีรายการรออนุมัติ</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>เบอร์ (รหัสลูกค้า)</TableHead>
                  <TableHead>อีเมลระบบ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.uid}>
                    <TableCell className="font-medium">{u.displayName}</TableCell>
                    <TableCell>{u.phone}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        onClick={() => approve(u)}
                        disabled={busyUid === u.uid}
                        className="gap-1"
                      >
                        {busyUid === u.uid ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UserCheck className="h-4 w-4" />
                        )}
                        อนุมัติ
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRejectTarget(u)}
                        disabled={busyUid === u.uid}
                        className="gap-1"
                      >
                        <UserX className="h-4 w-4" />
                        ปฏิเสธ
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            ลูกค้าลืมรหัสผ่าน
          </CardTitle>
          <CardDescription>
            ลูกค้าส่งคำขอจากพอร์ทัล — ตรวจเลขบัตรในระบบกับที่ลูกค้ากรอก แล้วตั้งรหัสชั่วคราวให้ลูกค้าเข้าสู่ระบบและตั้งรหัสใหม่เอง
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resetLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : resetRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีคำขอรีเซ็ตรหัสผ่านที่รอดำเนินการ</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เบอร์โทร</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>เลขบัตร (ในระบบ)</TableHead>
                  <TableHead>เลขบัตร (ลูกค้ากรอก)</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resetRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.phone}</TableCell>
                    <TableCell className="font-medium">{r.customerName}</TableCell>
                    <TableCell className="font-mono text-xs">{r.nationalIdOnFile}</TableCell>
                    <TableCell className="font-mono text-xs">{r.nationalIdSubmitted}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="default" className="gap-1" onClick={() => openResetDialog(r)}>
                        <KeyRound className="h-4 w-4" />
                        รีเซ็ตรหัสผ่าน
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={resetDialogOpen} onOpenChange={(o) => !resetBusy && setResetDialogOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>รีเซ็ตรหัสผ่านลูกค้า</DialogTitle>
            <DialogDescription>
              ตั้งรหัสชั่วคราวให้ {resetTarget?.customerName} ({resetTarget?.phone}) — หลังเข้าสู่ระบบระบบจะบังคับให้ตั้งรหัสใหม่เอง
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="admin-reset-pw">รหัสผ่านชั่วคราว</Label>
              <Input
                id="admin-reset-pw"
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                disabled={resetBusy}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-reset-pw2">ยืนยันรหัสผ่าน</Label>
              <Input
                id="admin-reset-pw2"
                type="password"
                autoComplete="new-password"
                value={resetPasswordConfirm}
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
                disabled={resetBusy}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={resetBusy} onClick={() => setResetDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" disabled={resetBusy} onClick={() => void submitAdminReset()}>
              {resetBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปฏิเสธการสมัคร?</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะลบบัญชีล็อกอินและเลิกผูกกับรายชื่อลูกค้า ลูกค้าสามารถสมัครใหม่ได้ภายหลัง
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => rejectTarget && reject(rejectTarget)}
            >
              ปฏิเสธ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
