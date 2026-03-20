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
import { cn } from "@/lib/utils";

type TabValue = "quotation" | "waiting-approve" | "pending-parts" | "in-repair" | "done" | "pickup" | "waiting-payment";

const tabLabels: Record<TabValue, string> = {
    "quotation": "รอเสนอราคา",
    "waiting-approve": "รอลูกค้าอนุมัติ",
    "pending-parts": "รอจัดอะไหล่",
    "in-repair": "กำลังดำเนินการซ่อม",
    "done": "รอทำบิล",
    "pickup": "รอลูกค้ารับสินค้า",
    "waiting-payment": "รอรับเงิน"
};

function ByStatusContent() {
  const { profile, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState("");

  const userDept = profile?.department;
  const userRole = profile?.role;

  // Define allowed tabs based on department (Strict Logic)
  const allowedTabs: TabValue[] = useMemo(() => {
    if (authLoading || !profile) return [];
    
    // Admin and System Management see everything
    if (userRole === 'ADMIN' || userDept === 'MANAGEMENT') {
      return ["quotation", "waiting-approve", "pending-parts", "in-repair", "done", "pickup", "waiting-payment"];
    }

    // Department-based restrictions
    switch (userDept) {
      case 'OFFICE':
        // Hide "waiting-payment" for office department
        return ["quotation", "waiting-approve", "in-repair", "done", "pickup"];
      case 'PURCHASING':
        return ["pending-parts"];
      case 'ACCOUNTING_HR':
        return ["done", "pickup", "waiting-payment"];
      default:
        return [];
    }
  }, [userDept, userRole, profile, authLoading]);

  const activeTab = (searchParams.get("status") as TabValue) || allowedTabs[0] || "quotation";

  useEffect(() => {
    if (!authLoading && allowedTabs.length > 0 && !allowedTabs.includes(activeTab)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("status", allowedTabs[0]);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [allowedTabs, activeTab, router, pathname, searchParams, authLoading]);

  if (authLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
  }

  const handleTabChange = (value: string) => {
    if (!allowedTabs.includes(value as TabValue)) return;
    
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="จัดการงานซ่อม - ตามสถานะ" description="แสดงงานทั้งหมดที่ยังไม่ปิด แยกตามสถานะปัจจุบัน">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ค้นหาชื่อ/เบอร์โทร..."
            className="pl-9 h-10 bg-background/50"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </PageHeader>
      
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList 
            className={cn(
                "grid w-full gap-1 h-auto bg-muted/50 p-1",
                allowedTabs.length === 7 ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-7" : 
                allowedTabs.length === 6 ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-6" :
                allowedTabs.length === 5 ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-5" :
                "grid-cols-2 sm:grid-cols-4"
            )}
          >
            {allowedTabs.map(tab => (
                <TabsTrigger 
                    key={tab}
                    value={tab} 
                    className={cn(
                        "text-xs sm:text-sm transition-all h-10 px-2",
                        "data-[state=active]:text-base sm:data-[state=active]:text-lg data-[state=active]:font-black data-[state=active]:shadow-md data-[state=active]:bg-background",
                        tab === "in-repair" && "text-primary",
                        tab === "waiting-payment" && "text-blue-600"
                    )}
                >
                    {tabLabels[tab]}
                </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <Card>
            <CardContent className="p-0">
                {allowedTabs.map(tab => (
                    <TabsContent key={tab} value={tab} className="mt-0">
                        {activeTab === tab && (
                            <JobList 
                                searchTerm={searchTerm}
                                status={
                                    tab === "waiting-approve" ? ["PENDING_CUSTOMER_INFORM", "WAITING_APPROVE"] :
                                    tab === "quotation" ? "WAITING_QUOTATION" :
                                    tab === "pending-parts" ? "PENDING_PARTS" :
                                    tab === "in-repair" ? "IN_REPAIR_PROCESS" :
                                    tab === "done" ? "DONE" :
                                    tab === "pickup" ? "WAITING_CUSTOMER_PICKUP" :
                                    "PICKED_UP"
                                }
                                emptyTitle={
                                    tab === "quotation" ? "ไม่มีงานที่รอเสนอราคา" :
                                    tab === "waiting-approve" ? "ไม่มีงานที่รอลูกค้าอนุมัติ" :
                                    tab === "pending-parts" ? "ไม่มีงานที่รอจัดอะไหล่" :
                                    tab === "in-repair" ? "ไม่มีงานที่กำลังซ่อม" :
                                    tab === "done" ? "ไม่มีงานที่เสร็จแล้ว" :
                                    tab === "pickup" ? "ไม่มีงานที่รอลูกค้ารับของ" :
                                    "ไม่มีงานที่รอรับเงิน"
                                }
                                emptyDescription={
                                    tab === "quotation" ? "ไม่มีงานที่อยู่ในสถานะ WAITING_QUOTATION ในขณะนี้" :
                                    tab === "waiting-approve" ? "ไม่มีงานที่อยู่ในสถานะ 'รอแจ้งลูกค้า' หรือ 'รอลูกค้าอนุมัติ' ในขณะนี้" :
                                    tab === "pending-parts" ? "ไม่มีงานที่อยู่ในสถานะ PENDING_PARTS ในขณะนี้" :
                                    tab === "in-repair" ? "ยังไม่มีงานที่อยู่ในสถานะ 'กำลังดำเนินการซ่อม' ในขณะนี้" :
                                    tab === "done" ? "ยังไม่มีงานที่อยู่ในสถานะ 'DONE' รอทำบิล" :
                                    tab === "pickup" ? "ไม่มีงานที่อยู่ในสถานะ WAITING_CUSTOMER_PICKUP" :
                                    "ยังไม่มีงานที่ลูกค้าได้รับของไปแล้วและอยู่ระหว่างรอรับเงินจริงค่ะ"
                                }
                            />
                        )}
                    </TabsContent>
                ))}
            </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}

export default function OfficeJobManagementByStatusPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <ByStatusContent />
    </Suspense>
  );
}
