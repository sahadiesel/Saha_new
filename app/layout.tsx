import './globals.css';
import type { ReactNode } from "react";
import type { Viewport } from 'next';
import { AppShellClient } from "@/components/app-shell-client";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";

export const viewport: Viewport = {
  themeColor: "#2A9D8F",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  shrinkToFit: "no",
  viewportFit: "cover",
};

export const metadata = {
  title: "Sahadiesel System",
  description: "Sahadiesel Service Management System",
  manifest: "/manifest.json",
  icons: {
    apple: "/icon-192x192.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
       <head>
        <meta name="application-name" content="Sahadiesel System" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Saha" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192x192.png"></link>
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('error', (event) => {
            if (event.message && (event.message.includes('ChunkLoadError') || event.message.includes('Loading chunk'))) {
              console.warn('ChunkLoadError detected, reloading page...');
              window.location.reload();
            }
          }, true);
        ` }} />
      </head>
      <body>
        <Providers>
          <AppShellClient>{children}</AppShellClient>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
