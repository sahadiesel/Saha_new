"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, orderBy, where, limit, deleteDoc, doc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Search, MoreHorizontal, Eye, Edit, Trash2, Filter, Package, Wrench } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { PurchaseDoc } from "@/lib/types";
import { isPurchaseDocServiceLike } from "@/firebase/purchases";
import { WithId } from "@/firebase/firestore/use-collection";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { useRouter } from "next/navigation";

// Status Badge & Tooltip Helper (Thai Labels)
const getStatusDisplay = (status?: PurchaseDoc['status']) => {
  switch (status) {
    case 'DRAFT': 
      return { label: "ฉบับร่าง", description: "ยังไม่ส่งตรวจ", variant: "secondary" as const };
    case 'PENDING_REVIEW': 
      return { label: "รอตรวจสอบ", description: "ส่งให้ฝ่ายบัญชีแล้ว", variant: "outline" as const };
    case 'REJECTED': 
      return { label: "ตีกลับแก้ไข", description: "บัญชีส่งกลับมาให้แก้ไข", variant: "destructive" as const };
    case 'APPROVED': 
      return { label: "อนุมัติแล้ว", description: "บัญชีตรวจสอบถูกต้องแล้ว", variant: "default" as const };
    case 'UNPAID': 
      return { label: "รอชำระเงิน", description: "รอการบันทึกจ่ายเงิน", variant: "default" as const };
    case 'PAID': 
      return { label: "จ่ายแล้ว", description: "จ่ายเงินและลงบัญชีแล้ว", variant: "default" as const };
    case 'CANCELLED': 
      return { label: "ยกเลิก", description: "ยกเลิกการใช้งาน", variant: "destructive" as const };
    default: 
      return { label: status || "-", description: "", variant: "outline" as const };
  }
};

