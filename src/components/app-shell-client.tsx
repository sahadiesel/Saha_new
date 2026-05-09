"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { isOfficePortalQuotationActor } from "@/lib/customer-document-access";
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

  const isMarketingPublic =
    pathname === "/" ||
    pathname === "/products" ||
    pathname === "/services" ||
    pathname === "/contact";

  const isStaffAuth = pathname === "/login" || pathname === "/signup";
  const isCustomerAuth = pathname === "/login/customer" || pathname === "/signup/customer";

  const isPublicRoute =
    isMarketingPublic ||
    isStaffAuth ||
    isCustomerAuth ||
    pathname === "/pending" ||
    pathname === "/healthz";

  const isCustomerPortal = pathname === "/customer" || pathname.startsWith("/customer/");
  /** เปิดใบเอกสารจากลิงก์พอร์ทัล — อนุญาตเจ้าหน้าที่ออฟฟิศ/บริหารเข้ายืนยันแทนลูกค้าได้ */
  const isSharedCustomerDocumentRoute = pathname.startsWith("/customer/documents/");

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (isCustomerPortal) {
        router.replace("/login/customer");
      } else if (!isPublicRoute) {
        router.replace("/login");
      }
      return;
    }

    if (isStaffAuth) {
      if (!profile) return;
      if (profile.status !== "ACTIVE") {
        router.replace("/pending");
        return;
      }
      if (profile.role === "CUSTOMER") {
        router.replace("/customer");
        return;
      }
      router.replace("/");
      return;
    }

    if (isCustomerAuth) {
      if (!profile) return;
      if (profile.status !== "ACTIVE") {
        router.replace("/pending");
        return;
      }
      if (profile.role === "CUSTOMER") {
        router.replace(profile.mustChangePassword ? "/customer/change-password" : "/customer");
        return;
      }
      router.replace("/");
      return;
    }

    if (
      profile?.role === "CUSTOMER" &&
      profile.status === "ACTIVE" &&
      profile.mustChangePassword === true &&
      isCustomerPortal &&
      pathname !== "/customer/change-password"
    ) {
      router.replace("/customer/change-password");
      return;
    }

    if (profile?.role === "CUSTOMER" && profile.status === "ACTIVE" && isCustomerPortal) {
      return;
    }

    if (profile?.role === "CUSTOMER" && profile.status === "ACTIVE" && pathname.startsWith("/app")) {
      router.replace("/customer");
      return;
    }

    if (profile && profile.role !== "CUSTOMER" && isCustomerPortal && !isSharedCustomerDocumentRoute) {
      router.replace("/app");
      return;
    }

    if (
      profile &&
      profile.role !== "CUSTOMER" &&
      isSharedCustomerDocumentRoute &&
      profile.status === "ACTIVE" &&
      !isOfficePortalQuotationActor(profile)
    ) {
      router.replace("/app");
      return;
    }

    if (isCustomerPortal && user && profile && profile.role === "CUSTOMER" && profile.status !== "ACTIVE") {
      router.replace("/pending");
      return;
    }

    if (!isPublicRoute && !isCustomerPortal) {
      if (!profile || (profile.status && profile.status !== "ACTIVE")) {
        if (pathname !== "/pending") {
          router.replace("/pending");
        }
      }
    }
  }, [loading, user, profile, router, pathname, isPublicRoute, isCustomerPortal, isStaffAuth, isCustomerAuth]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isCustomerPortal) {
    if (loading || !user) {
      return <FullscreenSpinner />;
    }
    if (!profile) {
      return <FullscreenSpinner />;
    }
    if (isSharedCustomerDocumentRoute && profile.status === "ACTIVE") {
      if (profile.role === "CUSTOMER") {
        return (
          <>
            <FixStuckUI />
            {children}
          </>
        );
      }
      if (isOfficePortalQuotationActor(profile)) {
        return (
          <>
            <FixStuckUI />
            {children}
          </>
        );
      }
    }
    if (profile.role !== "CUSTOMER" || profile.status !== "ACTIVE") {
      return <FullscreenSpinner />;
    }
    return (
      <>
        <FixStuckUI />
        {children}
      </>
    );
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
