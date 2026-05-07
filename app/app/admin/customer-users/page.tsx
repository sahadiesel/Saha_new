"use client";

import { useEffect, useState } from "react";
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserCheck, UserX } from "lucide-react";
import type { UserProfile } from "@/lib/types";
import { callRejectPortalCustomerRegistration } from "@/lib/callable-customer-portal";
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

export default function AdminCustomerUsersPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<UserProfile | null>(null);

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
