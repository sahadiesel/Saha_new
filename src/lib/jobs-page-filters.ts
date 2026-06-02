import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfToday,
  subDays,
  subMonths,
  endOfDay,
  startOfDay,
  isWithinInterval,
} from "date-fns";

export type JobsPageMetric = "inflow" | "outflow" | "backlog";
export type JobsDatePreset =
  | "ALL"
  | "TODAY"
  | "LAST_7_DAYS"
  | "THIS_MONTH"
  | "LAST_3_MONTHS"
  | "CUSTOM";

export const JOBS_DATE_PRESET_LABELS: Record<JobsDatePreset, string> = {
  ALL: "ทั้งหมด",
  TODAY: "วันนี้",
  LAST_7_DAYS: "7 วันที่ผ่านมา",
  THIS_MONTH: "เดือนนี้",
  LAST_3_MONTHS: "3 เดือนที่ผ่านมา",
  CUSTOM: "ช่วงที่เลือก",
};

export function resolveJobsDateRange(
  preset: JobsDatePreset,
  customMonth?: string,
  customFrom?: Date,
  customTo?: Date
): { from: Date; to: Date } | null {
  const today = startOfToday();
  switch (preset) {
    case "ALL":
      return null;
    case "TODAY":
      return { from: today, to: today };
    case "LAST_7_DAYS":
      return { from: subDays(today, 6), to: today };
    case "THIS_MONTH":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "LAST_3_MONTHS":
      return { from: startOfMonth(subMonths(today, 2)), to: endOfMonth(today) };
    case "CUSTOM":
      if (customFrom && customTo) {
        return { from: customFrom, to: customTo };
      }
      if (customMonth && /^\d{4}-\d{2}$/.test(customMonth)) {
        const anchor = parseISO(`${customMonth}-01`);
        return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
      }
      return null;
    default:
      return null;
  }
}

export function buildJobsPageLink(
  metric: JobsPageMetric,
  opts?: {
    fromDate?: Date;
    toDate?: Date;
    fromDashboard?: boolean;
    preset?: JobsDatePreset;
  }
): string {
  const params = new URLSearchParams({ metric });
  if (opts?.fromDashboard) params.set("from", "dashboard");
  if (opts?.preset && opts.preset !== "ALL") params.set("preset", opts.preset);
  if (opts?.fromDate && opts?.toDate && metric !== "backlog") {
    params.set("fromDate", format(opts.fromDate, "yyyy-MM-dd"));
    params.set("toDate", format(opts.toDate, "yyyy-MM-dd"));
  }
  return `/app/jobs?${params.toString()}`;
}

export function parseYmdDate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  try {
    const d = parseISO(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function isDateInRange(d: Date | null, range: { from: Date; to: Date } | null): boolean {
  if (!range) return true;
  if (!d) return false;
  return isWithinInterval(d, { start: startOfDay(range.from), end: endOfDay(range.to) });
}

/** ตรงกับแดชบอร์ด — งานที่ถือว่าเสร็จ/ส่งมอบแล้ว */
export function isJobOutflow(status: string | undefined): boolean {
  return ["DONE", "WAITING_CUSTOMER_PICKUP", "PICKED_UP", "CLOSED"].includes(
    String(status || "").toUpperCase()
  );
}

export function jobsMetricLabel(metric: JobsPageMetric): string {
  switch (metric) {
    case "inflow":
      return "งานเข้าใหม่";
    case "outflow":
      return "งานซ่อมเสร็จ";
    case "backlog":
      return "งานคงค้าง";
  }
}
