/** สอดคล้องกับ src/lib/customer-auth-phone และ customer-utils (ฝั่งแอป) */

export function normalizePhoneDigits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

export function customerDocumentIdFromPhone(raw: string): string {
  let d = normalizePhoneDigits(String(raw || "").trim());
  if (!d) return "";
  if (d.startsWith("66") && d.length >= 11) {
    d = "0" + d.slice(2);
  }
  if (!d.startsWith("0") && d.length === 9) {
    d = "0" + d;
  }
  return d;
}

export function phoneSearchTokens(raw: string): string[] {
  const rawTrim = String(raw || "").trim();
  const docId = customerDocumentIdFromPhone(rawTrim);
  const digits = normalizePhoneDigits(rawTrim);
  return Array.from(new Set([docId, rawTrim, digits].filter(Boolean) as string[]));
}

/** ต้องตรงกับ src/lib/customer-auth-phone.ts */
export function customerAuthEmailFromDocId(customerDocId: string): string {
  const safe = normalizePhoneDigits(customerDocId);
  return `cust_${safe}@customer.sahadiesel.local`;
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
