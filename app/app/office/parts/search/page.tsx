
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Box, MapPin, ScanBarcode, X, AlertCircle } from "lucide-react";
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import type { Part } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function OfficePartSearchPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<any>(null);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, "parts"), orderBy("name", "asc"), limit(1000));
    const unsubscribe = onSnapshot(q, (snap) => {
      setParts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Part)));
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db]);

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const q = searchTerm.toLowerCase().trim();
    return parts.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.code.toLowerCase().includes(q)
    );
  }, [parts, searchTerm]);

  const startScanner = async () => {
    setIsScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const reader = new BrowserMultiFormatReader();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const controls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            setSearchTerm(result.getText());
            stopScanner();
          }
        });
        scannerControlsRef.current = controls;
      }
    } catch (error) {
      toast({ variant: "destructive", title: "ไม่สามารถเปิดกล้องได้" });
      setIsScannerOpen(false);
    }
  };

  const stopScanner = () => {
    if (scannerControlsRef.current) scannerControlsRef.current.stop();
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScannerOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="ค้นหาสินค้า" description="ค้นหาอะไหล่เพื่อตรวจสอบราคาขาย สต็อกคงเหลือ และตำแหน่งจัดเก็บ" />

      <Card className="border-primary/20 bg-primary/5 shadow-lg">
        <CardContent className="pt-6">
          <div className="flex gap-2 max-w-2xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input 
                placeholder="พิมพ์ชื่อสินค้า หรือสแกนบาร์โค้ด..." 
                className="pl-10 h-12 text-lg bg-background shadow-inner"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                autoFocus
              />
              {searchTerm && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full hover:bg-muted"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Button size="lg" className="h-12 px-6 shadow-md" onClick={startScanner}>
              <ScanBarcode className="mr-2 h-5 w-5" />
              สแกนบาร์โค้ด
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="animate-spin h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">กำลังโหลดข้อมูลอะไหล่...</p>
          </div>
        ) : searchTerm.trim() === "" ? (
          <div className="text-center py-24 text-muted-foreground bg-muted/10 border-2 border-dashed rounded-xl">
            <Box className="h-16 w-16 mx-auto mb-4 opacity-10" />
            <p className="font-medium">กรุณาพิมพ์ชื่อสินค้าหรือรหัสเพื่อเริ่มต้นการค้นหา</p>
            <p className="text-xs opacity-60 mt-1">ค้นหาได้จาก 1,000 รายการล่าสุดในระบบค่ะ</p>
          </div>
        ) : filteredParts.length > 0 ? (
          <div className="space-y-2 animate-in fade-in duration-500">
            {filteredParts.map(part => (
              <Card key={part.id} className="overflow-hidden hover:border-primary/50 transition-all shadow-sm group">
                <div className="flex flex-row items-center p-2 gap-4">
                  {/* Small Image */}
                  <div className="relative h-12 w-12 rounded border bg-muted shrink-0 overflow-hidden shadow-sm">
                    {part.imageUrl ? (
                      <Image src={part.imageUrl} alt={part.name} fill className="object-cover" />
                    ) : (
                      <Box className="h-6 w-6 m-3 text-muted-foreground/30" />
                    )}
                  </div>
                  
                  {/* Name and Code */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate text-slate-800">{part.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase bg-slate-100 px-1 rounded">{part.code}</span>
                      <Badge variant="outline" className="text-[9px] h-4 py-0 px-1.5 font-normal opacity-70 border-primary/20">{part.categoryNameSnapshot}</Badge>
                    </div>
                  </div>

                  {/* Stock Info */}
                  <div className="w-20 sm:w-24 text-center border-l border-dashed pl-2">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">สต็อก</p>
                    <p className={cn("text-sm font-black", part.stockQty <= 0 ? "text-destructive" : "text-slate-700")}>
                      {part.stockQty}
                    </p>
                  </div>

                  {/* Price Info */}
                  <div className="w-24 sm:w-32 text-right border-l border-dashed pl-2 pr-2">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">ราคาขาย</p>
                    <p className="text-sm font-black text-primary">฿{part.sellingPrice.toLocaleString()}</p>
                  </div>

                  {/* Location Info */}
                  <div className="w-24 text-right hidden md:block border-l border-dashed pl-2 pr-2">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">ตำแหน่งเก็บ</p>
                    <div className="flex items-center justify-end gap-1 text-xs font-bold text-blue-600 mt-0.5">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate max-w-[60px]">{part.location || "-"}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-muted/20 border-2 border-dashed rounded-xl">
            <AlertCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">ไม่พบสินค้าที่ตรงกับคำค้นหา "{searchTerm}"</p>
            <p className="text-xs text-muted-foreground mt-1">ลองเปลี่ยนคำค้นหา หรือใช้ระบบสแกนบาร์โค้ดดูนะคะ</p>
          </div>
        )}
      </div>

      <Dialog open={isScannerOpen} onOpenChange={(open) => !open && stopScanner()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-black border-none">
          <DialogHeader className="p-4 bg-background border-b">
            <DialogTitle>สแกนรหัสสินค้า</DialogTitle>
          </DialogHeader>
          <div className="relative aspect-square">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            <div className="absolute inset-0 border-2 border-primary/50 m-12 rounded-2xl pointer-events-none shadow-[0_0_0_1000px_rgba(0,0,0,0.5)]">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
            </div>
          </div>
          <DialogFooter className="p-4 bg-background">
            <Button variant="outline" className="w-full h-12" onClick={stopScanner}>ปิดหน้าต่างสแกน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
