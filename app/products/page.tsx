"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, type FirestoreError } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Box, ShoppingCart, Search, Info, Gift, Sparkles, Tag, AlertCircle, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Part, PartCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default function PublicProductsPage() {
  const { db } = useFirebase();
  const [parts, setParts] = useState<Part[]>([]);
  const [categories, setCategories] = useState<PartCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    
    setIndexErrorUrl(null);

    // Fetch categories
    const unsubCats = onSnapshot(query(collection(db, "partCategories"), orderBy("name", "asc")), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as PartCategory)));
    });

    // Fetch only parts flagged for web display - Ordering by name to ensure consistent UI
    const qParts = query(collection(db, "parts"), where("showOnWeb", "==", true), orderBy("name", "asc"));
    const unsubParts = onSnapshot(qParts, {
      next: (snap) => {
        setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
        setLoading(false);
      },
      error: (err: FirestoreError) => {
        console.error("Public Parts fetch error:", err);
        if (err.message?.includes('requires an index')) {
          const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
          if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        setLoading(false);
      }
    });

    return () => { unsubCats(); unsubParts(); };
  }, [db]);

  const filteredParts = useMemo(() => {
    let result = [...parts];
    if (activeCategory !== "ALL") {
      result = result.filter(p => p.categoryId === activeCategory);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
    }
    return result;
  }, [parts, activeCategory, searchTerm]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />

      <main className="flex-1 pt-24 pb-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">สินค้าและอะไหล่</h1>
              <p className="text-slate-500">เลือกชมรายการอะไหล่คุณภาพมาตรฐานจาก Sahadiesel พร้อมโปรโมชั่นพิเศษ</p>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="ค้นหาอะไหล่..." 
                className="pl-10 bg-white shadow-sm border-slate-200" 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {indexErrorUrl && (
            <Alert variant="destructive" className="mb-10">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>ต้องสร้างดัชนี (Index) เพื่อแสดงข้อมูล</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>ระบบต้องการดัชนีเพื่อจัดเรียงสินค้า กรุณาแจ้งผู้ดูแลระบบเพื่อกดปุ่มด้านล่างเพื่อสร้าง Index</span>
                <Button asChild variant="outline" size="sm" className="w-fit bg-white text-destructive">
                  <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    สร้าง Index (Firebase Console)
                  </a>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="ALL" className="space-y-8" onValueChange={setActiveCategory}>
            <div className="overflow-x-auto pb-2">
              <TabsList className="bg-transparent h-auto p-0 flex justify-start gap-2">
                <TabsTrigger 
                  value="ALL" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-white bg-white border border-slate-200 px-6 py-2 rounded-full shadow-sm"
                >
                  ทั้งหมด
                </TabsTrigger>
                {categories.map(cat => (
                  <TabsTrigger 
                    key={cat.id} 
                    value={cat.id}
                    className="data-[state=active]:bg-primary data-[state=active]:text-white bg-white border border-slate-200 px-6 py-2 rounded-full shadow-sm"
                  >
                    {cat.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value={activeCategory} className="mt-0">
              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>
              ) : filteredParts.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {filteredParts.map(part => {
                    const hasSpecialPrice = part.webPrice && part.webPrice < part.sellingPrice;
                    const discountPercent = hasSpecialPrice ? Math.round(((part.sellingPrice - part.webPrice!) / part.sellingPrice) * 100) : 0;

                    return (
                      <Card key={part.id} className="group border-none shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden bg-white flex flex-col h-full">
                        <div className="relative aspect-square bg-slate-100 overflow-hidden">
                          {part.imageUrl ? (
                            <Image 
                              src={part.imageUrl} 
                              alt={part.name} 
                              fill 
                              className="object-cover group-hover:scale-110 transition-transform duration-500"
                              data-ai-hint="car part"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-300">
                              <Box className="h-16 w-16 opacity-20" />
                            </div>
                          )}
                          
                          {discountPercent > 0 && (
                            <Badge className="absolute top-2 left-2 bg-destructive text-white font-black border-none px-2 rounded-sm shadow-lg">
                                -{discountPercent}%
                            </Badge>
                          )}

                          {part.webPromoNote && (
                            <div className="absolute top-2 right-2">
                                <Badge className="bg-orange-500 border-none shadow-lg animate-pulse">
                                    <Gift className="h-3 w-3 mr-1" /> PROMO
                                </Badge>
                            </div>
                          )}

                          {part.stockQty <= 0 && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <Badge variant="destructive" className="px-3 py-1">สินค้าหมด</Badge>
                            </div>
                          )}
                        </div>
                        <CardHeader className="p-4 pb-0">
                          <CardTitle className="text-sm font-bold line-clamp-2 h-10 leading-relaxed text-slate-800">
                            {part.name}
                          </CardTitle>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px] h-4 font-normal border-slate-200 text-slate-500">
                              {part.categoryNameSnapshot}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 flex-grow">
                          <div className="space-y-1">
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-black text-primary">฿{(part.webPrice || part.sellingPrice).toLocaleString()}</span>
                                {hasSpecialPrice && (
                                    <span className="text-xs text-slate-400 line-through">฿{part.sellingPrice.toLocaleString()}</span>
                                )}
                            </div>
                            {part.bulkPrice && part.bulkPrice > 0 && (
                                <div className="flex items-center gap-1 text-[10px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded w-fit">
                                    <Tag className="h-2.5 w-2.5" />
                                    ราคา {part.bulkPrice.toLocaleString()}.- เมื่อซื้อ {part.bulkPriceQty}+ ชิ้น
                                </div>
                            )}
                            {part.webPromoNote && (
                                <div className="text-[10px] text-orange-600 font-bold flex items-start gap-1 mt-2">
                                    <Gift className="h-3 w-3 shrink-0" />
                                    <span className="leading-tight">{part.webPromoNote}</span>
                                </div>
                            )}
                          </div>
                        </CardContent>
                        <CardFooter className="p-4 pt-0">
                          <Button className="w-full h-9 rounded-full bg-slate-900 hover:bg-primary transition-colors text-xs font-bold gap-2 group-hover:shadow-lg">
                            <Info className="h-3.5 w-3.5" /> รายละเอียด
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                  <Box className="h-16 w-16 mx-auto mb-4 text-slate-300 opacity-20" />
                  <h3 className="text-lg font-bold text-slate-400">ไม่พบสินค้าในหมวดนี้</h3>
                  <p className="text-slate-400 text-sm">กรุณาลองเลือกหมวดหมู่ที่สูงขึ้นหรือค้นหาด้วยคำอื่น</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
