"use client";

import { useMemo, Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useDoc } from "@/firebase/firestore/use-doc";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Document } from "@/lib/types";

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

function VehicleInfo({ doc }: { doc: Document }) {
    const s = doc.carSnapshot;
    if (!s || (!s.licensePlate && !s.brand && !s.model && !s.partNumber && !s.registrationNumber)) return null;

    return (
        <div className="space-y-1 text-sm border-l-2 border-muted pl-4">
            <h4 className="font-bold text-primary mb-1 uppercase tracking-wider text-[10px]">รายละเอียดรถ / ชิ้นส่วน</h4>
            {s.brand && <div className="flex justify-between gap-4"><span className="text-muted-foreground">ยี่ห้อ:</span><span className="font-medium text-right">{s.brand}</span></div>}
            {s.model && <div className="flex justify-between gap-4"><span className="text-muted-foreground">รุ่นรถ:</span><span className="font-medium text-right">{s.model}</span></div>}
            {s.licensePlate && <div className="flex justify-between gap-4"><span className="text-muted-foreground">ทะเบียน:</span><span className="font-medium text-right">{s.licensePlate}</span></div>}
            {s.partNumber && <div className="flex justify-between gap-4"><span className="text-muted-foreground">เลขอะไหล่:</span><span className="font-medium text-right">{s.partNumber}</span></div>}
            {s.registrationNumber && <div className="flex justify-between gap-4"><span className="text-muted-foreground">เลขทะเบียนชิ้นส่วน:</span><span className="font-medium text-right">{s.registrationNumber}</span></div>}
        </div>
    );
}

