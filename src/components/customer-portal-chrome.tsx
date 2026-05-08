"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";

/** โครงหน้าลูกค้า (หัวเว็บ + พื้นหลังแบบหน้าแรก) — ไม่ใช้ (auth) layout แบบการ์ดกลางจออย่างเดียว */
export function CustomerPortalChrome({ children }: { children: ReactNode }) {
  const bgImage = PlaceHolderImages.find((img) => img.id === "login-bg") || PlaceHolderImages[0];

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <PublicHeader />
      <main className="flex-1">
        <section className="relative min-h-[calc(100dvh-5rem)] w-full flex flex-col items-center justify-center overflow-hidden pt-20 md:pt-24 pb-16 px-4">
          <Image
            src={bgImage.imageUrl}
            alt={bgImage.description}
            fill
            priority
            className="object-cover opacity-40"
            data-ai-hint={bgImage.imageHint}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/50 to-slate-900" />
          <div className="relative z-10 w-full max-w-md mx-auto shadow-[0_20px_50px_rgba(0,0,0,0.45)] rounded-lg overflow-hidden">
            {children}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
