"use client";

import { useState, useCallback, useEffect } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, query, where, getDocs, writeBatch, limit, getCountFromServer, doc, getDoc, updateDoc, serverTimestamp, deleteField, orderBy, deleteDoc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { Loader2, Database, Trash2, Wrench, Search, RotateCcw, AlertTriangle, Link2Off, Save, UserCheck, History, Link as LinkIcon, FileText, CheckCircle2, PlusCircle, FileSearch, Check, FileWarning, Receipt, Settings2, Sparkles, RefreshCw, Info, ShoppingCart } from "lucide-react";
import { jobStatusLabel, deptLabel, docTypeLabel, docStatusLabel } from "@/lib/ui-labels";
import { JOB_STATUSES } from "@/lib/constants";
import type { Job, Document as DocumentType, DocType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AdminUsersPage() {
  const { db, app: firebaseApp } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  // Job States
  const [jobSearchTerm, setJobSearchTerm] = useState("");
  const [searchInArchive, setSearchInArchive] = useState(false);
  const [foundJobs, setFoundJobs] = useState<Job[]>([]);
  const [isSearchingJobs, setIsSearchingJobs] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Document States
  const [docSearchTerm, setDocSearchTerm] = useState("");
  const [searchDocCategory, setSearchDocCategory] = useState<'SALES' | 'PURCHASE'>('SALES');
  const [foundDocs, setFoundDocs] = useState<any[]>([]);
  const [isSearchingDocs, setIsSearchingDocs] = useState(false);
  const [targetDoc, setTargetDoc] = useState<any>(null);

  // Migration & Cleanup States
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<any>(null);
  const [unusedTokenCount, setUnusedTokenCount] = useState<number | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  const isUserAdmin = profile?.role === 'ADMIN' || profile?.role === 'MANAGER';

  const handleSearchJobs = async () => {
    if (!db || !jobSearchTerm.trim()) return;
    setIsSearchingJobs(true);
    setFoundJobs([]);
    try {
      const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
      const q = query(collection(db, colName), orderBy("createdAt", "desc"), limit(1000));
      const snap = await getDocs(q);
      
      const term = jobSearchTerm.toLowerCase();
      const filtered = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Job))
        .filter(j => 
          j.id.toLowerCase().includes(term) || 
          j.customerSnapshot?.name?.toLowerCase().includes(term) ||
          j.customerSnapshot?.phone?.includes(term) ||
          j.salesDocNo?.toLowerCase().includes(term) ||
          j.description?.toLowerCase().includes(term)
        );
      
      setFoundJobs(filtered);
      if (filtered.length === 0) toast({ title: "ไม่พบข้อมูลงานซ่อมที่ระบุ" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ค้นหาล้มเหลว", description: e.message });
    } finally {
      setIsSearchingJobs(false);
    }
  };

  const handleSearchDocs = async () => {
    if (!db || !docSearchTerm.trim()) return;
    setIsSearchingDocs(true);
    setFoundDocs([]);
    try {
      const collectionName = searchDocCategory === 'SALES' ? "documents" : "purchaseDocs";
      const q = query(collection(db, collectionName), orderBy("createdAt", "desc"), limit(1000));
      const snap = await getDocs(q);
      
      const term = docSearchTerm.toLowerCase().trim();
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(d => 
          d.docNo.toLowerCase().includes(term) ||
          (d.customerSnapshot?.name || "").toLowerCase().includes(term) ||
          (d.vendorSnapshot?.companyName || "").toLowerCase().includes(term) ||
          (d.invoiceNo || "").toLowerCase().includes(term)
        );

      setFoundDocs(docs);
      
      if (docs.length === 0) {
        toast({ 
          title: "ไม่พบเอกสาร", 
          description: "ไม่พบรายการที่ตรงกับคำค้นหาใน 1,000 รายการล่าสุดค่ะ" 
        });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsSearchingDocs(false);
    }
  };

  const handleRevertDocToDraft = async (docObj: any) => {
    if (!db || !profile || !isUserAdmin) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      const isPurchase = searchDocCategory === 'PURCHASE' || (docObj.vendorSnapshot && !docObj.docType);
      const collectionName = isPurchase ? 'purchaseDocs' : 'documents';
      const docRef = doc(db, collectionName, docObj.id);
      
      const updatePayload: any = {
        status: 'DRAFT',
        updatedAt: serverTimestamp(),
        notes: (docObj.note || docObj.notes || "") + `\n[Admin Fix] Reverted to Draft by ${profile.displayName} on ${new Date().toLocaleString()}`
      };

      if (!isPurchase) {
          updatePayload.arStatus = deleteField();
          updatePayload.receiptStatus = deleteField();
          updatePayload.paymentSummary = deleteField();
          updatePayload.accountingEntryId = deleteField();
          updatePayload.arObligationId = deleteField();
          updatePayload.confirmedPayment = deleteField();
          updatePayload.suggestedPayments = deleteField();
      } else {
          updatePayload.apObligationId = deleteField();
          updatePayload.accountingEntryId = deleteField();
          updatePayload.isReceived = false; 
          updatePayload.reviewRejectReason = deleteField();
      }

      batch.update(docRef, updatePayload);

      const obQuery = query(collection(db, 'accountingObligations'), where('sourceDocId', '==', docObj.id));
      const obSnap = await getDocs(obQuery);
      obSnap.docs.forEach(d => batch.delete(d.ref));

      const entryQuery = query(collection(db, 'accountingEntries'), where('sourceDocId', '==', docObj.id));
      const entrySnap = await getDocs(entryQuery);
      entrySnap.docs.forEach(d => batch.delete(d.ref));

      const claimCollection = isPurchase ? "purchaseClaims" : "paymentClaims";
      const claimQuery = query(collection(db, claimCollection), where(isPurchase ? "purchaseDocId" : "sourceDocId", "==", docObj.id));
      const claimSnap = await getDocs(claimQuery);
      claimSnap.docs.forEach(d => batch.delete(d.ref));

      if (docObj.jobId) {
        const jobRef = doc(db, 'jobs', docObj.jobId);
        const jobSnap = await getDoc(jobRef);
        if (jobSnap.exists()) {
          batch.update(jobRef, {
            status: 'WAITING_CUSTOMER_PICKUP',
            salesDocStatus: 'DRAFT',
            lastActivityAt: serverTimestamp()
          });
          batch.set(doc(collection(jobRef, "activities")), {
            text: `[Admin Action] เอกสาร ${docObj.docNo} ถูกตีกลับเป็นฉบับร่าง: คืนสถานะงานเป็นรอลูกค้ารับของ`,
            userName: profile.displayName,
            userId: profile.uid,
            createdAt: serverTimestamp()
          });
        }
      }

      await batch.commit();
      toast({ title: "กู้คืนสถานะเอกสารสำเร็จ", description: "บิลกลับเป็นฉบับร่าง และลบรายการบัญชีที่เกี่ยวข้องออกแล้วค่ะ" });
      setTargetDoc(null);
      handleSearchDocs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ล้มเหลว", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateJobManual = async (jobId: string, updates: any, logText: string) => {
    if (!db || !profile) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
      const jobRef = doc(db, colName, jobId);
      batch.update(jobRef, { ...updates, updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
      batch.set(doc(collection(jobRef, "activities")), { text: `[Admin Manual Fix] ${logText}`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      await batch.commit();
      toast({ title: "ปรับปรุงข้อมูลสำเร็จ" });
      setEditingJob(null);
      handleSearchJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFullUnlink = async () => {
    if (!db || !editingJob || !profile) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
      const jobRef = doc(db, colName, editingJob.id);
      batch.update(jobRef, { salesDocId: deleteField(), salesDocNo: deleteField(), salesDocType: deleteField(), salesDocStatus: deleteField(), updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
      batch.set(doc(collection(jobRef, "activities")), { text: `[Admin Full Unlink] ล้างการเชื่อมโยงเอกสารทั้งหมดเรียบร้อยแล้ว`, userName: profile.displayName, userId: profile.uid, createdAt: serverTimestamp() });
      
      const docsQuery = query(collection(db, "documents"), where("jobId", "==", editingJob.id));
      const docSnaps = await getDocs(docsQuery);
      docSnaps.docs.forEach(d => batch.update(d.ref, { jobId: deleteField(), updatedAt: serverTimestamp() }));

      await batch.commit();
      toast({ title: "ล้างลิงก์เอกสารทั้งหมดสำเร็จ" });
      setEditingJob(null);
      handleSearchJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ล้มเหลว", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const fetchUnusedTokenCount = useCallback(async () => {
    if (!db || !isUserAdmin) return;
    setIsLoadingCount(true);
    try {
      const q = query(collection(db, "kioskTokens"), where("isActive", "==", true));
      const snap = await getCountFromServer(q);
      setUnusedTokenCount(snap.data().count);
    } catch (e) {} finally { setIsLoadingCount(false); }
  }, [db, isUserAdmin]);

  useEffect(() => {
    if (isUserAdmin) fetchUnusedTokenCount();
  }, [isUserAdmin, fetchUnusedTokenCount]);

  const handleCleanupTokens = async () => {
    if (!db || !isUserAdmin) return;
    setIsCleaningUp(true);
    try {
      const q = query(collection(db, "kioskTokens"), limit(500));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast({ title: "ล้าง Token สำเร็จ", description: `ลบไปทั้งหมด ${snap.size} รายการ` });
      fetchUnusedTokenCount();
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleRunMigration = async () => {
    if (!firebaseApp || !isUserAdmin) return;
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const functions = getFunctions(firebaseApp, 'us-central1');
      const migrateFn = httpsCallable(functions, 'migrateClosedJobsToArchive2026');
      const result = await migrateFn({ limit: 40 });
      setMigrationResult(result.data);
      toast({ title: "ดำเนินการ Migration สำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Migration ล้มเหลว", description: e.message });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="การดูแลรักษาระบบ" description="เครื่องมือสำหรับ Admin เพื่อจัดการข้อมูลและแก้ไขปัญหาเคสพิเศษ" />
      
      <Tabs defaultValue="jobs" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="jobs">แก้ไขงานซ่อม</TabsTrigger>
          <TabsTrigger value="docs">แก้ไขเอกสาร/บัญชี</TabsTrigger>
          <TabsTrigger value="maintenance">จัดการระบบ</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-6 space-y-6">
          {isUserAdmin && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader>
                <div className="flex items-center gap-2 text-blue-700">
                  <Wrench className="h-5 w-5" />
                  <CardTitle className="text-lg">แก้ไขข้อมูลงานซ่อม (Job Integrity)</CardTitle>
                </div>
                <CardDescription>บังคับเปลี่ยนสถานะหรือล้างลิงก์บิลที่ผิดพลาดในงานซ่อม</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 max-w-2xl">
                  <div className="flex-1 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input 
                        placeholder="พิมพ์ชื่อลูกค้า / ทะเบียน / อาการ / เลขจ๊อบ..." 
                        className="pl-8 bg-background h-10"
                        value={jobSearchTerm}
                        onChange={(e) => setJobSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchJobs()}
                      />
                    </div>
                    <div className="flex items-center space-x-2 px-1">
                      <Checkbox id="archive-search" checked={searchInArchive} onCheckedChange={(v) => setSearchInArchive(!!v)} />
                      <Label htmlFor="archive-search" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"><History className="h-3 w-3" /> ค้นหาในประวัติ</Label>
                    </div>
                  </div>
                  <Button onClick={handleSearchJobs} disabled={isSearchingJobs} className="h-10">{isSearchingJobs ? <Loader2 className="h-4 w-4 animate-spin" /> : "ค้นหาจ๊อบ"}</Button>
                </div>

                {foundJobs.length > 0 && (
                  <div className="border rounded-lg bg-background overflow-hidden">
                    <Table>
                      <TableHeader><TableRow><TableHead>รหัสงาน / ลูกค้า</TableHead><TableHead>บิลที่ผูกอยู่</TableHead><TableHead>สถานะจ๊อบ</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {foundJobs.map(job => (
                          <TableRow key={job.id}>
                            <TableCell><div className="font-bold text-sm">{job.customerSnapshot?.name}</div><div className="text-[10px] text-muted-foreground font-mono">{job.id}</div></TableCell>
                            <TableCell>{job.salesDocNo ? <span className="font-mono text-xs font-bold text-primary">{job.salesDocNo}</span> : <span className="text-xs text-muted-foreground italic">ไม่มี</span>}</TableCell>
                            <TableCell><Badge variant="outline">{jobStatusLabel(job.status)}</Badge></TableCell>
                            <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setEditingJob(job)}><Wrench className="h-3 w-3 mr-1" /> แก้ไข</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="docs" className="mt-6 space-y-6">
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader>
              <div className="flex items-center gap-2 text-amber-700">
                <FileWarning className="h-5 w-5" />
                <CardTitle className="text-lg">จัดการความถูกต้องของเอกสาร</CardTitle>
              </div>
              <CardDescription>ใช้กู้คืนบิลที่มีความผิดพลาดเรื่องตัวเลข ให้กลับมาเป็นฉบับร่างและลบรายการบัญชีที่ผิดออก</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-2 max-w-2xl">
                <Select value={searchDocCategory} onValueChange={(v: any) => setSearchDocCategory(v)}>
                  <SelectTrigger className="w-full sm:w-[220px] h-10 bg-background">
                    <SelectValue placeholder="ประเภทเอกสาร" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALES">งานขาย (ใบส่งของ/ใบกำกับ/ใบเสร็จ)</SelectItem>
                    <SelectItem value="PURCHASE">งานซื้อ (ใบซื้ออะไหล่/งานจ้าง)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex-1 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="พิมพ์เลขที่บิลบางส่วน หรือชื่อลูกค้า..." 
                      className="h-10 bg-background pl-10"
                      value={docSearchTerm}
                      onChange={e => setDocSearchTerm(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchDocs()}
                    />
                  </div>
                  <Button onClick={handleSearchDocs} disabled={isSearchingDocs} className="h-10 px-6">
                    {isSearchingDocs ? <Loader2 className="animate-spin h-4 w-4"/> : "ค้นหา"}
                  </Button>
                </div>
              </div>

              {foundDocs.length > 0 && (
                <div className="border rounded-lg bg-background overflow-hidden">
                  <Table>
                    <TableHeader><TableRow><TableHead>เลขที่</TableHead><TableHead>{searchDocCategory === 'SALES' ? 'ลูกค้า' : 'ร้านค้า'}</TableHead><TableHead className="text-right">ยอดเงิน</TableHead><TableHead>สถานะ</TableHead><TableHead className="text-right">จัดการ</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {foundDocs.map(d => (
                        <TableRow key={d.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-mono font-bold text-xs">{d.docNo}</span>
                              {d.docType && <span className="text-[9px] text-muted-foreground uppercase">{d.docType}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {searchDocCategory === 'SALES' ? d.customerSnapshot?.name : d.vendorSnapshot?.companyName}
                          </TableCell>
                          <TableCell className="text-right font-bold">฿{d.grandTotal.toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{docStatusLabel(d.status, d.docType)}</Badge></TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => setTargetDoc(d)} className="text-amber-600 border-amber-200 hover:bg-amber-50">
                              <RotateCcw className="h-3 w-3 mr-1" /> คืนสถานะร่าง
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
        </TabsContent>

        <TabsContent value="maintenance" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Migration Tool */}
            <Card className="border-purple-200">
              <CardHeader>
                <div className="flex items-center gap-2 text-purple-700">
                  <Database className="h-5 w-5" />
                  <CardTitle className="text-lg">Migration: เก็บงานซ่อมลงประวัติ</CardTitle>
                </div>
                <CardDescription>ย้ายงานที่มีสถานะ CLOSED ออกจากฐานข้อมูลหลักไปยังคลังประวัติ 2026</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="secondary" className="bg-purple-50 border-purple-100 text-purple-800">
                  <Info className="h-4 w-4 text-purple-600" />
                  <AlertTitle className="text-xs font-bold">คำแนะนำ</AlertTitle>
                  <AlertDescription className="text-xs">ใช้สำหรับงานที่ปิดไปแล้วแต่ยังค้างอยู่ในฐานข้อมูลหลัก เพื่อเพิ่มประสิทธิภาพในการโหลดหน้า JobList ค่ะ</AlertDescription>
                </Alert>
                
                {migrationResult && (
                  <div className="p-3 bg-muted rounded-md text-xs font-mono space-y-1 border">
                    <p className="text-green-600 font-bold">✓ ย้ายสำเร็จ: {migrationResult.migrated} รายการ</p>
                    <p className="text-muted-foreground">→ ข้าม (ซ้ำ): {migrationResult.skipped} รายการ</p>
                    {migrationResult.errors?.length > 0 && (
                      <p className="text-destructive font-bold">! ผิดพลาด: {migrationResult.errors.length} รายการ</p>
                    )}
                  </div>
                )}

                <Button 
                  onClick={handleRunMigration} 
                  disabled={isMigrating} 
                  className="w-full bg-purple-600 hover:bg-purple-700 font-bold"
                >
                  {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  เริ่ม Migration (Max 40 เคส)
                </Button>
              </CardContent>
            </Card>

            {/* Token Cleanup Tool */}
            <Card className="border-red-200">
              <CardHeader>
                <div className="flex items-center gap-2 text-red-700">
                  <RefreshCw className="h-5 w-5" />
                  <CardTitle className="text-lg">ล้าง Token QR ลงเวลา</CardTitle>
                </div>
                <CardDescription>ทำความสะอาดข้อมูล QR Code เก่าที่ค้างอยู่ในระบบ</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg border border-red-100">
                  <div>
                    <p className="text-xs text-red-600 font-bold uppercase tracking-wider">Token ที่ค้างอยู่</p>
                    <p className="text-3xl font-black text-red-700">{isLoadingCount ? "..." : (unusedTokenCount ?? 0)}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchUnusedTokenCount} disabled={isLoadingCount}>
                    <RefreshCw className={cn("h-4 w-4", isLoadingCount && "animate-spin")} />
                  </Button>
                </div>

                <Button 
                  variant="destructive" 
                  onClick={handleCleanupTokens} 
                  disabled={isCleaningUp || (unusedTokenCount === 0)}
                  className="w-full font-bold"
                >
                  {isCleaningUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  ล้าง Token ทั้งหมด
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Revert Doc Dialog */}
      <AlertDialog open={!!targetDoc} onOpenChange={o => !o && setTargetDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-amber-600"/> กู้คืนสถานะบิลกลับเป็นฉบับร่าง?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>คุณกำลังจะถอยสถานะเอกสาร <b>{targetDoc?.docNo}</b> กลับเป็น "ฉบับร่าง" เพื่อให้แก้ไขตัวเลขได้</p>
                <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-destructive text-xs space-y-1">
                  <p>• ระบบจะ <b>ลบรายการบัญชี</b> (Cashbook) ที่เกี่ยวข้องทิ้ง</p>
                  <p>• ระบบจะ <b>ลบยอดค้าง</b> (AR/AP) ที่เกี่ยวข้องทิ้ง</p>
                  <p>• ระบบจะ <b>ลบรายการรอรับเงิน/ตรวจสอบ</b> (Claims) ทิ้ง</p>
                  {targetDoc?.jobId && <p>• ระบบจะ <b>คืนสถานะใบงานซ่อม</b> เป็น "รอลูกค้ารับของ" ทันที</p>}
                </div>
                <p className="text-[10px] text-muted-foreground italic font-bold">* ระวัง: ข้อมูลรายการรับ/จ่ายเงินที่เคยบันทึกไว้จะหายไป ต้องบันทึกใหม่หลังจากบัญชีตรวจสอบบิลอีกครั้งค่ะ</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => targetDoc && handleRevertDocToDraft(targetDoc)} disabled={isSaving} className="bg-amber-600 hover:bg-amber-700">
              {isSaving ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Check className="h-4 w-4 mr-2"/>} ยืนยันกู้คืนสถานะ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual Job Editor Dialog */}
      <Dialog open={!!editingJob} onOpenChange={(o) => !o && setEditingJob(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>เครื่องมือแก้ไขจ๊อบ: {editingJob?.customerSnapshot?.name}</DialogTitle>
            <DialogDescription>แก้ไขสถานะหรืองานผูกเอกสารสำหรับจ๊อบเลขที่ {editingJob?.id}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-2">
              <Label className="font-bold">บังคับเปลี่ยนสถานะจ๊อบ</Label>
              <Select defaultValue={editingJob?.status} onValueChange={(val) => handleUpdateJobManual(editingJob!.id, { status: val }, `แก้ไขสถานะเป็น ${jobStatusLabel(val)}`)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{JOB_STATUSES.map(s => (<SelectItem key={s} value={s}>{jobStatusLabel(s)}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-4">
              <Label className="text-primary font-bold flex items-center gap-2"><LinkIcon className="h-4 w-4" /> จัดการลิงก์เอกสาร</Label>
              <div className="p-3 border border-destructive/20 bg-destructive/5 rounded-md space-y-2">
                <p className="text-xs font-bold text-destructive flex items-center gap-1"><Link2Off className="h-3 w-3"/> ล้างลิงก์เอกสารทั้งหมด (Full Unlink)</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs">เลขบิลหลัก: <b>{editingJob?.salesDocNo || "ไม่มี"}</b></span>
                  <Button variant="destructive" size="sm" onClick={handleFullUnlink} disabled={isSaving}>{isSaving ? <Loader2 className="h-3 w-3 animate-spin"/> : "ล้างลิงก์ทิ้ง"}</Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="p-4 border-t bg-muted/10"><Button variant="ghost" onClick={() => setEditingJob(null)}>ปิดหน้าต่าง</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
