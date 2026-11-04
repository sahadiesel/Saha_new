
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Document, Customer } from '@/lib/types';
import {
  billingInvoiceHeadingName,
  billingPerInvoiceSeparateKey,
} from '@/lib/billing-note-batch-helpers';
import { AlertTriangle, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface EditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
  invoices: Document[];
  initialOverrides: {
    deferred: Record<string, boolean>;
    separate: Record<string, string>;
  };
  initialTitles?: Record<string, string>;
  onSave: (
    customerId: string,
    deferred: Record<string, boolean>,
    separate: Record<string, string>,
    touchedInvoiceIds: string[],
    titles: Record<string, string>
  ) => void;
}

const formatCurrency = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BillingNoteBatchEditDialog({
  isOpen,
  onClose,
  customer,
  invoices,
  initialOverrides,
  initialTitles,
  onSave,
}: EditDialogProps) {
  const [invoiceStates, setInvoiceStates] = useState<
    Record<string, { group: 'include' | 'defer' | 'separate'; billName: string }>
  >({});

  useEffect(() => {
    const initialStates: Record<string, { group: 'include' | 'defer' | 'separate'; billName: string }> = {};
    invoices.forEach((inv) => {
      let group: 'include' | 'defer' | 'separate' = 'include';
      if (initialOverrides.deferred[inv.id]) group = 'defer';
      else if (initialOverrides.separate[inv.id]) group = 'separate';
      const savedTitle = String(initialTitles?.[inv.id] || '').trim();
      initialStates[inv.id] = {
        group,
        billName: savedTitle || billingInvoiceHeadingName(inv),
      };
    });
    setInvoiceStates(initialStates);
  }, [invoices, isOpen, initialOverrides, initialTitles]);

  const handleSave = () => {
    const deferred: Record<string, boolean> = {};
    const separate: Record<string, string> = {};
    const titles: Record<string, string> = {};

    Object.entries(invoiceStates).forEach(([invoiceId, state]) => {
      if (state.group === 'defer') {
        deferred[invoiceId] = true;
      } else if (state.group === 'separate') {
        separate[invoiceId] = billingPerInvoiceSeparateKey(invoiceId);
        const invoice = invoices.find((inv) => inv.id === invoiceId);
        titles[invoiceId] = (state.billName || '').trim() || (invoice ? billingInvoiceHeadingName(invoice) : '');
      }
    });

    onSave(customer.id, deferred, separate, invoices.map((i) => i.id), titles);
    onClose();
  };

  const splitEachInvoice = () => {
    setInvoiceStates((prev) => {
      const next = { ...prev };
      for (const inv of invoices) {
        next[inv.id] = {
          group: 'separate',
          billName: prev[inv.id]?.billName || billingInvoiceHeadingName(inv),
        };
      }
      return next;
    });
  };

  const separatePlanCount = useMemo(() => {
    let included = 0;
    let separateNotes = 0;
    for (const inv of invoices) {
      const state = invoiceStates[inv.id];
      if (!state || state.group === 'defer') continue;
      if (state.group === 'include') included += 1;
      else separateNotes += 1;
    }
    return { included, separateNotes };
  }, [invoiceStates, invoices]);

  const docNoCount = useMemo(() => {
    const counts: Record<string, number> = {};
    invoices.forEach(inv => {
      counts[inv.docNo] = (counts[inv.docNo] || 0) + 1;
    });
    return counts;
  }, [invoices]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>จัดการรายการบิล: {customer.taxName || customer.name}</DialogTitle>
          <DialogDescription>
            <span className="block space-y-1 text-left">
              <span className="block">
                <strong>เลื่อน</strong> — ย้ายบิลไปแสดงในเดือนถัดไป (จะไม่โผล่ในเดือนนี้อีก)
              </span>
              <span className="block">
                <strong>แยก</strong> — บิลนี้ได้ใบวางบิลของตัวเอง 1 ใบ ชื่อบนใบกำหนดได้คนละชื่อ
              </span>
              <span className="block">
                ชื่อที่พิมพ์ไม่ทำให้บิลไปรวมกัน อยากรวมหลายบิลในใบเดียวให้เลือก &quot;รวม&quot;
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            ใบหลัก {separatePlanCount.included} รายการ · แยกเป็น {separatePlanCount.separateNotes} ใบวางบิล
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={splitEachInvoice}>
            แยกทุกใบเป็นคนละใบวางบิล
          </Button>
        </div>
        
        <TooltipProvider>
          <ScrollArea className="max-h-[60vh] pr-4">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead>เลขที่เอกสาร</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead className="text-right">ยอดเงิน</TableHead>
                  <TableHead className="pl-8">การดำเนินการ (Action)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(invoice => {
                  const isDuplicate = docNoCount[invoice.docNo] > 1;
                  const currentName = customer.taxName || customer.name;
                  const invoiceName = invoice.customerSnapshot?.taxName || invoice.customerSnapshot?.name;
                  const nameMismatch = invoiceName && invoiceName !== currentName;

                  return (
                    <TableRow key={invoice.id} className={cn(invoiceStates[invoice.id]?.group === 'defer' && "bg-muted/30 opacity-70")}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{invoice.docNo}</span>
                            {(isDuplicate || nameMismatch) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isDuplicate && <p>• พบเลขที่บิลนี้ซ้ำกันในระบบ</p>}
                                  {nameMismatch && <p>• ชื่อในบิลไม่ตรงกับชื่อปัจจุบันลูกค้า</p>}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <Badge variant="outline" className="w-fit text-[8px] h-3 px-1">{invoice.docType === 'TAX_INVOICE' ? 'กำกับภาษี' : 'ใบส่งของ'}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{invoice.docDate}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatCurrency(invoice.grandTotal)}</TableCell>
                      <TableCell className="pl-8">
                        <div className="flex items-center gap-4">
                          <RadioGroup
                            value={invoiceStates[invoice.id]?.group}
                            onValueChange={(value) =>
                              setInvoiceStates(prev => ({
                                ...prev,
                                [invoice.id]: {
                                  ...prev[invoice.id],
                                  group: value as 'include' | 'defer' | 'separate',
                                  billName:
                                    prev[invoice.id]?.billName || billingInvoiceHeadingName(invoice),
                                },
                              }))
                            }
                            className="flex space-x-2"
                          >
                            <div className="flex items-center space-x-1.5">
                              <RadioGroupItem value="include" id={`include-${invoice.id}`} />
                              <Label htmlFor={`include-${invoice.id}`} className="text-xs cursor-pointer">รวม</Label>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              <RadioGroupItem value="defer" id={`defer-${invoice.id}`} />
                              <Label htmlFor={`defer-${invoice.id}`} className="text-xs cursor-pointer">เลื่อน (Defer)</Label>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              <RadioGroupItem value="separate" id={`separate-${invoice.id}`} />
                              <Label htmlFor={`separate-${invoice.id}`} className="text-xs cursor-pointer text-primary font-bold">แยก (Split)</Label>
                            </div>
                          </RadioGroup>
                          
                          {invoiceStates[invoice.id]?.group === 'separate' && (
                            <div className="flex items-center gap-2 animate-in slide-in-from-left-1 duration-200">
                              <Input
                                placeholder="ชื่อบนใบวางบิล"
                                className="h-8 w-64 text-xs"
                                value={invoiceStates[invoice.id]?.billName || ''}
                                onChange={(e) =>
                                  setInvoiceStates((prev) => ({
                                    ...prev,
                                    [invoice.id]: { ...prev[invoice.id], billName: e.target.value },
                                  }))
                                }
                              />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>ชื่อนี้พิมพ์บนใบวางบิลของบิลนี้ใบเดียว ไม่รวมกับบิลอื่น</TooltipContent>
                              </Tooltip>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </TooltipProvider>

        <DialogFooter className="bg-muted/20 p-4 -mx-6 -mb-6 border-t mt-4">
          <Button variant="outline" onClick={onClose}>ยกเลิก (Cancel)</Button>
          <Button onClick={handleSave}>บันทึกแผนการวางบิล (Save Plans)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
