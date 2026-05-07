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
