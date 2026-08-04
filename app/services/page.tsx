"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Wrench, Construction, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAppNavLabel } from "@/context/public-site-language-context";
import type { LandingPageContent } from "@/app/page";

export const dynamic = 'force-dynamic';

export default function ServicesPage() {
  const { db } = useFirebase();
  const { t } = useAppNavLabel();
  const [content, setContent] = useState<LandingPageContent | null>(null);

  useEffect(() => {
    if (!db) return;
    const fetchContent = async () => {
      try {
        const docSnap = await getDoc(doc(db, "settings", "landingPage"));
        if (docSnap.exists()) {
          setContent(docSnap.data() as LandingPageContent);
        }
      } catch (e) {
        console.error("Failed to fetch landing page content:", e);
      }
    };
    fetchContent();
  }, [db]);

  const bgImage = PlaceHolderImages.find(img => img.id === "login-bg") || PlaceHolderImages[0];

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <PublicHeader />

      {/* Shared Background */}
      <div className="fixed inset-0 z-0">
        <Image
          src={bgImage.imageUrl}
          alt={bgImage.description}
          fill
          priority
          className="object-cover"
          data-ai-hint="luxury workshop"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/70 to-primary/40 backdrop-blur-[3px]" />
      </div>

      <main className="relative z-10 flex-1 flex items-center justify-center pt-24 pb-20">
        <section className="container mx-auto px-4 max-w-2xl">
          <Card className="bg-white/5 border-white/10 text-white backdrop-blur-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500">
            <CardHeader className="text-center pt-12 pb-6">
              <div className="mx-auto bg-primary/20 p-6 rounded-full w-fit mb-6 shadow-xl shadow-primary/10">
                <Construction className="h-16 w-16 text-primary animate-pulse" />
              </div>
              <CardTitle className="text-3xl md:text-4xl font-bold font-headline mb-2">{t("งานบริการ (Our Services)")}</CardTitle>
              <CardDescription className="text-slate-400 text-lg">
                {t("หน้านี้กำลังอยู่ระหว่างการปรับปรุงข้อมูลค่ะ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-12 text-center space-y-6">
              <p className="text-slate-300 leading-relaxed">
                {t("เรากำลังจัดเตรียมรายละเอียดงานบริการ ทั้งงานซ่อมบำรุงรถยนต์นำเข้า งานซ่อมปั๊มหัวฉีดคอมมอนเรล และขั้นตอนมาตรฐาน 4S เพื่อให้ท่านได้รับข้อมูลที่ครบถ้วนที่สุด")}
              </p>
              
              <div className="flex items-center justify-center gap-2 text-primary font-bold text-sm uppercase tracking-widest">
                <Wrench className="h-4 w-4" />
                <span>Coming Soon</span>
              </div>

              <div className="pt-6">
                <Button asChild variant="outline" className="border-white/20 bg-white/5 hover:bg-white/10 text-white rounded-full px-8">
                  <Link href="/">
                    <ArrowLeft className="mr-2 h-4 w-4" /> {t("กลับสู่หน้าหลัก")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <PublicFooter content={content || undefined} />
    </div>
  );
}
