import type { Job, JobStatus } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** จำนวนวันที่งานค้างในระบบ (โชว์บนการ์ด — เทียบจากวันที่สร้าง/กิจกรรมล่าสุด) */
export function customerPortalJobAgeDays(job: Job): number {
  const anyJob = job as Job & {
    createdAt?: { toDate?: () => Date } | Date | string;
    lastActivityAt?: { toDate?: () => Date } | Date | string;
  };
  const source = anyJob.createdAt ?? anyJob.lastActivityAt;
  if (!source) return 0;

  let start: Date | null = null;
  if (source instanceof Date) start = source;
  else if (typeof source === "string") {
    const d = new Date(source);
    start = Number.isNaN(d.getTime()) ? null : d;
  } else if (typeof source === "object" && source && "toDate" in source && typeof source.toDate === "function") {
    start = source.toDate();
  }

  if (!start || Number.isNaN(start.getTime())) return 0;
  const diff = Math.floor((Date.now() - start.getTime()) / MS_PER_DAY) + 1;
  return Math.max(1, diff);
}

export function customerPortalStaleAgeBadgeClass(days: number) {
  if (days >= 15) return "bg-red-600 text-white";
  if (days >= 8) return "bg-orange-500 text-white";
  if (days >= 1) return "bg-green-600 text-white";
  return "bg-slate-500 text-white";
}

export function customerPortalStatusBadgeClass(status: JobStatus) {
  switch (status) {
    case "RECEIVED":
      return "bg-amber-500 text-white border-amber-600";
    case "IN_PROGRESS":
      return "bg-cyan-500 text-white border-cyan-600";
    case "WAITING_QUOTATION":
      return "bg-blue-500 text-white border-blue-600";
    case "PENDING_CUSTOMER_INFORM":
      return "bg-pink-500 text-white border-pink-600";
    case "WAITING_APPROVE":
      return "bg-orange-500 text-white border-orange-600";
    case "PENDING_PARTS":
      return "bg-purple-500 text-white border-purple-600";
    case "IN_REPAIR_PROCESS":
      return "bg-indigo-600 text-white border-indigo-700";
    case "DONE":
      return "bg-green-500 text-white border-green-600";
    case "WAITING_CUSTOMER_PICKUP":
      return "bg-emerald-600 text-white border-emerald-700";
    case "PICKED_UP":
      return "bg-blue-600 text-white border-blue-700";
    case "CLOSED":
      return "bg-slate-400 text-white border-slate-500";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

/** บรรทัดสรุปรถ/ชิ้นส่วนสำหรับพอร์ทัลลูกค้า */
export function customerPortalVehicleLines(job: Job): string[] {
  const lines: string[] = [];
  const cs = job.carServiceDetails;
  if (cs?.brand || cs?.model || cs?.licensePlate) {
    lines.push(
      ["ยานพาหนะ (หน้าร้าน)", [cs?.brand, cs?.model, cs?.licensePlate].filter(Boolean).join(" ")].join(": ")
    );
  }
  const cr = job.commonrailDetails;
  if (cr?.brand || cr?.registrationNumber || cr?.partNumber) {
    lines.push(
      ["คอมมอนเรล / หัวฉีด", [cr?.brand, cr?.registrationNumber, cr?.partNumber].filter(Boolean).join(" ")].join(": ")
    );
  }
  const me = job.mechanicDetails;
  if (me?.brand || me?.registrationNumber || me?.partNumber) {
    lines.push(
      ["แมคคานิค", [me?.brand, me?.registrationNumber, me?.partNumber].filter(Boolean).join(" ")].join(": ")
    );
  }
  return lines;
}
