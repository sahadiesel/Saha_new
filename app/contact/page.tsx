"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MapPin, Phone, ExternalLink } from "lucide-react";
import type { LandingPageContent } from "@/app/page";

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  const { db } = useFirebase();
  const [content, setContent] = useState<LandingPageContent>({
    heroTitle: "SAHADIESEL SERVICE CENTER",
    heroDescription: "",
    buttonText: "ตรวจสอบสถานะรถ",
    servicesTitle: "",
    s1Title: "",
    s1Desc: "",
    s2Title: "",
    s2Desc: "",
    s3Title: "",
    s3Desc: "",
    s4Title: "",
    s4Desc: "",
    footerAboutTitle: "เกี่ยวกับเรา",
    footerAboutDesc: "",
    footerContactTitle: "ติดต่อเรา",
    footerPhone: "02-XXX-XXXX",
    footerAddress: "เขตภาษีเจริญ กรุงเทพมหานคร",
    footerWebsite: "www.sahadiesel.com",
    footerFacebookUrl: "https://facebook.com/sahadiesel",
  });

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

      <main className="relative z-10 flex-1 pt-24 pb-20">
        <section className="container mx-auto px-4">
          <div className="mb-12 animate-in fade-in slide-in-from-top-4 duration-700">
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 font-headline tracking-tight">ติดต่อเรา (Contact Us)</h1>
            <p className="text-white/60 text-sm md:text-base">ข้อมูลการติดต่อและสถานที่ตั้งร้าน Sahadiesel Service Center</p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-700">
              <Card className="bg-white/5 border-white/10 text-white backdrop-blur-sm shadow-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <MapPin className="h-5 w-5" />
                    ข้อมูลการติดต่อและสถานที่ตั้ง
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-xl font-bold">หจก. สหดีเซลกลการ (Sahadiesel Service Center)</p>
                    <p className="text-slate-300 leading-relaxed">
                      {content.footerAddress}
                    </p>
                  </div>
                  
                  <Separator className="bg-white/10" />
                  
                  <div className="grid gap-6">
                    <div className="flex items-center gap-4">
                      <div className="bg-primary/20 p-3 rounded-full text-primary shadow-lg shadow-primary/10"><Phone className="h-6 w-6" /></div>
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">เบอร์โทรศัพท์</p>
                        <p className="text-xl font-bold text-white hover:text-primary transition-colors cursor-pointer">{content.footerPhone}</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6">
                    <Button asChild variant="outline" className="w-full h-12 border-primary text-primary hover:bg-primary hover:text-white font-bold transition-all shadow-lg shadow-primary/5">
                      <a href="https://maps.app.goo.gl/QFChLC8GrSGxQs5q9" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" /> เปิดใน Google Maps
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-2xl overflow-hidden h-[450px] border border-white/10 shadow-2xl relative animate-in fade-in slide-in-from-right-4 duration-700">
              {/* Embed Google Maps */}
              <iframe 
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3875.981424312141!2d100.4441413758451!3d13.71959409734141!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x30e2970de6666667%3A0x6666666666666666!2z4Liq4Lir4LiU4Li14LmA4LiL4Lil4LiB4Lil4LiB4Liy4Lij!5e0!3m2!1sth!2sth!4v1740922941000!5m2!1sth!2sth" 
                width="100%" 
                height="100%" 
                style={{ border: 0 }} 
                allowFullScreen 
                loading="lazy" 
                referrerPolicy="no-referrer-when-downgrade"
                className="opacity-90 grayscale invert-[0.1] contrast-[1.1]"
              ></iframe>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter content={content} />
    </div>
  );
}
