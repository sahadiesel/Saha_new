
"use client";

import { useMemo, Suspense, useState, useEffect, useRef, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, type DocumentReference } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useDoc } from "@/firebase/firestore/use-doc";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer, Loader2, CheckCircle2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { safeFormat } from "@/lib/date-utils";
import { cn, thaiBahtText } from "@/lib/utils";
import { applyPrintDocumentTitle, getPrintFirstPageItemCount, shouldSplitPrintPages } from "@/lib/print-document";
import { informCustomerOfJobQuotation } from "@/firebase/job-quotation-inform";
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

/** เปิดหน้าต่างพิมพ์ — ตั้งชื่อไฟล์เป็นเลขที่เอกสารก่อน (Edge/Chrome ใช้ document.title) */
function triggerPrintWithDocTitle(docNo: string | undefined) {
    const no = docNo?.trim();
    if (no) applyPrintDocumentTitle(no);
    requestAnimationFrame(() => window.print());
}

function VehicleInfo({ doc, isTaxInvoicePrint }: { doc: Document; isTaxInvoicePrint?: boolean }) {
    const s = doc.carSnapshot;
    if (!s || (!s.licensePlate && !s.brand && !s.model && !s.partNumber && !s.registrationNumber)) return null;

    return (
        <div className="space-y-1 text-sm border-l-2 border-muted pl-4">
            <h4
                className={cn(
                    "font-bold text-primary mb-1 uppercase",
                    isTaxInvoicePrint
                        ? "text-xs tracking-wide"
                        : "tracking-wider text-[10px]"
                )}
            >
                รายละเอียดรถ / ชิ้นส่วน
            </h4>
            {s.brand && (
                <div className="flex min-w-0 w-full items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">ยี่ห้อ:</span>
                    <span className="min-w-0 max-w-full flex-1 break-words text-right font-medium leading-snug">{s.brand}</span>
                </div>
            )}
            {s.model && (
                <div className="flex min-w-0 w-full items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">รุ่นรถ:</span>
                    <span className="min-w-0 max-w-full flex-1 break-words text-right font-medium leading-snug">{s.model}</span>
                </div>
            )}
            {s.licensePlate && (
                <div className="flex min-w-0 w-full items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">ทะเบียน:</span>
                    <span className="min-w-0 max-w-full flex-1 break-words text-right font-medium leading-snug">{s.licensePlate}</span>
                </div>
            )}
            {s.partNumber && (
                <div className="flex min-w-0 w-full items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">เลขอะไหล่:</span>
                    <span className="min-w-0 max-w-full flex-1 break-all text-right font-medium leading-snug whitespace-normal">
                        {s.partNumber}
                    </span>
                </div>
            )}
            {s.registrationNumber && (
                <div className="flex min-w-0 w-full items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">เลขทะเบียนชิ้นส่วน:</span>
                    <span className="min-w-0 max-w-full flex-1 break-words text-right font-medium leading-snug">{s.registrationNumber}</span>
                </div>
            )}
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
    
    /** ใบวางบิล: หัวลูกค้าต้องตรง customerSnapshot (เดียวกับใบกำกับภาษี) — ไม่ใช้ receiverName ทับ */
    const displayCustomerName = customer.useTax
        ? customer.taxName || customer.name
        : customer.name;
        
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
    const isTaxInvoice = document.docType === "TAX_INVOICE";
    const isDeliveryNote = document.docType === "DELIVERY_NOTE";

    /** รวมบรรทัดใน string สำหรับพิมพ์ (newline / ช่องว่างพิเศษ) */
    const collapseToSingleLine = (s: string) =>
        String(s || "")
            .replace(/[\r\n\u2028\u2029\u0085]+/g, " ")
            .replace(/[ \t\u00A0\u2000-\u200B\uFEFF]+/g, " ")
            .trim();

    /** ใบกำกับภาษี: รวมที่อยู่เป็นหนึ่งบรรทัด แล้วต่อเบอร์โทร (ไม่ตัดกลางที่อยู่ถ้าไม่จำเป็น) */
    const taxInvoiceAddressOneLine = isTaxInvoice ? collapseToSingleLine(String(displayCustomerAddress || "---")) : "";
    const taxInvoiceCustomerNameOneLine = isTaxInvoice ? collapseToSingleLine(String(displayCustomerName || "")) : "";
    const showTaxInvoiceBranchAfterName = Boolean(
        isTaxInvoice &&
            branchLabel &&
            !taxInvoiceCustomerNameOneLine.includes(`(${branchLabel})`)
    );

    const storeAddressOneLine = isTaxInvoice
        ? collapseToSingleLine(String(document.storeSnapshot.taxAddress || ""))
        : "";
    
    const labelSender = isQuotation ? 'ผู้เสนอราคา' : (isBilling ? 'ผู้วางบิล' : (isReceipt ? 'ผู้รับเงิน' : (isWithdrawal ? 'ผู้จ่ายอะไหล่' : 'ผู้ส่งสินค้า')));
    const labelReceiver = isQuotation ? 'ลูกค้า / ผู้รับข้อเสนอ' : (isBilling ? 'ผู้รับวางบิล' : (isReceipt ? 'ลูกค้า / ผู้จ่ายเงิน' : (isWithdrawal ? 'ผู้รับอะไหล่' : 'ผู้รับสินค้า')));
    const itemColCount = isWithdrawal ? 4 : 5;
    const allItems = document.items;
    const splitPrintLayout = shouldSplitPrintPages(document.docType, allItems.length);
    const firstPageItemCount = getPrintFirstPageItemCount(allItems.length);
    const pagesPerCopy = splitPrintLayout ? 2 : 1;

    const renderDocumentTable = (
        items: typeof allItems,
        { showFooter, startIndex }: { showFooter: boolean; startIndex: number }
    ) => (
            <Table
                className={cn(
                    "mb-4 border-t border-b",
                    (isTaxInvoice || isDeliveryNote) && "[&_tbody_tr]:h-auto"
                )}
            >
                <TableHeader className="[&_tr]:border-b-0">
                    <TableRow className="print-doc-repeat-header border-0 hover:bg-transparent">
                        <TableHead
                            colSpan={itemColCount}
                            className="h-auto border-0 bg-white p-0 py-2 text-left align-top font-normal text-black print:border-0 [&_*]:text-black"
                        >
                <div
                    className={cn(
                        "mb-2 gap-4 w-full",
                        isTaxInvoice || isQuotation || isDeliveryNote
                            ? "grid [grid-template-columns:minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start"
                            : "grid grid-cols-2 gap-8"
                    )}
                >
                    <div className="space-y-1 min-w-0">
                        <h2
                            className={cn(
                                "font-bold leading-snug",
                                isTaxInvoice || isDeliveryNote ? "text-lg" : "text-base"
                            )}
                        >
                            {(document.storeSnapshot.taxName || document.storeSnapshot.informalName) || "Sahadiesel Service"}
                            {storeBranchLabel && <span className="font-bold"> ({storeBranchLabel})</span>}
                        </h2>
                        {isTaxInvoice ? (
                            <>
                                <p className="text-sm leading-snug break-words">{storeAddressOneLine || "—"}</p>
                                {document.storeSnapshot.phone && (
                                    <p className="text-sm leading-snug">โทร {document.storeSnapshot.phone}</p>
                                )}
                                {document.storeSnapshot.taxId && !isBilling && (
                                    <p className="text-xs leading-snug">เลขประจำตัวผู้เสียภาษี {document.storeSnapshot.taxId}</p>
                                )}
                            </>
                        ) : isDeliveryNote ? (
                            <>
                                <p className="text-sm leading-snug whitespace-pre-wrap break-words">
                                    {document.storeSnapshot.taxAddress}
                                </p>
                                {document.storeSnapshot.phone && (
                                    <p className="text-sm leading-snug">โทร {document.storeSnapshot.phone}</p>
                                )}
                                {document.storeSnapshot.taxId && !isBilling && (
                                    <p className="text-xs leading-snug">เลขประจำตัวผู้เสียภาษี {document.storeSnapshot.taxId}</p>
                                )}
                            </>
                        ) : (
                            <>
                                <p className="text-[11px] whitespace-pre-wrap leading-relaxed">
                                    {document.storeSnapshot.taxAddress}
                                </p>
                                <p className="text-[11px]">
                                    โทร {document.storeSnapshot.phone}
                                    {document.storeSnapshot.taxId && !isBilling && (
                                        <span className="ml-4">เลขประจำตัวผู้เสียภาษี {document.storeSnapshot.taxId}</span>
                                    )}
                                </p>
                            </>
                        )}
                    </div>
                    <div
                        className={cn(
                            "text-right min-w-0",
                            isTaxInvoice || isDeliveryNote ? "space-y-0.5" : isQuotation ? "space-y-1" : "space-y-1"
                        )}
                    >
                        {isTaxInvoice ? (
                            <>
                                <h1 className="text-lg font-bold text-primary leading-tight sm:text-xl">
                                    {labelSuffix
                                        ? `ใบกำกับภาษี ${labelSuffix === "ORIGINAL" ? "ต้นฉบับ" : "สำเนา"}`
                                        : "ใบกำกับภาษี"}
                                </h1>
                                <h2 className="text-base font-bold text-primary leading-tight sm:text-lg">Tax Invoice</h2>
                                <p className="text-sm font-medium text-foreground pt-0.5">เอกสารออกเป็นชุด</p>
                                <p className="text-sm font-bold">เลขที่: {document.docNo}</p>
                                <p className="text-sm">วันที่: {safeFormat(new Date(document.docDate), "dd/MM/yyyy")}</p>
                            </>
                        ) : isDeliveryNote ? (
                            <>
                                <h1 className="text-lg font-bold text-primary leading-tight sm:text-xl">{finalDocTitle}</h1>
                                <p className="text-sm font-bold">เลขที่: {document.docNo}</p>
                                <p className="text-sm">วันที่: {safeFormat(new Date(document.docDate), "dd/MM/yyyy")}</p>
                            </>
                        ) : (
                            <>
                                <h1 className="text-xl font-bold text-primary">{finalDocTitle}</h1>
                                <p className="text-sm font-bold">เลขที่: {document.docNo}</p>
                                <p className="text-sm">วันที่: {safeFormat(new Date(document.docDate), "dd/MM/yyyy")}</p>
                            </>
                        )}
                    </div>
                </div>
                        </TableHead>
                    </TableRow>
                    <TableRow className="print-doc-repeat-header border-0 hover:bg-transparent">
                        <TableHead
                            colSpan={itemColCount}
                            className="h-auto border-0 bg-white p-0 py-1 text-left align-top font-normal text-black print:border-0 [&_*]:text-black"
                        >
                <div
                    className={cn(
                        "mb-0 p-3 border rounded-md w-full",
                        isTaxInvoice || isQuotation || isDeliveryNote
                            ? "grid gap-3 [grid-template-columns:minmax(0,3fr)_minmax(0,2fr)]"
                            : "grid grid-cols-2 gap-8"
                    )}
                >
                    <div className="space-y-1 min-w-0">
                        <h4
                            className={cn(
                                "font-bold text-primary uppercase mb-1",
                                isTaxInvoice || isDeliveryNote
                                    ? "text-xs tracking-wide"
                                    : "text-[10px] tracking-wider"
                            )}
                        >
                            ข้อมูลลูกค้า
                        </h4>
                        {document.docType === "TAX_INVOICE" ? (
                            <>
                                <p className="text-base font-bold leading-tight text-foreground">
                                    <span>{taxInvoiceCustomerNameOneLine || displayCustomerName}</span>
                                    {showTaxInvoiceBranchAfterName && <span className="text-primary">&nbsp;({branchLabel})</span>}
                                </p>
                                <p className="text-sm leading-snug">
                                    {taxInvoiceAddressOneLine}
                                    {displayCustomerPhone && (
                                        <span className="whitespace-nowrap">{"\u00A0"}โทร: {displayCustomerPhone}</span>
                                    )}
                                </p>
                                {(isTaxDoc || customer.useTax) && customer.taxId && (
                                    <p className="text-sm font-bold">
                                        เลขประจำตัวผู้เสียภาษี: {customer.taxId}
                                    </p>
                                )}
                            </>
                        ) : isDeliveryNote ? (
                            <>
                                <p className="text-base font-bold leading-tight text-foreground">
                                    <span>{displayCustomerName}</span>
                                    {branchLabel && <span className="font-bold text-primary ml-2">({branchLabel})</span>}
                                </p>
                                <p className="text-sm leading-snug whitespace-pre-wrap">{displayCustomerAddress}</p>
                                <div className="text-sm space-y-0.5">
                                    <p>โทร: {displayCustomerPhone}</p>
                                    {(isTaxDoc || customer.useTax) && customer.taxId && (
                                        <p className="font-bold">เลขประจำตัวผู้เสียภาษี: {customer.taxId}</p>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
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
                            </>
                        )}
                    </div>
                    <div className="min-w-0">
                        <VehicleInfo doc={document} isTaxInvoicePrint={isTaxInvoice || isDeliveryNote} />
                    </div>
                </div>
                        </TableHead>
                    </TableRow>
                    <TableRow className="print-doc-repeat-header border-b bg-muted/20 hover:bg-transparent">
                            <TableHead className="h-8 w-12 text-center text-black font-bold">
                                #
                            </TableHead>
                            <TableHead className="h-8 text-black font-bold">
                                รายการ
                            </TableHead>
                            <TableHead
                                className={cn(
                                    "h-8 text-right text-black font-bold",
                                    isWithdrawal ? "w-32" : "w-20"
                                )}
                            >
                                {isWithdrawal ? "จำนวนเบิก" : "จำนวน"}
                            </TableHead>
                            {isWithdrawal ? (
                                <TableHead className="h-8 w-32 text-right text-black font-bold">
                                    คงเหลือในคลัง
                                </TableHead>
                            ) : (
                                <>
                                    <TableHead className="h-8 w-32 text-right text-black font-bold">
                                        ราคา/หน่วย
                                    </TableHead>
                                    <TableHead className="h-8 w-32 text-right text-black font-bold">
                                        รวมเงิน
                                    </TableHead>
                                </>
                            )}
                        </TableRow>
                </TableHeader>
                    <TableBody>
                        {items.map((item, index) => (
                            <TableRow key={startIndex + index} className="border-b hover:bg-transparent">
                                <TableCell className="h-8 py-1.5 text-center">
                                    {startIndex + index + 1}
                                </TableCell>
                                <TableCell className="h-8 py-1.5">
                                    {item.description}
                                </TableCell>
                                <TableCell className="h-8 py-1.5 text-right">
                                    {item.quantity}
                                </TableCell>
                                {isWithdrawal ? (
                                    <TableCell className="h-8 py-1.5 text-right">
                                        {item.stockSnapshot !== undefined ? item.stockSnapshot : "-"}
                                    </TableCell>
                                ) : (
                                    <>
                                        <TableCell className="h-8 py-1.5 text-right">
                                            {item.unitPrice.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="h-8 py-1.5 text-right">
                                            {item.total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                        </TableCell>
                                    </>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                    {showFooter && (
                    <TableFooter className="border-0 bg-transparent print:border-0 print:bg-transparent">
                        {/*
                          หมายเหตุ/ยอด/ลายเซ็นอยู่ tfoot — รายการอยู่ tbody เพียงอย่างเดียว
                          ทำให้ thead (หัวร้าน/ลูกค้า/คอลัมน์) ซ้ำทุกหน้าเมื่อรายการยาว
                        */}
                        <TableRow className="print-doc-footer-row border-0 hover:bg-transparent">
                            <TableCell
                                colSpan={itemColCount}
                                className="border-0 p-0 align-top print:border-0 [&_*]:text-black"
                            >
                                {(isQuotation || isDeliveryNote) && !isWithdrawal ? (
                                    <div className="mb-0 p-3 border rounded-md w-full grid gap-3 [grid-template-columns:minmax(0,3fr)_minmax(0,2fr)] items-start">
                                        <div className="space-y-1 min-w-0 text-left">
                                            <h4 className="font-bold text-primary uppercase mb-1 text-[10px] tracking-wider">
                                                หมายเหตุ
                                            </h4>
                                            <div className="text-[11px] whitespace-pre-wrap leading-relaxed min-h-[3rem]">
                                                {document.notes?.trim() ?? ""}
                                            </div>
                                        </div>
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex justify-between text-sm"><span>รวมเป็นเงิน</span><span>{document.subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                                            <div className="flex justify-between text-sm"><span>ส่วนลด</span><span>{document.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                                            <div className="flex justify-between font-bold text-sm"><span>ยอดหลังหักส่วนลด</span><span>{document.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                                            {document.withTax && <div className="flex justify-between text-sm"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{document.vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>}
                                            <Separator className="my-1" />
                                            <div className="flex justify-between text-base font-bold text-primary uppercase"><span>ยอดสุทธิรวม</span><span>{document.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
                                            <div className="text-right pt-1">
                                                <span className="font-bold italic text-[11px]">
                                                    {thaiBahtText(document.grandTotal)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                <div className="grid grid-cols-2 gap-8 items-start">
                                    <div className="text-left space-y-4">
                                        {document.docType === "TAX_INVOICE" ? (
                                            <div className="border border-neutral-400 rounded-sm p-2.5 min-h-[5.5rem] print:border-neutral-500">
                                                <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1.5">หมายเหตุ</p>
                                                <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground min-h-[3rem]">
                                                    {document.notes?.trim() ?? ""}
                                                </div>
                                            </div>
                                        ) : (
                                            document.notes && (
                                                <div className="text-[11px] whitespace-pre-wrap">
                                                    <span className="font-bold">หมายเหตุ:</span> {document.notes}
                                                </div>
                                            )
                                        )}

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
                                                <span className="font-bold italic text-[11px]">
                                                    {thaiBahtText(document.grandTotal)}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                )}

                                <div className="grid grid-cols-2 gap-12 text-center text-[11px] pb-4 pt-10">
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
                            </TableCell>
                        </TableRow>
                    </TableFooter>
                    )}
                </Table>
    );

    const renderPrintPageBlock = (pageNumberLabel: string, table: ReactNode) => (
        <div className="print-page-block hidden print:flex flex-col">
            <div className="print-page-block__content">{table}</div>
            <div className="print-page-block__pagenum">{pageNumberLabel}</div>
        </div>
    );

    return (
        <div className="printable-document print-doc-instance print-doc-set border bg-white shadow-sm w-[210mm] mx-auto text-black print:shadow-none print:border-none print:m-0 print:w-full box-border flex flex-col print:min-h-0">
            {splitPrintLayout ? (
                <>
                    <div className="print:hidden">
                        {renderDocumentTable(allItems, { showFooter: true, startIndex: 0 })}
                    </div>
                    <div className="hidden print:block">
                        {renderPrintPageBlock(
                            `หน้า 1 จาก ${pagesPerCopy}`,
                            renderDocumentTable(allItems.slice(0, firstPageItemCount), {
                                showFooter: false,
                                startIndex: 0,
                            })
                        )}
                        {renderPrintPageBlock(
                            `หน้า 2 จาก ${pagesPerCopy}`,
                            renderDocumentTable(allItems.slice(firstPageItemCount), {
                                showFooter: true,
                                startIndex: firstPageItemCount,
                            })
                        )}
                    </div>
                </>
            ) : (
                <>
                    <div className="print:hidden">
                        {renderDocumentTable(allItems, { showFooter: true, startIndex: 0 })}
                    </div>
                    {renderPrintPageBlock(
                        `หน้า 1 จาก ${pagesPerCopy}`,
                        renderDocumentTable(allItems, { showFooter: true, startIndex: 0 })
                    )}
                </>
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
    /** ต้นฉบับอย่างเดียว / +สำเนา 1 / +สำเนา 2 — default ต้นฉบับ+สำเนา 1 */
    const [printChoice, setPrintChoice] = useState<
        "ORIGINAL_ONLY" | "ORIGINAL_PLUS_1_COPY" | "ORIGINAL_PLUS_2_COPIES"
    >("ORIGINAL_PLUS_1_COPY");
    const [accountName, setAccountName] = useState<string>("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [informConfirmOpen, setInformConfirmOpen] = useState(false);
    const [resubmitQuotationOpen, setResubmitQuotationOpen] = useState(false);

    const printTitleRef = useRef({ docNo: "", titleBeforePrint: "" });

    const docRef = useMemo((): DocumentReference<Document> | null => {
      if (!db || typeof docId !== "string") return null;
      return doc(db, "documents", docId) as DocumentReference<Document>;
    }, [db, docId]);
    const { data: document, isLoading, error } = useDoc<Document>(docRef);

    const customerRef = useMemo((): DocumentReference<Customer> | null => {
      if (!db || !document?.customerId) return null;
      return doc(db, "customers", document.customerId) as DocumentReference<Customer>;
    }, [db, document?.customerId]);
    const { data: liveCustomer, isLoading: liveCustomerLoading } = useDoc<Customer>(customerRef);

    const jobRef = useMemo((): DocumentReference<Job> | null => {
      if (!db || !document?.jobId) return null;
      return doc(db, "jobs", document.jobId) as DocumentReference<Job>;
    }, [db, document?.jobId]);
    const { data: linkedJob } = useDoc<Job>(jobRef);

    const effectiveCustomer = useMemo(() => {
        if (!document) return null;
        const snap = document.customerSnapshot;

        // ใบวางบิล: หัวเอกสารต้องตรง snapshot ตอนออกเอกสาร (แถวแยกเล่มใช้ customerId เสมือน — ดึงจาก customers/ จะได้ชื่อหลักผิด)
        if (document.docType === 'BILLING_NOTE' && snap) {
            return snap as Customer;
        }

        // เอกสารที่บันทึก snapshot ลูกค้า/ภาษีไว้แล้ว ต้องพิมพ์ตาม snapshot เท่านั้น
        // ข้อมูลลูกค้าสดมี tax* ชุดเดียวที่ราก — ถ้า merge ทับ snapshot จะได้ชื่อสาขาผิด
        // เมื่อลูกค้ามีหลายนามภาษี (หลาย tax profile)
        const freezeSnapshotTypes: Document["docType"][] = [
            "TAX_INVOICE",
            "RECEIPT",
            "CREDIT_NOTE",
            "WITHHOLDING_TAX",
        ];
        const preferSnapshot = freezeSnapshotTypes.includes(document.docType) && snap;

        if (preferSnapshot) {
            return { ...(liveCustomer || {}), ...snap };
        }
        if (snap) {
            return { ...snap, ...(liveCustomer || {}) };
        }
        return liveCustomer ?? null;
    }, [document, liveCustomer]);

    /** มีบัญชีพอร์ทัลผูกกับรายชื่อลูกค้า (customers.authUid) — ใช้บอกว่าเอกสารจะไปโผล่ใน portal ได้ */
    const customerHasPortalAccount = useMemo(() => {
        const uid = liveCustomer?.authUid;
        return typeof uid === "string" && uid.trim().length > 0;
    }, [liveCustomer?.authUid]);

    useEffect(() => {
        printTitleRef.current.docNo = document?.docNo?.trim() || "";
        if (document?.docNo?.trim()) {
            applyPrintDocumentTitle(document.docNo.trim());
        }
    }, [document?.docNo]);

    useEffect(() => {
        const beforePrint = () => {
            printTitleRef.current.titleBeforePrint = document.title;
            const no = printTitleRef.current.docNo;
            if (no) applyPrintDocumentTitle(no);
        };
        const afterPrint = () => {
            document.title = printTitleRef.current.titleBeforePrint;
        };
        window.addEventListener("beforeprint", beforePrint);
        window.addEventListener("afterprint", afterPrint);
        return () => {
            window.removeEventListener("beforeprint", beforePrint);
            window.removeEventListener("afterprint", afterPrint);
        };
    }, []);

    useEffect(() => {
        if (document && searchParams.get('autoprint') === '1') {
            const timer = setTimeout(() => {
                triggerPrintWithDocTitle(document.docNo);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [document, searchParams]);

    useEffect(() => {
        setPrintChoice("ORIGINAL_PLUS_1_COPY");
    }, [document?.id, document?.docType]);

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

        if (from === 'jobs-by-status') {
            router.push(`/app/office/jobs/management/by-status?status=${tab || 'waiting-approve'}`);
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
            case 'CREDIT_NOTE':
                router.push('/app/management/accounting/documents/credit-note');
                break;
            case 'DEBIT_NOTE':
                router.push('/app/management/accounting/documents/debit-note');
                break;
            case 'WITHHOLDING_TAX':
                router.push('/app/management/accounting/documents/withholding-tax');
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
        else triggerPrintWithDocTitle(document?.docNo);
    };

    const handleInformCustomer = async () => {
        if (!db || !document?.jobId || !profile) return;
        setIsProcessing(true);
        try {
            await informCustomerOfJobQuotation(db, {
                jobId: document.jobId,
                quotationDocId: document.id,
                actorName: profile.displayName,
                actorUid: profile.uid,
            });
            toast({ title: "อัปเดตสถานะสำเร็จ", description: "งานซ่อมเปลี่ยนเป็นสถานะ 'รอลูกค้าอนุมัติ' แล้วค่ะ" });
            setInformConfirmOpen(false);
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error", description: e.message });
        } finally {
            setIsProcessing(false);
        }
    };

    if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
    if (error || !document || !effectiveCustomer) return <div className="p-12 text-center space-y-4"><AlertCircle className="mx-auto h-12 w-12 text-destructive"/><h2 className="text-xl font-bold">ไม่พบเอกสาร</h2><Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2"/> กลับ</Button></div>;

    const showMultiCopy = ['TAX_INVOICE', 'BILLING_NOTE', 'RECEIPT'].includes(document.docType);
    const showInformButton =
        document.docType === 'QUOTATION' &&
        linkedJob &&
        (document.status === 'FINAL' || document.status === 'OFFERED') &&
        (linkedJob.status === 'PENDING_CUSTOMER_INFORM' || linkedJob.status === 'WAITING_QUOTATION');

    const showResubmitQuotationButton =
        document.docType === 'QUOTATION' &&
        linkedJob?.status === 'WAITING_APPROVE' &&
        linkedJob?.quotationAwaitingOfficeResubmit === true &&
        linkedJob?.salesDocId === document.id;

    const handleResubmitQuotationToCustomer = async () => {
        if (!db || !document?.jobId || !profile) return;
        setIsProcessing(true);
        try {
            const jRef = doc(db, 'jobs', document.jobId);
            await updateDoc(jRef, {
                quotationAwaitingOfficeResubmit: false,
                lastActivityAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            await addDoc(collection(jRef, 'activities'), {
                text: `ส่งใบเสนอราคาให้ลูกค้าพิจารณาอีกครั้งแล้ว (โดย ${profile.displayName}) — ลูกค้าสามารถกดอนุมัติหรือไม่อนุมัติใน portal ได้`,
                userName: profile.displayName,
                userId: profile.uid,
                createdAt: serverTimestamp(),
            });
            toast({
                title: 'อัปเดตแล้ว',
                description: 'ลูกค้าจะเห็นปุ่มอนุมัติ/ไม่อนุมัติใน portal อีกครั้งหลังปรับใบเสนอราคาแล้ว',
            });
            setResubmitQuotationOpen(false);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast({ variant: 'destructive', title: 'ไม่สำเร็จ', description: msg });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-muted/20 py-8 print:p-0 print:bg-white overflow-x-hidden print:overflow-visible">
            <div className="max-w-[210mm] mx-auto space-y-6 print:space-y-0 print:m-0 print:max-w-none">
                <div className="flex flex-wrap justify-between items-center bg-background p-4 rounded-lg border shadow-sm print:hidden mx-4 md:mx-0 gap-4">
                    <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
                    <div className="flex flex-wrap gap-2">
                        {showInformButton && (
                            <Button 
                                onClick={() => setInformConfirmOpen(true)} 
                                disabled={isProcessing}
                                className="bg-pink-600 hover:bg-pink-700 text-white font-bold"
                            >
                                <CheckCircle2 className="mr-2 h-4 w-4"/>
                                ส่งเอกสาร/ยืนยันแจ้งลูกค้า
                            </Button>
                        )}
                        {showResubmitQuotationButton && (
                            <Button
                                type="button"
                                onClick={() => setResubmitQuotationOpen(true)}
                                disabled={isProcessing}
                                className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
                            >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                ส่งให้ลูกค้าพิจารณาใบเสนอราคาอีกครั้ง
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
                                {printChoice !== "ORIGINAL_ONLY" && (
                                    <>
                                        <div className="hidden print:block print-doc-page-break break-before-page" />
                                        <DocumentView document={document} customer={effectiveCustomer} labelSuffix="COPY" accountName={accountName} />
                                    </>
                                )}
                                {printChoice === "ORIGINAL_PLUS_2_COPIES" && (
                                    <>
                                        <div className="hidden print:block print-doc-page-break break-before-page" />
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

            <AlertDialog open={resubmitQuotationOpen} onOpenChange={(open) => !isProcessing && setResubmitQuotationOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>ส่งให้ลูกค้าพิจารณาใบเสนอราคาอีกครั้ง?</AlertDialogTitle>
                        <AlertDialogDescription className="text-sm space-y-2 pt-1">
                            <p>
                                ใช้เมื่อลูกค้าขอแก้ไขแล้ว และศูนย์ได้ปรับใบเสนอราคาในระบบเรียบร้อยแล้ว — ระบบจะเปิดปุ่ม &quot;อนุมัติ / ไม่อนุมัติ&quot; บนพอร์ทัลลูกค้าอีกครั้ง
                            </p>
                            <p className="text-xs text-muted-foreground">
                                โปรดตรวจสอบว่าได้แก้ไขรายการในใบเสนอราคานี้แล้วก่อนยืนยัน
                            </p>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>ยกเลิก</AlertDialogCancel>
                        <Button
                            type="button"
                            className="bg-amber-600 hover:bg-amber-700"
                            disabled={isProcessing}
                            onClick={() => void handleResubmitQuotationToCustomer()}
                        >
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            ยืนยัน
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={informConfirmOpen} onOpenChange={(open) => !isProcessing && setInformConfirmOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>ยืนยันการส่งเอกสาร / แจ้งลูกค้า</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3 text-sm text-muted-foreground pt-1">
                                {liveCustomerLoading ? (
                                    <p className="flex items-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                        กำลังตรวจสอบสถานะพอร์ทัลลูกค้า…
                                    </p>
                                ) : customerHasPortalAccount ? (
                                    <p>
                                        ลูกค้ารายนี้ลงทะเบียนพอร์ทัลแล้ว — เอกสารฉบับนี้จะปรากฏใน portal ของลูกค้าเมื่อบันทึกขั้นตอนนี้
                                    </p>
                                ) : (
                                    <p>
                                        ลูกค้ารายนี้ยังไม่ได้ลงทะเบียนพอร์ทัล — โปรดยืนยันว่าคุณได้โทรแจ้งลูกค้า หรือพิมพ์เอกสารส่งให้ลูกค้าทางช่องทางอื่นเรียบร้อยแล้ว
                                    </p>
                                )}
                                <p className="text-xs">เมื่อกดยืนยัน ระบบจะเปลี่ยนสถานะงานเป็น &quot;รอลูกค้าอนุมัติ&quot;</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>ยกเลิก</AlertDialogCancel>
                        <Button
                            type="button"
                            className="bg-pink-600 hover:bg-pink-700"
                            disabled={isProcessing || liveCustomerLoading}
                            onClick={() => void handleInformCustomer()}
                        >
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            ยืนยัน
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={isPrintOptionsOpen} onOpenChange={setIsPrintOptionsOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>พิมพ์{document.docType === 'TAX_INVOICE' ? 'ใบกำกับภาษี' : (document.docType === 'RECEIPT' ? 'ใบเสร็จรับเงิน' : 'ใบวางบิล')}</AlertDialogTitle>
                        <AlertDialogDescription>เลือกจำนวนสำเนาที่ต้องการพิมพ์</AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <RadioGroup
                            value={printChoice}
                            onValueChange={(v) =>
                                setPrintChoice(
                                    v as "ORIGINAL_ONLY" | "ORIGINAL_PLUS_1_COPY" | "ORIGINAL_PLUS_2_COPIES"
                                )
                            }
                        >
                            {document.docType === "RECEIPT" ? (
                                <>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_ONLY" id="rc0" />
                                        <Label htmlFor="rc0" className="cursor-pointer">
                                            ต้นฉบับ 1 ใบ
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_PLUS_1_COPY" id="rc1" />
                                        <Label htmlFor="rc1" className="cursor-pointer">
                                            ต้นฉบับ 1 ใบ + สำเนา 1 ใบ
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_PLUS_2_COPIES" id="rc2" />
                                        <Label htmlFor="rc2" className="cursor-pointer">
                                            ต้นฉบับ 1 ใบ + สำเนา 2 ใบ
                                        </Label>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_ONLY" id="c0" />
                                        <Label htmlFor="c0" className="cursor-pointer">
                                            ต้นฉบับอย่างเดียว (แนะนำเมื่อบันทึก PDF)
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_PLUS_1_COPY" id="c1" />
                                        <Label htmlFor="c1" className="cursor-pointer">
                                            ต้นฉบับ 1 + สำเนา 1
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="ORIGINAL_PLUS_2_COPIES" id="c2" />
                                        <Label htmlFor="c2" className="cursor-pointer">
                                            ต้นฉบับ 1 + สำเนา 2 (ออฟฟิศ/บัญชี)
                                        </Label>
                                    </div>
                                </>
                            )}
                        </RadioGroup>
                    </div>
                    <AlertDialogFooter><AlertDialogCancel>ยกเลิก</AlertDialogCancel><AlertDialogAction onClick={() => { setIsPrintOptionsOpen(false); setTimeout(() => triggerPrintWithDocTitle(document.docNo), 300); }}>ยืนยันและเปิดหน้าต่างพิมพ์</AlertDialogAction></AlertDialogFooter>
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
