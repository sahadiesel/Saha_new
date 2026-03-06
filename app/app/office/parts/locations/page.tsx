
"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, MapPin } from "lucide-react";

export default function PartLocationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="จัดการชั้นวางสินค้า" description="กำหนดพิกัดตำแหน่งการจัดเก็บอะไหล่ในคลัง" />
      
      <Alert className="bg-primary/5 border-primary/20">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle className="font-bold">ข้อมูลการจัดการคลัง</AlertTitle>
        <AlertDescription>
          หน้านี้ใช้สำหรับระบุโซนและรหัสชั้นวางสินค้าเพื่อให้พนักงานหาของได้รวดเร็วขึ้นครับ (ระบบกำลังพัฒนารูปแบบการจัดการ Grid)
        </AlertDescription>
      </Alert>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <MapPin className="h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm">ฟีเจอร์การสร้างแผนผังชั้นวางกำลังอยู่ระหว่างการพัฒนา</p>
          <p className="text-[10px]">ในระหว่างนี้ ท่านสามารถระบุชื่อตำแหน่งในหน้า "รายการและสต๊อคสินค้า" ได้ทันทีครับ</p>
        </CardContent>
      </Card>
    </div>
  );
}
