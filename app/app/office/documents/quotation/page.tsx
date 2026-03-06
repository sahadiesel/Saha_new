"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { PlusCircle, LayoutTemplate } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { useAuth } from "@/context/auth-context";

export default function OfficeQuotationPage() {
    const { profile } = useAuth();
    
    // Check if user has write permission (Office, Admin, Manager)
    const canManage = profile?.role === 'ADMIN' || 
                      profile?.role === 'MANAGER' || 
                      profile?.department === 'OFFICE' || 
                      profile?.department === 'MANAGEMENT';

    return (
        <div className="space-y-6">
            <PageHeader 
                title="ใบเสนอราคา" 
                description="ค้นหาและจัดการใบเสนอราคาทั้งหมด" 
                className="mb-0"
            >
                {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline">
                            <Link href="/app/office/documents/quotation/templates">
                                <LayoutTemplate className="mr-2 h-4 w-4" />
                                จัดการ Template
                            </Link>
                        </Button>
                        <Button asChild variant="outline">
                            <Link href="/app/office/jobs/management/quotation">
                                สร้างจากงานซ่อม
                            </Link>
                        </Button>
                        <Button asChild>
                            <Link href="/app/office/documents/quotation/new">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                สร้างใบเสนอราคาใหม่
                            </Link>
                        </Button>
                    </div>
                )}
            </PageHeader>
            
            <DocumentList
                docType="QUOTATION"
            />
        </div>
    );
}
