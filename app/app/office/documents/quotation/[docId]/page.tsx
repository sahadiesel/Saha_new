"use client";

import { useMemo, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { doc } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Printer, FileText, User, Calendar, Loader2, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat } from "@/lib/date-utils";
import type { Document } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function QuotationDetailPageContent() {
    const { docId } = useParams();
    const router = useRouter();
    const { db } = useFirebase();

    const docRef = useMemo(() => (db && typeof docId === 'string' ? doc(db, 'documents', docId) : null), [db, docId]);
    const { data: document, isLoading, error } = useDoc<Document>(docRef);

    const isCancelled = document?.status === 'CANCELLED';

    if (isLoading) return <div className="space-y-6"><Skeleton className="h-12 w-1/3"/><Skeleton className="h-64 w-full"/><Skeleton className="h-96 w-full"/></div>;
    
    if (error || !document || document.docType !== 'QUOTATION') {
        return (
            <div className="p-8 text-center space-y-4">
                <AlertCircle className="mx-auto h-12 w-12 text-destructive"/>
                <h2 className="text-xl font-bold">ไม่พบข้อมูลใบเสนอราคา</h2>
                <p className="text-muted-foreground">เอกสารที่ต้องการอาจไม่มีอยู่ในระบบ</p>
                <Button variant="outline" onClick={() => router.push('/app/office/documents/quotation')}><ArrowLeft className="mr-2 h-4 w-4"/> กลับไปหน้ารายการ</Button>
            </div>
        );
    }

    const formatCurrency = (val: number) => (val ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4"/> ย้อนกลับ
                </Button>
                <Button asChild variant="default" size="sm">
                    <Link href={`/app/office/documents/${docId}`}>
                        <Eye className="mr-2 h-4 w-4"/> พรีวิว / พิมพ์เอกสาร
                    </Link>
                </Button>
            </div>

            {isCancelled && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>เอกสารนี้ถูกยกเลิกแล้ว</AlertTitle>
                    <AlertDescription>ยกเลิกเมื่อ: {safeFormat(document.updatedAt, 'PPpp')}</AlertDescription>
                </Alert>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>รายการสินค้า / บริการ</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-12 text-center">#</TableHead>
                                            <TableHead>รายละเอียด</TableHead>
                                            <TableHead className="w-24 text-right">จำนวน</TableHead>
                                            <TableHead className="w-32 text-right">ราคา/หน่วย</TableHead>
                                            <TableHead className="w-32 text-right">รวมเงิน</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {document.items.map((item, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                                                <TableCell className="font-medium">{item.description}</TableCell>
                                                <TableCell className="text-right">{item.quantity}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.total)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            
                            <div className="flex flex-col items-end gap-2 mt-6">
                                <div className="flex justify-between w-full max-w-[300px] text-sm">
                                    <span className="text-muted-foreground">รวมเป็นเงิน:</span>
                                    <span>{formatCurrency(document.subtotal)}</span>
                                </div>
                                <div className="flex justify-between w-full max-w-[300px] text-sm text-destructive">
                                    <span className="text-muted-foreground">ส่วนลด:</span>
                                    <span>- {formatCurrency(document.discountAmount || 0)}</span>
                                </div>
                                <div className="flex justify-between w-full max-w-[300px] text-sm font-medium">
                                    <span className="text-muted-foreground">ยอดหลังหักส่วนลด:</span>
                                    <span>{formatCurrency(document.net)}</span>
                                </div>
                                {document.withTax && (
                                    <div className="flex justify-between w-full max-w-[300px] text-sm">
                                        <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม 7%:</span>
                                        <span>{formatCurrency(document.vatAmount || 0)}</span>
                                    </div>
                                )}
                                <Separator className="my-1 w-full max-w-[300px]" />
                                <div className="flex justify-between w-full max-w-[300px] text-lg font-bold text-primary">
                                    <span>ยอดสุทธิรวม:</span>
                                    <span>{formatCurrency(document.grandTotal)} บาท</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {document.notes && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">หมายเหตุ</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="whitespace-pre-wrap text-sm">{document.notes}</p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">ข้อมูลเอกสาร</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-full text-primary"><FileText className="h-4 w-4"/></div>
                                <div>
                                    <p className="text-xs text-muted-foreground">เลขที่เอกสาร</p>
                                    <p className="font-bold font-mono">{document.docNo}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-full text-primary"><Calendar className="h-4 w-4"/></div>
                                <div>
                                    <p className="text-xs text-muted-foreground">วันที่ออกเอกสาร</p>
                                    <p className="font-medium">{safeFormat(new Date(document.docDate), 'dd/MM/yyyy')}</p>
                                </div>
                            </div>
                            <Separator />
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">สถานะ</p>
                                <Badge variant={isCancelled ? 'destructive' : 'default'} className="w-full justify-center py-1">
                                    {isCancelled ? 'ยกเลิกแล้ว' : 'ปกติ'}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">ข้อมูลลูกค้า</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-primary/10 rounded-full text-primary mt-1"><User className="h-4 w-4"/></div>
                                <div>
                                    <p className="font-bold text-base">{document.customerSnapshot.name}</p>
                                    <p className="text-sm text-muted-foreground">{document.customerSnapshot.phone}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export default function QuotationDetailPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
            <QuotationDetailPageContent />
        </Suspense>
    );
}
