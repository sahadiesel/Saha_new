import type { HRSettings } from "@/lib/types";
import { round2 } from "@/lib/payroll/sso";

export type PitBracket = {
  /** ฐานเริ่มต้นของขั้น (ไม่รวม) ยกเว้นขั้นแรก = 0 */
  min: number;
  /** เพดานขั้นนี้ — ไม่ระบุหรือ 0 = ไม่จำกัด */
  max: number | null;
  ratePercent: number;
};

/** อัตราภาษีเงินได้บุคคลธรรมดา (มาตรา 48) */
export const DEFAULT_THAI_PIT_BRACKETS: PitBracket[] = [
  { min: 0, max: 150000, ratePercent: 0 },
  { min: 150000, max: 300000, ratePercent: 5 },
  { min: 300000, max: 500000, ratePercent: 10 },
  { min: 500000, max: 750000, ratePercent: 15 },
  { min: 750000, max: 1000000, ratePercent: 20 },
  { min: 1000000, max: 2000000, ratePercent: 25 },
  { min: 2000000, max: 5000000, ratePercent: 30 },
  { min: 5000000, max: null, ratePercent: 35 },
];

export function normalizePitBrackets(brackets?: PitBracket[] | null): PitBracket[] {
  const list = (brackets && brackets.length > 0 ? brackets : DEFAULT_THAI_PIT_BRACKETS)
    .map((b) => ({
      min: Math.max(0, Number(b.min) || 0),
      max: b.max == null || Number(b.max) <= 0 ? null : Number(b.max),
      ratePercent: Math.max(0, Number(b.ratePercent) || 0),
    }))
    .sort((a, b) => a.min - b.min);
  return list.length > 0 ? list : DEFAULT_THAI_PIT_BRACKETS;
}

/** ภาษีทั้งปีจากฐานเงินได้สุทธิแบบขั้นบันได */
export function annualPitTax(taxableIncome: number, brackets?: PitBracket[] | null): number {
  const taxable = Math.max(0, Number(taxableIncome) || 0);
  if (taxable <= 0) return 0;
  let tax = 0;
  for (const b of normalizePitBrackets(brackets)) {
    const cap = b.max == null ? Number.POSITIVE_INFINITY : b.max;
    const slice = Math.max(0, Math.min(taxable, cap) - b.min);
    if (slice <= 0) continue;
    tax += slice * (b.ratePercent / 100);
  }
  return tax;
}

export type EmploymentTaxBreakdown = {
  enabled: boolean;
  annualIncome: number;
  expenseDeduction: number;
  personalAllowance: number;
  ssoAnnual: number;
  extraDeduction: number;
  taxable: number;
  annualTax: number;
  monthlyTax: number;
  periodTax: { p1: number; p2: number };
};

/**
 * คำนวณภาษีหัก ณ ที่จ่ายเงินเดือน (ภ.ง.ด.1) แบบ OPEC:
 * รายได้ทั้งปี = เงินเดือน × 12
 * หักค่าใช้จ่าย 50% ไม่เกินเพดาน + ลดหย่อนส่วนตัว + ประกันสังคมทั้งปี
 * ภาษีขั้นบันได → หาร 12 เป็นรายเดือน → หาร 2 เป็นต่องวด
 */
export function computeEmploymentTaxBreakdown(args: {
  monthlySalary: number;
  monthlySso?: number;
  withholding?: HRSettings["withholding"] | null;
}): EmploymentTaxBreakdown {
  const monthlySalary = Math.max(0, Number(args.monthlySalary) || 0);
  const monthlySso = Math.max(0, Number(args.monthlySso) || 0);
  const w = args.withholding;
  const annualIncome = round2(monthlySalary * 12);

  const expensePercent = w?.expensePercent ?? 50;
  const expenseCap = w?.expenseCap ?? 100000;
  const expenseDeduction = Math.min(
    round2(annualIncome * (Math.max(0, expensePercent) / 100)),
    Math.max(0, expenseCap)
  );
  const personalAllowance = Math.max(0, w?.personalAllowance ?? 60000);
  const ssoAnnual = w?.deductSso === false ? 0 : round2(monthlySso * 12);
  const extraDeduction = Math.max(0, Number(w?.extraAnnualDeduction) || 0);
  const taxable = Math.max(
    0,
    annualIncome - expenseDeduction - personalAllowance - ssoAnnual - extraDeduction
  );

  const empty: EmploymentTaxBreakdown = {
    enabled: false,
    annualIncome,
    expenseDeduction,
    personalAllowance,
    ssoAnnual,
    extraDeduction,
    taxable,
    annualTax: 0,
    monthlyTax: 0,
    periodTax: { p1: 0, p2: 0 },
  };

  if (w?.enabled !== true || monthlySalary <= 0) {
    return empty;
  }

  const annualTaxRaw = annualPitTax(taxable, w.brackets);
  const annualTax = round2(annualTaxRaw);
  const monthlyTax = round2(annualTax / 12);
  const p1 = round2(monthlyTax / 2);
  const p2 = round2(monthlyTax - p1);

  return {
    ...empty,
    enabled: true,
    annualTax,
    monthlyTax,
    periodTax: { p1, p2 },
  };
}

export function formatBracketLabel(bracket: PitBracket): string {
  const from = (bracket.min + (bracket.min > 0 ? 1 : 0)).toLocaleString("th-TH");
  const to =
    bracket.max == null || bracket.max <= 0
      ? "ขึ้นไป"
      : bracket.max.toLocaleString("th-TH");
  return `${from} – ${to}`;
}
