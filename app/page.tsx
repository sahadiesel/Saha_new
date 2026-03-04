"use client";

import { useState, useEffect, useMemo } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Wrench, Gauge } from "lucide-react";

export const dynamic = 'force-dynamic';

interface LandingPageContent {
  heroTitle: string;
  heroDescription: string;
  buttonText: string;
}

export default function LandingPage() {
  const { db } = useFirebase();
  const [content, setContent] = useState<LandingPageContent>({
    heroTitle: "SAHADIESEL SERVICE CENTER",
    heroDescription: "ศูนย์บริการรถยนต์ครบวงจรที่มีมาตรฐานและเครื่องมือครบครัน พร้อมเครื่องวิเคราะห์รถยนต์ที่ทันสมัย ให้บริการเช็คระยะ ซ่อมเครื่องยนต์และระบบไฟฟ้า ซ่อมบำรุงรถยนต์นำเข้าได้หลากรุ่น หลายแบรนด์ โดยทีมช่างมากประสบการณ์ และมีระบบออนไลน์ในการติดตามงาน ซึ่งลูกค้าสามารถตรวจสอบสถานะการซ่อมได้ตลอดเวลา",
    buttonText: "ตรวจสอบสถานะรถ",
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

  // Use the professional workshop background
  const bgImage = PlaceHolderImages.find(img => img.id === "login-bg") || PlaceHolderImages[0];

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <PublicHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative h-[85vh] w-full flex items-center justify-center overflow-hidden">
          <Image
            src={bgImage.imageUrl}
            alt={bgImage.description}
            fill
            priority
            className="object-cover opacity-40"
            data-ai-hint="luxury workshop"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/60 via-transparent to-slate-900" />
          
          <div className="container relative z-10 mx-auto px-4 text-center max-w-4xl">
            <h1 className="font-headline text-5xl md:text-7xl font-bold mb-6 tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-1000">
              {content.heroTitle}
            </h1>
            
            {/* Styled border box for description similar to the provided layout */}
            <div className="relative mb-8 p-6 md:p-10 border-2 border-primary/40 rounded-sm bg-black/20 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-200">
                <p className="text-lg md:text-xl text-slate-200 leading-relaxed font-medium">
                  {content.heroDescription}
                </p>
            </div>

            <div className="flex flex-wrap justify-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
              <Button size="lg" className="rounded-full px-10 h-12 text-base font-bold bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 transition-all hover:scale-105">
                {content.buttonText} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-10 h-12 text-base font-bold border-white/20 bg-white/5 hover:bg-white/10 text-white backdrop-blur-sm">
                นัดหมายบริการ
              </Button>
            </div>
          </div>
        </section>

        {/* Info Section */}
        <section className="py-20 bg-slate-900">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="space-y-8">
                <h2 className="text-3xl font-bold border-l-4 border-primary pl-4">SAHADIESEL บริการแบบ 4S</h2>
                
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="mt-1 bg-primary/20 p-2 rounded-lg h-fit text-primary"><ShieldCheck className="h-6 w-6"/></div>
                    <div>
                      <h3 className="font-bold text-lg text-white">Standard</h3>
                      <p className="text-slate-400 text-sm">บริการมาตรฐานสากล ใส่ใจทุกขั้นตอนการตรวจเช็คและซ่อมบำรุง</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="mt-1 bg-primary/20 p-2 rounded-lg h-fit text-primary"><CheckCircle2 className="h-6 w-6"/></div>
                    <div>
                      <h3 className="font-bold text-lg text-white">Space</h3>
                      <p className="text-slate-400 text-sm">ให้บริการบนพื้นที่กว้างขวาง รองรับรถได้มากกว่า 50 คันต่อวัน พร้อมห้องรับรองลูกค้า</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="mt-1 bg-primary/20 p-2 rounded-lg h-fit text-primary"><Wrench className="h-6 w-6"/></div>
                    <div>
                      <h3 className="font-bold text-lg text-white">Specialist</h3>
                      <p className="text-slate-400 text-sm">ทีมช่างผู้เชี่ยวชาญเฉพาะทาง แก้ปัญหาได้ตรงจุด รวดเร็ว แม่นยำ ด้วยระบบวิเคราะห์อัจฉริยะ</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="mt-1 bg-primary/20 p-2 rounded-lg h-fit text-primary"><Gauge className="h-6 w-6"/></div>
                    <div>
                      <h3 className="font-bold text-lg text-white">Service</h3>
                      <p className="text-slate-400 text-sm">ศูนย์บริการรถยนต์นำเข้าและปั๊มหัวฉีดแบบครบวงจร One Stop Service ครอบคลุมแบบ 360 องศา ดูแลรักษา ซ่อม ทำสี เคลมประกัน ครบจบในที่เดียว</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl group border border-white/5">
                  <Image 
                    src="https://images.unsplash.com/photo-1503376780353-7e6692767b70?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3NDE5ODJ8MHwxfHNlYXJjaHw0fHxsdXh1cnklMjBjYXIlMjBzZXJ2aWNlfGVufDB8fHx8MTc0MDkyMjk0MXww&ixlib=rb-4.1.0&q=80&w=800" 
                    alt="Service View 1" 
                    fill 
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                    data-ai-hint="car service"
                  />
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                </div>
                <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl group border border-white/5">
                  <Image 
                    src="https://images.unsplash.com/photo-1517524206127-48bbd363f3d7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3NDE5ODJ8MHwxfHNlYXJjaHwzfHxtZWNoYW5pYyUyMHdvcmt8ZW58MHx8fHwxNzQwOTIyOTQxfDA&ixlib=rb-4.1.0&q=80&w=800" 
                    alt="Service View 2" 
                    fill 
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                    data-ai-hint="car workshop"
                  />
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
