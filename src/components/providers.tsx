"use client";

import type { ReactNode } from "react";
import { FirebaseClientProvider } from "@/firebase/client-provider";
import { AuthProvider } from "@/context/auth-context";
import { PublicSiteLanguageProvider } from "@/context/public-site-language-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <FirebaseClientProvider>
      <AuthProvider>
        <PublicSiteLanguageProvider>{children}</PublicSiteLanguageProvider>
      </AuthProvider>
    </FirebaseClientProvider>
  );
}