const formatCurrency = (value: number) => {
  return (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function PurchaseDocsListPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const router = useRouter();

  const [docs, setDocs] = useState<WithId<PurchaseDoc>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${now.getFullYear()}-${month}`;
  });
  const [docToDelete, setDocToDelete] = useState<WithId<PurchaseDoc> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const isAdmin = profile?.role === 'ADMIN';

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, "purchaseDocs"), orderBy("docDate", "desc"), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDocs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<PurchaseDoc>)));
      setLoading(false);
    }, (error) => {
      console.error("Error loading purchase documents: ", error);
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ไม่สามารถโหลดข้อมูลการซื้อได้" });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, toast]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    docs.forEach((d) => {
      if (typeof d.docDate === "string" && d.docDate.length >= 7) {
        months.add(d.docDate.slice(0, 7));
      }
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [docs]);

  const filteredDocs = useMemo(() => {
    let result = [...docs];

    if (monthFilter !== "ALL") {
      result = result.filter((doc) => (doc.docDate || "").startsWith(monthFilter));
    }

    if (statusFilter !== "ALL") {
      result = result.filter(doc => doc.status === statusFilter);
    }

    if (searchTerm.trim()) {
      const lowercasedFilter = searchTerm.toLowerCase();
      result = result.filter(doc =>
        doc.docNo.toLowerCase().includes(lowercasedFilter) ||
        doc.vendorSnapshot.shortName.toLowerCase().includes(lowercasedFilter) ||
        doc.vendorSnapshot.companyName.toLowerCase().includes(lowercasedFilter) ||
        (doc.invoiceNo && doc.invoiceNo.toLowerCase().includes(lowercasedFilter))
      );
    }
    
    return result;
  }, [docs, searchTerm, statusFilter, monthFilter]);

  const totals = useMemo(() => {
    return filteredDocs.reduce(
      (acc, d) => {
        acc.net += d.net ?? 0;
        acc.vat += d.withTax ? (d.vatAmount ?? 0) : 0;
        acc.grand += d.grandTotal ?? 0;
        return acc;
      },
      { net: 0, vat: 0, grand: 0 }
    );
  }, [filteredDocs]);

  const handleDelete = async () => {
    if (!db || !docToDelete) return;
    setIsDeleting(true);
    try {
        await deleteDoc(doc(db, "purchaseDocs", docToDelete.id));
        toast({ title: "ลบเอกสารสำเร็จ" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
        setIsDeleting(false);
        setDocToDelete(null);
    }
  };

  return (
    <TooltipProvider>
      <PageHeader title="รายการซื้อสินค้า/บริการ" description="สร้างและจัดการเอกสารการจัดซื้อและงานจ้าง">
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          สร้างรายการซื้อใหม่
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex justify-end gap-2">
            <div className="rounded-md border bg-background px-4 py-2 min-w-[160px] text-right">
              <div className="text-[11px] text-muted-foreground">ยอดก่อนภาษี</div>
              <div className="text-sm font-bold">{formatCurrency(totals.net)}</div>
            </div>
            <div className="rounded-md border bg-background px-4 py-2 min-w-[120px] text-right">
              <div className="text-[11px] text-muted-foreground">ภาษี</div>
              <div className="text-sm font-bold">{formatCurrency(totals.vat)}</div>
            </div>
            <div className="rounded-md border bg-background px-4 py-2 min-w-[160px] text-right">
              <div className="text-[11px] text-muted-foreground">ยอดรวม</div>
              <div className="text-sm font-bold">{formatCurrency(totals.grand)}</div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาจากเลขที่เอกสาร, ชื่อร้านค้า, เลขที่บิล..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="เดือน..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกเดือน</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="กรองตามสถานะ..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสถานะ</SelectItem>
                <SelectItem value="DRAFT">ฉบับร่าง</SelectItem>
                <SelectItem value="PENDING_REVIEW">รอตรวจสอบ</SelectItem>
                <SelectItem value="REJECTED">ตีกลับแก้ไข</SelectItem>
                <SelectItem value="APPROVED">อนุมัติแล้ว</SelectItem>
                <SelectItem value="UNPAID">รอชำระเงิน</SelectItem>
                <SelectItem value="PAID">จ่ายแล้ว</SelectItem>
                <SelectItem value="CANCELLED">ยกเลิก</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>เลขที่เอกสาร</TableHead>
                  <TableHead>ร้านค้า</TableHead>
                  <TableHead>เลขที่บิล</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">ยอดก่อนภาษี</TableHead>
                  <TableHead className="text-right">ภาษี</TableHead>
                  <TableHead className="text-right">ยอดรวม</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="h-24 text-center"><Loader2 className="mx-auto animate-spin" /></TableCell></TableRow>
                ) : filteredDocs.length > 0 ? (
                  filteredDocs.map(purchaseDoc => {
                    const statusInfo = getStatusDisplay(purchaseDoc.status);
                    const canEdit = ['DRAFT', 'REJECTED', 'PENDING_REVIEW'].includes(purchaseDoc.status);
                    const canDelete = isAdmin && ['DRAFT', 'REJECTED', 'CANCELLED', 'PENDING_REVIEW'].includes(purchaseDoc.status);

                    return (
                      <TableRow key={purchaseDoc.id}>
                        <TableCell>{safeFormat(new Date(purchaseDoc.docDate), APP_DATE_FORMAT)}</TableCell>
                        <TableCell className="font-medium">{purchaseDoc.docNo}</TableCell>
                        <TableCell>{purchaseDoc.vendorSnapshot.shortName}</TableCell>
                        <TableCell>{purchaseDoc.invoiceNo}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={statusInfo.variant} className="cursor-help">
                                {statusInfo.label}
                              </Badge>
                            </TooltipTrigger>
                            {statusInfo.description && (
                              <TooltipContent>
                                <p>{statusInfo.description}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(purchaseDoc.net)}</TableCell>
                        <TableCell className="text-right">{purchaseDoc.withTax && purchaseDoc.vatAmount > 0 ? formatCurrency(purchaseDoc.vatAmount) : ""}</TableCell>
                        <TableCell className="text-right">{formatCurrency(purchaseDoc.grandTotal)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4"/></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                  <Link href={`/app/office/parts/purchases/${purchaseDoc.id}`}><Eye className="mr-2 h-4 w-4"/> ดูรายละเอียด</Link>
                              </DropdownMenuItem>
                              
                              {canEdit && (
                                <DropdownMenuItem asChild>
                                    <Link href={isPurchaseDocServiceLike(purchaseDoc) ? `/app/office/parts/purchases/service/new?editDocId=${purchaseDoc.id}` : `/app/office/parts/purchases/new?editDocId=${purchaseDoc.id}`}><Edit className="mr-2 h-4 w-4"/> แก้ไข</Link>
                                </DropdownMenuItem>
                              )}

                              {canDelete && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDocToDelete(purchaseDoc)}>
                                        <Trash2 className="mr-2 h-4 w-4"/> ลบเอกสาร
                                    </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow><TableCell colSpan={9} className="h-24 text-center">ไม่พบเอกสารจัดซื้อ</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Creation Type Selection Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>เลือกประเภทรายการซื้อ</DialogTitle>
            <DialogDescription>คุณต้องการสร้างรายการซื้อสินค้า หรือรายการซื้องานบริการ (งานจ้าง)?</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-4">
            <Button 
              size="lg" 
              className="h-20 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setIsCreateDialogOpen(false);
                router.push("/app/office/parts/purchases/new");
              }}
            >
              <Package className="h-6 w-6" />
              <div className="flex flex-col">
                <span className="font-bold">สร้างรายการซื้อสินค้า</span>
                <span className="text-[10px] font-normal opacity-80">อะไหล่, วัสดุสิ้นเปลือง (ตัดเข้าสต็อก)</span>
              </div>
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="h-20 flex flex-col items-center justify-center gap-2 border-primary text-primary hover:bg-primary/5"
              onClick={() => {
                setIsCreateDialogOpen(false);
                router.push("/app/office/parts/purchases/service/new");
              }}
            >
              <Wrench className="h-6 w-6" />
              <div className="flex flex-col">
                <span className="font-bold">สร้างรายการซื้องานบริการ (งานจ้าง)</span>
                <span className="text-[10px] font-normal opacity-80">งานโรงกลึง, ค่าจ้างภายนอก, อื่นๆ (ไม่ตัดสต็อก)</span>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>ยกเลิก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!docToDelete} onOpenChange={(open) => !open && setDocToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>ยืนยันการลบเอกสาร?</AlertDialogTitle>
                  <AlertDialogDescription>
                      คุณกำลังจะลบเอกสารเลขที่ {docToDelete?.docNo} ข้อมูลนี้จะหายไปจากฐานข้อมูลถาวร
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                      {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} ลบข้อมูล
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
