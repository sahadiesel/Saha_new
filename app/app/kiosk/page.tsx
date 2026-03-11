"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { generateKioskToken } from '@/firebase/kiosk';

import { PageHeader } from "@/components/page-header";
import { QrDisplay } from "@/components/qr-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default function KioskPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile, loading: authLoading } = useAuth();

  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [kioskId, setKioskId] = useState<string | null>(null);

  // KIOSK FEATURE FLAG
  const KIOSK_ENABLED = true;

  // Safe client-side initialization for Kiosk ID
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
        let id = localStorage.getItem('kiosk_device_id');
        if (!id) {
          id = 'kiosk_' + Math.random().toString(36).substring(2, 15);
          localStorage.setItem('kiosk_device_id', id);
        }
        setKioskId(id);
    } catch (e) {
        setKioskId('session_' + Math.random().toString(36).substring(2, 8));
    }
  }, []);

  const rotateToken = useCallback(async (isManual: boolean = false) => {
    if (!KIOSK_ENABLED || !db || authLoading || !profile) return;
    if (isLoading && !isManual) return;

    setIsLoading(true);
    try {
      await generateKioskToken(db);
    } catch (error: any) {
      console.error("Kiosk rotation failed:", error);
      toast({
        variant: "destructive",
        title: "Could not generate QR Code",
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [db, authLoading, profile, isLoading, KIOSK_ENABLED, toast]);

  // Subscribe to kiosk doc changes
  useEffect(() => {
    if (!db || !kioskId || !KIOSK_ENABLED) return;

    const tokenRef = doc(db, "kioskTokens", kioskId);
    const unsubscribe = onSnapshot(tokenRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const now = Date.now();
        
        if (!data.isActive || now > data.expiresAtMs) {
          rotateToken();
        } else {
          setCurrentToken(data.currentToken);
          setExpiresAtMs(data.expiresAtMs);
          const fullUrl = `${window.location.origin}/app/attendance/scan?kiosk=${kioskId}&t=${data.currentToken}`;
          setQrData(fullUrl);
        }
      } else {
        rotateToken();
      }
    });

    return () => unsubscribe();
  }, [db, kioskId, KIOSK_ENABLED, rotateToken]);

  // Timer for countdown
  useEffect(() => {
    if (!expiresAtMs) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.round((expiresAtMs - now) / 1000));
      setCountdown(diff);
      if (diff <= 0) {
        rotateToken();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAtMs, rotateToken]);

  return (
    <>
      <PageHeader 
        title="Kiosk / หน้าจอลงเวลา" 
        description="Scan this QR Code to record your working time. / ให้พนักงานสแกน QR Code นี้เพื่อบันทึกเวลาทำงาน" 
      />
      <div className="flex flex-col items-center justify-center mt-8 gap-6">
        {!KIOSK_ENABLED ? (
          <Card className="w-full max-w-md border-amber-200 bg-amber-50">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4"><AlertTriangle className="h-12 w-12 text-amber-500" /></div>
              <CardTitle className="text-xl text-amber-900">ปิดปรับปรุงชั่วคราว</CardTitle>
              <CardDescription className="text-amber-700">ระบบลงเวลาผ่าน QR Code ปิดให้บริการชั่วคราว</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="w-full max-w-sm text-center">
            <CardHeader>
              <CardTitle className="text-2xl font-headline">Scan to Clock In/Out</CardTitle>
              <CardDescription>สแกน QR Code เพื่อเปิดหน้าลงเวลาบนมือถือ</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <QrDisplay data={qrData} />
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                {isLoading && !qrData ? (
                  <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>Generating...</span></div>
                ) : (
                  <span>Code expires in: {countdown}s</span>
                )}
                <Button onClick={() => rotateToken(true)} variant="outline" size="sm" disabled={isLoading}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
                  Refresh Code / สร้างโค้ดใหม่
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
