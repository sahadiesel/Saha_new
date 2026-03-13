
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import React, { useMemo, useState, useEffect } from "react"
import {
  collection, query, where, getDocs
} from "firebase/firestore"

import {
  Building, Factory, Wrench, Truck, Package, Landmark,
  ChevronDown, QrCode, Smartphone, Settings, LogOut, Clock, History, Presentation, Users, Loader2, ShieldCheck, MessageSquareText, Receipt, CalendarDays, Globe, ShoppingCart, FileText, LayoutList, Tags, ClipboardList, AlertTriangle
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { Department } from "@/lib/constants"
import { useAuth } from "@/context/auth-context"
import { useFirebase } from "@/firebase"
import type { UserProfile } from "@/lib/types"


const departmentNames: Record<Department, string> = {
    MANAGEMENT: "ฝ่ายบริหาร",
    OFFICE: "แผนกออฟฟิศ",
    PURCHASING: "จัดซื้อ/สต๊อค",
    ACCOUNTING_HR: "แผนกบัญชี/บุคคล",
    CAR_SERVICE: "งานซ่อมหน้าร้าน",
    COMMONRAIL: "แผนกคอมมอนเรล",
    MECHANIC: "แผนกแมคคานิค",
    OUTSOURCE: "งานนอก",
    WEB_MANAGEMENT: "จัดการเว็บไซต์",
};

const SubNavLink = ({ href, label, icon: Icon, onClick }: { href: string; label: string; icon?: React.ElementType; onClick?: () => void }) => {
    const pathname = usePathname();
    const isActive = pathname === href;
    return (
        <Button
            asChild
            variant={isActive ? "secondary" : "ghost"}
            className="w-full justify-start text-muted-foreground text-sm h-9"
            onClick={onClick}
        >
            <Link href={href}>
                {Icon && <Icon className="mr-2 h-3.5 w-3.5" />}
                {label}
            </Link>
        </Button>
    );
};

const OfficeJobManagementSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const isOpen = pathname.startsWith('/app/office/jobs/management');
    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                 <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground">
                    จัดการงานซ่อม
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/office/jobs/management/all" label="งานทั้งหมด" onClick={onLinkClick} />
                <SubNavLink href="/app/office/jobs/management/by-department" label="งานตามแผนก" onClick={onLinkClick} />
                <SubNavLink href="/app/office/jobs/management/by-status" label="งานตามสถานะ" onClick={onLinkClick} />
                <SubNavLink href="/app/office/jobs/management/history" label="ประวัติงานซ่อม" onClick={onLinkClick} />
            </CollapsibleContent>
        </Collapsible>
    );
};


const ManagementAccountingSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    
    const isAccountingDocActive = 
        pathname.startsWith('/app/office/documents/delivery-note') || 
        pathname.startsWith('/app/office/documents/tax-invoice');
        
    const isOpen = pathname.startsWith('/app/management/accounting') || isAccountingDocActive;
    
    const isDocSubGroupActive = 
        pathname.startsWith('/app/management/accounting/documents') || 
        isAccountingDocActive;

    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                    แผนกบัญชี
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/management/accounting/inbox" label="รอตรวจสอบรายการขาย" onClick={onLinkClick} />
                <SubNavLink href="/app/management/accounting/purchase-inbox" label="รอตรวจสอบรายการซื้อ" onClick={onLinkClick} />
                <SubNavLink href="/app/management/accounting/cashbook" label="รับ–จ่ายเงิน" onClick={onLinkClick} />
                <SubNavLink href="/app/management/accounting/receivables-payables" label="ลูกหนี้/เจ้าหนี้" onClick={onLinkClick} />
                <SubNavLink href="/app/management/accounting/accounts" label="บัญชีเงินสด/ธนาคาร" onClick={onLinkClick} />
                <SubNavLink href="/app/management/accounting/payroll-payouts" label="จ่ายเงินเดือน" onClick={onLinkClick} />
                <Collapsible defaultOpen={isDocSubGroupActive}>
                    <CollapsibleTrigger asChild>
                        <Button variant={isDocSubGroupActive ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                            เอกสารบัญชี
                            <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="py-1 pl-4 space-y-1">
                        <SubNavLink href="/app/office/documents/delivery-note" label="ใบส่งของชั่วคราว" onClick={onLinkClick} />
                        <SubNavLink href="/app/office/documents/tax-invoice" label="ใบกำกับภาษี" onClick={onLinkClick} />
                        <SubNavLink href="/app/management/accounting/documents/receipt" label="ใบเสร็จรับเงิน" onClick={onLinkClick} />
                        <SubNavLink href="/app/management/accounting/documents/billing-note" label="ใบวางบิล" onClick={onLinkClick} />
                        <SubNavLink href="/app/management/accounting/documents/credit-note" label="ใบลดหนี้" onClick={onLinkClick} />
                        <SubNavLink href="/app/management/accounting/documents/withholding-tax" label="ใบหัก ณ ที่จ่าย" onClick={onLinkClick} />
                    </CollapsibleContent>
                </Collapsible>
            </CollapsibleContent>
        </Collapsible>
    );
};

const HRSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const isOpen = pathname.startsWith('/app/management/hr');
    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                    แผนกบุคคล
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/management/hr/employees" label="จัดการพนักงาน" onClick={onLinkClick} />
                <SubNavLink href="/app/management/hr/leaves" label="จัดการวันลาพนักงาน" onClick={onLinkClick} />
                <SubNavLink href="/app/management/hr/attendance-summary" label="จัดการการลงเวลา" onClick={onLinkClick} />
                <SubNavLink href="/app/management/hr/payroll" label="สลิปเงินเดือน" onClick={onLinkClick} />
            </CollapsibleContent>
        </Collapsible>
    );
};

const WebManagementSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const isOpen = pathname.startsWith('/app/admin/web-management');
    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                    จัดการเว็บไซต์
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/admin/web-management" label="จัดการหน้าแรก" onClick={onLinkClick} />
                <SubNavLink href="/app/admin/web-management/products" label="จัดการหน้าสินค้า" onClick={onLinkClick} />
                <SubNavLink href="/app/admin/web-management/services" label="จัดการหน้างานบริการ" onClick={onLinkClick} />
            </CollapsibleContent>
        </Collapsible>
    );
};

const AdminSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const isOpen = pathname.startsWith('/app/admin') && !pathname.startsWith('/app/admin/web-management');
    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                    <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Admin</span>
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/admin/users" label="จัดการผู้ใช้ / Maintenance" onClick={onLinkClick} />
                <SubNavLink href="/app/admin/stock-log" label="ประวัติสต๊อก (Activity Log)" onClick={onLinkClick} />
            </CollapsibleContent>
        </Collapsible>
    );
};

const SettingsSubMenu = ({ onLinkClick }: { onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const isOpen = pathname.startsWith('/app/management/settings') || pathname.startsWith('/app/management/hr/settings') || pathname.startsWith('/app/management/hr/holidays');
    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                    ตั้งค่า
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-4 space-y-1">
                <SubNavLink href="/app/management/settings/store" label="ตั้งค่าร้าน/เวลา" onClick={onLinkClick} />
                <SubNavLink href="/app/management/settings/documents" label="ตั้งค่าเลขที่เอกสาร" onClick={onLinkClick} />
                <SubNavLink href="/app/management/hr/settings" label="ตั้งค่า HR" onClick={onLinkClick} />
                <SubNavLink href="/app/management/settings/sso-hospitals" label="รพ. ประกันสังคม" onClick={onLinkClick} />
                 <SubNavLink href="/app/management/hr/holidays" label="ตั้งค่าวันหยุด" onClick={onLinkClick} />
            </CollapsibleContent>
        </Collapsible>
    );
};

