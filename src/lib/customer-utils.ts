import { collection, getDocs, type Firestore } from "firebase/firestore";
import type { Customer, CustomerTaxProfile } from "@/lib/types";

/** id สำหรับโปรไฟล์ภาษีที่ดึงจากฟิลด์แบน (ก่อนมี taxProfiles) */
export const LEGACY_TAX_PROFILE_ID = "legacy";

export function normalizePhoneDigits(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/** เบอร์หลัก + เบอร์เสริม — backward compat กับเอกสารที่มีแค่ phone */
export function normalizeCustomerPhones(c: Pick<Customer, "phone" | "phones">): string[] {
  const fromArray = Array.isArray(c.phones) ? c.phones.map((p) => String(p || "").trim()).filter(Boolean) : [];
  if (fromArray.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of fromArray) {
      const k = normalizePhoneDigits(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  }
  const p = String(c.phone || "").trim();
  return p ? [p] : [];
}

export function dedupePhoneList(phones: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phones) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const k = normalizePhoneDigits(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** รวมโปรไฟล์จาก taxProfiles หรือจากฟิลด์ tax* เดิมเป็นชุดเดียว */
export function normalizeCustomerTaxProfiles(c: Customer): CustomerTaxProfile[] {
  if (c.taxProfiles && c.taxProfiles.length > 0) {
    return c.taxProfiles.map((p) => ({
      ...p,
      id: p.id || LEGACY_TAX_PROFILE_ID,
      taxBranchType: p.taxBranchType || "HEAD_OFFICE",
      taxBranchNo: p.taxBranchNo ?? (p.taxBranchType === "BRANCH" ? "" : "00000"),
    }));
  }
  if (
    c.useTax &&
    (c.taxName?.trim() || c.taxId?.trim() || c.taxAddress?.trim())
  ) {
    return [
      {
        id: LEGACY_TAX_PROFILE_ID,
        label: "",
        taxName: c.taxName?.trim() || "",
        taxAddress: c.taxAddress?.trim() || "",
        taxId: c.taxId?.trim() || "",
        taxPhone: c.taxPhone?.trim(),
        taxBranchType: c.taxBranchType || "HEAD_OFFICE",
        taxBranchNo: c.taxBranchNo || "00000",
      },
    ];
  }
  return [];
}

export function isTaxProfileComplete(p: CustomerTaxProfile): boolean {
  const branchOk =
    p.taxBranchType !== "BRANCH" ||
    (!!p.taxBranchNo && String(p.taxBranchNo).length === 5);
  return !!(
    p.taxName?.trim() &&
    p.taxAddress?.trim() &&
    p.taxId?.trim() &&
    branchOk
  );
}

export function getInvoiceableTaxProfiles(c: Customer): CustomerTaxProfile[] {
  if (!c.useTax) return [];
  return normalizeCustomerTaxProfiles(c).filter(isTaxProfileComplete);
}

/** ลูกค้าพร้อมออกใบกำกับอย่างน้อย 1 นาม */
export function customerCanIssueTaxInvoice(c: Customer): boolean {
  return c.useTax && getInvoiceableTaxProfiles(c).length > 0;
}

export async function findPhoneConflictAgainstFirestore(
  db: Firestore,
  phones: string[],
  excludeCustomerId?: string
): Promise<{ customer: Customer; phone: string } | null> {
  const snap = await getDocs(collection(db, "customers"));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer));
  return findCustomerPhoneConflict(all, phones, excludeCustomerId);
}

export function findCustomerPhoneConflict(
  allCustomers: Customer[],
  phones: string[],
  excludeCustomerId?: string
): { customer: Customer; phone: string } | null {
  const normalizedWant = dedupePhoneList(phones).map(normalizePhoneDigits);
  if (normalizedWant.length === 0) return null;
  const wantSet = new Set(normalizedWant);
  for (const cust of allCustomers) {
    if (excludeCustomerId && cust.id === excludeCustomerId) continue;
    const theirs = normalizeCustomerPhones(cust).map(normalizePhoneDigits);
    for (const w of wantSet) {
      if (theirs.includes(w)) {
        return {
          customer: cust,
          phone: normalizeCustomerPhones(cust).find(
            (p) => normalizePhoneDigits(p) === w
          )!,
        };
      }
    }
  }
  return null;
}

/** snapshot สำหรับบันทึกในเอกสาร — ผูกกับโปรไฟล์ภาษีที่เลือก */
export function buildCustomerSnapshotForTaxInvoice(
  c: Customer,
  profile: CustomerTaxProfile
): Customer {
  const phones = normalizeCustomerPhones(c);
  const primary = phones[0] || c.phone;
  return {
    ...c,
    phone: primary,
    phones,
    useTax: true,
    taxName: profile.taxName.trim(),
    taxAddress: profile.taxAddress.trim(),
    taxId: profile.taxId.trim(),
    taxPhone: profile.taxPhone?.trim() || primary,
    taxBranchType: profile.taxBranchType || "HEAD_OFFICE",
    taxBranchNo:
      profile.taxBranchType === "BRANCH"
        ? profile.taxBranchNo || ""
        : "00000",
    taxProfileId: profile.id,
  };
}
