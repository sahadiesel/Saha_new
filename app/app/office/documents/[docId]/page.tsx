
"use client";

import { useMemo, Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useDoc } from "@/firebase/firestore/use-doc";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer, Loader2, CheckCircle2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat } from "@/lib/date-utils";
import { cn, thaiBahtText } from "@/lib/utils";
import type { Document, AccountingAccount, Customer, Job } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";

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

function DocumentView({ 
    document, 
    customer,
    labelSuffix,
    accountName
}: { 
    document: Document, 
    customer: any,
    labelSuffix?: 'ORIGINAL' | 'COPY',
    accountName?: string
}) {
    const docTypeDisplay: Record<string, string> = {
        QUOTATION: "ใบเสนอราคา / Quotation",
        DELIVERY_NOTE: "ใบส่งของชั่วคราว",
        TAX_INVOICE: "ใบกำกับภาษี / Tax Invoice",
        RECEIPT: "ใบเสร็จรับเงิน / Receipt",
        BILLING_NOTE: "ใบวางบิล / Billing Note",
        CREDIT_NOTE: "ใบลดหนี้ / Credit Note",
        WITHHOLDING_TAX: "หนังสือรับรองหัก ณ ที่จ่าย",
        WITHDRAWAL: "ใบเบิกอะไหล่ / Part Withdrawal",
    };
    
    let finalDocTitle = docTypeDisplay[document.docType] || document.docType;
    
    if (labelSuffix) {
        const suffixThai = labelSuffix === 'ORIGINAL' ? 'ต้นฉบับ' : 'สำเนา';
        if (document.docType === 'TAX_INVOICE') {
            finalDocTitle = `ใบกำกับภาษี ${suffixThai} / Tax Invoice`;
        } else if (document.docType === 'BILLING_NOTE') {
            finalDocTitle = `ใบวางบิล ${suffixThai} / Billing Note`;
        } else if (document.docType === 'RECEIPT') {
            finalDocTitle = `ใบเสร็จรับเงิน ${suffixThai} / Receipt`;
        }
    }

    const isTaxDoc = ['TAX_INVOICE', 'RECEIPT', 'BILLING_NOTE', 'CREDIT_NOTE', 'WITHHOLDING_TAX'].includes(document.docType);
    const isBilling = document.docType === 'BILLING_NOTE';
    const isWithdrawal = document.docType === 'WITHDRAWAL';
    
    const displayCustomerName = customer.useTax 
        ? (customer.taxName || customer.name) 
        : (customer.name);
        
    const displayCustomerAddress = isTaxDoc 
        ? (customer.taxAddress || customer.detail || '---') 
        : (customer.detail || customer.taxAddress || '---');
        
    const displayCustomerPhone = isTaxDoc 
        ? (customer.taxPhone || customer.phone) 
        : customer.phone;

    let branchLabel = "";
    if (isTaxDoc || customer.useTax) {
        if (customer.taxBranchType === 'HEAD_OFFICE') {
            branchLabel = "สำนักงานใหญ่";
        } else if (customer.taxBranchType === 'BRANCH') {
            branchLabel = `สาขา ${customer.taxBranchNo || '-----'}`;
        }
    }

    const storeBranchLabel = document.storeSnapshot.branch === '00000' || document.storeSnapshot.branch === 'สำนักงานใหญ่' 
        ? 'สำนักงานใหญ่' 
        : (document.storeSnapshot.branch ? `สาขา ${document.storeSnapshot.branch}` : '');

    const isQuotation = document.docType === 'QUOTATION';
    const isReceipt = document.docType === 'RECEIPT';
    
    const labelSender = isQuotation ? 'ผู้เสนอราคา' : (isBilling ? 'ผู้วางบิล' : (isReceipt ? 'ผู้รับเงิน' : (isWithdrawal ? 'ผู้จ่ายอะไหล่' : 'ผู้ส่งสินค้า')));
    const labelReceiver = isQuotation ? 'ลูกค้า / ผู้รับข้อเสนอ' : (isBilling ? 'ผู้รับวางบิล' : (isReceipt ? 'ลูกค้า / ผู้จ่ายเงิน' : (isWithdrawal ? 'ผู้รับอะไหล่' : 'ผู้รับสินค้า')));

    return (
        <div className="printable-document border bg-white shadow-sm w-[210mm] mx-auto text-black print:shadow-none print:border-none print:m-0 print:w-full box-border flex flex-col">
            <div className="flex-1">
                <div className="grid grid-cols-2 gap-8 mb-4">
                    <div className="space-y-1">
                        <h2 className="text-base font-bold">
                            {(document.storeSnapshot.taxName || document.storeSnapshot.informalName) || 'Sahadiesel Service'}
                            {storeBranchLabel && <span className="font-bold"> ({storeBranchLabel})</span>}
                        </h2>
                        <p className="text-[11px] whitespace-pre-wrap leading-relaxed">
                            {document.storeSnapshot.taxAddress}
                        </p>
                        <p className="text-[11px]">
                            โทร {document.storeSnapshot.phone}
                            {document.storeSnapshot.taxId && !isBilling && (
                                <span className="ml-4">เลขประจำตัวผู้เสียภาษี {document.storeSnapshot.taxId}</span>
                            )}
                        </p>
                    </div>
                    <div className="text-right space-y-1">
                        <h1 className="text-xl font-bold text-primary">{finalDocTitle}</h1>
                        {document.docType === "TAX_INVOICE" && (
                            <p className="text-sm font-medium text-foreground">เอกสารออกเป็นชุด</p>
                        )}
                        <p className="text-sm font-bold">เลขที่: {document.docNo}</p>
                        <p className="text-sm">วันที่: {safeFormat(new Date(document.docDate), 'dd/MM/yyyy')}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-4 p-3 border rounded-md">
                    <div className="space-y-1">
                        <h4 className="font-bold text-[10px] text-primary uppercase tracking-wider mb-1">ข้อมูลลูกค้า</h4>
                        <p className="text-sm">
                            <span className="font-bold">{displayCustomerName}</span>
                            {branchLabel && <span className="font-bold text-primary ml-2">({branchLabel})</span>}
                        </p>
                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap">
                            {displayCustomerAddress}
                        </p>
                        <div className="text-[11px] space-y-0.5">
                            <p>โทร: {displayCustomerPhone}</p>
                            {(isTaxDoc || customer.useTax) && customer.taxId && (
                                <p className="font-bold">เลขประจำตัวผู้เสียภาษี: {customer.taxId}</p>
                            )}
                        </div>
                    </div>
                    <VehicleInfo doc={document} />
                </div>

                <Table className="mb-4 border-t border-b">
                    <TableHeader className="bg-muted/20">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="w-12 text-center text-black font-bold h-8">#</TableHead>
                            <TableHead className="text-black font-bold h-8">รายการ</TableHead>
                            <TableHead className={cn("text-right text-black font-bold h-8", isWithdrawal ? "w-32" : "w-20")}>
                                {isWithdrawal ? "จำนวนเบิก" : "จำนวน"}
                            </TableHead>
                            {isWithdrawal ? (
                                <TableHead className="w-32 text-right text-black font-bold h-8">คงเหลือในคลัง</TableHead>
                            ) : (
                                <>
                                    <TableHead className="w-32 text-right text-black font-bold h-8">ราคา/หน่วย</TableHead>
                                    <TableHead className="w-32 text-right text-black font-bold h-8">รวมเงิน</TableHead>
                                </>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {document.items.map((item, index) => (
                            <TableRow key={index} className="border-b hover:bg-transparent">
                                <TableCell className="text-center py-1.5 h-8">{index + 1}</TableCell>
                                <TableCell className="py-1.5 h-8">{item.description}</TableCell>
                                <TableCell className="text-right py-1.5 h-8">{item.quantity}</TableCell>
                                {isWithdrawal ? (
                                    <TableCell className="text-right py-1.5 h-8">
                                        {item.stockSnapshot !== undefined ? item.stockSnapshot : "-"}
                                    </TableCell>
                                ) : (
                                    <>
                                        <TableCell className="text-right py-1.5 h-8">{item.unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="text-right py-1.5 h-8">{item.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</TableCell>
                                    </>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="grid grid-cols-2 gap-8">
                    <div className="text-left space-y-4">
                        {document.notes && <div className="text-[11px] whitespace-pre-wrap"><span className="font-bold">หมายเหตุ:</span> {document.notes}</div>}
                        
                        {isReceipt && (
                            <div className="p-3 border rounded bg-muted/5 space-y-1">
                                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">ข้อมูลการชำระเงิน</p>
                                <p className="text-xs font-bold">ชำระโดย: <span className="font-normal">{accountName || (document.paymentMethod === 'CASH' ? 'เงินสด' : 'เงินโอน')}</span></p>
                                <p className="text-[10px] text-muted-foreground italic">วันที่ได้รับเงิน: {safeFormat(new Date(document.paymentDate || document.docDate), 'dd/MM/yyyy')}</p>
                            </div>
                        )}
                    </div>
                    {!isWithdrawal && (
                        <div className="space-y-1">
                            <div className="flex justify-between text-sm"><span>รวมเป็นเงิน</span><span>{document.subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                            <div className="flex justify-between text-sm"><span>ส่วนลด</span><span>{document.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                            <div className="flex justify-between font-bold text-sm"><span>ยอดหลังหักส่วนลด</span><span>{document.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                            {document.withTax && <div className="flex justify-between text-sm"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{document.vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>}
                            <Separator className="my-1" />
                            <div className="flex justify-between text-base font-bold text-primary uppercase"><span>ยอดสุทธิรวม</span><span>{document.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                            
                            <div className="text-right pt-1">
                                <span className="text-[11px] font-bold italic">{thaiBahtText(document.grandTotal)}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-12 mt-auto text-center text-[11px] pb-4 pt-10">
                <div className="flex flex-col items-center">
                    <p className="mb-6">.................................................</p>
                    <p className="font-bold">{labelSender}</p>
                </div>
                <div className="flex flex-col items-center">
                    <p className="mb-6">.................................................</p>
                    <p className="font-bold">{labelReceiver}</p>
                </div>
            </div>

            {(isReceipt || isWithdrawal) && (
                <div className="text-center text-[10px] text-muted-foreground border-t pt-2 mt-4 italic">
                    {isReceipt ? "\"เอกสารฉบับนี้จะสมบูรณ์เมื่อได้รับเงินครบถ้วนแล้วเท่านั้น\"" : "\"ใช้สำหรับการเบิกอะไหล่ภายในคลังสินค้า Sahadiesel เท่านั้น\""}
                </div>
            )}
        </div>
    );
}

function DocumentPageContent() {
    const { docId } = useParams();
    const router = useRouter();
    const { db } = useFirebase();
    const { toast } = useToast();
    const { profile } = useAuth();
    const searchParams = useSearchParams();

    const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);
    const [printCopies, setPrintCopies] = useState<1 | 2>(1);
    const [accountName, setAccountName] = useState<string>("");
    const [isProcessing, setIsProcessing] = useState(false);

    const docRef = useMemo(() => (db && typeof docId === 'string' ? doc(db, 'documents', docId) : null), [db, docId]);
    const { data: document, isLoading, error } = useDoc<Document>(docRef);

    const customerRef = useMemo(() => (db && document?.customerId ? doc(db, 'customers', document.customerId) : null), [db, document?.customerId]);
    const { data: liveCustomer } = useDoc<Customer>(customerRef);

    const jobRef = useMemo(() => (db && document?.jobId ? doc(db, 'jobs', document.jobId) : null), [db, document?.jobId]);
    const { data: linkedJob } = useDoc<Job>(jobRef);

    const effectiveCustomer = useMemo(() => {
        if (!document) return null;
        return {
            ...document.customerSnapshot,
            ...(liveCustomer || {})
        };
    }, [document, liveCustomer]);

    // Set browser tab title to document number for filename auto-suggestion
    useEffect(() => {
        if (document?.docNo) {
            const originalTitle = window.document.title;
            window.document.title = document.docNo;
            return () => {
                window.document.title = originalTitle;
            };
        }
    }, [document?.docNo]);

    useEffect(() => {
        if (document && searchParams.get('autoprint') === '1') {
            const timer = setTimeout(() => {
                window.print();
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [document, searchParams]);

    useEffect(() => {
        if (document?.docType === 'RECEIPT' && document.receivedAccountId && db) {
            getDoc(doc(db, 'accountingAccounts', document.receivedAccountId)).then(snap => {
                if (snap.exists()) {
                    setAccountName(snap.data().name);
                }
            });
        }
    }, [document, db]);

    const handleBack = () => {
        const from = searchParams.get('from');
        const tab = searchParams.get('tab');
        
        if (from === 'inbox') {
            router.push(`/app/management/accounting/inbox?tab=${tab || 'receive'}`);
            return;
        }

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
            case 'WITHDRAWAL':
                router.push('/app/office/parts/withdraw');
                break;
            default:
                router.push('/app/jobs');
        }
    };

    const handlePrintRequest = () => {
        if (['TAX_INVOICE', 'BILLING_NOTE', 'RECEIPT'].includes(document?.docType || '')) setIsPrintOptionsOpen(true);
        else window.print();
    };

    const handleInformCustomer = async () => {
        if (!db || !document?.jobId || !profile) return;
        setIsProcessing(true);
        try {
            const jRef = doc(db, 'jobs', document.jobId);
            await updateDoc(jRef, {
                status: 'WAITING_APPROVE',
                lastActivityAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            // Log activity
            await addDoc(collection(jRef, 'activities'), {
                text: `แจ้งราคาลูกค้าแล้ว (โดย ${profile.displayName}) - สถานะเปลี่ยนเป็นรออนุมัติ`,
                userName: profile.displayName,
                userId: profile.uid,
                createdAt: serverTimestamp()
            });
            toast({ title: "อัปเดตสถานะสำเร็จ", description: "งานซ่อมเปลี่ยนเป็นสถานะ 'รอลูกค้าอนุมัติ' แล้วค่ะ" });
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error", description: e.message });
        } finally {
            setIsProcessing(false);
        }
    };

    if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
    if (error || !document || !effectiveCustomer) return <div className="p-12 text-center space-y-4"><AlertCircle className="mx-auto h-12 w-12 text-destructive"/><h2 className="text-xl font-bold">ไม่พบเอกสาร</h2><Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2"/> กลับ</Button></div>;

    const showMultiCopy = ['TAX_INVOICE', 'BILLING_NOTE', 'RECEIPT'].includes(document.docType);
    const showInformButton = document.docType === 'QUOTATION' && linkedJob?.status === 'PENDING_CUSTOMER_INFORM';

    return (
        <div className="min-h-screen bg-muted/20 py-8 print:p-0 print:bg-white overflow-x-hidden print:overflow-visible">
            <div className="max-w-[210mm] mx-auto space-y-6 print:space-y-0 print:m-0 print:max-w-none">
                <div className="flex flex-wrap justify-between items-center bg-background p-4 rounded-lg border shadow-sm print:hidden mx-4 md:mx-0 gap-4">
                    <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <div className="flex flex-wrap gap-2">
                        {showInformButton && (
                            <Button 
                                onClick={handleInformCustomer} 
                                disabled={isProcessing}
                                className="bg-pink-600 hover:bg-pink-700 text-white font-bold"
                            >
                                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4"/>}
                                แจ้งราคาลูกค้าแล้ว
                            </Button>
                        )}
                        <Button onClick={handlePrintRequest}><Printer className="mr-2 h-4 w-4"/> สั่งพิมพ์ (Ctrl+P)</Button>
                    </div>
                </div>

                <div className="w-full overflow-x-auto pb-10 print:overflow-visible print:pb-0">
                    <div className="min-w-[210mm] print:min-w-0 print:m-0">
                        {showMultiCopy ? (
                            <div className="space-y-8 print:space-y-0">
                                <DocumentView document={document} customer={effectiveCustomer} labelSuffix="ORIGINAL" accountName={accountName} />
                                <div className="hidden print:block break-before-page" />
                                <DocumentView document={document} customer={effectiveCustomer} labelSuffix="COPY" accountName={accountName} />
                                
                                {printCopies === 2 && (
                                    <>
                                        <div className="hidden print:block break-before-page" />
                                        <DocumentView document={document} customer={effectiveCustomer} labelSuffix="COPY" accountName={accountName} />
                                    </>
                                )}
                            </div>
                        ) : (
                            <DocumentView document={document} customer={effectiveCustomer} accountName={accountName} />
                        )}
                    </div>
                </div>
            </div>

            <AlertDialog open={isPrintOptionsOpen} onOpenChange={setIsPrintOptionsOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>พิมพ์{document.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : (document.docType === 'RECEIPT' ? 'ใบเสร็จรับเงิน' : 'ใบวางบิล')}</AlertDialogTitle>
                        <AlertDialogDescription>เลือกจำนวนสำเนาที่ต้องการพิมพ์</AlertDialogDescription>
                    </AlertDialogHeader>
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
