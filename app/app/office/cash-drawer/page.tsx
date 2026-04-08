"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  doc, 
  setDoc,
  updateDoc, 
  serverTimestamp, 
  writeBatch, 
  limit, 
  getDocs,
  Timestamp,
  runTransaction,
  type FirestoreError
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Loader2, PlusCircle, History, Wallet, ArrowDownCircle, ArrowUpCircle, 
  Lock, Unlock, CheckCircle2, AlertCircle, Camera, X, Image as ImageIcon, ExternalLink, Eye, Receipt, Save
} from "lucide-react";
import { cashDrawerStatusLabel } from "@/lib/ui-labels";
import { safeFormat } from "@/lib/date-utils";
import Image from "next/image";
import { cn } from "@/lib/utils";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { CashDrawerSession, CashDrawerTransaction } from "@/lib/types";

export const dynamic = 'force-dynamic';

const FILE_SIZE_THRESHOLD = 500 * 1024; // 500KB

const compressImageIfNeeded = async (file: File): Promise<File> => {
  if (file.size <= FILE_SIZE_THRESHOLD) return file;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let quality = 0.9;
        const attemptCompression = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                if (blob.size <= FILE_SIZE_THRESHOLD || q <= 0.1) {
                  const compressedFile = new File([blob], file.name, {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                } else {
                  attemptCompression(q - 0.1);
                }
              } else {
                resolve(file); 
              }
            },
            "image/jpeg",
            q
          );
        };
        attemptCompression(quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const transactionSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  amount: z.coerce.number().min(0.01, "จำนวนเงินต้องมากกว่า 0"),
  category: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  description: z.string().min(1, "กรุณาระบุรายละเอียด"),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

const openSessionSchema = z.object({
  openingAmount: z.coerce.number().min(0, "จำนวนเงินต้องไม่ติดลบ"),
});

const closeSessionSchema = z.object({
  countedAmount: z.coerce.number().min(0, "จำนวนเงินต้องไม่ติดลบ"),
  notes: z.string().optional(),
});

export default function OfficeCashDrawerPage() {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [activeSession, setActiveSession] = useState<CashDrawerSession | null>(null);
  const [sessions, setSessions] = useState<CashDrawerSession[]>([]);
  const [transactions, setTransactions] = useState<CashDrawerTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyIndexUrl, setHistoryIndexUrl] = useState<string | null>(null);

  const [isOpening, setIsOpening] = useState(false);
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // History Details States
  const [viewingSession, setViewingSession] = useState<CashDrawerSession | null>(null);
  const [viewingTransactions, setViewingTransactions] = useState<CashDrawerTransaction[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const [transPhotos, setTransPhotos] = useState<File[]>([]);
  const [transPhotoPreviews, setTransPhotoPreviews] = useState<string[]>([]);

  const transForm = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: { type: "IN", amount: 0, category: "", description: "" },
  });

  const openForm = useForm<z.infer<typeof openSessionSchema>>({
    resolver: zodResolver(openSessionSchema),
    defaultValues: { openingAmount: 0 },
  });

  const closeForm = useForm<z.infer<typeof closeSessionSchema>>({
    resolver: zodResolver(closeSessionSchema),
    defaultValues: { countedAmount: 0, notes: "" },
  });

  // Fetch active session and history
  useEffect(() => {
    if (!db) return;

    const activeQ = query(
      collection(db, "cashDrawerSessions"), 
      where("status", "==", "OPEN"),
      limit(1)
    );
    const unsubActive = onSnapshot(activeQ, (snap) => {
      if (!snap.empty) {
        setActiveSession({ id: snap.docs[0].id, ...snap.docs[0].data() } as CashDrawerSession);
      } else {
        setActiveSession(null);
      }
      setLoading(false);
    });

    const historyQ = query(
      collection(db, "cashDrawerSessions"),
      orderBy("openedAt", "desc"),
      limit(20)
    );
    const unsubHistory = onSnapshot(historyQ, (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as CashDrawerSession)));
      setHistoryIndexUrl(null);
    }, (err: FirestoreError) => {
        if (err.message?.includes('requires an index')) {
            const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
            if (urlMatch) setHistoryIndexUrl(urlMatch[0]);
        }
    });

    return () => { unsubActive(); unsubHistory(); };
  }, [db]);

  useEffect(() => {
    if (!db || !activeSession) {
      setTransactions([]);
      return;
    }
    const transQ = query(
      collection(db, "cashDrawerSessions", activeSession.id, "transactions"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(transQ, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as CashDrawerTransaction)));
    });
  }, [db, activeSession]);

  // Load Transactions for viewing a history session
  useEffect(() => {
    if (!db || !viewingSession) {
      setViewingTransactions([]);
      return;
    }
    setIsLoadingDetails(true);
    const transQ = query(
      collection(db, "cashDrawerSessions", viewingSession.id, "transactions"),
      orderBy("createdAt", "asc")
    );
    
    const unsubscribe = onSnapshot(transQ, (snap) => {
      setViewingTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as CashDrawerTransaction)));
      setIsLoadingDetails(false);
    }, (err) => {
      console.error(err);
      setIsLoadingDetails(false);
    });

    return () => unsubscribe();
  }, [db, viewingSession]);

  const handleOpenSession = async (values: z.infer<typeof openSessionSchema>) => {
    if (!db || !profile) return;
    setIsSubmitting(true);
    try {
      const sessionRef = doc(collection(db, "cashDrawerSessions"));
      await setDoc(sessionRef, {
        status: "OPEN",
        openedAt: serverTimestamp(),
        openedByUid: profile.uid,
        openedByName: profile.displayName,
        openingAmount: values.openingAmount,
        expectedAmount: values.openingAmount,
        createdAt: serverTimestamp(),
      });
      toast({ title: "เปิดรอบการทำงานสำเร็จ" });
      setIsOpening(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "เปิดรอบไม่สำเร็จ", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTransaction = async (values: TransactionFormData) => {
    if (!db || !activeSession || !profile || !storage) return;
    setIsSubmitting(true);
    try {
      const uploadedPhotos: string[] = [];
      for (const file of transPhotos) {
        const pRef = ref(storage, `cash-drawer/${activeSession.id}/${Date.now()}-${file.name}`);
        await uploadBytes(pRef, file);
        uploadedPhotos.push(await getDownloadURL(pRef));
      }

      await runTransaction(db, async (transaction) => {
        const sessionRef = doc(db, "cashDrawerSessions", activeSession.id);
        const transRef = doc(collection(db, "cashDrawerSessions", activeSession.id, "transactions"));
        
        const currentSession = await transaction.get(sessionRef);
        if (!currentSession.exists()) throw new Error("รอบการทำงานถูกปิดไปแล้ว");
        
        const currentExpected = currentSession.data().expectedAmount || 0;
        const newExpected = values.type === "IN" ? currentExpected + values.amount : currentExpected - values.amount;

        transaction.set(transRef, {
          ...values,
          sessionId: activeSession.id,
          photos: uploadedPhotos,
          createdAt: serverTimestamp(),
          createdByUid: profile.uid,
          createdByName: profile.displayName,
        });

        transaction.update(sessionRef, {
          expectedAmount: newExpected,
          updatedAt: serverTimestamp(),
        });
      });

      toast({ title: "บันทึกรายการสำเร็จ" });
      setIsAddingTransaction(false);
      setTransPhotos([]);
      setTransPhotoPreviews([]);
      transForm.reset();
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseSession = async (values: z.infer<typeof closeSessionSchema>) => {
    if (!db || !activeSession || !profile) return;
    setIsSubmitting(true);
    try {
      const sessionRef = doc(db, "cashDrawerSessions", activeSession.id);
      const diff = values.countedAmount - activeSession.expectedAmount;
      
      await updateDoc(sessionRef, {
        status: "CLOSED",
        countedAmount: values.countedAmount,
        difference: diff,
        closedAt: serverTimestamp(),
        closedByUid: profile.uid,
        closedByName: profile.displayName,
        notes: values.notes || "",
        updatedAt: serverTimestamp(),
      });

      toast({ title: "ปิดรอบการทำงานแล้ว", description: "กรุณานำส่งเงินคืนผู้จัดการเพื่อทำการตรวจสอบและล็อกรอบ" });
      setIsClosing(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ปิดรอบไม่สำเร็จ", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setIsCompressing(true);
      try {
        const processedFiles: File[] = [];
        for (const file of files) {
          const processed = await compressImageIfNeeded(file);
          processedFiles.push(processed);
        }
        setTransPhotos(prev => [...prev, ...processedFiles]);
        setTransPhotoPreviews(prev => [...prev, ...processedFiles.map(f => URL.createObjectURL(f))]);
      } catch (err) {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาดในการจัดการรูปภาพ" });
      } finally {
        setIsCompressing(false);
        e.target.value = '';
      }
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="เงินสดหน้าร้าน (Cash Drawer)" description="จัดการกระแสเงินสดและการเปิด-ปิดรอบประจำวัน" />

      {activeSession ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg">รอบปัจจุบัน (เปิดอยู่)</CardTitle>
                <Badge variant="default" className="bg-green-600 animate-pulse">OPEN</Badge>
              </div>
              <CardDescription>เปิดโดย {activeSession.openedByName} เมื่อ {safeFormat(activeSession.openedAt, "HH:mm")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center p-6 bg-background rounded-lg border shadow-inner">
                <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">เงินสดที่ควรมีในลิ้นชัก</p>
                <p className="text-4xl font-bold text-primary mt-2">฿{activeSession.expectedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Button size="lg" className="h-20 flex-col gap-1" onClick={() => setIsAddingTransaction(true)}>
                  <PlusCircle className="h-6 w-6" />
                  บันทึก รับ/จ่าย
                </Button>
                <Button variant="outline" size="lg" className="h-20 flex-col gap-1 border-destructive text-destructive hover:bg-destructive/10" onClick={() => setIsClosing(true)}>
                  <Lock className="h-6 w-6" />
                  ปิดรอบงาน
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>รายการล่าสุดในรอบนี้</CardTitle>
              <Wallet className="text-muted-foreground h-5 w-5" />
            </CardHeader>
            <CardContent>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เวลา</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>รายการ</TableHead>
                      <TableHead className="text-right">จำนวนเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length > 0 ? transactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs text-muted-foreground">{safeFormat(t.createdAt, "HH:mm")}</TableCell>
                        <TableCell>
                          <Badge variant={t.type === "IN" ? "secondary" : "destructive"} className="text-[10px]">
                            {t.type === "IN" ? <ArrowDownCircle className="mr-1 h-3 w-3" /> : <ArrowUpCircle className="mr-1 h-3 w-3" />}
                            {t.type === "IN" ? "รับ" : "จ่าย"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{t.description}</p>
                          <p className="text-[10px] text-muted-foreground">{t.category}</p>
                        </TableCell>
                        <TableCell className={cn("text-right font-bold", t.type === "IN" ? "text-green-600" : "text-destructive")}>
                          {t.type === "IN" ? "+" : "-"}{t.amount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={4} className="text-center h-24 text-muted-foreground italic">ยังไม่มีรายการในรอบนี้</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="max-w-md mx-auto text-center py-12 border-dashed">
          <CardHeader>
            <div className="mx-auto bg-muted p-4 rounded-full w-fit mb-4"><Unlock className="h-10 w-10 text-muted-foreground" /></div>
            <CardTitle>ยังไม่เปิดรอบการทำงาน</CardTitle>
            <CardDescription>กรุณาเปิดรอบและระบุจำนวนเงินสดเริ่มต้นเพื่อเริ่มบันทึกรายการ</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" className="w-full" onClick={() => setIsOpening(true)}>
              <PlusCircle className="mr-2 h-5 w-5" /> เปิดรอบการทำงานใหม่
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการเปิด-ปิดรอบ</CardTitle>
            <CardDescription>รายการย้อนหลัง 20 รอบล่าสุด</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {historyIndexUrl && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>ต้องสร้างดัชนี (Index) ก่อนดูประวัติ</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>ฐานข้อมูลต้องการดัชนีเพื่อจัดเรียงรายการประวัติ กรุณากดปุ่มด้านล่างเพื่อสร้าง Index</span>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href={historyIndexUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> สร้าง Index สำหรับประวัติ
                  </a>
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>ผู้รับผิดชอบ</TableHead>
                  <TableHead className="text-right">เงินต้น</TableHead>
                  <TableHead className="text-right">เงินปลายรอบ</TableHead>
                  <TableHead className="text-right">ผลต่าง</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{safeFormat(s.openedAt, "dd/MM/yy HH:mm")}</TableCell>
                    <TableCell className="text-sm font-medium">{s.openedByName}</TableCell>
                    <TableCell className="text-right">{s.openingAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-bold">{s.countedAmount ? s.countedAmount.toLocaleString() : "-"}</TableCell>
                    <TableCell className={cn("text-right font-bold", (s.difference || 0) < 0 ? "text-destructive" : "text-green-600")}>
                      {s.difference !== undefined ? (s.difference > 0 ? `+${s.difference}` : s.difference) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "OPEN" ? "default" : s.status === "CLOSED" ? "secondary" : "outline"} className="text-[10px]">
                        {cashDrawerStatusLabel(s.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setViewingSession(s)}>
                        <Eye className="h-3 w-3" />
                        ดูรายการ
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* History Details Dialog */}
      <Dialog open={!!viewingSession} onOpenChange={(open) => !open && setViewingSession(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <div className="flex justify-between items-start">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-primary" />
                  รายละเอียดรอบงาน: {safeFormat(viewingSession?.openedAt, "dd MMM yy")}
                </DialogTitle>
                <DialogDescription>
                  รอบเปิดโดย {viewingSession?.openedByName} เมื่อ {safeFormat(viewingSession?.openedAt, "HH:mm")}
                </DialogDescription>
              </div>
              <Badge variant={viewingSession?.status === "OPEN" ? "default" : "secondary"}>
                {viewingSession?.status}
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 border rounded-lg bg-muted/20">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">เงินต้น (Opening)</p>
                <p className="text-lg font-bold">฿{viewingSession?.openingAmount.toLocaleString()}</p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/20">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">ยอดในระบบ</p>
                <p className="text-lg font-bold">฿{viewingSession?.expectedAmount.toLocaleString()}</p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/20">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">นับจริง (Counted)</p>
                <p className="text-lg font-bold">฿{viewingSession?.countedAmount?.toLocaleString() || "-"}</p>
              </div>
              <div className={cn("p-3 border rounded-lg", (viewingSession?.difference || 0) < 0 ? "bg-destructive/5 border-destructive/20" : "bg-green-50 border-green-200")}>
                <p className="text-[10px] text-muted-foreground uppercase font-bold">ผลต่าง</p>
                <p className={cn("text-lg font-bold", (viewingSession?.difference || 0) < 0 ? "text-destructive" : "text-green-600")}>
                  {viewingSession?.difference !== undefined ? (viewingSession.difference > 0 ? `+${viewingSession.difference}` : viewingSession.difference) : "-"}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <ArrowDownCircle className="h-4 w-4 text-green-600" />
                รายการเดินเงิน (Transactions)
              </h4>
              
              {isLoadingDetails ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
              ) : viewingTransactions.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-20">เวลา</TableHead>
                        <TableHead>รายการ</TableHead>
                        <TableHead className="text-right">จำนวนเงิน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingTransactions.map(t => (
                        <TableRow key={t.id} className="hover:bg-transparent">
                          <TableCell className="text-xs text-muted-foreground align-top pt-3">{safeFormat(t.createdAt, "HH:mm")}</TableCell>
                          <TableCell className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={t.type === "IN" ? "secondary" : "destructive"} className="h-4 text-[8px] px-1">
                                {t.type === "IN" ? "รับ" : "จ่าย"}
                              </Badge>
                              <span className="font-medium text-sm">{t.description}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">{t.category}</p>
                            {t.photos && t.photos.length > 0 && (
                              <div className="flex gap-1 mt-2">
                                {t.photos.map((url, idx) => (
                                  <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="relative w-10 h-10 rounded border overflow-hidden block">
                                    <Image src={url} alt="proof" fill className="object-cover" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={cn("text-right font-bold align-top pt-3", t.type === "IN" ? "text-green-600" : "text-destructive")}>
                            {t.type === "IN" ? "+" : "-"}{t.amount.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 border rounded-md border-dashed text-muted-foreground italic text-sm">
                  ไม่มีรายการบันทึกในรอบนี้
                </div>
              )}
            </div>

            {viewingSession?.notes && (
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase">หมายเหตุการปิดรอบ</Label>
                <div className="p-3 bg-muted/30 rounded-md text-sm italic">
                  "{viewingSession.notes}"
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="p-4 border-t bg-muted/10">
            <Button variant="outline" onClick={() => setViewingSession(null)}>ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isOpening} onOpenChange={setIsOpening}>
        <DialogContent>
          <DialogHeader><DialogTitle>เปิดรอบการทำงาน</DialogTitle></DialogHeader>
          <Form {...openForm}>
            <form onSubmit={openForm.handleSubmit(handleOpenSession)} className="space-y-4">
              <FormField name="openingAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>จำนวนเงินทอนเริ่มต้น (บาท)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter><Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ยืนยันเปิดรอบ</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddingTransaction} onOpenChange={setIsAddingTransaction}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>บันทึกรายการ รับ/จ่าย</DialogTitle></DialogHeader>
          <Form {...transForm}>
            <form onSubmit={transForm.handleSubmit(handleAddTransaction)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภท</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><SelectItem value="IN">เงินเข้า (รับ)</SelectItem><SelectItem value="OUT">เงินออก (จ่าย)</SelectItem></SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField name="amount" render={({ field }) => (
                  <FormItem><FormLabel>จำนวนเงิน</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>หมวดหมู่</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="เลือกหมวดหมู่..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="ขายสดหน้าร้าน">ขายสดหน้าร้าน</SelectItem>
                      <SelectItem value="รับชำระลูกหนี้">รับชำระลูกหนี้</SelectItem>
                      <SelectItem value="ค่าอะไหล่/ของซื้อนอก">ค่าอะไหล่/ของซื้อนอก</SelectItem>
                      <SelectItem value="ค่าส่งของ/ขนส่ง">ค่าส่งของ/ขนส่ง</SelectItem>
                      <SelectItem value="ค่าใช้จ่ายเบ็ดเตล็ด">ค่าใช้จ่ายเบ็ดเตล็ด</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField name="description" render={({ field }) => (
                <FormItem><FormLabel>รายละเอียด</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              
              <div className="space-y-2">
                <Label>แนบรูปภาพหลักฐาน (ถ้ามี)</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" asChild disabled={isCompressing}>
                    <label className="cursor-pointer flex items-center gap-2">
                      {isCompressing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} 
                      {isCompressing ? "กำลังบีบอัด..." : "ถ่ายรูป/เลือกไฟล์"}
                      <input type="file" className="hidden" accept="image/*" multiple onChange={handlePhotoChange} disabled={isCompressing} />
                    </label>
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {transPhotoPreviews.map((p, i) => (
                    <div key={i} className="relative w-16 h-16 border rounded overflow-hidden">
                      <Image src={p} alt="preview" fill className="object-cover" />
                      <Button type="button" variant="destructive" size="icon" className="absolute top-0 right-0 h-5 w-5 rounded-none" onClick={() => {
                        setTransPhotos(prev => prev.filter((_, idx) => idx !== i));
                        setTransPhotoPreviews(prev => prev.filter((_, idx) => idx !== i));
                      }}><X className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter><Button type="submit" disabled={isSubmitting || isCompressing}>{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}บันทึกรายการ</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isClosing} onOpenChange={setIsClosing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ปิดรอบการทำงาน</DialogTitle>
            <DialogDescription>นับเงินสดที่มีจริงในลิ้นชักเพื่อเปรียบเทียบกับยอดในระบบ</DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-muted/50 rounded-lg text-center mb-4">
            <p className="text-xs text-muted-foreground uppercase font-bold">ยอดเงินในระบบ</p>
            <p className="text-2xl font-bold">฿{activeSession?.expectedAmount.toLocaleString()}</p>
          </div>
          <Form {...closeForm}>
            <form onSubmit={closeForm.handleSubmit(handleCloseSession)} className="space-y-4">
              <FormField name="countedAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>จำนวนเงินที่นับได้จริง (บาท)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="notes" render={({ field }) => (<FormItem><FormLabel>หมายเหตุการปิดรอบ</FormLabel><FormControl><Textarea {...field} placeholder="เช่น สาเหตุที่เงินขาดหรือเกิน..." /></FormControl></FormItem>)} />
              <DialogFooter><Button type="submit" variant="destructive" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ยืนยันการปิดรอบ</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
