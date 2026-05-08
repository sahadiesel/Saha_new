"use client";

import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileImage } from "lucide-react";
import type { Job } from "@/lib/types";
import { jobStatusLabel, deptLabel } from "@/lib/ui-labels";
import { jobDisplayRef } from "@/lib/job-display";
import { safeFormat, APP_DATE_TIME_FORMAT } from "@/lib/date-utils";
import {
  customerPortalJobAgeDays,
  customerPortalStaleAgeBadgeClass,
  customerPortalStatusBadgeClass,
} from "@/lib/customer-job-portal-ui";
import { cn } from "@/lib/utils";

export function CustomerJobCard({ job }: { job: Job }) {
  const thumbUrl = job.photos?.find(Boolean);
  const ageDays = customerPortalJobAgeDays(job);

  return (
    <Card className="flex flex-col overflow-hidden border-white/10 bg-slate-900/90 text-white hover:border-primary/40 transition-colors shadow-xl">
      <div className="relative aspect-video bg-slate-800">
        {thumbUrl ? (
          <Image src={thumbUrl} alt="" fill unoptimized className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-500">
            <FileImage className="h-12 w-12 opacity-25" />
          </div>
        )}
        <Badge
          className={cn(
            "absolute top-2 right-2 shadow-md border-0 font-semibold text-xs",
            customerPortalStatusBadgeClass(job.status)
          )}
        >
          {jobStatusLabel(job.status)}
        </Badge>
        {ageDays > 0 && (
          <Badge
            className={cn(
              "absolute top-2 left-2 shadow-md border border-black/40 font-bold text-[10px]",
              customerPortalStaleAgeBadgeClass(ageDays)
            )}
          >
            ค้าง {ageDays} วัน
          </Badge>
        )}
      </div>
      <CardHeader className="p-4 space-y-1">
        <CardTitle className="text-base line-clamp-1">{job.customerSnapshot?.name || "ลูกค้า"}</CardTitle>
        <CardDescription className="text-[10px] text-slate-400">
          <span className="font-mono font-semibold text-slate-200">{jobDisplayRef(job)}</span>
          {" · "}
          {deptLabel(job.department)} • {safeFormat(job.lastActivityAt, APP_DATE_TIME_FORMAT)}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-2 flex-grow">
        <p className="text-sm line-clamp-3 text-slate-300">{job.description || "—"}</p>
      </CardContent>
      <CardFooter className="px-4 pb-4 pt-0 flex flex-col gap-2">
        <Button asChild className="w-full h-10 font-bold bg-white text-slate-900 hover:bg-white/90">
          <Link href={`/customer/jobs/${job.id}`}>
            ดูรายละเอียด <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
