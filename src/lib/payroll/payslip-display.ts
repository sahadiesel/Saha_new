import type { PayslipSnapshot, StoreSettings } from "@/lib/types";
import { round2 } from "@/lib/payroll/sso";

export const AUTO_SSO_DEDUCTION = "[AUTO] ประกันสังคม";
export const AUTO_WHT_DEDUCTION = "[AUTO] ภาษีหัก ณ ที่จ่าย";

const SSO_LABEL = "ประกันสังคม";
const WHT_LABEL = "ภาษีหัก ณ ที่จ่าย";

const formatCurrency = (value: number | undefined) =>
  (value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const safeParseFloat = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = parseFloat(value);
    return Number.isNaN(num) ? 0 : num;
  }
  return 0;
};

export function calcTotals(snapshot: PayslipSnapshot | null | undefined) {
  if (!snapshot) return { basePay: 0, addTotal: 0, dedTotal: 0, netPay: 0 };
  const basePay = round2(safeParseFloat(snapshot.basePay));
  const addTotal = round2(
    (snapshot.additions || []).reduce((sum, item) => sum + safeParseFloat(item.amount), 0)
  );
  const dedTotal = round2(
    (snapshot.deductions || []).reduce((sum, item) => sum + safeParseFloat(item.amount), 0)
  );
  const netPay = round2(basePay + addTotal - dedTotal);
  return { basePay, addTotal, dedTotal, netPay };
}

export function parsePayrollBatchId(batchId: string): { yearMonth: string; periodNo: 1 | 2 } | null {
  const m = String(batchId || "").match(/^(\d{4}-\d{2})-([12])$/);
  if (!m) return null;
  return { yearMonth: m[1], periodNo: Number(m[2]) as 1 | 2 };
}

export function siblingPayrollBatchId(batchId: string): string | null {
  const parsed = parsePayrollBatchId(batchId);
  if (!parsed) return null;
  return `${parsed.yearMonth}-${parsed.periodNo === 1 ? 2 : 1}`;
}

export function displayDeductionName(name: string): string {
  return String(name || "").replace(/^\[AUTO\]\s*/, "").trim() || name;
}

function nameMatches(name: string, needles: string[]): boolean {
  const n = displayDeductionName(name);
  return needles.some((needle) => n === needle || n.includes(needle));
}

export function deductionAmount(
  snapshot: PayslipSnapshot | null | undefined,
  needles: string[]
): number {
  return round2(
    (snapshot?.deductions || [])
      .filter((d) => nameMatches(d.name, needles))
      .reduce((sum, d) => sum + safeParseFloat(d.amount), 0)
  );
}

export function ssoDeductionAmount(snapshot: PayslipSnapshot | null | undefined): number {
  return deductionAmount(snapshot, [SSO_LABEL, "SSO"]);
}

export function whtDeductionAmount(snapshot: PayslipSnapshot | null | undefined): number {
  return deductionAmount(snapshot, [WHT_LABEL, "ภาษี ณ ที่จ่าย", "หัก ณ ที่จ่าย"]);
}

export function otherDeductions(snapshot: PayslipSnapshot | null | undefined) {
  return (snapshot?.deductions || []).filter(
    (d) =>
      !nameMatches(d.name, [SSO_LABEL, "SSO"]) &&
      !nameMatches(d.name, [WHT_LABEL, "ภาษี ณ ที่จ่าย", "หัก ณ ที่จ่าย"])
  );
}

export type LeaveDays = {
  sickDays: number;
  businessDays: number;
  vacationDays: number;
  overLimitDays: number;
  total: number;
};

export function leaveDaysFrom(
  summary: PayslipSnapshot["leaveSummary"] | PayslipSnapshot["leaveSummaryYtd"] | undefined
): LeaveDays {
  const sickDays = summary?.sickDays || 0;
  const businessDays = summary?.businessDays || 0;
  const vacationDays = summary?.vacationDays || 0;
  const overLimitDays = summary?.overLimitDays || 0;
  return {
    sickDays,
    businessDays,
    vacationDays,
    overLimitDays,
    total: sickDays + businessDays + vacationDays,
  };
}

export function mergeLeaveDays(a: LeaveDays, b: LeaveDays): LeaveDays {
  return {
    sickDays: a.sickDays + b.sickDays,
    businessDays: a.businessDays + b.businessDays,
    vacationDays: a.vacationDays + b.vacationDays,
    overLimitDays: a.overLimitDays + b.overLimitDays,
    total: a.total + b.total,
  };
}

export function monthLeaveDays(
  snapshot: PayslipSnapshot,
  otherSnapshot?: PayslipSnapshot | null
): LeaveDays {
  return mergeLeaveDays(leaveDaysFrom(snapshot.leaveSummary), leaveDaysFrom(otherSnapshot?.leaveSummary));
}

