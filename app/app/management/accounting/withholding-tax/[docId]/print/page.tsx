"use client";

import { useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, type DocumentReference } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Document as DocumentType } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

export const dynamic = 'force-dynamic';

export default function WhtPrintPage() {
    const { docId } = useParams();
    const router = useRouter();
    const { db } = useFirebase();

    const docRef = useMemo((): DocumentReference<DocumentType> | null => {
      if (!db || typeof docId !== "string") return null;
      return doc(db, "documents", docId) as DocumentReference<DocumentType>;
    }, [db, docId]);
    const { data: document, isLoading, error } = useDoc<DocumentType>(docRef);

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
        if (document && !isLoading) {
            // Short delay to ensure styles and font are loaded before printing
            const timer = setTimeout(() => {
                // window.print(); // Uncomment if auto-print is desired
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [document, isLoading]);

    if (isLoading) return <Skeleton className="h-screen w-full" />;
    
    if (error || !document) {
        return (
            <div className="p-12 text-center space-y-4">
                <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
                <h1 className="text-xl font-bold">ไม่พบเอกสาร</h1>
                <p className="text-muted-foreground">ไม่พบข้อมูลหนังสือรับรองหัก ณ ที่จ่าย หรือคุณไม่มีสิทธิ์เข้าถึง</p>
                <Button onClick={() => router.back()} variant="outline"><ArrowLeft className="mr-2 h-4 w-4"/> กลับ</Button>
            </div>
        );
    }

    const getTaxIdDigits = (taxId: string | undefined) => {
        return (taxId || '').replace(/\D/g, '').split('');
    };

    const taxIdPayer = getTaxIdDigits(document.payerSnapshot?.taxId);
    const taxIdPayee = getTaxIdDigits(document.payeeSnapshot?.taxId);

    const isItem5 = document.incomeTypeCode === 'ITEM5' || !document.incomeTypeCode;

    return (
        <div className="min-h-screen bg-muted/20 pb-10">
            <style jsx global>{`
                @media print {
                    @page { 
                        size: A4; 
                        margin: 0; 
                    }
                    body { 
                        margin: 0; 
                        padding: 0; 
                        background: white;
                    }
                    .print-hidden { 
                        display: none !important; 
                    }
                    .document-container {
                        box-shadow: none !important;
                        border: none !important;
                        margin: 0 !important;
                    }
                }
                .wht-form-wrapper {
                    position: relative;
                    width: 210mm;
                    height: 297mm;
                    margin: 0 auto;
                    background-color: white;
                    overflow: hidden;
                }
                .wht-form-bg {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image: url('/forms/wht50twi.png');
                    background-size: contain;
                    background-repeat: no-repeat;
                    z-index: 0;
                }
                .field {
                    position: absolute;
                    font-size: 13px;
                    font-family: sans-serif;
                    z-index: 10;
                    white-space: nowrap;
                }
                .digit-box {
                    display: flex;
                    position: absolute;
                    z-index: 10;
                }
                .digit {
                    width: 5.4mm;
                    text-align: center;
                    font-weight: bold;
                    font-size: 14px;
                }
            `}</style>

            <div className="print-hidden sticky top-0 bg-background/95 backdrop-blur border-b p-4 flex items-center justify-between z-50 mb-6 shadow-sm">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="sm" onClick={() => router.back()}>
                        <ArrowLeft className="mr-2 h-4 w-4"/> กลับ
                    </Button>
                    <div>
                        <h1 className="font-bold">พิมพ์หนังสือรับรองหัก ณ ที่จ่าย</h1>
                        <p className="text-xs text-muted-foreground">เลขที่เอกสาร: {document.docNo}</p>
                    </div>
                </div>
                <Button size="sm" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4"/> พิมพ์เอกสาร (Ctrl+P)
                </Button>
            </div>

            <div className="document-container wht-form-wrapper shadow-2xl border">
                <div className="wht-form-bg" />
                <div className="field font-bold" style={{ top: '42.5mm', left: '168mm' }}>{document.docNo}</div>
                <div className="digit-box" style={{ top: '58.5mm', left: '128.5mm', gap: '1.45mm' }}>
                    {taxIdPayer.map((d, i) => <span key={i} className="digit">{d}</span>)}
                </div>
                <div className="field" style={{ top: '65.5mm', left: '32mm' }}>{document.payerSnapshot?.name}</div>
                <div className="field text-xs" style={{ top: '72.5mm', left: '32mm', width: '150mm', whiteSpace: 'normal', lineHeight: 1.1 }}>
                    {document.payerSnapshot?.address}
                </div>
                <div className="digit-box" style={{ top: '88.5mm', left: '128.5mm', gap: '1.45mm' }}>
                    {taxIdPayee.map((d, i) => <span key={i} className="digit">{d}</span>)}
                </div>
                <div className="field font-semibold" style={{ top: '95.5mm', left: '32mm' }}>{document.payeeSnapshot?.name}</div>
                <div className="field text-xs" style={{ top: '102.5mm', left: '32mm', width: '150mm', whiteSpace: 'normal', lineHeight: 1.1 }}>
                    {document.payeeSnapshot?.address}
                </div>
                <div className="field font-bold" style={{ top: '118.5mm', left: '103.5mm' }}>/</div>
                <div className="field text-xs" style={{ top: '118.5mm', left: '115mm' }}>{document.pndSequenceNo}</div>
                {isItem5 && (
                    <>
                        <div className="field font-bold" style={{ top: '192.5mm', left: '24mm' }}>/</div>
                        <div className="field" style={{ top: '192.5mm', left: '115mm' }}>
                            {document.paidMonth ? `${String(document.paidMonth).padStart(2, '0')}/${document.paidYear}` : safeFormat(new Date(document.docDate), 'MM/yyyy')}
                        </div>
                        <div className="field text-right font-mono" style={{ top: '192.5mm', left: '142mm', width: '32mm' }}>
                            {document.paidAmountGross?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="field text-right font-mono" style={{ top: '192.5mm', left: '176mm', width: '22mm' }}>
                            {document.withholdingAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                    </>
                )}
                <div className="field text-right font-bold" style={{ top: '232.5mm', left: '142mm', width: '32mm' }}>
                    {document.paidAmountGross?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="field text-right font-bold" style={{ top: '232.5mm', left: '176mm', width: '22mm' }}>
                    {document.withholdingAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="field text-center font-semibold" style={{ top: '270.5mm', left: '125mm', width: '60mm' }}>
                    {document.senderName}
                    <div className="text-xs font-normal mt-1">{safeFormat(new Date(document.docDate), 'dd MMMM yyyy')}</div>
                </div>
            </div>
        </div>
    );
}
