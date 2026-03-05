
"use client";

import { useState, Suspense, useMemo, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { JobList } from "@/components/job-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";

type TabValue = "quotation" | "waiting-approve" | "pending-parts" | "done" | "pickup";

function ByStatusContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState("");

  const userDept = profile?.department;
  const userRole = profile?.role;

  // Define allowed tabs mapping
  const allowedTabs: TabValue[] = useMemo(() => {
    // Admin and Management see everything
    if (userRole === 'ADMIN' || userRole === 'MANAGER' || userDept === 'MANAGEMENT') {
      return ["quotation", "waiting-approve", "pending-parts", "done", "pickup"];
    }

    switch (userDept) {
      case 'OFFICE':
        return ["quotation", "waiting-approve", "pickup"];
      case 'PURCHASING':
        return ["pending-parts"];
      case 'ACCOUNTING_HR':
        return ["done", "pickup"];
      default:
        return [];
    }
  }, [userDept, userRole]);

  const activeTab = (searchParams.get("status") as TabValue) || allowedTabs[0] || "quotation";

  // Security Redirect: If user is on a tab they are not allowed to see, redirect them to the first allowed tab
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(activeTab)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("status", allowedTabs[0]);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [allowedTabs, activeTab, router, pathname, searchParams]);

  const handleTabChange = (value: string) => {
    if (!allowedTabs.includes(value as TabValue)) return;
    
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const isTabDisabled = (value: TabValue) => !allowedTabs.includes(value);

  return (
    <>
      <PageHeader title="จัดการงานซ่อม - ตามสถานะ" description="แสดงงานทั้งหมดที่ยังไม่ปิด แยกตามสถานะปัจจุบัน" />
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-5 gap-1">
            <TabsTrigger 
              value="quotation" 
              disabled={isTabDisabled("quotation")}
              className={cn(isTabDisabled("quotation") && "opacity-50 grayscale cursor-not-allowed")}
            >
              งานเสนอราคา
            </TabsTrigger>
            <TabsTrigger 
              value="waiting-approve" 
              disabled={isTabDisabled("waiting-approve")}
              className={cn(isTabDisabled("waiting-approve") && "opacity-50 grayscale cursor-not-allowed")}
            >
              รอลูกค้าอนุมัติ
            </TabsTrigger>
            <TabsTrigger 
              value="pending-parts" 
              disabled={isTabDisabled("pending-parts")}
              className={cn(isTabDisabled("pending-parts") && "opacity-50 grayscale cursor-not-allowed")}
            >
              กำลังจัดอะไหล่
            </TabsTrigger>
            <TabsTrigger 
              value="done" 
              disabled={isTabDisabled("done")}
              className={cn(isTabDisabled("done") && "opacity-50 grayscale cursor-not-allowed")}
            >
              งานเสร็จรอทำบิล
            </TabsTrigger>
            <TabsTrigger 
              value="pickup" 
              disabled={isTabDisabled("pickup")}
              className={cn(isTabDisabled("pickup") && "opacity-50 grayscale cursor-not-allowed")}
            >
              รอลูกค้ารับสินค้า
            </TabsTrigger>
          </TabsList>
          <div className="relative w-full md:w-auto md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหาชื่อ/เบอร์โทร..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <Card>
            <CardContent className="p-0">
                <TabsContent value="quotation" className="mt-0">
                    {activeTab === 'quotation' && allowedTabs.includes('quotation') && (
                        <JobList 
                            searchTerm={searchTerm}
                            status='WAITING_QUOTATION'
                            emptyTitle="ไม่มีงานที่รอเสนอราคา"
                            emptyDescription="ไม่มีงานที่อยู่ในสถานะ WAITING_QUOTATION ในขณะนี้"
                        />
                    )}
                </TabsContent>
                <TabsContent value="waiting-approve" className="mt-0">
                    {activeTab === 'waiting-approve' && allowedTabs.includes('waiting-approve') && (
                        <JobList 
                            searchTerm={searchTerm}
                            status="WAITING_APPROVE"
                            actionPreset="waitingApprove"
                            emptyTitle="ไม่มีงานที่รอลูกค้าอนุมัติ"
                            emptyDescription="ไม่มีงานที่อยู่ในสถานะ WAITING_APPROVE ในขณะนี้"
                        />
                    )}
                </TabsContent>
                 <TabsContent value="pending-parts" className="mt-0">
                    {activeTab === 'pending-parts' && allowedTabs.includes('pending-parts') && (
                        <JobList 
                            searchTerm={searchTerm}
                            status="PENDING_PARTS"
                            actionPreset="pendingPartsReady"
                            emptyTitle="ไม่มีงานที่รอจัดอะไหล่"
                            emptyDescription="ไม่มีงานที่อยู่ในสถานะ PENDING_PARTS ในขณะนี้"
                        />
                    )}
                </TabsContent>
                 <TabsContent value="done" className="mt-0">
                    {activeTab === 'done' && allowedTabs.includes('done') && (
                        <JobList 
                            searchTerm={searchTerm}
                            status="DONE"
                            emptyTitle="ไม่มีงานที่เสร็จแล้ว"
                            emptyDescription="ยังไม่มีงานที่อยู่ในสถานะ 'DONE' รอทำบิล"
                        />
                    )}
                </TabsContent>
                 <TabsContent value="pickup" className="mt-0">
                    {activeTab === 'pickup' && allowedTabs.includes('pickup') && (
                        <JobList 
                            searchTerm={searchTerm}
                            status="WAITING_CUSTOMER_PICKUP"
                            emptyTitle="ไม่มีงานที่รอลูกค้ารับของ"
                            emptyDescription="ไม่มีงานที่อยู่ในสถานะ WAITING_CUSTOMER_PICKUP"
                        />
                    )}
                </TabsContent>
            </CardContent>
        </Card>
      </Tabs>
    </>
  );
}

import { cn } from "@/lib/utils";

export default function OfficeJobManagementByStatusPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <ByStatusContent />
    </Suspense>
  );
}
