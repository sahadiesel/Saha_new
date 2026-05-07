"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, type FirestoreError } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Loader2, Box, Search, Info, Gift, Sparkles, Tag, AlertCircle, 
  ExternalLink, ShoppingCart, ShoppingBag, Plus, Minus, Trash2, 
  CreditCard, CheckCircle2, ChevronDown, LayoutGrid, Eye, FileText
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger,
} from "@/components/ui/sheet";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { Part, PartCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import Link from "next/link";

export const dynamic = 'force-dynamic';

interface CartItem extends Part {
  quantity: number;
}

function PlaceholderCard() {
  return (
    <Card className="border-none bg-white/5 backdrop-blur-md overflow-hidden flex flex-col h-full animate-pulse border border-white/10">
      <div className="aspect-square bg-white/10 flex items-center justify-center">
        <Box className="h-12 w-12 text-white/10" />
      </div>
      <CardContent className="p-4 flex-grow space-y-3">
        <div className="h-4 bg-white/10 rounded w-3/4"></div>
        <div className="h-3 bg-white/10 rounded w-1/2"></div>
        <div className="h-6 bg-white/10 rounded w-full mt-4"></div>
      </CardContent>
    </Card>
  );
}

export default function PublicProductsPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const canUseCart = !!(user && profile?.role === "CUSTOMER" && profile?.status === "ACTIVE");
  
  const [parts, setParts] = useState<Part[]>([]);
  const [categories, setCategories] = useState<PartCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  
  const [viewingPart, setViewingPart] = useState<Part | null>(null);

  const bgImage = PlaceHolderImages.find(img => img.id === "login-bg") || PlaceHolderImages[0];

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "partCategories"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as PartCategory));
      data.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      setCategories(data);
    });
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, "parts"), where("showOnWeb", "==", true));
    const unsubscribe = onSnapshot(q, {
      next: (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Part));
        data.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setParts(data);
        setLoading(false);
      },
      error: (err: FirestoreError) => {
        if (err.message?.includes('requires an index')) {
          const urlMatch = err.message.match(/https?:\/\/[^\s]+/);
          if (urlMatch) setIndexErrorUrl(urlMatch[0]);
        }
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [db]);

  const filteredParts = useMemo(() => {
    let result = [...parts];
    if (activeCategory !== "ALL") {
      result = result.filter(p => p.categoryId === activeCategory);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.code.toLowerCase().includes(q)
      );
    }
    return result;
  }, [parts, activeCategory, searchTerm]);

  const addToCart = (part: Part) => {
    if (!canUseCart) {
      toast({
        variant: "destructive",
        title: "เข้าสู่ระบบลูกค้าเพื่อสั่งซื้อ",
        description: "ทุกคนดูรายการสินค้าได้ แต่เฉพาะลูกค้าที่อนุมัติแล้วเท่านั้นที่ใส่ตะกร้าได้",
      });
      return;
    }
    const existing = cart.find(item => item.id === part.id);
    
    setCart(prev => {
      const existingInPrev = prev.find(item => item.id === part.id);
      if (existingInPrev) {
        return prev.map(item => item.id === part.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...part, quantity: 1 }];
    });

    if (existing) {
      toast({ title: "เพิ่มจำนวนสินค้าแล้ว" });
    } else {
      toast({ title: "เพิ่มลงตะกร้าแล้ว", description: part.name });
    }
  };

  const updateQuantity = (partId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === partId) return { ...item, quantity: Math.max(1, item.quantity + delta) };
      return item;
    }));
  };

  const removeFromCart = (partId: string) => {
    setCart(prev => prev.filter(item => item.id !== partId));
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + ((item.webPrice || item.sellingPrice) * item.quantity), 0);
  }, [cart]);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-900">
      <PublicHeader />

      <div className="fixed inset-0 z-0">
        <Image
          src={bgImage.imageUrl}
          alt={bgImage.description}
          fill
          priority
          className="object-cover opacity-40"
          data-ai-hint="luxury workshop"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/70 to-primary/40 backdrop-blur-[3px]" />
      </div>

      <main className="relative z-10 flex-1 pt-24 pb-20 overflow-x-hidden">
        <div className="container mx-auto px-4">
          
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
            <div className="animate-in fade-in slide-in-from-top-4 duration-700">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 font-headline tracking-tight">สินค้าและอะไหล่</h1>
              <p className="text-white/60 text-sm md:text-base">เลือกชมรายการอะไหล่มาตรฐาน Sahadiesel ในราคาพิเศษ</p>
            </div>
            
            <div className="flex w-full md:w-auto flex-col md:flex-row items-stretch md:items-center gap-3">
              {!canUseCart && (
                <p className="text-white/70 text-xs md:max-w-xs order-2 md:order-none">
                  ดูรายการได้โดยไม่ต้องล็อกอิน —{" "}
                  <Link href="/login/customer" className="text-primary font-bold underline">
                    เข้าสู่ระบบลูกค้า
                  </Link>{" "}
                  เพื่อใส่ตะกร้าและสั่งซื้อ
                </p>
              )}
              <div className="relative flex-1 md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                <Input 
                  placeholder="ค้นหาอะไหล่..." 
                  className="pl-10 bg-white/10 border-white/20 text-white rounded-full h-11 focus:ring-primary backdrop-blur-md" 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    className="relative h-11 w-11 rounded-full border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 disabled:opacity-40"
                    disabled={!canUseCart}
                    title={canUseCart ? "ตะกร้า" : "เข้าสู่ระบบลูกค้าเพื่อใช้ตะกร้า"}
                  >
                    <ShoppingCart className="h-5 w-5" />
                    {canUseCart && cartCount > 0 && <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-primary border-slate-900">{cartCount}</Badge>}
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-md flex flex-col p-0 bg-slate-950 border-white/10 text-white">
                  <SheetHeader className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-primary" /><SheetTitle className="text-white">ตะกร้าสินค้า</SheetTitle></div>
                  </SheetHeader>
                  <ScrollArea className="flex-1">
                    {cart.length > 0 ? (
                      <div className="p-6 space-y-6">
                        {cart.map(item => (
                          <div key={item.id} className="flex gap-4 items-start">
                            <div className="relative h-16 w-16 rounded-lg bg-white/5 overflow-hidden border border-white/10 shrink-0">
                              {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill className="object-cover" /> : <Box className="h-6 w-6 m-5 opacity-20" />}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="font-bold text-sm line-clamp-1">{item.name}</p>
                              <p className="text-xs text-primary font-bold">฿{(item.webPrice || item.sellingPrice).toLocaleString()}</p>
                              <div className="flex items-center justify-between pt-2">
                                <div className="flex items-center gap-3 bg-white/5 rounded-full px-2 py-1">
                                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-white/10" onClick={() => updateQuantity(item.id, -1)}><Minus className="h-3 w-3" /></Button>
                                  <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-white/10" onClick={() => updateQuantity(item.id, 1)}><Plus className="h-3 w-3" /></Button>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-destructive" onClick={() => removeFromCart(item.id)}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="flex flex-col items-center justify-center h-[60vh] text-white/20 gap-4"><ShoppingBag className="h-16 w-16 opacity-10" /><p className="text-sm">ตะกร้าว่างเปล่า</p></div>}
                  </ScrollArea>
                  {cart.length > 0 && (
                    <div className="p-6 border-t border-white/10 bg-white/5 space-y-4">
                      <div className="flex justify-between text-lg font-black"><span>ยอดรวม</span><span className="text-primary">฿{cartTotal.toLocaleString()}</span></div>
                      <Button className="w-full h-12 rounded-xl text-base font-bold gap-2" onClick={() => toast({ title: "ระบบกำลังเตรียมข้อมูลการสั่งซื้อ..." })}>ชำระเงิน / สั่งซื้อ</Button>
                    </div>
                  )}
                </SheetContent>
              </Sheet>
            </div>
          </div>

          <div className="mb-10 flex flex-col sm:flex-row items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <Label className="text-white/60 font-bold uppercase text-[10px] tracking-widest flex items-center gap-2"><LayoutGrid className="h-3 w-3" /> เลือกหมวดหมู่สินค้า</Label>
            <Select value={activeCategory} onValueChange={setActiveCategory}>
              <SelectTrigger className="w-full sm:w-64 bg-white/5 border-white/20 text-white h-11 rounded-xl backdrop-blur-md">
                <SelectValue placeholder="ทุกหมวดหมู่" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-white/10 text-white">
                <SelectItem value="ALL">ทุกหมวดหมู่ (All Categories)</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {indexErrorUrl && (
            <Alert variant="destructive" className="mb-10 bg-red-950/50 border-red-500/50 text-white">
              <AlertCircle className="h-4 w-4" /><AlertTitle>ต้องการ Index</AlertTitle>
              <AlertDescription className="flex flex-col gap-2 mt-2">
                <span>กรุณาแจ้งแอดมินเพื่อสร้างดัชนีข้อมูลในการจัดเรียง</span>
                <Button asChild variant="outline" size="sm" className="w-fit bg-white text-red-900"><a href={indexErrorUrl} target="_blank" rel="noopener noreferrer">สร้าง Index</a></Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-8">
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
                {Array.from({ length: 6 }).map((_, i) => <PlaceholderCard key={i} />)}
              </div>
            ) : filteredParts.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
                {filteredParts.map(part => {
                  const isSpecial = part.isSpecialPrice;
                  const displayPrice = part.webPrice || part.sellingPrice;
                  const originalPrice = isSpecial ? (part.webPriceOld || part.sellingPrice) : part.sellingPrice;
                  const discountPercent = isSpecial ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100) : 0;

                  return (
                    <Card key={part.id} className="group border-none shadow-xl transition-all duration-500 overflow-hidden bg-white flex flex-col h-full hover:-translate-y-1">
                      <div className="relative aspect-square bg-slate-100 overflow-hidden cursor-pointer" onClick={() => setViewingPart(part)}>
                        {part.imageUrl ? (
                          <Image src={part.imageUrl} alt={part.name} fill className="object-cover transition-transform duration-700 group-hover:scale-110" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-200"><Box className="h-16 w-16 opacity-10" /></div>
                        )}
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                          {isSpecial && discountPercent > 0 && <Badge className="bg-red-600 text-white border-none font-bold text-[9px] px-1.5">-{discountPercent}%</Badge>}
                          {part.webPromoNote && <Badge className="bg-orange-500 border-none font-bold text-[9px] px-1.5"><Sparkles className="h-2.5 w-2.5 mr-1" />PROMO</Badge>}
                        </div>
                        
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button variant="secondary" size="sm" className="rounded-full font-bold text-xs gap-2">
                                <Info className="h-3 w-3" /> รายละเอียด
                            </Button>
                        </div>

                        {part.stockQty <= 0 && (
                          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10">
                            <Badge variant="destructive" className="font-bold">สินค้าหมด</Badge>
                          </div>
                        )}
                      </div>

                      <CardContent className="p-4 flex-grow space-y-2">
                        <div className="min-h-[40px] cursor-pointer" onClick={() => setViewingPart(part)}>
                          <h3 className="text-xs font-bold line-clamp-2 leading-snug text-slate-800 hover:text-primary transition-colors">{part.name}</h3>
                          <p className="text-[9px] text-slate-400 font-mono mt-1 uppercase">{part.code}</p>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-black text-primary">฿{displayPrice.toLocaleString()}</span>
                            {isSpecial && <span className="text-[10px] text-slate-400 line-through">฿{originalPrice.toLocaleString()}</span>}
                          </div>
                          {part.bulkPrice && part.bulkPrice > 0 && (
                            <p className="text-[9px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded w-fit"><Tag className="h-2 w-2 inline mr-1" />฿{part.bulkPrice.toLocaleString()} ({part.bulkPriceQty}+ ชิ้น)</p>
                          )}
                        </div>
                      </CardContent>

                      <CardFooter className="p-3 pt-0 gap-2">
                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setViewingPart(part)} title="ดูรายละเอียด">
                            <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          className="flex-1 h-9 rounded-lg text-xs font-bold gap-2"
                          onClick={() => addToCart(part)}
                          disabled={part.stockQty <= 0 || !canUseCart}
                          title={!canUseCart ? "เข้าสู่ระบบลูกค้าเพื่อใส่ตะกร้า" : undefined}
                        >
                          <Plus className="h-3.5 w-3.5" /> ใส่ตะกร้า
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-white/40 gap-4">
                  <Box className="h-16 w-16 opacity-10" />
                  <p>ไม่พบสินค้าในหมวดหมู่ที่เลือกค่ะ</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <Dialog open={!!viewingPart} onOpenChange={(open) => !open && setViewingPart(null)}>
        <DialogContent className="sm:max-w-2xl bg-slate-900 border-white/10 text-white overflow-hidden p-0">
            <div className="grid md:grid-cols-2">
                <div className="relative aspect-square md:aspect-auto bg-slate-100">
                    {viewingPart?.imageUrl ? (
                        <Image src={viewingPart.imageUrl} alt={viewingPart.name} fill className="object-cover" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-200"><Box className="h-20 w-20 opacity-10" /></div>
                    )}
                    {viewingPart?.isSpecialPrice && (
                        <Badge className="absolute top-4 left-4 bg-red-600 text-white border-none font-bold">ราคาพิเศษ</Badge>
                    )}
                </div>
                <div className="p-6 flex flex-col h-full">
                    <DialogHeader>
                        <div className="text-[10px] text-primary font-bold uppercase tracking-widest mb-1">{viewingPart?.categoryNameSnapshot}</div>
                        <DialogTitle className="text-xl font-bold leading-tight text-white">{viewingPart?.name}</DialogTitle>
                        <DialogDescription className="text-slate-400 font-mono text-xs">{viewingPart?.code}</DialogDescription>
                    </DialogHeader>
                    
                    <div className="flex-1 mt-6">
                        <div className="flex items-baseline gap-3 mb-6">
                            <span className="text-3xl font-black text-primary">฿{(viewingPart?.webPrice || viewingPart?.sellingPrice || 0).toLocaleString()}</span>
                            {viewingPart?.isSpecialPrice && (
                                <span className="text-sm text-slate-500 line-through">฿{(viewingPart?.webPriceOld || viewingPart?.sellingPrice || 0).toLocaleString()}</span>
                            )}
                        </div>

                        {viewingPart?.webPromoNote && (
                            <Alert className="bg-orange-500/10 border-orange-500/20 text-orange-500 mb-6">
                                <Sparkles className="h-4 w-4" />
                                <AlertTitle className="text-xs font-bold">โปรโมชั่นพิเศษ!</AlertTitle>
                                <AlertDescription className="text-xs">{viewingPart.webPromoNote}</AlertDescription>
                            </Alert>
                        )}

                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-white/40 uppercase tracking-widest">รายละเอียดสินค้า</Label>
                            <ScrollArea className="h-40 pr-4">
                                <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                                    {viewingPart?.webDetails || "ขออภัยค่ะ สินค้ารายการนี้ยังไม่มีรายละเอียดเพิ่มเติมในขณะนี้ หากต้องการข้อมูลสเปคที่แน่นอน สามารถติดต่อสอบถามเจ้าหน้าที่ได้เลยค่ะ"}
                                </p>
                            </ScrollArea>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-white/10 mt-6 flex gap-3">
                        <Button
                          className="flex-1 h-12 text-base font-bold rounded-xl"
                          onClick={() => {
                            if (viewingPart) addToCart(viewingPart);
                            setViewingPart(null);
                          }}
                          disabled={(viewingPart && viewingPart.stockQty <= 0) || !canUseCart}
                          title={!canUseCart ? "เข้าสู่ระบบลูกค้าเพื่อใส่ตะกร้า" : undefined}
                        >
                            <Plus className="mr-2 h-5 w-5" /> เพิ่มลงตะกร้า
                        </Button>
                    </div>
                </div>
            </div>
        </DialogContent>
      </Dialog>

      <PublicFooter />
    </div>
  );
}
