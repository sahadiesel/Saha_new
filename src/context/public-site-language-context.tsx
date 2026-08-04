"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getPublicSiteLanguage,
  clearGoogleTranslateArtifacts,
  type PublicSiteLanguage,
} from "@/lib/public-site-language";
import { translateAppNavLabel } from "@/lib/app-nav-i18n";

type PublicSiteLanguageContextValue = {
  lang: PublicSiteLanguage;
  t: (thaiLabel: string) => string;
  refreshLanguage: () => void;
};

const PublicSiteLanguageContext = createContext<PublicSiteLanguageContextValue>({
  lang: "th",
  t: (label) => label,
  refreshLanguage: () => {},
});

export function PublicSiteLanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<PublicSiteLanguage>("th");

  const refreshLanguage = useCallback(() => {
    setLang(getPublicSiteLanguage());
  }, []);

  useEffect(() => {
    clearGoogleTranslateArtifacts();
    refreshLanguage();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sahadiesel-public-lang") refreshLanguage();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshLanguage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshLanguage);
    };
  }, [refreshLanguage]);

  const t = useCallback(
    (thaiLabel: string) => translateAppNavLabel(thaiLabel, lang),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, t, refreshLanguage }),
    [lang, t, refreshLanguage]
  );

  return (
    <PublicSiteLanguageContext.Provider value={value}>
      {children}
    </PublicSiteLanguageContext.Provider>
  );
}

export function useAppNavLabel() {
  return useContext(PublicSiteLanguageContext);
}
