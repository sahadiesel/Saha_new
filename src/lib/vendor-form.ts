import * as z from "zod";
import { deleteField, type FieldValue } from "firebase/firestore";
import { VENDOR_TYPES } from "@/lib/constants";
import type { Vendor } from "@/lib/types";

export function normalizeVendorTaxId(value: string | undefined): string {
  return (value || "").replace(/\D/g, "");
}

export const vendorFormSchema = z
  .object({
    shortName: z.string().min(1, "กรุณากรอกชื่อย่อ").max(15, "ชื่อย่อต้องไม่เกิน 15 ตัวอักษร"),
    companyName: z.string().min(1, "กรุณากรอกชื่อร้าน/บริษัท"),
    vendorType: z.enum(VENDOR_TYPES),
    address: z.string().optional(),
    phone: z.string().min(9, "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (อย่างน้อย 9 หลัก)"),
    contactName: z.string().optional(),
    contactPhone: z.string().optional(),
    email: z.string().email({ message: "อีเมลไม่ถูกต้อง" }).optional().or(z.literal("")),
    hasTax: z.boolean(),
    taxId: z.string().optional(),
    taxBranchType: z.enum(["HEAD_OFFICE", "BRANCH"]).optional(),
    taxBranchNo: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hasTax) {
      const digits = normalizeVendorTaxId(data.taxId);
      if (digits.length !== 13) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก",
          path: ["taxId"],
        });
      }
      if (!data.taxBranchType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณาเลือกสำนักงานใหญ่หรือสาขา",
          path: ["taxBranchType"],
        });
      } else if (data.taxBranchType === "BRANCH") {
        const b = (data.taxBranchNo || "").trim();
        if (!/^\d{5}$/.test(b)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "กรุณากรอกรหัสสาขา 5 หลัก",
            path: ["taxBranchNo"],
          });
        }
      }
    }

    if (data.vendorType === "CONTRACTOR") {
      if (!data.hasTax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ผู้รับเหมาต้องเลือก "มีภาษี" และกรอกข้อมูลภาษีให้ครบ',
          path: ["hasTax"],
        });
      }
      if (!data.address || data.address.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณากรอกที่อยู่สำหรับผู้รับเหมา",
          path: ["address"],
        });
      }
    }
  });

export type VendorFormData = z.infer<typeof vendorFormSchema>;

export const vendorFormDefaultValues: VendorFormData = {
  shortName: "",
  companyName: "",
  vendorType: "SUPPLIER",
  address: "",
  phone: "",
  contactName: "",
  contactPhone: "",
  email: "",
  hasTax: false,
  taxId: "",
  taxBranchType: undefined,
  taxBranchNo: "",
  notes: "",
};

/** แปลง Vendor จาก Firestore เป็นค่าเริ่มต้นของฟอร์ม */
export function vendorToFormDefaults(v: {
  shortName: string;
  companyName: string;
  vendorType?: (typeof VENDOR_TYPES)[number];
  address?: string;
  phone?: string;
  contactName?: string;
  contactPhone?: string;
  email?: string;
  hasTax?: boolean;
  taxId?: string;
  taxBranchType?: "HEAD_OFFICE" | "BRANCH";
  taxBranchNo?: string;
  notes?: string;
}): VendorFormData {
  const legacyHasTax = normalizeVendorTaxId(v.taxId).length === 13;
  const hasTax = v.hasTax === true ? true : v.hasTax === false ? false : legacyHasTax;
  return {
    shortName: v.shortName,
    companyName: v.companyName,
    vendorType: v.vendorType || "SUPPLIER",
    address: v.address || "",
    phone: v.phone || "",
    contactName: v.contactName || "",
    contactPhone: v.contactPhone || "",
    email: v.email || "",
    hasTax,
    taxId: v.taxId || "",
    taxBranchType: hasTax ? v.taxBranchType || (legacyHasTax ? "HEAD_OFFICE" : undefined) : undefined,
    taxBranchNo: hasTax && v.taxBranchType === "BRANCH" ? v.taxBranchNo || "" : "",
    notes: v.notes || "",
  };
}

type FirestoreVendorPayload = Record<string, string | boolean | FieldValue | undefined>;

export function vendorFormValuesToFirestore(
  values: VendorFormData,
  options: { mode: "create" | "update" }
): FirestoreVendorPayload {
  const base: FirestoreVendorPayload = {
    shortName: values.shortName.toUpperCase(),
    companyName: values.companyName,
    vendorType: values.vendorType,
    address: values.address?.trim() || undefined,
    phone: values.phone.trim(),
    contactName: values.contactName?.trim() || undefined,
    contactPhone: values.contactPhone?.trim() || undefined,
    email: values.email?.trim() || undefined,
    notes: values.notes?.trim() || undefined,
  };

  const clearTax =
    options.mode === "update"
      ? {
          taxId: deleteField(),
          taxBranchType: deleteField(),
          taxBranchNo: deleteField(),
        }
      : {};

  if (!values.hasTax) {
    return { ...base, hasTax: false, ...clearTax };
  }

  const taxId = normalizeVendorTaxId(values.taxId);
  const taxBranchType = values.taxBranchType!;
  const out: FirestoreVendorPayload = {
    ...base,
    hasTax: true,
    taxId,
    taxBranchType,
  };

  if (taxBranchType === "BRANCH") {
    out.taxBranchNo = (values.taxBranchNo || "").trim();
  } else if (options.mode === "update") {
    out.taxBranchNo = deleteField();
  }

  return out;
}

/** snapshot บนเอกสารซื้อ — สอดคล้องกับ PurchaseDoc.vendorSnapshot */
export function buildPurchaseVendorSnapshot(
  vendor: Pick<Vendor, "shortName" | "companyName" | "address" | "taxId" | "hasTax" | "taxBranchType" | "taxBranchNo">
) {
  const hasTax = vendor.hasTax === true ? true : vendor.hasTax === false ? false : normalizeVendorTaxId(vendor.taxId).length === 13;
  const taxId = hasTax ? normalizeVendorTaxId(vendor.taxId) : "";
  return {
    shortName: vendor.shortName,
    companyName: vendor.companyName,
    taxId,
    address: vendor.address || "",
    hasTax,
    ...(hasTax && vendor.taxBranchType ? { taxBranchType: vendor.taxBranchType } : {}),
    ...(hasTax && vendor.taxBranchType === "BRANCH" && vendor.taxBranchNo
      ? { taxBranchNo: vendor.taxBranchNo }
      : {}),
  };
}
