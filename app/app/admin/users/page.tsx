
"use client";

import { useState, useCallback, useEffect } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, query, where, getDocs, writeBatch, limit, getCountFromServer, doc, getDoc, updateDoc, serverTimestamp, deleteField, orderBy } from "firebase/firestore";
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
import { Loader2, Database, Trash2, Wrench, Search, RotateCcw, AlertTriangle, Link2Off, Save, UserCheck, History, Link as LinkIcon, FileText, CheckCircle2 } from "lucide-react";
import { jobStatusLabel, deptLabel, docTypeLabel } from "@/lib/ui-labels";
import { JOB_STATUSES } from "@/lib/constants";
import type { Job, Document as DocumentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

export default function AdminUsersPage() {
  const { db, app: firebaseApp } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  // States
  const [jobSearchTerm, setJobSearchTerm] = useState("");
  const [searchInArchive, setSearchInArchive] = useState(false);
  const [foundJobs, setFoundJobs] = useState<Job[]>([]);
  const [isSearchingJobs, setIsSearchingJobs] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Link Doc States
  const [linkDocNo, setLinkDocNo] = useState("");
  const [isSearchingDoc, setIsSearchingDoc] = useState(false);
  const [foundDoc, setFoundDoc] = useState<DocumentType | null>(null);

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
      if (filtered.length === 0) toast({ title: "ไม่พบข้อมูลงานซ่อมที่ระบุ", description: searchInArchive ? "ลองค้นหาใน 'งานที่กำลังทำ' ดูนะคะ" : "ลองติ๊ก 'ค้นหาในประวัติ' ดูนะคะ" });
    } catch (e: any) {
      if (e.message?.includes('requires an index')) {
          const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
          const qSimple = query(collection(db, colName), limit(1000));
          const snapSimple = await getDocs(qSimple);
          const term = jobSearchTerm.toLowerCase();
          const filtered = snapSimple.docs
            .map(d => ({ id: d.id, ...d.data() } as Job))
            .filter(j => 
              j.id.toLowerCase().includes(term) || 
              j.customerSnapshot?.name?.toLowerCase().includes(term) ||
              j.customerSnapshot?.phone?.includes(term) ||
              j.salesDocNo?.toLowerCase().includes(term) ||
              j.description?.toLowerCase().includes(term)
            );
          setFoundJobs(filtered);
      } else {
          toast({ variant: 'destructive', title: "ค้นหาล้มเหลว", description: e.message });
      }
    } finally {
      setIsSearchingJobs(false);
    }
  };

  const handleSearchDocument = async () => {
    if (!db || !linkDocNo.trim()) return;
    setIsSearchingDoc(true);
    setFoundDoc(null);
    try {
      const q = query(collection(db, "documents"), where("docNo", "==", linkDocNo.trim()), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        toast({ variant: "destructive", title: "ไม่พบเอกสาร", description: "กรุณาตรวจสอบเลขที่บิลอีกครั้งค่ะ" });
      } else {
        setFoundDoc({ id: snap.docs[0].id, ...snap.docs[0].data() } as DocumentType);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: e.message });
    } finally {
      setIsSearchingDoc(false);
    }
  };

  const handleUpdateJobManual = async (jobId: string, updates: any, logText: string) => {
    if (!db || !profile) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
      const jobRef = doc(db, colName, jobId);
      
      batch.update(jobRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
      });

      const activityRef = doc(collection(jobRef, "activities"));
      batch.set(activityRef, {
        text: `[Admin Manual Fix] ${logText}`,
        userName: profile.displayName,
        userId: profile.uid,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      toast({ title: "ปรับปรุงข้อมูลสำเร็จ" });
      setEditingJob(null);
      setFoundDoc(null);
      setLinkDocNo("");
      handleSearchJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLinkDocument = async () => {
    if (!db || !editingJob || !foundDoc) return;
    
    const updates = {
      salesDocId: foundDoc.id,
      salesDocNo: foundDoc.docNo,
      salesDocType: foundDoc.docType
    };

    // Also update document to point back to job
    try {
      setIsSaving(true);
      const batch = writeBatch(db);
      const colName = searchInArchive ? `jobsArchive_${new Date().getFullYear()}` : "jobs";
      const jobRef = doc(db, colName, editingJob.id);
      
      batch.update(jobRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
      });

      const docRef = doc(db, "documents", foundDoc.id);
      batch.update(docRef, { jobId: editingJob.id, updatedAt: serverTimestamp() });

      const activityRef = doc(collection(jobRef, "activities"));
      batch.set(activityRef, {
        text: `[Admin Manual Link] เชื่อมโยงบิลเลขที่ ${foundDoc.docNo} เข้ากับจ๊อบสำเร็จ`,
        userName: profile?.displayName,
        userId: profile?.uid,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      toast({ title: "เชื่อมโยงเอกสารสำเร็จ" });
      setEditingJob(null);
      setFoundDoc(null);
      setLinkDocNo("");
      handleSearchJobs();
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleMigrate = async () => {
    if (!firebaseApp) return;
    setIsMigrating(true);
    try {
      const functions = getFunctions(firebaseApp, 'us-central1');
      const migrate = httpsCallable(functions, "migrateClosedJobsToArchive2026");
      const result = await migrate({ limit: 40 });
      setMigrationResult(result.data);
      toast({ title: "ย้ายข้อมูลสำเร็จ" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ล้มเหลว", description: e.message });
    } finally {
      setIsMigrating(false);
    }
  };

  const fetchUnusedTokenCount = useCallback(async () => {
    if (!db || !isUserAdmin) return;
    setIsLoadingCount(true);
    try {
      const q = query(collection(db, "kioskTokens"), where("isActive", "==", true));
      const snap = await getCountFromServer(q);
      setUnusedTokenCount(snap.data().count);
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsLoadingCount(false);
    }
  }, [db, isUserAdmin]);

  useEffect(() => {
    if (isUserAdmin) fetchUnusedTokenCount();
  }, [isUserAdmin, fetchUnusedTokenCount]);

  const handleCleanupTokens = async () => {
    if (!db || !isUserAdmin) return;
    setIsCleaningUp(true);
    try {
      const q = query(collection(db, "kioskTokens"), where("isActive", "==", true), limit(500));
      const snap = await getDocs(q);
      if (snap.empty) { setIsCleaningUp(false); return; }
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast({ title: "ล้างข้อมูลสำเร็จ" });
      await fetchUnusedTokenCount();
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ผิดพลาด", description: e.message });
    } finally {
      setIsCleaningUp(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="การดูแลรักษาระบบ" description="เครื่องมือสำหรับ Admin เพื่อจัดการข้อมูลและประสิทธิภาพแบบรายกรณี" />
      
      {isUserAdmin && (
        <Card className="border-blue-200 bg-blue-50/30 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-blue-700">
              <Wrench className="h-5 w-5" />
              <CardTitle className="text-lg">แก้ไขข้อมูลงานซ่อม (Job Data Integrity)</CardTitle>
            </div>
            <CardDescription>
              ใช้สำหรับแก้ไขเคสที่ข้อมูลไม่สอดคล้อง หรือต้องการบังคับเปลี่ยนสถานะจ๊อบด้วยมือ Admin
            </CardDescription>
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
                  <Checkbox 
                    id="archive-search" 
                    checked={searchInArchive} 
                    onCheckedChange={(v) => setSearchInArchive(!!v)} 
                  />
                  <Label htmlFor="archive-search" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <History className="h-3 w-3" /> ค้นหาในประวัติงานซ่อม (Archive)
                  </Label>
                </div>
              </div>
              <Button onClick={handleSearchJobs} disabled={isSearchingJobs} className="h-10">
                {isSearchingJobs ? <Loader2 className="h-4 w-4 animate-spin" /> : "ค้นหาจ๊อบ"}
              </Button>
            </div>

            {foundJobs.length > 0 && (
              <div className="border rounded-lg bg-background overflow-hidden animate-in fade-in slide-in-from-top-2">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>รหัสงาน / ลูกค้า</TableHead>
                      <TableHead>บิลที่ผูกอยู่</TableHead>
                      <TableHead>สถานะจ๊อบ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {foundJobs.map(job => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <div className="font-bold text-sm">{job.customerSnapshot?.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{job.id}</div>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{job.description}</p>
                        </TableCell>
                        <TableCell>
                          {job.salesDocNo ? (
                            <div className="flex flex-col">
                              <span className="font-mono text-xs font-bold text-primary">{job.salesDocNo}</span>
                              <span className="text-[9px] text-muted-foreground">{job.salesDocType}</span>
                            </div>
                          ) : <span className="text-xs text-muted-foreground italic">ไม่มีบิล</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{jobStatusLabel(job.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => { setEditingJob(job); setFoundDoc(null); setLinkDocNo(""); }}>
                            <Wrench className="h-3 w-3 mr-1" /> แก้ไขข้อมูล
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
      )}

      {/* Manual Job Editor Dialog */}
      <Dialog open={!!editingJob} onOpenChange={(o) => !o && setEditingJob(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>เครื่องมือแก้ไขจ๊อบ: {editingJob?.customerSnapshot?.name}</DialogTitle>
            <DialogDescription>
              Admin กำลังแก้ไขข้อมูลดิบของจ๊อบเลขที่ {editingJob?.id}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-2">
              <Label className="font-bold">บังคับเปลี่ยนสถานะจ๊อบ (Force Status)</Label>
              <Select 
                defaultValue={editingJob?.status} 
                onValueChange={(val) => handleUpdateJobManual(editingJob!.id, { status: val }, `แก้ไขสถานะเป็น ${jobStatusLabel(val)}`)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{jobStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground italic">* ระวัง: การเปลี่ยนสถานะด้วยมืออาจทำให้ปุ่มการทำงานในหน้าช่างเปลี่ยนไป</p>
            </div>

            <Separator />

            {/* Link Management Section */}
            <div className="space-y-4">
              <Label className="text-primary font-bold flex items-center gap-2">
                <LinkIcon className="h-4 w-4" /> 
                จัดการลิงก์เอกสาร (Bill Management)
              </Label>

              {/* Unlink Section */}
              <div className="p-3 border border-destructive/20 bg-destructive/5 rounded-md space-y-2">
                <p className="text-xs font-bold text-destructive flex items-center gap-1"><Link2Off className="h-3 w-3"/> ล้างลิงก์เดิม</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs">เลขบิลปัจจุบัน: <b>{editingJob?.salesDocNo || "ไม่มี"}</b></span>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    className="h-7 text-[10px]"
                    disabled={!editingJob?.salesDocNo && !editingJob?.salesDocId}
                    onClick={() => handleUpdateJobManual(editingJob!.id, {
                      salesDocId: deleteField(),
                      salesDocNo: deleteField(),
                      salesDocType: deleteField()
                    }, "ล้างลิงก์เอกสารที่ผูกอยู่")}
                  >
                    ล้างลิงก์ทิ้ง
                  </Button>
                </div>
                <p className="text-[9px] text-muted-foreground">เมื่อล้างลิงก์แล้ว จ๊อบจะสามารถ "ออกบิลใหม่" ได้ทันที</p>
              </div>

              {/* Relink / Link Existing Section */}
              <div className="p-3 border border-primary/20 bg-primary/5 rounded-md space-y-3">
                <p className="text-xs font-bold text-primary flex items-center gap-1"><PlusCircle className="h-3 w-3"/> สร้างลิงก์ใหม่ (Link Existing Doc)</p>
                <div className="flex gap-2">
                  <Input 
                    placeholder="ใส่เลขบิลที่ต้องการผูก (เช่น DN...)" 
                    className="h-8 text-xs font-mono"
                    value={linkDocNo}
                    onChange={e => setLinkDocNo(e.target.value)}
                  />
                  <Button size="sm" className="h-8 px-2" onClick={handleSearchDocument} disabled={isSearchingDoc || !linkDocNo.trim()}>
                    {isSearchingDoc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  </Button>
                </div>

                {foundDoc && (
                  <div className="mt-2 p-2 bg-background border rounded-md animate-in slide-in-from-top-1">
                    <div className="flex justify-between items-start mb-2">
                      <div className="space-y-0.5">
                        <Badge variant="outline" className="text-[8px] h-3 px-1">{docTypeLabel(foundDoc.docType)}</Badge>
                        <p className="text-xs font-bold font-mono">{foundDoc.docNo}</p>
                        <p className="text-[10px] text-muted-foreground">{foundDoc.customerSnapshot?.name}</p>
                        <p className="text-[10px] font-bold text-primary">฿{foundDoc.grandTotal.toLocaleString()}</p>
                      </div>
                      <Button size="sm" className="h-7 text-[10px] bg-green-600 hover:bg-green-700" onClick={handleLinkDocument} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin"/> : <CheckCircle2 className="mr-1 h-3 w-3"/>}
                        ผูกบิลนี้
                      </Button>
                    </div>
                    {foundDoc.jobId && (
                      <p className="text-[9px] text-destructive italic font-bold">* บิลนี้เคยผูกอยู่กับจ๊อบอื่น (ID: {foundDoc.jobId.substring(0,8)})</p>
                    )}
                  </div>
                )}
                <p className="text-[9px] text-muted-foreground">ใช้สำหรับกรณีออกบิลมือหรือแยกบิลแล้วต้องการนำมาผูกคืนกับใบงานค่ะ</p>
              </div>
            </div>
          </div>
          
          <DialogFooter className="p-4 border-t bg-muted/10">
            <Button variant="ghost" onClick={() => setEditingJob(null)}>ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isUserAdmin && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <div className="flex items-center gap-2 text-amber-700">
              <Database className="h-5 w-5" />
              <CardTitle className="text-lg">ย้ายงานที่ปิดแล้วเข้าประวัติ (Migration)</CardTitle>
            </div>
            <CardDescription>
              ระบบจะย้ายงานสถานะ CLOSED ที่ตกค้างไปยัง Archive เพื่อให้แอปทำงานเร็วขึ้น
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {migrationResult && (
              <div className="p-4 rounded-md border bg-green-50 border-green-200 text-xs">
                <p className="font-bold text-green-700 mb-1">สรุปผลล่าสุด:</p>
                <p>พบงาน: {migrationResult.totalFound} | ย้ายสำเร็จ: {migrationResult.migrated} | ข้าม: {migrationResult.skipped}</p>
              </div>
            )}
            <Button onClick={handleMigrate} disabled={isMigrating} className="w-full sm:w-auto">
              {isMigrating ? <Loader2 className="mr-2 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              เริ่มการย้ายข้อมูล (Migration)
            </Button>
          </CardContent>
        </Card>
      )}

      {isUserAdmin && (
        <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                    <Trash2 className="h-5 w-5" />
                    ล้างข้อมูลส่วนเกิน (Cleanup)
                </CardTitle>
            </CardHeader>
            <CardContent className="flex justify-between items-center">
                <div className="text-sm">
                    <p className="font-bold">ล้างประวัติ QR Token ลงเวลา</p>
                    <p className="text-muted-foreground">รายการค้าง: {isLoadingCount ? "..." : unusedTokenCount?.toLocaleString() || "0"}</p>
                </div>
                <Button variant="destructive" size="sm" onClick={handleCleanupTokens} disabled={isCleaningUp || unusedTokenCount === 0}>
                    {isCleaningUp ? <Loader2 className="mr-2 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4"/>}
                    ล้างข้อมูล
                </Button>
            </CardContent>
        </Card>
      )}
    </div>
  );
}
