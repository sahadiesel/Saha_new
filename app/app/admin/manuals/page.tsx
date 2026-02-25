"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { BookX, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function ManualUploadPage() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <PageHeader 
        title="คลังคู่มือซ่อมรถยนต์" 
        description="ฐานข้อมูลคู่มือเทคนิค" 
      />

      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <BookX className="h-16 w-16 text-muted-foreground opacity-20" />
        <Card className="max-w-md text-center border-dashed">
          <CardHeader>
            <CardTitle>ปิดคลังคู่มือ</CardTitle>
            <CardDescription>
              ระบบคลังคู่มือ PDF ถูกยกเลิกเพื่อลดภาระการจัดเก็บข้อมูลค่ะ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" /> ย้อนกลับ
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
