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
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background gap-4">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground animate-pulse">กำลังเตรียมข้อมูลระบบ...</p>
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
    pathname === "/services" ||
    pathname === "/contact";

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (!isPublicRoute) {
        router.replace("/login");
      }
      return;
    }

    const isAuthPage = pathname === "/login" || pathname === "/signup";
    
    if (isAuthPage) {
        if (profile?.status === "ACTIVE") {
            router.replace("/");
        } else if (profile) {
            router.replace("/pending");
        }
        return;
    }

    // IF NOT PUBLIC AND LOGGED IN
    if (!isPublicRoute) {
        // Case 1: No profile found in Firestore (new user or data issue)
        if (!profile) {
            if (pathname !== "/pending") {
                router.replace("/pending");
            }
            return;
        }
        
        // Case 2: Profile exists but not active
        if (profile.status !== "ACTIVE" && pathname !== "/pending") {
            router.replace("/pending");
        }
    }
  }, [loading, user, profile, router, pathname, isPublicRoute]);

  if (isPublicRoute) {
    return <>{children}</>;
  }
  
  // Guard against stuck spinner: only spin if we are actually loading OR we definitely need to redirect
  if (loading || !user) {
    return <FullscreenSpinner />;
  }

  // If we are on a non-public route and profile is missing, redirecting is handled in useEffect.
  // We show spinner until redirected or profile loaded.
  if (!profile && pathname !== "/pending") {
      return <FullscreenSpinner />;
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