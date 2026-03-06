
"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, PlusCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function WebManagementProductsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="จัดการหน้าสินค้า" description="แก้ไขข้อมูลสินค้าและบริการที่จะแสดงบนหน้าเว็บไซต์สาธารณะ" />
      
      <Alert variant="secondary" className="bg-blue-50 border-blue-200 text-blue-800">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertTitle>กำลังอยู่ระหว่างการพัฒนา</AlertTitle>
        <AlertDescription>
          ระบบจัดการหน้าสินค้าจะเชื่อมโยงกับฐานข้อมูลอะไหล่ในอนาคต เพื่อให้คุณสามารถเลือกสินค้าที่ต้องการโปรโมทขึ้นหน้าเว็บได้ทันทีค่ะ
        </AlertDescription>
      </Alert>

      <Card className="border-dashed">
        <CardHeader className="text-center py-12">
          <div className="mx-auto bg-muted p-4 rounded-full w-fit mb-4">
            <Package className="h-10 w-10 text-muted-foreground" />
          </div>
          <CardTitle>ยังไม่มีรายการสินค้าหน้าเว็บ</CardTitle>
          <CardDescription>คุณสามารถเพิ่มรายการสินค้าที่ต้องการโชว์หน้าเว็บได้ที่นี่</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-12">
          <Button disabled>
            <PlusCircle className="mr-2 h-4 w-4" />
            เพิ่มสินค้าแนะนำ
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
