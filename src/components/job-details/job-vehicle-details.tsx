"use client";

import type { Job } from "@/lib/types";

interface DetailRowProps {
  label: string;
  value?: string | null;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
};

export function JobVehicleDetails({ job }: { job: Job }) {
  const car = job.carServiceDetails;
  const commonrail = job.commonrailDetails;
  const mechanic = job.mechanicDetails;

  const hasCarDetails = !!(car?.brand || car?.model || car?.licensePlate);
  const hasPartsDetails = !!(
    commonrail?.brand ||
    commonrail?.partNumber ||
    commonrail?.registrationNumber ||
    mechanic?.brand ||
    mechanic?.partNumber ||
    mechanic?.registrationNumber
  );

  return (
    <div className="space-y-1">
      {hasCarDetails && (
        <>
          <DetailRow label="ยี่ห้อรถ" value={car?.brand} />
          <DetailRow label="รุ่นรถ" value={car?.model} />
          <DetailRow label="ทะเบียนรถ" value={car?.licensePlate} />
        </>
      )}

      {!hasCarDetails && hasPartsDetails && (
        <>
          <DetailRow label="ยี่ห้อ" value={commonrail?.brand || mechanic?.brand} />
          <DetailRow label="เลขอะไหล่" value={commonrail?.partNumber || mechanic?.partNumber} />
          <DetailRow label="ทะเบียนชิ้นส่วน" value={commonrail?.registrationNumber || mechanic?.registrationNumber} />
        </>
      )}
      
      {!hasCarDetails && !hasPartsDetails && (
        <p className="text-xs text-muted-foreground italic">ไม่มีข้อมูลรายละเอียดรถหรือชิ้นส่วน</p>
      )}
    </div>
  );
}
