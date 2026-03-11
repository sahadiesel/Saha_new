"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, UserX } from "lucide-react";

export default function PendingPage() {
  const { signOut, user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return; 

    if (!user) {
      router.replace("/login");
      return;
    }
    
    if (profile?.status === "ACTIVE") {
      router.replace("/app");
    }
  }, [user, profile, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Handle case where user is logged in but profile doesn't exist in Firestore
  if (!profile) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit mb-4">
                <UserX className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-headline">Profile Not Found</CardTitle>
            <CardDescription>
              ไม่พบข้อมูลโปรไฟล์ของคุณในระบบ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-6 text-sm text-muted-foreground">
              คุณได้เข้าสู่ระบบแล้ว แต่ดูเหมือนว่าข้อมูลโปรไฟล์พนักงานจะยังไม่ได้ถูกสร้าง 
              กรุณาติดต่อฝ่ายบุคคลหรือผู้ดูแลระบบเพื่อเปิดใช้งานบัญชีค่ะ
            </p>
            <Button variant="outline" onClick={signOut}>
              ออกจากระบบ (Logout)
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profile.status === 'PENDING') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-2xl font-headline">Account Pending</CardTitle>
            <CardDescription>
              บัญชีของคุณอยู่ระหว่างรอการอนุมัติ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-6 text-sm text-muted-foreground">
              กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานบัญชี 
              คุณจะสามารถเข้าใช้งานระบบได้ทันทีเมื่อบัญชีได้รับการอนุมัติเรียบร้อยแล้วค่ะ
            </p>
            <Button variant="outline" onClick={signOut}>
              ออกจากระบบ (Logout)
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md text-center">
            <CardHeader>
                <CardTitle className="text-2xl font-headline">Account Restricted</CardTitle>
                <CardDescription>
                    สถานะบัญชีปัจจุบัน: {profile.status}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <p className="mb-6 text-sm text-muted-foreground">
                    บัญชีของคุณถูกจำกัดการเข้าใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบเพื่อขอข้อมูลเพิ่มเติมค่ะ
                </p>
                <Button variant="outline" onClick={signOut}>
                    ออกจากระบบ (Logout)
                </Button>
            </CardContent>
        </Card>
    </div>
  );
}