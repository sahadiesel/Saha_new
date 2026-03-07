"use client";

import { Globe, Phone, MapPin, Facebook } from "lucide-react";
import type { LandingPageContent } from "@/app/page";

interface PublicFooterProps {
  content?: LandingPageContent;
}

export function PublicFooter({ content }: PublicFooterProps) {
  // Use provided content or fallbacks
  const aboutTitle = content?.footerAboutTitle || "เกี่ยวกับเรา";
  const aboutDesc = content?.footerAboutDesc || "Sahadiesel Service Center ผู้เชี่ยวชาญด้านการซ่อมบำรุงรถยนต์และระบบปั๊มหัวฉีดคอมมอนเรล";
  const contactTitle = content?.footerContactTitle || "ติดต่อเรา";
  const phone = content?.footerPhone || "02-XXX-XXXX";
  const address = content?.footerAddress || "เขตภาษีเจริญ กรุงเทพมหานคร";
  const website = content?.footerWebsite || "www.sahadiesel.com";
  const facebookUrl = content?.footerFacebookUrl || "#";

  return (
    <footer className="bg-slate-950 text-slate-400 py-12 border-t border-white/5">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-3 gap-12">
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg border-l-2 border-primary pl-3">{aboutTitle}</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {aboutDesc}
            </p>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg border-l-2 border-primary pl-3">{contactTitle}</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-1.5 rounded-full"><Phone className="h-4 w-4 text-primary" /></div>
                {phone}
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 p-1.5 rounded-full mt-0.5"><MapPin className="h-4 w-4 text-primary" /></div>
                <span className="flex-1">{address}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-1.5 rounded-full"><Globe className="h-4 w-4 text-primary" /></div>
                {website}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg border-l-2 border-primary pl-3">ติดตามเรา</h3>
            <div className="flex gap-4">
              <a 
                href={facebookUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-slate-800 p-2.5 rounded-full hover:bg-primary hover:text-white transition-all transform hover:scale-110 cursor-pointer shadow-lg"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <a 
                href={`https://${website}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-slate-800 p-2.5 rounded-full hover:bg-primary hover:text-white transition-all transform hover:scale-110 cursor-pointer shadow-lg"
              >
                <Globe className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-white/5 text-center text-[10px] uppercase tracking-widest text-slate-600">
          <p>© {new Date().getFullYear()} Sahadiesel Service Management System. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
