/** ใช้ร่วมกับฟอร์มสมัครพอร์ทัลลูกค้าและ signUpCustomerWithPhone */

export function isLegalFullName(displayName: string): boolean {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}

export function normalizeNationalIdDigits(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

export function isValidThaiNationalId13(digits: string): boolean {
  return /^[0-9]{13}$/.test(digits);
}

export function isSubstantialIdCardAddress(addr: string): boolean {
  return addr.trim().length >= 15;
}
