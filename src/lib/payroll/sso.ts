
"use client";

// Utility functions for Social Security Office (SSO) calculations.

export type SsoRateSettings = {
  employeePercent?: number;
  employerPercent?: number;
  monthlyMinBase?: number;
  monthlyCap?: number;
};

/** ค่าเรท SSO จาก HR settings (ตัวเลขล้วน) */
export function ssoSettingsFromHr(sso?: SsoRateSettings | null) {
  return {
    employeePercent: Number(sso?.employeePercent ?? 0),
    employerPercent: Number(sso?.employerPercent ?? 0),
    monthlyMinBase: Number(sso?.monthlyMinBase ?? 0),
    monthlyCap: effectiveSsoCap(Number(sso?.monthlyCap ?? 0)),
  };
}

/** 0 หรือไม่ระบุ = ไม่จำกัดเพดาน */
export function effectiveSsoCap(cap: number): number {
  return cap > 0 ? cap : Infinity;
}

/** เรทที่ใช้คำนวณสลิป — ร่าง/คำนวณใหม่ใช้ HR Settings ล่าสุด */
export function resolveSsoRatesForPayslip(args: {
  hrSettings?: SsoRateSettings | null;
  batchDecision?: (SsoRateSettings & { source?: string }) | null;
  /** true เมื่อกด "คำนวณใหม่" หรือสลิปยังไม่ล็อก */
  preferHrSettings: boolean;
}) {
  const hr = ssoSettingsFromHr(args.hrSettings);
  if (args.preferHrSettings) {
    return { ...hr, source: "HR_SETTINGS_SYNC" as const };
  }
  if (args.batchDecision) {
    return {
      ...ssoSettingsFromHr(args.batchDecision),
      source: args.batchDecision.source,
    };
  }
  return { ...hr, source: "AUTO_LOCK" as const };
}

/** เปรียบเทียบเรท SSO สองชุด */
export function ssoDecisionDiffers(
  a?: SsoRateSettings | null,
  b?: SsoRateSettings | null
): boolean {
  const A = ssoSettingsFromHr(a);
  const B = ssoSettingsFromHr(b);
  const check = (v1: number, v2: number) => Math.abs(v1 - v2) > 0.01;
  return (
    check(A.employeePercent, B.employeePercent) ||
    check(A.employerPercent, B.employerPercent) ||
    check(A.monthlyMinBase, B.monthlyMinBase) ||
    check(A.monthlyCap, B.monthlyCap)
  );
}

/**
 * Rounds a number to a specified number of decimal places.
 * Default adjusted to 0 for Sahadiesel integer policy.
 */
export function round2(value: number, decimals: number = 0): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/**
 * Clamps the base salary between a minimum and a maximum for SSO calculation.
 */
export function clampSsoBase(salaryMonthly: number, minBase: number, cap: number): number {
    const effectiveCap = effectiveSsoCap(cap);
    return Math.max(minBase, Math.min(salaryMonthly, effectiveCap));
}

/**
 * Calculates the total monthly SSO deduction amount as an integer.
 */
export function calcSsoMonthly(
  salaryMonthly: number,
  percent: number,
  minBase: number,
  cap: number
): number {
  if (salaryMonthly <= 0 || percent <= 0) {
    return 0;
  }
  const base = clampSsoBase(salaryMonthly, minBase, cap);
  // Force integer rounding
  return Math.round(base * (percent / 100));
}

/**
 * Splits the total monthly SSO deduction into two halves for bi-monthly payroll.
 * Ensures result is integer.
 */
export function splitSsoHalf(ssoMonthly: number): { p1: number; p2: number } {
  const p1 = Math.round(ssoMonthly / 2);
  const p2 = Math.round(ssoMonthly - p1);
  return { p1, p2 };
}
