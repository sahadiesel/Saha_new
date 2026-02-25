"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Bot, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function CarRepairAIChatPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] space-y-3">
      <PageHeader 
        title="สอบถามน้องจิมมี่ (AI ช่างเทคนิค)" 
        description="ระบบวิเคราะห์อาการเสียอัจฉริยะ"
      />

      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <Bot className="h-20 w-20 text-muted-foreground opacity-20" />
        <Card className="max-w-md text-center border-dashed">
          <CardHeader>
            <CardTitle>ระบบปิดให้บริการ</CardTitle>
            <CardDescription>
              ฟีเจอร์ผู้ช่วย AI ฝ่ายเทคนิคถูกยกเลิกการใช้งานแล้วค่ะพี่ๆ ช่าง
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" /> กลับไปหน้างานซ่อม
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
