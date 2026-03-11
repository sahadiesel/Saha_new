
"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { Loader2, LayoutDashboard, Landmark, Wrench, Package, Truck, UserCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function AppHomePage() {
  const { profile, loading, signOut } = useAuth();
  const router = useRouter();
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!profile) {
      router.replace('/login');
      return;
    }

    const role = profile.role;
    const department = profile.department;

    // Redirection Logic
    let targetPath = '/app/jobs'; // Default fallback

    if (role === 'ADMIN' || department === 'MANAGEMENT') {
      targetPath = '/app/management/dashboard';
    } else if (role === 'OFFICER' && department === 'CAR_SERVICE') {
      targetPath = '/app/kiosk';
    } else {
      switch (department) {
        case 'OFFICE':
          targetPath = '/app/office/intake';
          break;
        case 'PURCHASING':
          targetPath = '/app/office/jobs/management/by-status?status=pending-parts';
          break;
        case 'ACCOUNTING_HR':
          targetPath = '/app/management/accounting/inbox';
          break;
        case 'CAR_SERVICE':
          targetPath = '/app/car-service/jobs/all';
          break;
        case 'COMMONRAIL':
          targetPath = '/app/commonrail/jobs/all';
          break;
        case 'MECHANIC':
          targetPath = '/app/mechanic/jobs/all';
          break;
        case 'OUTSOURCE':
          targetPath = profile.role === 'WORKER' ? '/app/outsource/jobs/my' : '/app/outsource/tracking/pending';
          break;
      }
    }

    // Attempt to navigate
    const timer = setTimeout(() => {
      // If still on this page after 3 seconds, show fallback UI
      setShowFallback(true);
    }, 3000);

    router.replace(targetPath);

    return () => clearTimeout(timer);
  }, [profile, loading, router]);

  if (loading) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center p-4">
      {!showFallback ? (
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-500">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-base font-medium text-muted-foreground animate-pulse">
            กำลังเตรียมหน้าจอส่วนตัวของคุณ...
          </p>
        </div>
      ) : (
        <Card className="w-full max-w-lg shadow-2xl border-primary/20 animate-in zoom-in-95 duration-300">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-primary">ยินดีต้อนรับคุณ {profile?.displayName}</CardTitle>
            <CardDescription>
              ระบบกำลังนำทางคุณไปยังหน้าจอหลัก แต่ดูเหมือนจะใช้เวลานานกว่าปกติค่ะ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button asChild className="h-14 font-bold text-lg" variant="default">
                <Link href="/app/management/dashboard">
                  <LayoutDashboard className="mr-2 h-5 w-5" />
                  ไปหน้า Dashboard
                </Link>
              </Button>
              <Button asChild className="h-14 font-bold text-lg" variant="secondary">
                <Link href="/app/jobs">
                  <Wrench className="mr-2 h-5 w-5" />
                  ไปหน้างานซ่อม
                </Link>
              </Button>
              <Button asChild className="h-14 font-bold text-lg" variant="outline">
                <Link href="/app/office/intake">
                  <PlusCircle className="mr-2 h-5 w-5" />
                  เปิดงานใหม่ (Intake)
                </Link>
              </Button>
              <Button asChild className="h-14 font-bold text-lg" variant="outline">
                <Link href="/settings">
                  <UserCircle className="mr-2 h-5 w-5" />
                  โปรไฟล์ของฉัน
                </Link>
              </Button>
            </div>
            
            <Separator />
            
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <p>หากกดแล้วยังไม่เปลี่ยนหน้า กรุณารีเฟรชบราวเซอร์ (F5) ค่ะ</p>
              <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-destructive font-bold">
                <LogOut className="mr-1 h-3 w-3" /> ออกจากระบบ
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
