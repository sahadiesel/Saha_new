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

/** ค้นหาลูกค้า — ชื่อ, เบอร์, ชื่อใบกำกับ, โปรไฟล์ภาษี, รายละเอียด (เดียวกับหน้าจัดการรายชื่อ) */
export function customerMatchesSearchTerm(customer: Customer, searchTerm: string): boolean {
  const trimmed = searchTerm.trim();
  if (!trimmed) return true;

  const lowercasedFilter = trimmed.toLowerCase();
  const qDigits = trimmed.replace(/\D/g, "");
  const phones = normalizeCustomerPhones(customer);
  const taxLabels = normalizeCustomerTaxProfiles(customer)
    .map((p) => `${p.label || ""} ${p.taxName} ${p.taxId}`)
    .join(" ")
    .toLowerCase();

  return (
    customer.name.toLowerCase().includes(lowercasedFilter) ||
    phones.some((p) => p.includes(trimmed) || (qDigits.length > 0 && p.replace(/\D/g, "").includes(qDigits))) ||
    (customer.taxName || "").toLowerCase().includes(lowercasedFilter) ||
    taxLabels.includes(lowercasedFilter) ||
    (customer.detail || "").toLowerCase().includes(lowercasedFilter)
  );
}

/** ข้อมูลจากการลงทะเบียนพอร์ทัล — ใช้เติมฟิลด์ใบกำกับภาษี (ชื่อ / เลขผู้เสียภาษี = เลขบัตรประชาชน / ที่อยู่ตามบัตร) */
export function getPortalRegistrationTaxDefaults(c: Customer): {
  taxName: string;
  taxId: string;
  taxAddress: string;
} | null {
  if (!String(c.authUid || "").trim()) return null;
  const taxName = String(c.name || "").trim();
  const taxId = String(c.nationalId || "").replace(/\D/g, "");
  const taxAddress = String(c.idCardAddress || "").trim();
  if (!taxName || !taxId || !taxAddress) return null;
  return { taxName, taxId, taxAddress };
}

/** เติมชุดภาษีชุดแรกจากข้อมูลลงทะเบียน เฉพาะช่องที่ว่าง — ถ้ายังไม่มีชุดใดเลยจะสร้างแถวใหม่ */
export function mergePortalTaxDefaultsIntoProfiles(
  profiles: CustomerTaxProfile[],
  portal: { taxName: string; taxId: string; taxAddress: string },
  primaryPhone: string
): CustomerTaxProfile[] {
  const pid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tp_${Date.now()}`;
  const phoneTrim = String(primaryPhone || "").trim();

  if (profiles.length === 0) {
    return [
      {
        id: pid,
        label: "",
        taxName: portal.taxName,
        taxAddress: portal.taxAddress,
        taxId: portal.taxId,
        ...(phoneTrim ? { taxPhone: phoneTrim } : {}),
        taxBranchType: "HEAD_OFFICE",
        taxBranchNo: "00000",
      },
    ];
  }

  const first = profiles[0];
  const mergedFirst: CustomerTaxProfile = {
    ...first,
    id: first.id || pid,
    label: first.label ?? "",
    taxName: first.taxName?.trim() || portal.taxName,
    taxAddress: first.taxAddress?.trim() || portal.taxAddress,
    taxId: first.taxId?.trim() || portal.taxId,
    taxBranchType: first.taxBranchType || "HEAD_OFFICE",
    taxBranchNo: first.taxBranchNo || "00000",
  };
  if (!mergedFirst.taxPhone?.trim() && phoneTrim) {
    mergedFirst.taxPhone = phoneTrim;
  }
  return [mergedFirst, ...profiles.slice(1)];
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
/** เลือกโปรไฟล์ที่ตรงกับบิลในแถวมากที่สุด (จาก customerSnapshot.taxProfileId) */
export function guessTaxProfileFromInvoices(
  invoices: { customerSnapshot?: { taxProfileId?: string } }[],
  profiles: CustomerTaxProfile[]
): CustomerTaxProfile | undefined {
  if (profiles.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const inv of invoices) {
    const pid = inv.customerSnapshot?.taxProfileId;
    if (pid && typeof pid === "string") {
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
  }
  let bestId: string | undefined;
  let bestN = -1;
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestN = n;
      bestId = id;
    }
  }
  if (bestId) {
    const found = profiles.find((p) => p.id === bestId);
    if (found) return found;
  }
  return profiles[0];
}

/** ทับชื่อ/ที่อยู่บน snapshot ใบวางบิลตามชุดภาษีที่ผู้ใช้เลือก (หลังรวมจากบิลต้นทาง) */
export function overlayTaxProfileForBillingNote(
  billingCustomer: Customer,
  profile: CustomerTaxProfile
): Customer {
  const phone =
    profile.taxPhone?.trim() ||
    billingCustomer.taxPhone?.trim() ||
    billingCustomer.phone;
  return {
    ...billingCustomer,
    useTax: true,
    taxName: profile.taxName.trim(),
    taxAddress: profile.taxAddress.trim(),
    taxId: profile.taxId.trim(),
    taxPhone: phone,
    taxBranchType: profile.taxBranchType || "HEAD_OFFICE",
    taxBranchNo:
      profile.taxBranchType === "BRANCH"
        ? profile.taxBranchNo || ""
        : "00000",
    taxProfileId: profile.id,
  };
}

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
