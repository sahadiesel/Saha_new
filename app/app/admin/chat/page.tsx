"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function AdminChatPage() {
  const router = useRouter();
  
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Chat with Nong Jimmy" 
        description="ระบบผู้ช่วยส่วนตัว AI" 
      />
      
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <AlertCircle className="h-16 w-16 text-amber-500" />
        <Card className="max-w-md text-center border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">ปิดการใช้งานชั่วคราว</CardTitle>
            <CardDescription className="text-amber-700 font-medium">
              ฟีเจอร์ AI "น้องจิมมี่" ถูกปิดการใช้งานเพื่อลดค่าใช้จ่ายและปรับปรุงระบบฐานข้อมูลค่ะ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.back()} className="border-amber-300 hover:bg-amber-100">
              <ArrowLeft className="mr-2 h-4 w-4" /> ย้อนกลับ
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
