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
    <html lang="th" className="notranslate" translate="no">
       <head>
        <meta name="google" content="notranslate" />
        <meta name="application-name" content="Sahadiesel System" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Saha" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192x192.png"></link>
        <script dangerouslySetInnerHTML={{ __html: `
          (function () {
            var expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
            document.cookie = 'googtrans=;path=/;expires=' + expired;
            document.documentElement.classList.remove('translated-ltr', 'translated-rtl');
            sessionStorage.removeItem('gt-recover-reload');
            sessionStorage.removeItem('gt-recover-retries');
          })();

          window.addEventListener('load', function () {
            sessionStorage.removeItem('gt-recover-reload');
            sessionStorage.removeItem('gt-recover-retries');
          });

          window.addEventListener('error', (event) => {
            // 1. Fix for Chunk Load Errors
            if (event.message && (event.message.includes('ChunkLoadError') || event.message.includes('Loading chunk'))) {
              console.warn('ChunkLoadError detected, reloading page...');
              window.location.reload();
            }

            // 2. Google Translate / extension DOM conflicts with React
            if (
              event.message && (
                event.message.includes('removeChild') ||
                event.message.includes('insertBefore') ||
                event.message.includes('not a child of this node')
              )
            ) {
              var expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
              document.cookie = 'googtrans=;path=/;expires=' + expired;
              document.documentElement.classList.remove('translated-ltr', 'translated-rtl');
              var gtRetries = parseInt(sessionStorage.getItem('gt-recover-retries') || '0', 10);
              if (gtRetries < 2) {
                sessionStorage.setItem('gt-recover-retries', String(gtRetries + 1));
                window.location.reload();
              }
            }
            
            // 3. Fix for Browser Extension Errors (e.g. MetaMask, AdBlock)
            // These are not app bugs, so we suppress them from the Next.js error overlay.
            if (
              event.filename && (
                event.filename.includes('chrome-extension://') || 
                event.filename.includes('moz-extension://')
              ) ||
              (event.message && event.message.includes('MetaMask'))
            ) {
              event.stopImmediatePropagation();
            }
          }, true);

          // Suppress unhandled rejections from extensions
          window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.stack && event.reason.stack.includes('chrome-extension://')) {
              event.stopImmediatePropagation();
              event.preventDefault();
            }
          });
        ` }} />
      </head>
      <body className="notranslate">
        <Providers>
          <AppShellClient>{children}</AppShellClient>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