const CarServiceByWorkerNav = ({ onLinkClick }: { onLinkClick?: () => void }) => {
  const { db } = useFirebase();
  const pathname = usePathname();
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!db) return;

    const fetchWorkers = async () => {
      setIsLoading(true);
      const workersQuery = query(
        collection(db, "users"),
        where("department", "==", "CAR_SERVICE"),
        where("role", "==", "WORKER"),
        where("status", "==", "ACTIVE")
      );
      try {
        const querySnapshot = await getDocs(workersQuery);
        const fetchedWorkers = querySnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setWorkers(fetchedWorkers);
      } catch (error) {
        console.error("Failed to fetch workers:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkers();
  }, [db]);

  const isOpen = pathname.startsWith('/app/car-service/jobs/by-worker');

  return (
    <Collapsible defaultOpen={isOpen}>
      <CollapsibleTrigger asChild>
        <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground">
          งานตามพนักงาน
          <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="py-1 pl-4 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : workers.length > 0 ? (
          workers.map(worker => (
            <SubNavLink 
              key={worker.uid}
              href={`/app/car-service/jobs/by-worker/${worker.uid}`}
              label={worker.displayName}
              onClick={onLinkClick} 
            />
          ))
        ) : (
          <p className="p-2 text-xs text-muted-foreground">ไม่พบรายชื่อช่าง</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

const DepartmentMenu = ({ department, onLinkClick }: { department: Department, onLinkClick?: () => void }) => {
    const pathname = usePathname();
    const { profile } = useAuth();

    const departmentPath = `/app/${department.toLowerCase().replace('_', '-')}`
    const isOpen = pathname.startsWith(departmentPath)

    const icons: Record<Department, React.ElementType> = {
        MANAGEMENT: Building,
        OFFICE: Landmark,
        PURCHASING: ShoppingCart,
        ACCOUNTING_HR: Users,
        CAR_SERVICE: Truck,
        COMMONRAIL: Factory,
        MECHANIC: Wrench,
        OUTSOURCE: Package,
        WEB_MANAGEMENT: Globe,
    };
    const Icon = icons[department];
    const canSeeAccounting = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT' || profile?.department === 'ACCOUNTING_HR';
    const isSystemAdmin = profile?.role === 'ADMIN';

    return (
        <Collapsible defaultOpen={isOpen}>
            <CollapsibleTrigger asChild>
                <Button variant={isOpen ? "secondary" : "ghost"} className="w-full justify-between">
                    <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {departmentNames[department]}
                    </span>
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="py-1 pl-6 space-y-1">
                {department === 'MANAGEMENT' && (
                    <>
                        <SubNavLink href="/app/management/dashboard" label="แดชบอร์ด" onClick={onLinkClick} />
                        <SubNavLink href="/app/office/jobs/management/by-status" label="งานตามสถานะ" onClick={onLinkClick} />
                        {canSeeAccounting && (
                           <ManagementAccountingSubMenu onLinkClick={onLinkClick} />
                        )}
                        <HRSubMenu onLinkClick={onLinkClick} />
                        <WebManagementSubMenu onLinkClick={onLinkClick} />
                        <SettingsSubMenu onLinkClick={onLinkClick} />
                        {isSystemAdmin && <AdminSubMenu onLinkClick={onLinkClick} />}
                    </>
                )}
                {department === 'OFFICE' && (
                     <>
                        <SubNavLink href="/app/office/intake" label="เปิดงานใหม่ (Intake)" onClick={onLinkClick} />
                        <OfficeJobManagementSubMenu onLinkClick={onLinkClick} />
                        
                        <Collapsible defaultOpen={pathname.startsWith('/app/office/list-management') || pathname.startsWith('/app/management/customers')}>
                            <CollapsibleTrigger asChild>
                                <Button variant={(pathname.startsWith('/app/office/list-management') || pathname.startsWith('/app/management/customers')) ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground">
                                    การจัดการรายชื่อ
                                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="py-1 pl-4 space-y-1">
                                <SubNavLink href="/app/management/customers" label="จัดการรายชื่อลูกค้า" onClick={onLinkClick} />
                            </CollapsibleContent>
                        </Collapsible>

                        <Collapsible defaultOpen={pathname.startsWith('/app/office/documents')}>
                            <CollapsibleTrigger asChild>
                                <Button variant={pathname.startsWith('/app/office/documents') ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground">
                                    จัดการเอกสาร
                                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="py-1 pl-4 space-y-1">
                                <SubNavLink href="/app/office/documents/quotation" label="ใบเสนอราคา" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/documents/delivery-note" label="ใบส่งของชั่วคราว" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/documents/tax-invoice" label="ใบกำกับภาษี" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/documents/quotation/templates" label="Template ใบเสนอราคา" onClick={onLinkClick} />
                            </CollapsibleContent>
                        </Collapsible>
                        <SubNavLink href="/app/office/cash-drawer" label="เงินสดหน้าร้าน" onClick={onLinkClick} />
                    </>
                )}
                {department === 'PURCHASING' && (
                    <>
                        <SubNavLink href="/app/office/jobs/management/by-status?status=pending-parts" label="งานตามสถานะ" onClick={onLinkClick} />
                        <SubNavLink href="/app/office/parts/list" label="รายการและสต๊อคสินค้า" onClick={onLinkClick} />
                        <SubNavLink href="/app/office/parts/low-stock" label="รายการที่ต้องเตรียมสั่ง" onClick={onLinkClick} />
                        
                        <Collapsible defaultOpen={pathname.startsWith('/app/office/parts/purchases') || pathname.startsWith('/app/office/parts/withdraw') || pathname.startsWith('/app/office/documents/quotation')}>
                            <CollapsibleTrigger asChild>
                                <Button variant={(pathname.startsWith('/app/office/parts/purchases') || pathname.startsWith('/app/office/parts/withdraw') || pathname.startsWith('/app/office/documents/quotation')) ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                                    จัดการเอกสาร
                                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="py-1 pl-4 space-y-1">
                                <SubNavLink href="/app/office/parts/purchases" label="รายการซื้อสินค้า" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/parts/withdraw" label="รายการเบิกสินค้า" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/documents/quotation" label="ใบเสนอราคา" onClick={onLinkClick} />
                            </CollapsibleContent>
                        </Collapsible>

                        <Collapsible defaultOpen={pathname.startsWith('/app/office/parts/categories') || pathname.startsWith('/app/office/parts/locations') || pathname.startsWith('/app/office/parts/vendors')}>
                            <CollapsibleTrigger asChild>
                                <Button variant={(pathname.startsWith('/app/office/parts/categories') || pathname.startsWith('/app/office/parts/locations') || pathname.startsWith('/app/office/parts/vendors')) ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9 text-muted-foreground text-sm">
                                    ตั้งค่า (งานอะไหล่)
                                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="py-1 pl-4 space-y-1">
                                <SubNavLink href="/app/office/parts/vendors" label="จัดการรายชื่อร้านค้า" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/parts/categories" label="หมวดหมู่อะไหล่" onClick={onLinkClick} />
                                <SubNavLink href="/app/office/parts/locations" label="จัดการชั้นวางสินค้า" onClick={onLinkClick} />
                            </CollapsibleContent>
                        </Collapsible>
                    </>
                )}
                {department === 'ACCOUNTING_HR' && (
                    <>
                        <SubNavLink href="/app/office/jobs/management/by-status?status=done" label="งานตามสถานะ" onClick={onLinkClick} />
                        <ManagementAccountingSubMenu onLinkClick={onLinkClick} />
                        <HRSubMenu onLinkClick={onLinkClick} />
                    </>
                )}
                {department === 'CAR_SERVICE' && (
                    <>
                       <SubNavLink href="/app/car-service/jobs/all" label="งานทั้งหมด" onClick={onLinkClick} />
                       {profile?.role === 'OFFICER' ? (
                            <CarServiceByWorkerNav onLinkClick={onLinkClick} />
                       ) : (
                            profile?.role === 'WORKER' && <SubNavLink href="/app/car-service/jobs/my" label="งานของฉัน" onClick={onLinkClick} />
                       )}
                    </>
                )}
                {department === 'COMMONRAIL' && (
                    <>
                       <SubNavLink href="/app/commonrail/jobs/all" label="งานทั้งหมด" onClick={onLinkClick} />
                       {profile?.role === 'WORKER' && <SubNavLink href="/app/commonrail/jobs/my" label="งานของฉัน" onClick={onLinkClick} />}
                    </>
                )}
                {department === 'MECHANIC' && (
                    <>
                       <SubNavLink href="/app/mechanic/jobs/all" label="งานทั้งหมด" onClick={onLinkClick} />
                       {profile?.role === 'WORKER' && <SubNavLink href="/app/mechanic/jobs/my" label="งานของฉัน" onClick={onLinkClick} />}
                    </>
                )}
                 {department === 'OUTSOURCE' && (
                    <>
                        {profile?.role === 'WORKER' ? (
                            <>
                                <SubNavLink href="/app/outsource/jobs/my" label="งานของฉัน" onClick={onLinkClick} />
                            </>
                        ) : (
                            <>
                                <SubNavLink href="/app/outsource/export/new" label="สร้างรายการส่งออก" onClick={onLinkClick} />
                                <SubNavLink href="/app/outsource/import" label="รับกลับเข้าระบบ" onClick={onLinkClick} />
                                <Collapsible defaultOpen={pathname.startsWith('/app/outsource/tracking')}>
                                    <CollapsibleTrigger asChild>
                                        <Button variant={pathname.startsWith('/app/outsource/tracking') ? "secondary" : "ghost"} className="w-full justify-between font-normal h-9">
                                            ติดตาม
                                            <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                        </Button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="py-1 pl-4 space-y-1">
                                        <SubNavLink href="/app/outsource/tracking/pending" label="รอส่ง" onClick={onLinkClick} />
                                        <SubNavLink href="/app/outsource/tracking/away" label="อยู่ร้านนอก" onClick={onLinkClick} />
                                        <SubNavLink href="/app/outsource/tracking/returned" label="รับกลับแล้ว" onClick={onLinkClick} />
                                    </CollapsibleContent>
                                </Collapsible>
                            </>
                        )}
                    </>
                )}
            </CollapsibleContent>
        </Collapsible>
    )
}

export function AppNav({ onLinkClick }: { onLinkClick?: () => void }) {
    const pathname = usePathname();
    const { profile, loading } = useAuth();
    const isAttendanceOpen = pathname.startsWith('/app/kiosk') || pathname.startsWith('/app/attendance');

    // Attendance QR only visible for specific technical/office roles, not restricted admin depts
    const showAttendance = useMemo(() => {
        if (!profile) return false;
        if (profile.role === 'ADMIN') return true;
        // Hide QR attendance menu for Purchasing and Accounting/HR as requested
        if (['PURCHASING', 'ACCOUNTING_HR', 'MANAGEMENT'].includes(profile.department || '')) return false;
        return true;
    }, [profile]);

    const departmentsToShow = useMemo(() => {
        if (!profile) return [];
        
        // ADMIN or MANAGEMENT department sees all main administrative departments
        if (profile.role === 'ADMIN' || profile.department === 'MANAGEMENT') {
            return ["MANAGEMENT", "OFFICE", "PURCHASING", "ACCOUNTING_HR"];
        }
        
        // Staff (and Managers in specific departments) see ONLY their assigned department
        return profile.department ? [profile.department as Department] : [];
    }, [profile]);

    if (loading) {
        return (
            <div className="p-4 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <>
            <nav 
                className="grid items-start px-2 text-sm font-medium"
            >
                {showAttendance && (
                    <>
                        <Collapsible defaultOpen={isAttendanceOpen}>
                            <CollapsibleTrigger asChild>
                                <Button variant={isAttendanceOpen ? "secondary" : "ghost"} className="w-full justify-between">
                                    <span className="flex items-center gap-2">
                                        <QrCode className="h-4 w-4" />
                                        QR ลงเวลา
                                    </span>
                                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="py-1 pl-6 space-y-1">
                                {profile?.role === 'OFFICER' && (
                                    <SubNavLink href="/app/kiosk" label="คอมกลาง (ลงเวลา)" onClick={onLinkClick} />
                                )}
                                { !(profile?.role === 'OFFICER' && profile?.department === 'CAR_SERVICE') && (
                                  <SubNavLink href="/app/attendance/history" label="ประวัติลงเวลา" onClick={onLinkClick} />
                                )}
                            </CollapsibleContent>
                        </Collapsible>
                        
                        <div className="my-2 border-t"></div>
                    </>
                )}

                {departmentsToShow.map(dept => <DepartmentMenu key={dept} department={dept} onLinkClick={onLinkClick} />)}
            </nav>
        </>
    );
}
