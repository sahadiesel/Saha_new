"use client";

import { useEffect, useState } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getPublicSiteLanguage,
  setPublicSiteLanguage,
  PUBLIC_SITE_LANGUAGE_OPTIONS,
  publicSiteLanguageBadge,
  type PublicSiteLanguage,
} from "@/lib/public-site-language";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate?: {
        TranslateElement: new (
          options: Record<string, unknown>,
          elementId: string
        ) => void;
      };
    };
  }
}

function ensureGoogleTranslateScript() {
  if (typeof document === "undefined") return;
  if (document.getElementById("google-translate-script")) return;

  window.googleTranslateElementInit = () => {
    if (!window.google?.translate?.TranslateElement) return;
    new window.google.translate.TranslateElement(
      {
        pageLanguage: "th",
        includedLanguages: "th,en,my",
        autoDisplay: false,
      },
      "google_translate_element"
    );
  };

  const script = document.createElement("script");
  script.id = "google-translate-script";
  script.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  document.body.appendChild(script);
}

export function PublicLanguageSwitcher({ className }: { className?: string }) {
  const [lang, setLang] = useState<PublicSiteLanguage>("th");

  useEffect(() => {
    setLang(getPublicSiteLanguage());
    ensureGoogleTranslateScript();
  }, []);

  return (
    <>
      <div id="google_translate_element" className="hidden" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "text-white hover:bg-white/10 hover:text-white gap-1.5 h-10 px-2.5 rounded-full",
              className
            )}
            aria-label="เลือกภาษา"
          >
            <Globe className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wide">{publicSiteLanguageBadge(lang)}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 bg-slate-800 border-white/10 text-white shadow-2xl">
          {PUBLIC_SITE_LANGUAGE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.code}
              className={cn(
                "focus:bg-primary/20 focus:text-white cursor-pointer py-2.5",
                lang === option.code && "bg-primary/15 font-bold"
              )}
              onClick={() => {
                if (lang !== option.code) setPublicSiteLanguage(option.code);
              }}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
