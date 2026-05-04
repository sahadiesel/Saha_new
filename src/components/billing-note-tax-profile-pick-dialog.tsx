"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CustomerTaxProfile } from "@/lib/types";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: CustomerTaxProfile[];
  selectedProfileId: string;
  onSelectedProfileIdChange: (id: string) => void;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
};

export function BillingNoteTaxProfilePickDialog({
  open,
  onOpenChange,
  profiles,
  selectedProfileId,
  onSelectedProfileIdChange,
  onConfirm,
  confirming,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>เลือกชื่อ / ที่อยู่บนใบวางบิล</AlertDialogTitle>
          <AlertDialogDescription>
            ลูกค้ามีหลายชุดข้อมูลภาษี — เลือกชุดที่ต้องการแสดงบนใบวางบิล (ระบบเลือกชุดที่ตรงกับบิลในแถวเป็นค่าเริ่มต้น)
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          value={selectedProfileId}
          onValueChange={onSelectedProfileIdChange}
          className="gap-3"
        >
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem value={p.id} id={`bn-tax-${p.id}`} className="mt-1 shrink-0" />
              <Label htmlFor={`bn-tax-${p.id}`} className="flex-1 cursor-pointer space-y-1 font-normal leading-snug">
                <div className="font-semibold text-sm text-foreground">
                  {p.label?.trim() ? `${p.label.trim()} · ` : ""}
                  {p.taxName}
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">{p.taxAddress}</div>
                <div className="text-xs text-muted-foreground">
                  เลขประจำตัวผู้เสียภาษี {p.taxId}
                  {p.taxBranchType === "BRANCH" && p.taxBranchNo
                    ? ` · สาขา ${p.taxBranchNo}`
                    : p.taxBranchType === "HEAD_OFFICE"
                      ? " · สำนักงานใหญ่"
                      : ""}
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={confirming}>ยกเลิก</AlertDialogCancel>
          <Button type="button" disabled={confirming} onClick={() => void onConfirm()}>
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังสร้าง...
              </>
            ) : (
              "สร้างใบวางบิล"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
