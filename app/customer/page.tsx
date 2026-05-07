"use client";

import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Phone, ArrowRight, Wrench, History, Package } from "lucide-react";

export default function CustomerHomePage() {
  const { profile, loading } = useAuth();

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="container mx-auto flex-1 px-4 pb-16 pt-24 md:pt-28 max-w-2xl space-y-6">
        <Card className="border-white/10 bg-slate-900/80 text-white backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl font-headline text-white">
              สวัสดีค่ะ คุณ{profile.displayName}
            </CardTitle>
            <CardDescription className="text-slate-300">
              พอร์ทัลลูกค้า — ติดตามงานซ่อมและบริการออนไลน์
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-slate-200 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild variant="secondary" className="h-auto py-4 flex-col gap-2">
                <Link href="/customer/jobs">
                  <Wrench className="h-5 w-5" />
                  <span className="font-bold">งานระหว่างดำเนินการ</span>
                </Link>
              </Button>
              <Button asChild variant="secondary" className="h-auto py-4 flex-col gap-2">
                <Link href="/customer/jobs/history">
                  <History className="h-5 w-5" />
                  <span className="font-bold">ประวัติงานซ่อม</span>
                </Link>
              </Button>
            </div>
            <Button asChild className="w-full h-12 gap-2 bg-primary text-primary-foreground font-bold">
              <Link href="/products">
                <Package className="h-4 w-4" />
                สินค้าและอะไหล่
              </Link>
            </Button>
            <p className="text-slate-400 pt-2">
              หากต้องการสอบถามเพิ่มเติม โปรดติดต่อศูนย์โดยตรง
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild className="bg-primary text-primary-foreground font-bold">
                <Link href="/contact">
                  <Phone className="mr-2 h-4 w-4" />
                  ติดต่อเรา
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                <Link href="/">
                  กลับหน้าแรก
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
