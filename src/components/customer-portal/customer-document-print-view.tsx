"use client";

import type { Document } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat, APP_DATE_FORMAT } from "@/lib/date-utils";
import { docStatusLabel } from "@/lib/ui-labels";

const DOC_TITLE: Partial<Record<Document["docType"], string>> = {
  QUOTATION: "ใบเสนอราคา",
  DELIVERY_NOTE: "ใบส่งของชั่วคราว",
  TAX_INVOICE: "ใบกำกับภาษี",
  RECEIPT: "ใบเสร็จรับเงิน",
  CREDIT_NOTE: "ใบลดหนี้",
  DEBIT_NOTE: "ใบเพิ่มหนี้",
  BILLING_NOTE: "ใบวางบิล",
  WITHDRAWAL: "ใบเบิกอะไหล่",
};

/** มุมมองอ่านอย่างเดียว + พิมพ์ — ใช้ในพอร์ทัลลูกค้า */
export function CustomerDocumentPrintView({ document: d }: { document: Document }) {
  const title = DOC_TITLE[d.docType] || d.docType;
  const customerName = d.customerSnapshot?.taxName || d.customerSnapshot?.name || "—";

  return (
    <div className="printable-document mx-auto max-w-[210mm] border bg-white p-6 text-black shadow-sm print:border-0 print:shadow-none">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl font-bold text-primary">{title}</h1>
          <p className="text-sm mt-1">
            เลขที่: <span className="font-mono font-bold">{d.docNo}</span>
          </p>
          <p className="text-sm">วันที่: {safeFormat(new Date(d.docDate), APP_DATE_FORMAT)}</p>
          <p className="text-sm">สถานะ: {docStatusLabel(d.status, d.docType)}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{(d.storeSnapshot?.taxName || d.storeSnapshot?.informalName) ?? "Sahadiesel"}</p>
          {d.storeSnapshot?.phone ? <p>โทร {d.storeSnapshot.phone}</p> : null}
        </div>
      </div>

      <div className="mb-6 rounded-md border p-4 text-sm">
        <p className="font-bold text-slate-700">ลูกค้า / ผู้ติดต่อ</p>
        <p className="font-medium">{customerName}</p>
        {d.customerSnapshot?.phone ? <p>โทร {d.customerSnapshot.phone}</p> : null}
      </div>

      <Table className="border">
        <TableHeader>
          <TableRow className="bg-slate-100">
            <TableHead className="w-10 text-center">#</TableHead>
            <TableHead>รายการ</TableHead>
            <TableHead className="w-24 text-right">จำนวน</TableHead>
            <TableHead className="w-28 text-right">ราคา/หน่วย</TableHead>
            <TableHead className="w-32 text-right">จำนวนเงิน</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(d.items || []).map((line, idx) => (
            <TableRow key={idx}>
              <TableCell className="text-center">{idx + 1}</TableCell>
              <TableCell className="whitespace-pre-wrap">{line.description}</TableCell>
              <TableCell className="text-right">{line.quantity}</TableCell>
              <TableCell className="text-right">
                {(line.unitPrice ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="text-right font-medium">
                {(line.total ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span>ยอดก่อนภาษี</span>
            <span className="font-mono">{(d.net ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
          </div>
          {d.withTax ? (
            <div className="flex justify-between">
              <span>ภาษี</span>
              <span className="font-mono">{(d.vatAmount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <span>ยอดสุทธิ</span>
            <span className="font-mono text-primary">{(d.grandTotal ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {d.notes ? (
        <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm whitespace-pre-wrap border">
          <span className="font-bold">หมายเหตุ: </span>
          {d.notes}
        </div>
      ) : null}
    </div>
  );
}