export function splitAmountHalf(total: number): { p1: number; p2: number } {
  const p1 = round2(total / 2);
  return { p1, p2: round2(total - p1) };
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPayslipPrintHtml(args: {
  store: Pick<StoreSettings, "taxName" | "taxAddress" | "phone" | "taxId">;
  employeeName: string;
  departmentLabel: string;
  payTypeLabelText: string;
  periodLabel: string;
  currentPeriodNo: 1 | 2;
  snapshot: PayslipSnapshot;
  otherSnapshot?: PayslipSnapshot | null;
  salaryMonthly?: number;
  bahtText: string;
}): string {
  const {
    store,
    employeeName,
    departmentLabel,
    payTypeLabelText,
    periodLabel,
    currentPeriodNo,
    snapshot,
    otherSnapshot,
    salaryMonthly,
    bahtText,
  } = args;

  const currentTotals = calcTotals(snapshot);
  const otherTotals = calcTotals(otherSnapshot);
  const p1Totals = currentPeriodNo === 1 ? currentTotals : otherTotals;
  const p2Totals = currentPeriodNo === 2 ? currentTotals : otherTotals;
  const monthlyNet = p1Totals.netPay + p2Totals.netPay;
  const monthlySalary =
    salaryMonthly && salaryMonthly > 0
      ? salaryMonthly
      : p1Totals.basePay + p2Totals.basePay || currentTotals.basePay;

  const ssoAmt = ssoDeductionAmount(snapshot);
  const whtAmt = whtDeductionAmount(snapshot);
  const extras = otherDeductions(snapshot);
  const monthLeave = monthLeaveDays(snapshot, otherSnapshot);
  const ytdLeave = leaveDaysFrom(snapshot.leaveSummaryYtd);

  const additionRows = (snapshot.additions || [])
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.name)}</td><td class="text-right">${formatCurrency(a.amount)}</td></tr>`
    )
    .join("");

  const extraDeductionRows = extras
    .map(
      (d) =>
        `<tr><td>${escapeHtml(displayDeductionName(d.name))}</td><td class="text-right">-${formatCurrency(d.amount)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payslip ${escapeHtml(employeeName)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
    @page { size: A4; margin: 15mm; }
    body { font-family: 'Sarabun', sans-serif; font-size: 13px; line-height: 1.4; color: #333; margin: 0; padding: 0; }
    .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 18px; color: #000; }
    .header p { margin: 5px 0 0; font-size: 11px; color: #666; }
    .doc-title { text-align: center; margin-bottom: 16px; }
    .doc-title h2 { margin: 0; font-size: 16px; text-decoration: underline; font-weight: bold; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
    .section-title { font-weight: bold; background: #f0f0f0; padding: 4px 8px; border: 1px solid #ccc; font-size: 12px; margin-top: 15px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background-color: #f9f9f9; }
    .text-right { text-align: right; }
    .total-row { font-weight: bold; background-color: #eee; }
    .net-pay-box { border: 2px solid #333; padding: 10px; margin-top: 15px; display: flex; justify-content: space-between; align-items: center; }
    .net-pay-val { font-size: 18px; font-weight: bold; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px; }
    .period-box { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 12px 0; }
    .period-cell { border: 1px solid #ccc; padding: 8px; }
    .period-cell .lbl { font-size: 11px; color: #666; }
    .period-cell .val { font-size: 15px; font-weight: bold; }
    .footer { margin-top: 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; text-align: center; }
    .signature { border-top: 1px solid #333; padding-top: 5px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(store.taxName || "Sahadiesel Service")}</h1>
    <p>${escapeHtml(store.taxAddress || "")}</p>
    <p>โทร: ${escapeHtml(store.phone || "")} ${store.taxId ? `| เลขผู้เสียภาษี: ${escapeHtml(store.taxId)}` : ""}</p>
  </div>
  <div class="doc-title"><h2>ใบแจ้งยอดเงินเดือน / PAY SLIP</h2></div>
  <div class="info-grid">
    <div><strong>ชื่อพนักงาน:</strong> ${escapeHtml(employeeName)}</div>
    <div class="text-right"><strong>ประจำงวด:</strong> ${escapeHtml(periodLabel)}</div>
    <div><strong>แผนก:</strong> ${escapeHtml(departmentLabel)}</div>
    <div class="text-right"><strong>ประเภท:</strong> ${escapeHtml(payTypeLabelText)}</div>
  </div>

  <div class="section-title">สรุปเงินเดือนทั้งเดือน / ที่ได้รับจริง</div>
  <div class="period-box">
    <div class="period-cell">
      <div class="lbl">เงินเดือนทั้งเดือน</div>
      <div class="val">${formatCurrency(monthlySalary)}</div>
    </div>
    <div class="period-cell">
      <div class="lbl">รับจริงงวด 1 (1-15)</div>
      <div class="val">${otherSnapshot || currentPeriodNo === 1 ? formatCurrency(p1Totals.netPay) : "—"}</div>
    </div>
    <div class="period-cell">
      <div class="lbl">รับจริงงวด 2 (16-สิ้นเดือน)</div>
      <div class="val">${otherSnapshot || currentPeriodNo === 2 ? formatCurrency(p2Totals.netPay) : "—"}</div>
    </div>
  </div>
  <table>
    <tr class="total-row"><td>ยอดรับสุทธิรวมเดือนนี้ (งวด 1 + งวด 2)</td><td class="text-right">${formatCurrency(monthlyNet)}</td></tr>
  </table>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 15px;">
    <div>
      <div class="section-title">รายได้ / EARNINGS (งวดนี้)</div>
      <table>
        <thead><tr><th>รายการ</th><th class="text-right">จำนวนเงิน</th></tr></thead>
        <tbody>
          <tr><td>เงินเดือนพื้นฐาน (เต็มเดือน)</td><td class="text-right">${formatCurrency(monthlySalary)}</td></tr>
          <tr><td>เงินเดือนงวดนี้</td><td class="text-right">${formatCurrency(currentTotals.basePay)}</td></tr>
          ${additionRows}
          <tr class="total-row"><td>รวมรายได้งวดนี้</td><td class="text-right">${formatCurrency(currentTotals.basePay + currentTotals.addTotal)}</td></tr>
        </tbody>
      </table>
    </div>
    <div>
      <div class="section-title">รายการหัก / DEDUCTIONS (งวดนี้)</div>
      <table>
        <thead><tr><th>รายการ</th><th class="text-right">จำนวนเงิน</th></tr></thead>
        <tbody>
          <tr><td>${SSO_LABEL}</td><td class="text-right">-${formatCurrency(ssoAmt)}</td></tr>
          <tr><td>${WHT_LABEL}</td><td class="text-right">-${formatCurrency(whtAmt)}</td></tr>
          ${extraDeductionRows}
          <tr class="total-row"><td>รวมรายการหัก</td><td class="text-right">-${formatCurrency(currentTotals.dedTotal)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="net-pay-box">
    <div style="font-size: 11px;">(${escapeHtml(bahtText)})</div>
    <div>
      <span style="margin-right: 15px;">เงินได้สุทธิงวดนี้ / NET PAY:</span>
      <span class="net-pay-val">${formatCurrency(currentTotals.netPay)} บาท</span>
    </div>
  </div>

  <div class="stats-grid">
    <div>
      <div class="section-title">สรุปวันลาภายในเดือน</div>
      <table style="font-size: 11px;">
        <tr><td>ลาป่วย</td><td class="text-right">${monthLeave.sickDays} วัน</td></tr>
        <tr><td>ลากิจ</td><td class="text-right">${monthLeave.businessDays} วัน</td></tr>
        <tr><td>พักร้อน</td><td class="text-right">${monthLeave.vacationDays} วัน</td></tr>
        <tr class="total-row"><td>รวมวันลาเดือนนี้</td><td class="text-right">${monthLeave.total} วัน</td></tr>
        <tr><td>วันทำงานงวดนี้</td><td class="text-right">${snapshot.attendanceSummary?.presentDays || 0} วัน</td></tr>
        <tr><td>มาสายงวดนี้</td><td class="text-right">${snapshot.attendanceSummary?.lateDays || 0} ครั้ง (${snapshot.attendanceSummary?.lateMinutes || 0} นาที)</td></tr>
      </table>
    </div>
    <div>
      <div class="section-title">วันลาสะสมปีปัจจุบัน (YTD)</div>
      <table style="font-size: 11px;">
        <tr><td>ลาป่วยสะสม</td><td class="text-right">${ytdLeave.sickDays} วัน</td></tr>
        <tr><td>ลากิจสะสม</td><td class="text-right">${ytdLeave.businessDays} วัน</td></tr>
        <tr><td>พักร้อนสะสม</td><td class="text-right">${ytdLeave.vacationDays} วัน</td></tr>
        <tr class="total-row"><td>รวมวันลาสะสม</td><td class="text-right">${ytdLeave.total} วัน</td></tr>
        <tr><td>วันทำงานสะสม</td><td class="text-right">${snapshot.attendanceSummaryYtd?.presentDays || 0} วัน</td></tr>
        <tr><td>สายสะสม</td><td class="text-right">${snapshot.attendanceSummaryYtd?.lateMinutes || 0} นาที</td></tr>
      </table>
    </div>
  </div>

  ${
    snapshot.calcNotes
      ? `<div style="margin-top: 10px; font-size: 11px; border: 1px dashed #ccc; padding: 8px;"><strong>หมายเหตุ:</strong> ${escapeHtml(snapshot.calcNotes)}</div>`
      : ""
  }

  <div class="footer">
    <div><div class="signature"></div><p>ผู้อนุมัติจ่าย / Authorized Signature</p></div>
    <div><div class="signature"></div><p>ผู้รับเงิน / Employee Signature</p></div>
  </div>
</body>
</html>`;
}
