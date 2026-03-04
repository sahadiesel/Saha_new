"use client";

import { useState, useCallback, useEffect } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, query, where, getDocs, writeBatch, limit, getCountFromServer, doc, getDoc, updateDoc, serverTimestamp, deleteField } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Database, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Trash2, Wrench, Search, FileText, CheckCircle, RotateCcw, Ban, Link as LinkIcon, Sparkles, FileWarning } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { docStatusLabel, jobStatusLabel } from "@/lib/ui-labels";
import type { Document as DocumentType, Job } from "@/lib/types";

export default function AdminUsersPage() {
  const { db, app: firebaseApp } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  // Migration States
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<any>(null);

  // Database Maintenance States
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [unusedTokenCount, setUnusedTokenCount] = useState<number | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(false);

  // Data Repair States
  const [isSearchingStuck, setIsSearchingStuck] = useState(false);
  const [stuckDocs, setStuckDocs] = useState<DocumentType[]>([]);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  
  const [isRepairingLinks, setIsRepairingLinks] = useState(false);
  const [isSearchingBroken, setIsSearchingBroken] = useState(false);
  const [brokenJobs, setBrokenJobs] = useState<Job[]>([]);

  const isUserAdmin = profile?.role === 'ADMIN';

  const handleSearchStuckDNs = async () => {
    if (!db || !isUserAdmin) return;
    setIsSearchingStuck(true);
    try {
      const q = query(
        collection(db, "documents"), 
        where("docType", "==", "DELIVERY_NOTE"), 
        where("status", "==", "APPROVED"),
        limit(100)
      );
      const snap = await getDocs(q);
      setStuckDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentType)));
      if (snap.empty) {
        toast({ title: "ไม่พบใบส่งของที่ติดสถานะ Approved" });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "ค้นหาล้มเหลว", description: e.message });
    } finally {
      setIsSearchingStuck(false);
    }
  };

  const handleSearchBrokenJobLinks = async () => {
    if (!db || !isUserAdmin) return;
    setIsSearchingBroken(true);
    try {
        // Find jobs that are in WAITING_CUSTOMER_PICKUP but might have invalid bills
        const q = query(collection(db, "jobs"), where("status", "==", "WAITING_CUSTOMER_PICKUP"), limit(100));
        const snap = await getDocs(q);
        const inconsistent: Job[] = [];

        for (const jobDoc of snap.docs) {
            const data = jobDoc.data() as Job;
            if (data.salesDocId) {
                const docSnap = await getDoc(doc(db, "documents", data.salesDocId));
                if (!docSnap.exists() || docSnap.data().status === 'CANCELLED') {
                    inconsistent.push({ id: jobDoc.id, ...data });
                }
            } else {
                // No salesDocId but in pickup status? Definitely broken.
                inconsistent.push({ id: jobDoc.id, ...data });
            }
        }

        setBrokenJobs(inconsistent);
        if (inconsistent.length === 0) {
            toast({ title: "ไม่พบงานที่มีปัญหาบิลหาย" });
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: "ค้นหาล้มเหลว", description: e.message });
    } finally {
        setIsSearchingBroken(false);
    }
  };

  const handleFixBrokenJob = async (jobObj: Job) => {
    if (!db || !isUserAdmin || isActionLoading) return;
    setIsActionLoading(jobObj.id);
    try {
        const batch = writeBatch(db);
        const jobRef = doc(db, "jobs", jobObj.id);
        
        batch.update(jobRef, {
            status: 'DONE',
            salesDocId: deleteField(),
            salesDocNo: deleteField(),
            salesDocType: deleteField(),
            updatedAt: serverTimestamp(),
            lastActivityAt: serverTimestamp()
        });

        const activityRef = doc(collection(db, "jobs", jobObj.id, "activities"));
        batch.set(activityRef, {
            text: `[Admin Fix] กู้คืนสถานะงานกลับเป็น 'ทำเสร็จ' เนื่องจากบิลเดิม (${jobObj.salesDocNo || 'N/A'}) ถูกลบหรือยกเลิกออกจากระบบ เพื่อให้ออกบิลใหม่ได้ถูกต้องค่ะ`,
            userName: profile?.displayName || "Admin",
            userId: profile?.uid || "admin",
            createdAt: serverTimestamp()
        });

        await batch.commit();
        toast({ title: "กู้คืนจ๊อบสำเร็จ", description: "ตอนนี้จ๊อบนี้สามารถออกบิลใหม่ได้แล้วค่ะ" });
        setBrokenJobs(prev => prev.filter(j => j.id !== jobObj.id));
    } catch (e: any) {
        toast({ variant: 'destructive', title: "แก้ไขไม่สำเร็จ", description: e.message });
    } finally {
        setIsActionLoading(null);
    }
  };

  const handleFixDocStatus = async (docObj: DocumentType, newStatus: string) => {
    if (!db || !isUserAdmin || isActionLoading) return;
    setIsActionLoading(docObj.id);
    try {
      const batch = writeBatch(db);
      const docRef = doc(db, "documents", docObj.id);
      
      const updatePayload: any = { 
        status: newStatus, 
        updatedAt: serverTimestamp(),
        notes: (docObj.notes || "") + `\n[Admin Fix] เปลี่ยนสถานะเป็น ${newStatus} โดย ${profile?.displayName}`
      };

      batch.update(docRef, updatePayload);

      // If set to PAID, we should also close the linked job if it exists
      if (newStatus === 'PAID' && docObj.jobId) {
        const jobRef = doc(db, "jobs", docObj.jobId);
        batch.update(jobRef, { 
          status: 'CLOSED', 
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp() 
        });
      }

      await batch.commit();
      toast({ title: "แก้ไขสถานะสำเร็จ", description: `บิล ${docObj.docNo} เปลี่ยนเป็น ${newStatus} แล้วค่ะ` });
      setStuckDocs(prev => prev.filter(d => d.id !== docObj.id));
    } catch (e: any) {
      toast({ variant: 'destructive', title: "แก้ไขไม่สำเร็จ", description: e.message });
    } finally {
      setIsActionLoading(null);
    }
  };

  const handleRepairMissingLinks = async () => {
    if (!db || !isUserAdmin) return;
    setIsRepairingLinks(true);
    let repairCount = 0;
    try {
        // 1. Get all active jobs
        const jobsSnap = await getDocs(query(collection(db, "jobs"), where("status", "!=", "CLOSED"), limit(200)));
        const batch = writeBatch(db);
        
        for (const jobDoc of jobsSnap.docs) {
            const jobId = jobDoc.id;
            const jobData = jobDoc.data() as Job;
            
            // 2. If job has no salesDocId, search for a document pointing to this job
            if (!jobData.salesDocId) {
                const docsQuery = query(collection(db, "documents"), where("jobId", "==", jobId), limit(1));
                const docsSnap = await getDocs(docsQuery);
                
                if (!docsSnap.empty) {
                    const docData = docsSnap.docs[0].data() as DocumentType;
                    const docId = docsSnap.docs[0].id;
                    
                    // Found a lost link! Repair it.
                    batch.update(jobDoc.ref, {
                        salesDocId: docId,
                        salesDocNo: docData.docNo,
                        salesDocType: docData.docType,
                        status: 'WAITING_CUSTOMER_PICKUP',
                        updatedAt: serverTimestamp()
                    });
                    repairCount++;
                }
            }
        }
        
        if (repairCount > 0) {
            await batch.commit();
            toast({ title: `กู้คืนลิงก์สำเร็จ ${repairCount} รายการ`, description: "ปุ่ม 'ดูบิล' ควรจะกลับมาแสดงผลที่จ๊อบแล้วค่ะ" });
        } else {
            toast({ title: "ไม่พบรายการที่ลิงก์หาย" });
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: "กู้คืนล้มเหลว", description: e.message });
    } finally {
        setIsRepairingLinks(false);
    }
  };

  const handleMigrate = async () => {
    if (!firebaseApp) {
      toast({ variant: 'destructive', title: "ระบบยังไม่พร้อม", description: "ไม่พบการเชื่อมต่อกับ Firebase App" });
      return;
    }
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
      <PageHeader title="การดูแลรักษาระบบ" description="เครื่องมือสำหรับ Admin เพื่อจัดการข้อมูลและประสิทธิภาพ" />
      
      {isUserAdmin && (
        <Card className="border-blue-200 bg-blue-50/30 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-blue-700">
              <Wrench className="h-5 w-5" />
              <CardTitle className="text-lg">แก้ไขสถานะข้อมูล (Data Integrity & Repair)</CardTitle>
            </div>
            <CardDescription>
              ใช้สำหรับจัดการเคสที่ข้อมูลไม่สอดคล้องกัน เช่น บิลถูกลบไปแล้วแต่จ๊อบยังติดสถานะเดิม
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-3">
                <Button onClick={handleSearchBrokenJobLinks} disabled={isSearchingBroken} className="bg-blue-600 hover:bg-blue-700 shadow-sm">
                    {isSearchingBroken ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileWarning className="mr-2 h-4 w-4" />}
                    ตรวจสอบบิลค้างที่ไม่มีเอกสารจริง (Find Broken Links)
                </Button>

                <Button onClick={handleSearchStuckDNs} disabled={isSearchingStuck} variant="outline" className="border-blue-600 text-blue-700 hover:bg-blue-50">
                    {isSearchingStuck ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    หาใบส่งของที่ติดสถานะ Approved
                </Button>

                <Button onClick={handleRepairMissingLinks} disabled={isRepairingLinks} variant="outline" className="border-blue-600 text-blue-700 hover:bg-blue-50">
                    {isRepairingLinks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                    กู้คืนลิงก์เอกสารที่หายไป (Lost Links)
                </Button>
            </div>

            {brokenJobs.length > 0 && (
                <div className="border border-blue-200 rounded-lg bg-background overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="bg-blue-600 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3" /> พบงานที่บิลหาย/ถูกยกเลิกแต่สถานะไม่คืนค่า
                    </div>
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead>รหัสงาน / ลูกค้า</TableHead>
                                <TableHead>เลขบิลที่ค้างในจ๊อบ</TableHead>
                                <TableHead>สถานะปัจจุบัน</TableHead>
                                <TableHead className="text-right">จัดการ</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {brokenJobs.map(job => (
                                <TableRow key={job.id}>
                                    <TableCell>
                                        <div className="font-bold text-sm">{job.customerSnapshot?.name}</div>
                                        <div className="text-[10px] text-muted-foreground font-mono">{job.id}</div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-destructive font-bold">{job.salesDocNo || "ไม่มีเลขบิล"}</TableCell>
                                    <TableCell><Badge variant="secondary" className="text-[10px]">{jobStatusLabel(job.status)}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Button 
                                            size="sm" 
                                            className="bg-green-600 hover:bg-green-700 text-xs h-8"
                                            disabled={isActionLoading === job.id}
                                            onClick={() => handleFixBrokenJob(job)}
                                        >
                                            {isActionLoading === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                                            กู้คืนกลับไปรอออกบิล
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {stuckDocs.length > 0 && (
              <div className="border rounded-lg bg-background overflow-hidden animate-in fade-in slide-in-from-top-2">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>เลขที่เอกสาร</TableHead>
                      <TableHead>สถานะใน DB</TableHead>
                      <TableHead>สถานะที่ UI แสดง</TableHead>
                      <TableHead className="text-right">จัดการแก้ไขสถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stuckDocs.map(docItem => (
                      <TableRow key={docItem.id}>
                        <TableCell className="font-mono font-bold text-sm">
                          {docItem.docNo}
                          <p className="text-[10px] text-muted-foreground font-sans font-normal">{docItem.customerSnapshot?.name}</p>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="font-mono text-[10px]">APPROVED</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{docStatusLabel(docItem.status, docItem.docType)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="text-[10px] h-8 border-amber-500 text-amber-700 hover:bg-amber-50"
                              disabled={!!isActionLoading}
                              onClick={() => handleFixDocStatus(docItem, 'PENDING_REVIEW')}
                            >
                              {isActionLoading === docItem.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                              ย้อนกลับไปรอตรวจ
                            </Button>
                            <Button 
                              size="sm" 
                              className="text-[10px] h-8 bg-green-600 hover:bg-green-700"
                              disabled={!!isActionLoading}
                              onClick={() => handleFixDocStatus(docItem, 'PAID')}
                            >
                              {isActionLoading === docItem.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                              เปลี่ยนเป็นรับเงินแล้ว
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="text-[10px] h-8 text-destructive hover:bg-destructive/10"
                              disabled={!!isActionLoading}
                              onClick={() => handleFixDocStatus(docItem, 'CANCELLED')}
                            >
                              <Ban className="h-3 w-3 mr-1" />
                              ยกเลิก
                            </Button>
                          </div>
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
              {isMigrating ? <Loader2 className="mr-2 animate-spin" /> : <RefreshCw className="mr-2" />}
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
