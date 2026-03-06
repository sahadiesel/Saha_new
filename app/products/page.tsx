
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Box, ShoppingCart, Search, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
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

  useEffect(() => {
    if (!db) return;
    
    // Fetch categories
    const unsubCats = onSnapshot(query(collection(db, "partCategories"), orderBy("name", "asc")), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as PartCategory)));
    });

    // Fetch only parts flagged for web display
    const qParts = query(collection(db, "parts"), where("showOnWeb", "==", true));
    const unsubParts = onSnapshot(qParts, (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
      setLoading(false);
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
              <p className="text-slate-500">เลือกชมรายการอะไหล่คุณภาพมาตรฐานจาก Sahadiesel</p>
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
                  {filteredParts.map(part => (
                    <Card key={part.id} className="group border-none shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden bg-white">
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
                      <CardContent className="p-4 pt-2">
                        <div className="flex items-baseline gap-1">
                          <span className="text-xs font-bold text-primary">฿</span>
                          <span className="text-xl font-black text-primary">{part.sellingPrice.toLocaleString()}</span>
                        </div>
                      </CardContent>
                      <CardFooter className="p-4 pt-0">
                        <Button className="w-full h-9 rounded-full bg-slate-900 hover:bg-primary transition-colors text-xs font-bold gap-2">
                          <Info className="h-3.5 w-3.5" /> รายละเอียด
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
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
