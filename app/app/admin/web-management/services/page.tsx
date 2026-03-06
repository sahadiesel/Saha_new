
"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, PlusCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function WebManagementServicesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="จัดการหน้างานบริการ" description="แก้ไขข้อมูลงานบริการและขั้นตอนการซ่อมบำรุงบนหน้าเว็บไซต์" />
      
      <Alert variant="secondary" className="bg-amber-50 border-amber-200 text-amber-800">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertTitle>กำลังอยู่ระหว่างการพัฒนา</AlertTitle>
        <AlertDescription>
          ส่วนนี้จะใช้สำหรับเพิ่มเนื้อหารายละเอียดงานบริการ เช่น บริการล้างหัวฉีด, งานซ่อมช่วงล่าง พร้อมรูปภาพประกอบขั้นตอนการทำงานค่ะ
        </AlertDescription>
      </Alert>

      <Card className="border-dashed">
        <CardHeader className="text-center py-12">
          <div className="mx-auto bg-muted p-4 rounded-full w-fit mb-4">
            <Settings className="h-10 w-10 text-muted-foreground" />
          </div>
          <CardTitle>ยังไม่มีรายการงานบริการ</CardTitle>
          <CardDescription>คุณสามารถเพิ่มรายละเอียดงานบริการต่างๆ ได้ที่นี่</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-12">
          <Button disabled>
            <PlusCircle className="mr-2 h-4 w-4" />
            เพิ่มงานบริการใหม่
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
