"use client";

import { useMemo, Suspense, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { doc } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/date-utils";
import type { PurchaseDoc } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

// Helper for currency formatting
const formatCurrency = (value: number | null | undefined) => (value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Status Badge Component (Thai Labels)
const getStatusDisplay = (status?: PurchaseDoc['status']) => {
  switch (status) {
    case 'DRAFT': return { label: "ฉบับร่าง", variant: "secondary" as const };
    case 'PENDING_REVIEW': return { label: "รอตรวจสอบ", variant: "outline" as const };
    case 'REJECTED': return { label: "ตีกลับแก้ไข", variant: "destructive" as const };
    case 'APPROVED': return { label: "อนุมัติแล้ว", variant: "default" as const };
    case 'UNPAID': return { label: "รอชำระเงิน", variant: "default" as const };
    case 'PAID': return { label: "จ่ายแล้ว", variant: "default" as const };
    case 'CANCELLED': return { label: "ยกเลิก", variant: "destructive" as const };
    default: return { label: status || "-", variant: "outline" as const };
  }
};

// UI component for the document view itself
function PurchaseDocView({ document }: { document: PurchaseDoc }) {
    const statusInfo = getStatusDisplay(document.status);
    return (
        <div className="printable-document p-8 border rounded-lg bg-card text-card-foreground shadow-sm print:shadow-none print:border-none print:p-0">
            <Table className="mb-8 border-collapse print:mb-4">
                <TableHeader className="[&_tr]:border-b-0">
                    <TableRow className="print-doc-repeat-header border-0 hover:bg-transparent">
                        <TableHead
                            colSpan={5}
                            className="h-auto border-0 bg-transparent p-0 py-3 text-left align-top font-normal print:border-0"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-2 print:mb-0">
                                <div className="space-y-2">
                                    <h2 className="text-xl font-bold">{document.vendorSnapshot.companyName}</h2>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{document.vendorSnapshot.address}</p>
                                    <p className="text-sm text-muted-foreground">เลขที่บิลร้านค้า: {document.invoiceNo}</p>
                                </div>
                                <div className="space-y-2 text-left md:text-right">
                                    <h1 className="text-2xl font-bold text-primary">บันทึกรายการซื้อ</h1>
                                    <div className="flex md:justify-end gap-4 text-sm font-mono"><span className="font-medium">เลขที่ระบบ:</span><span>{document.docNo}</span></div>
                                    <div className="flex md:justify-end gap-4 text-sm"><span className="font-medium">วันที่:</span><span>{safeFormat(new Date(document.docDate), 'dd/MM/yyyy')}</span></div>
                                    <div className="flex md:justify-end gap-4 text-sm items-center"><span className="font-medium">สถานะ:</span><Badge variant={statusInfo.variant}>{statusInfo.label}</Badge></div>
                                </div>
                            </div>
                        </TableHead>
                    </TableRow>
                    <TableRow className="border-b bg-muted/30 hover:bg-transparent">
                        <TableHead className="w-12 text-center">#</TableHead>
                        <TableHead>รายการ</TableHead>
                        <TableHead className="text-right">จำนวน</TableHead>
                        <TableHead className="text-right">ราคา/หน่วย</TableHead>
                        <TableHead className="text-right">จำนวนเงิน</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {document.items.map((item, index) => (
                        <TableRow key={index}>
                            <TableCell className="text-center">{index + 1}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            {/* Summary and Photos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="space-y-4">
                    {document.billPhotos && document.billPhotos.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="font-semibold text-sm">รูปบิลที่แนบ:</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {document.billPhotos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block border rounded-md overflow-hidden bg-muted aspect-square relative">
                                        <Image src={url} alt={`Bill photo ${i+1}`} fill className="object-cover hover:scale-105 transition-transform" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                    {document.note && (
                        <div className="space-y-1 p-3 bg-muted/30 rounded-md">
                            <p className="font-semibold text-xs uppercase text-muted-foreground">หมายเหตุ:</p>
                            <p className="text-sm whitespace-pre-wrap">{document.note}</p>
                        </div>
                    )}
                </div>
                <div className="space-y-2 p-4 bg-muted/20 rounded-lg">
                    <div className="flex justify-between text-sm"><span>รวมเป็นเงิน</span><span>{formatCurrency(document.subtotal)}</span></div>
                    <div className="flex justify-between text-sm text-destructive"><span>ส่วนลด</span><span>-{formatCurrency(document.discountAmount)}</span></div>
                    <div className="flex justify-between font-medium"><span>ยอดหลังหักส่วนลด</span><span>{formatCurrency(document.net)}</span></div>
                    {document.withTax && <div className="flex justify-between text-sm"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{formatCurrency(document.vatAmount)}</span></div>}
                    {document.withholdingEnabled && (document.withholdingAmount || 0) > 0 && (
                      <>
                        <div className="flex justify-between text-sm text-amber-700"><span>หัก ณ ที่จ่าย ({document.withholdingPercent || 0}%)</span><span>-{formatCurrency(document.withholdingAmount)}</span></div>
                        <div className="flex justify-between text-sm text-muted-foreground"><span>ยอดรวมบิล</span><span>{formatCurrency(document.grandTotal)}</span></div>
                      </>
                    )}
                    <Separator className="my-2" />
                    <div className="flex justify-between text-lg font-bold text-primary">
                      <span>{document.withholdingEnabled ? "ยอดจ่ายสุทธิ" : "ยอดสุทธิ"}</span>
                      <span>{formatCurrency(document.withholdingEnabled ? (document.amountPayable ?? document.grandTotal - (document.withholdingAmount || 0)) : document.grandTotal)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground text-right mt-2">
                        เงื่อนไข: {document.paymentMode === 'CASH' ? 'เงินสด/โอน' : `เครดิต (ครบกำหนด: ${document.dueDate || 'ไม่ระบุ'})${document.expectedPaymentAccountId ? ' · มีบัญชีคาดจ่าย' : ''}`}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Main page component
function PurchaseViewPageContent() {
    const { purchaseId } = useParams();
    const router = useRouter();
    const { db } = useFirebase();
    const { toast } = useToast();
    const printFrameRef = useRef<HTMLIFrameElement>(null);

    const docRef = useMemo(() => {
        if (!db || typeof purchaseId !== 'string') return null;
        return doc(db, 'purchaseDocs', purchaseId);
    }, [db, purchaseId]);

    const { data: document, isLoading, error } = useDoc<PurchaseDoc>(docRef);

    const handlePrint = () => {
        if (printFrameRef.current) {
            // สั่งพิมพ์โดยตรงผ่าน iframe
            printFrameRef.current.src = `/app/office/documents/${purchaseId}?print=1&autoprint=1&t=${Date.now()}`;
            toast({ title: "กำลังเตรียมข้อมูลการซื้อสำหรับพิมพ์..." });
        }
    };

    if (isLoading) {
        return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-primary"/></div>;
    }

    if (error || !document) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <AlertCircle className="w-16 h-16 text-destructive" />
                <PageHeader title="ไม่พบเอกสาร" description="เอกสารรายการซื้อที่ต้องการอาจถูกลบหรือไม่มีอยู่ในระบบ" />
                <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2"/> กลับ</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <Button type="button" variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                <div className="flex gap-2">
                    <Button type="button" onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4"/> พิมพ์</Button>
                </div>
            </div>
            
            <PurchaseDocView document={document} />

            {/* Hidden Iframe for Direct Printing */}
            <iframe 
                ref={printFrameRef} 
                className="fixed bottom-0 right-0 w-0 h-0 border-0 opacity-0 pointer-events-none" 
                title="Print Frame"
            />
        </div>
    );
}

export default function PurchaseViewPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}>
      <PurchaseViewPageContent />
    </Suspense>
  )
}
