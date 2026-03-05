
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AppHomePage() {
  const { profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!profile) {
      router.replace('/login');
      return;
    }

    const role = profile.role;
    const department = profile.department;

    // 1. System Admins and MANAGEMENT department go to Dashboard
    // We no longer send generic MANAGERS to dashboard to respect departmental boundaries
    if (role === 'ADMIN' || department === 'MANAGEMENT') {
      router.replace('/app/management/dashboard');
      return;
    }

    // 2. Special role: Officer in Car Service (Kiosk/Central Tablet)
    if (role === 'OFFICER' && department === 'CAR_SERVICE') {
      router.replace('/app/kiosk');
      return;
    }

    // 3. Regular Department Routing (Land on the most relevant operational page)
    switch (department) {
      case 'OFFICE':
        router.replace('/app/office/intake');
        break;
      case 'PURCHASING':
        // Land on Job Management filtered to parts status
        router.replace('/app/office/jobs/management/by-status?status=pending-parts');
        break;
      case 'ACCOUNTING_HR':
        // Land on Accounting Inbox
        router.replace('/app/management/accounting/inbox');
        break;
      case 'CAR_SERVICE':
        router.replace('/app/car-service/jobs/all');
        break;
      case 'COMMONRAIL':
        router.replace('/app/commonrail/jobs/all');
        break;
      case 'MECHANIC':
        router.replace('/app/mechanic/jobs/all');
        break;
      case 'OUTSOURCE':
        if (role === 'WORKER') {
          router.replace('/app/outsource/jobs/my');
        } else {
          router.replace('/app/outsource/tracking/pending');
        }
        break;
      default:
        // Fallback for roles without specific landing pages
        router.replace('/app/jobs');
        break;
    }
  }, [profile, loading, router]);

  return (
    <div className="flex h-[80vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium animate-pulse">
          กำลังเตรียมหน้าจอส่วนตัวของคุณ...
        </p>
      </div>
    </div>
  );
}