function DocumentView({ document, taxCopyLabel }: { document: Document, taxCopyLabel?: 'ORIGINAL' | 'COPY' }) {
    const docTypeDisplay: Record<string, string> = {
        QUOTATION: "ใบเสนอราคา / Quotation",
        DELIVERY_NOTE: "ใบส่งของชั่วคราว",
        TAX_INVOICE: "ใบกำกับภาษี / Tax Invoice",
        RECEIPT: "ใบเสร็จรับเงิน / Receipt",
        BILLING_NOTE: "ใบวางบิล / Billing Note",
        CREDIT_NOTE: "ใบลดหนี้ / Credit Note",
        WITHHOLDING_TAX: "หนังสือรับรองหัก ณ ที่จ่าย",
    };
    
    let finalDocTitle = docTypeDisplay[document.docType] || document.docType;
    if (document.docType === 'TAX_INVOICE') {
        if (taxCopyLabel === 'ORIGINAL') finalDocTitle = "ใบกำกับภาษี ต้นฉบับ / Tax Invoice";
        else if (taxCopyLabel === 'COPY') finalDocTitle = "ใบกำกับภาษี สำเนา / Tax Invoice";
    }

    const isDeliveryNote = document.docType === 'DELIVERY_NOTE';
    const isTaxDoc = document.docType === 'TAX_INVOICE' || document.docType === 'CREDIT_NOTE' || (document.docType === 'RECEIPT' && !!document.customerSnapshot.useTax);

    const displayCustomerName = isTaxDoc ? (document.customerSnapshot.taxName || document.customerSnapshot.name) : document.customerSnapshot.name;
    const displayCustomerAddress = isTaxDoc ? (document.customerSnapshot.taxAddress || 'ไม่มีที่อยู่') : (document.customerSnapshot.detail || document.customerSnapshot.taxAddress || 'ไม่มีที่อยู่');
    const displayCustomerPhone = isTaxDoc ? (document.customerSnapshot.taxPhone || document.customerSnapshot.phone) : document.customerSnapshot.phone;

    let branchLabel = "";
    if (isTaxDoc) {
        if (document.customerSnapshot.taxBranchType === 'HEAD_OFFICE') {
            branchLabel = "สำนักงานใหญ่";
        } else if (document.customerSnapshot.taxBranchType === 'BRANCH') {
            branchLabel = `สาขา ${document.customerSnapshot.taxBranchNo || '-----'}`;
        }
    }

    const storeBranchLabel = document.storeSnapshot.branch === '00000' || document.storeSnapshot.branch === 'สำนักงานใหญ่' 
        ? 'สำนักงานใหญ่' 
        : (document.storeSnapshot.branch ? `สาขา ${document.storeSnapshot.branch}` : '');

    const isQuotation = document.docType === 'QUOTATION';
    const labelSender = isQuotation ? 'ผู้เสนอราคา' : 'ผู้ส่งสินค้า/บริการ';
    const labelReceiver = isQuotation ? 'ผู้รับสินค้า/บริการ';

    return (
        <div className="printable-document border bg-white shadow-sm w-[210mm] mx-auto text-black print:shadow-none print:border-none print:m-0 print:w-full box-border flex flex-col">
            <div className="flex-1">
                <div className="grid grid-cols-2 gap-8 mb-4">
                    <div className="space-y-1">
                        <h2 className="text-base font-bold">
                            {(isDeliveryNote ? (document.storeSnapshot.informalName || document.storeSnapshot.taxName) : document.storeSnapshot.taxName) || 'Sahadiesel Service'}
                            {storeBranchLabel && <span className="font-bold"> ({storeBranchLabel})</span>}
                        </h2>
                        <p className="text-[11px] whitespace-pre-wrap leading-relaxed">
                            {document.storeSnapshot.taxAddress}
                        </p>
                        <p className="text-[11px]">
                            โทร {document.storeSnapshot.phone}
                            {!isDeliveryNote && document.storeSnapshot.taxId && (
                                <span className="ml-4">เลขประจำตัวผู้เสียภาษี {document.storeSnapshot.taxId}</span>
                            )}
                        </p>
                    </div>
                    <div className="text-right space-y-1">
                        <h1 className="text-xl font-bold text-primary">{finalDocTitle}</h1>
                        <p className="text-sm font-bold">เลขที่: {document.docNo}</p>
                        <p className="text-sm">วันที่: {safeFormat(new Date(document.docDate), 'dd/MM/yyyy')}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-4 p-3 border rounded-md">
                    <div className="space-y-1">
                        <h4 className="font-bold text-[10px] text-primary uppercase tracking-wider mb-1">ข้อมูลลูกค้า</h4>
                        <p className="text-sm">
                            <span className="font-bold">{displayCustomerName}</span>
                            {branchLabel && <span className="font-bold"> ({branchLabel})</span>}
                        </p>
                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap">
                            {displayCustomerAddress}
                        </p>
                        <p className="text-[11px]">
                            โทร {displayCustomerPhone}
                            {isTaxDoc && document.customerSnapshot.taxId && (
                                <span className="ml-4">เลขประจำตัวผู้เสียภาษี {document.customerSnapshot.taxId}</span>
                            )}
                        </p>
                    </div>
                    <VehicleInfo doc={document} />
                </div>

                <Table className="mb-4 border-t border-b">
                    <TableHeader className="bg-muted/20">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="w-12 text-center text-black font-bold h-8">#</TableHead>
                            <TableHead className="text-black font-bold h-8">รายการ</TableHead>
                            <TableHead className="w-20 text-right text-black font-bold h-8">จำนวน</TableHead>
                            <TableHead className="w-32 text-right text-black font-bold h-8">ราคา/หน่วย</TableHead>
                            <TableHead className="w-32 text-right text-black font-bold h-8">รวมเงิน</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {document.items.map((item, index) => (
                            <TableRow key={index} className="border-b hover:bg-transparent">
                                <TableCell className="text-center py-1.5 h-8">{index + 1}</TableCell>
                                <TableCell className="py-1.5 h-8">{item.description}</TableCell>
                                <TableCell className="text-right py-1.5 h-8">{item.quantity}</TableCell>
                                <TableCell className="text-right py-1.5 h-8">{item.unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell>
                                <TableCell className="text-right py-1.5 h-8">{item.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="grid grid-cols-2 gap-8">
                    <div className="text-left text-[11px]">
                        {document.notes && <p className="whitespace-pre-wrap"><span className="font-bold">หมายเหตุ:</span> {document.notes}</p>}
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-sm"><span>รวมเป็นเงิน</span><span>{document.subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between text-sm"><span>ส่วนลด</span><span>{document.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between font-bold text-sm"><span>ยอดหลังหักส่วนลด</span><span>{document.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                        {document.withTax && <div className="flex justify-between text-sm"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{document.vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>}
                        <Separator className="my-1" />
                        <div className="flex justify-between text-base font-bold text-primary uppercase"><span>ยอดสุทธิรวม</span><span>{document.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-12 mt-auto text-center text-xs pb-4 pt-10">
                <div className="space-y-8">
                    <p>.................................................</p>
                    <p>({document.senderName || labelSender})</p>
                </div>
                <div className="space-y-8">
                    <p>.................................................</p>
                    <p>({document.receiverName || labelReceiver})</p>
                </div>
            </div>
        </div>
    );
}

function DocumentPageContent() {
    const { docId } = useParams();
    const router = useRouter();
    const { db } = useFirebase();
    const searchParams = useSearchParams();

    const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);
    const [printCopies, setPrintCopies] = useState<1 | 2>(1);

    const docRef = useMemo(() => (db && typeof docId === 'string' ? doc(db, 'documents', docId) : null), [db, docId]);
    const { data: document, isLoading, error } = useDoc<Document>(docRef);

    useEffect(() => {
        if (document && searchParams.get('autoprint') === '1') {
            const timer = setTimeout(() => {
                window.print();
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [document, searchParams]);

    const handleBack = () => {
        if (!document) {
            router.back();
            return;
        }
        
        switch (document.docType) {
            case 'QUOTATION':
                router.push('/app/office/documents/quotation');
                break;
            case 'DELIVERY_NOTE':
                router.push('/app/office/documents/delivery-note');
                break;
            case 'TAX_INVOICE':
                router.push('/app/office/documents/tax-invoice');
                break;
            case 'BILLING_NOTE':
                router.push('/app/management/accounting/documents/billing-note');
                break;
            case 'RECEIPT':
                router.push('/app/management/accounting/documents/receipt');
                break;
            default:
                router.push('/app/jobs');
        }
    };

    const handlePrintRequest = () => {
        if (document?.docType === 'TAX_INVOICE') setIsPrintOptionsOpen(true);
        else window.print();
    };

    if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
    if (error || !document) return <div className="p-12 text-center space-y-4"><AlertCircle className="mx-auto h-12 w-12 text-destructive"/><h2 className="text-xl font-bold">ไม่พบเอกสาร</h2><Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2"/> กลับ</Button></div>;

    return (
        <div className="min-h-screen bg-muted/20 py-8 print:p-0 print:bg-white overflow-x-hidden">
            <div className="max-w-[210mm] mx-auto space-y-6 print:m-0 print:max-w-none">
                <div className="flex justify-between items-center bg-background p-4 rounded-lg border shadow-sm print:hidden mx-4 md:mx-0">
                    <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <div className="flex gap-2">
                        <Button onClick={handlePrintRequest}><Printer className="mr-2 h-4 w-4"/> สั่งพิมพ์ (Ctrl+P)</Button>
                    </div>
                </div>

                <div className="w-full overflow-x-auto pb-10 print:overflow-visible print:pb-0">
                    <div className="min-w-[210mm] print:min-w-0 print:m-0">
                        {document.docType === 'TAX_INVOICE' ? (
                            <div className="space-y-8 print:space-y-0">
                                <DocumentView document={document} taxCopyLabel="ORIGINAL" />
                                <div className="hidden print:block break-before-page" />
                                <DocumentView document={document} taxCopyLabel="COPY" />
                                
                                {printCopies === 2 && (
                                    <>
                                        <div className="hidden print:block break-before-page" />
                                        <DocumentView document={document} taxCopyLabel="COPY" />
                                    </>
                                )}
                            </div>
                        ) : (
                            <DocumentView document={document} />
                        )}
                    </div>
                </div>
            </div>

            <AlertDialog open={isPrintOptionsOpen} onOpenChange={setIsPrintOptionsOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>พิมพ์ใบกำกับภาษี</AlertDialogTitle><AlertDialogDescription>เลือกจำนวนสำเนาที่ต้องการพิมพ์</AlertDialogDescription></AlertDialogHeader>
                    <div className="py-4">
                        <RadioGroup value={String(printCopies)} onValueChange={(v) => setPrintCopies(Number(v) as 1 | 2)}>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="1" id="c1" /><Label htmlFor="c1" className="cursor-pointer">ต้นฉบับ 1 + สำเนา 1</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="2" id="c2" /><Label htmlFor="c2" className="cursor-pointer">ต้นฉบับ 1 + สำเนา 2 (ออฟฟิศ/บัญชี)</Label></div>
                        </RadioGroup>
                    </div>
                    <AlertDialogFooter><AlertDialogCancel>ยกเลิก</AlertDialogCancel><AlertDialogAction onClick={() => { setIsPrintOptionsOpen(false); setTimeout(() => window.print(), 300); }}>ยืนยันและเปิดหน้าต่างพิมพ์</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function DocumentPageWrapper() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>}>
      <DocumentPageContent />
    </Suspense>
  );
}