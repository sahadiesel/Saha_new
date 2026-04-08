"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { FixStuckUI } from "@/components/fix-stuck-ui";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

function FullscreenSpinner() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
    </div>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/pending" ||
    pathname === "/signup" ||
    pathname === "/healthz" ||
    pathname === "/products" ||
    pathname === "/services" || // เพิ่ม /services เข้าในรายการหน้าสาธารณะ
    pathname === "/contact";

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (!isPublicRoute) {
        router.replace("/login");
      }
      return;
    }

    // Auto-redirect to Home (not app) from auth pages if already logged in
    const isAuthPage = pathname === "/login" || pathname === "/signup";
    
    if (isAuthPage) {
        if (profile?.status === "ACTIVE") {
            router.replace("/"); // Redirect to Home
        } else if (profile) {
            router.replace("/pending");
        }
        return;
    }

    if (!isPublicRoute) {
        if (!profile || (profile.status && profile.status !== "ACTIVE")) {
            if (pathname !== "/pending") {
                router.replace("/pending");
            }
        }
    }
  }, [loading, user, profile, router, pathname, isPublicRoute]);

  if (isPublicRoute) {
    return <>{children}</>;
  }
  
  if (loading || !user || (!profile && pathname !== "/pending")) {
    return <FullscreenSpinner />;
  }
  
  if (!profile && pathname === "/pending") {
      return <div className="p-4">{children}</div>;
  }
  
  const isPrintMode = searchParams.get("print") === "1";
  if (isPrintMode) {
    return (
      <>
        <FixStuckUI />
        <main className="min-h-screen w-full p-0">{children}</main>
      </>
    );
  }

  return (
    <>
      <FixStuckUI />
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col sm:pl-64 print:pl-0 overflow-hidden">
          <AppHeader />
          <main className="flex-1 p-4 md:p-8 lg:p-10 print:p-0 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}

export function AppShellClient({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Suspense fallback={<FullscreenSpinner />}>
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}
