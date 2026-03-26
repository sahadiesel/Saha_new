
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Box, MapPin, ScanBarcode, X } from "lucide-react";
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
            {filteredParts.map(part => (
              <Card key={part.id} className="overflow-hidden hover:border-primary/50 transition-all shadow-sm hover:shadow-md group">
                <div className="flex gap-4 p-4">
                  <div className="relative h-24 w-24 rounded-xl border bg-muted shrink-0 overflow-hidden shadow-sm">
                    {part.imageUrl ? (
                      <Image src={part.imageUrl} alt={part.name} fill className="object-cover group-hover:scale-110 transition-transform duration-500" />
                    ) : (
                      <Box className="h-8 w-8 m-8 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                    <div className="space-y-1">
                        <p className="font-black text-sm line-clamp-2 leading-tight text-slate-800">{part.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase bg-muted w-fit px-1.5 rounded">{part.code}</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] py-0 w-fit h-4 font-normal">{part.categoryNameSnapshot}</Badge>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-3 divide-x divide-border bg-slate-50/50">
                  <div className="p-3 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest mb-1">ราคาขาย</p>
                    <p className="text-lg font-black text-primary">฿{part.sellingPrice.toLocaleString()}</p>
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest mb-1">สต็อกคงเหลือ</p>
                    <p className={cn("text-lg font-black", part.stockQty <= 0 ? "text-destructive" : "text-slate-700")}>
                      {part.stockQty}
                    </p>
                  </div>
                  <div className="p-3 text-center flex flex-col items-center justify-center">
                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest mb-1">ตำแหน่งเก็บ</p>
                    <div className="flex items-center gap-1 text-sm font-bold text-blue-600 mt-0.5">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate max-w-[80px]">{part.location || "-"}</span>
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
