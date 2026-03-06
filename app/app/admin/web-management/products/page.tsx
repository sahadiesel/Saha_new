"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, where, getDocs, limit } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Package, Globe, PlusCircle, Settings, Trash2, Box, Info, Sparkles, Gift, LayoutGrid } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Part, PartCategory } from "@/lib/types";
import type { WithId } from "@/firebase";
import Image from "next/image";
import Link from "next/link";
import { cn, sanitizeForFirestore } from "@/lib/utils";

const manageWebSchema = z.object({
  webPrice: z.coerce.number().min(0, "ห้ามติดลบ"),
  webPromoNote: z.string().optional().default(""),
  bulkPriceQty: z.coerce.number().min(0, "ห้ามติดลบ"),
  bulkPrice: z.coerce.number().min(0, "ห้ามติดลบ"),
});

export default function WebManagementProductsPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const [webParts, setWebParts] = useState<WithId<Part>[]>([]);
  const [allParts, setAllParts] = useState<WithId<Part>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  
  const [managingPart, setManagingPart] = useState<WithId<Part> | null>(null);
  const [isManaging, setIsManaging] = useState(false);

  const manageForm = useForm<z.infer<typeof manageWebSchema>>({
    resolver: zodResolver(manageWebSchema),
    defaultValues: { webPrice: 0, webPromoNote: "", bulkPriceQty: 0, bulkPrice: 0 }
  });

  useEffect(() => {
    if (!db) return;
    
    // 1. Listen to parts currently on web
    const qWeb = query(collection(db, "parts"), where("showOnWeb", "==", true), orderBy("name", "asc"));
    const unsubWeb = onSnapshot(qWeb, (snap) => {
      setWebParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>)));
      setLoading(false);
    });

    // 2. Load all parts for the "Add" selection (broad query, can be optimized with search)
    const qAll = query(collection(db, "parts"), orderBy("name", "asc"), limit(500));
    const unsubAll = onSnapshot(qAll, (snap) => {
      setAllParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>)));
    });

    return () => { unsubWeb(); unsubAll(); };
  }, [db]);

  const handleToggleWeb = async (partId: string, show: boolean) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, "parts", partId), {
        showOnWeb: show,
        updatedAt: serverTimestamp()
      });
      toast({ title: show ? "เพิ่มขึ้นหน้าเว็บแล้ว" : "นำออกจากหน้าเว็บแล้ว" });
      if (show) setIsAddDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    }
  };

  const handleOpenManage = (part: WithId<Part>) => {
    setManagingPart(part);
    manageForm.reset({
      webPrice: part.webPrice || part.sellingPrice,
      webPromoNote: part.webPromoNote || "",
      bulkPriceQty: part.bulkPriceQty || 0,
      bulkPrice: part.bulkPrice || 0,
    });
    setIsManaging(true);
  };

  const onManageSubmit = async (values: z.infer<typeof manageWebSchema>) => {
    if (!db || !managingPart) return;
    setIsManaging(false);
    try {
      await updateDoc(doc(db, "parts", managingPart.id), sanitizeForFirestore({
        ...values,
        updatedAt: serverTimestamp()
      }));
      toast({ title: "บันทึกโปรโมชั่นสำเร็จ" });
      setManagingPart(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    }
  };

  const filteredWebParts = useMemo(() => {
    if (!searchTerm) return webParts;
    const q = searchTerm.toLowerCase();
    return webParts.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [webParts, searchTerm]);

  const availableToAdd = useMemo(() => {
    const webIds = new Set(webParts.map(p => p.id));
    const q = partSearch.toLowerCase();
    return allParts.filter(p => !webIds.has(p.id) && (p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)));
  }, [allParts, webParts, partSearch]);

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="จัดการรายการหน้าเว็บ" description="เลือกสินค้าจากสต๊อกขึ้นแสดงบนหน้าเว็บ พร้อมจัดการโปรโมชั่นและราคาพิเศษ">
        <Button onClick={() => setIsAddDialogOpen(true)} className="shadow-md">
          <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มสินค้าขึ้นหน้าเว็บ
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อหรือรหัสในรายการหน้าเว็บ..." 
                className="pl-10" 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
              />
            </div>
            <div className="flex items-center gap-4">
                <Button asChild variant="outline" size="sm">
                    <Link href="/products" target="_blank">
                        <Globe className="mr-2 h-4 w-4" /> ดูหน้าเว็บจริง
                    </Link>
                </Button>
                <Badge variant="secondary" className="h-6">
                    บนเว็บ: {webParts.length} รายการ
                </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16 text-center">รูป</TableHead>
                  <TableHead>สินค้าและสต๊อก</TableHead>
                  <TableHead className="text-right">ราคาปกติ</TableHead>
                  <TableHead className="text-right">ราคาหน้าเว็บ</TableHead>
                  <TableHead>โปรโมชั่น / ของแถม</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : filteredWebParts.length > 0 ? (
                  filteredWebParts.map(part => (
                    <TableRow key={part.id} className="group hover:bg-muted/30">
                      <TableCell>
                        <div className="relative w-12 h-12 rounded-lg border bg-muted overflow-hidden shadow-sm">
                          {part.imageUrl ? (
                            <Image src={part.imageUrl} alt={part.name} fill className="object-cover" />
                          ) : (
                            <Box className="w-6 h-6 m-3 text-muted-foreground/30" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-bold text-sm truncate max-w-[200px]">{part.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 rounded">{part.code}</span>
                          <Badge variant={part.stockQty > 0 ? "outline" : "destructive"} className="h-4 text-[9px] px-1 font-normal">
                            สต๊อก: {part.stockQty}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground line-through text-xs">฿{part.sellingPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="font-black text-primary">฿{(part.webPrice || part.sellingPrice).toLocaleString()}</div>
                        {part.bulkPrice > 0 && (
                            <div className="text-[9px] text-green-600 font-bold leading-tight">({part.bulkPriceQty}+ ชิ้น: ฿{part.bulkPrice.toLocaleString()})</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {part.webPromoNote ? (
                            <div className="flex items-center gap-1.5 text-xs text-orange-600 font-medium">
                                <Gift className="h-3 w-3" />
                                {part.webPromoNote}
                            </div>
                        ) : <span className="text-muted-foreground/40 text-xs italic">ไม่มี</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="h-8 text-xs font-bold" onClick={() => handleOpenManage(part)}>
                            <Settings className="mr-1.5 h-3 w-3" /> จัดการ
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleToggleWeb(part.id, false)} title="นำออกจากหน้าเว็บ">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-48 text-center text-muted-foreground italic">
                    <div className="flex flex-col items-center gap-2">
                        <LayoutGrid className="h-10 w-10 opacity-10" />
                        <p>ยังไม่มีสินค้าบนหน้าเว็บค่ะ<br/>กดปุ่มด้านบนเพื่อเลือกสินค้าจากคลังมาแสดงผลที่นี่</p>
                    </div>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Select Part from Stock Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>เลือกสินค้าขึ้นหน้าเว็บ</DialogTitle>
            <DialogDescription>ค้นหาอะไหล่จากคลังเพื่อนำมาแสดงผลและทำโปรโมชั่นที่หน้าเว็บไซต์</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="พิมพ์ชื่อหรือรหัสอะไหล่เพื่อค้นหา..." className="pl-10" value={partSearch} onChange={e=>setPartSearch(e.target.value)} />
            </div>
            <ScrollArea className="h-[400px] border rounded-md">
              <div className="p-2 space-y-1">
                {availableToAdd.length > 0 ? availableToAdd.map(p => (
                  <Button key={p.id} variant="ghost" className="w-full justify-between h-auto py-2 px-3 border-b last:border-0 rounded-none hover:bg-primary/5" onClick={() => handleToggleWeb(p.id, true)}>
                    <div className="flex items-center gap-3">
                      <div className="relative w-10 h-10 rounded border bg-muted overflow-hidden flex-shrink-0">
                        {p.imageUrl ? <Image src={p.imageUrl} alt={p.name} fill className="object-cover" /> : <Box className="w-5 h-5 m-2.5 opacity-20" />}
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm line-clamp-1">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{p.code} | สต๊อก: {p.stockQty}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-primary">฿{p.sellingPrice.toLocaleString()}</p>
                      <Badge variant="outline" className="text-[8px] h-4">เลือก <PlusCircle className="ml-1 h-2 w-2" /></Badge>
                    </div>
                  </Button>
                )) : (
                  <div className="p-8 text-center text-muted-foreground italic text-sm">ไม่พบสินค้าในสต๊อก หรือถูกเลือกไปหมดแล้ว</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Promotion Dialog */}
      <Dialog open={isManaging} onOpenChange={setIsManaging}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-orange-500" />
                ตั้งค่าโปรโมชั่น: {managingPart?.name}
            </DialogTitle>
            <DialogDescription>จัดการราคาพิเศษและเงื่อนไขการแถมสำหรับแสดงหน้าเว็บ</DialogDescription>
          </DialogHeader>
          <Form {...manageForm}>
            <form onSubmit={manageForm.handleSubmit(onManageSubmit)} className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg border border-dashed flex flex-col items-center justify-center">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">ราคาขายปกติ</p>
                    <p className="text-lg font-black text-muted-foreground line-through">฿{managingPart?.sellingPrice.toLocaleString()}</p>
                </div>
                <FormField control={manageForm.control} name="webPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-primary font-bold">ราคาพิเศษหน้าเว็บ</FormLabel>
                    <FormControl><Input type="number" step="0.01" className="text-lg font-black border-primary/50 text-primary" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator />

              <div className="space-y-4">
                <Label className="flex items-center gap-2 text-green-600 font-bold"><LayoutGrid className="h-4 w-4"/> ราคาส่ง/ยกลัง (Bulk Price)</Label>
                <div className="grid grid-cols-2 gap-4 bg-green-50/50 p-4 rounded-xl border border-green-100">
                    <FormField control={manageForm.control} name="bulkPriceQty" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] uppercase">ซื้อกี่ชิ้นขึ้นไป</FormLabel>
                            <FormControl><Input type="number" {...field} placeholder="0" /></FormControl>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="bulkPrice" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] uppercase">ราคาต่อชิ้นที่ลด</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} placeholder="0" /></FormControl>
                        </FormItem>
                    )} />
                </div>
                <p className="text-[10px] text-muted-foreground italic">* ระบุเป็น 0 หากไม่ต้องการใช้ราคาส่ง</p>
              </div>

              <FormField control={manageForm.control} name="webPromoNote" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2 text-orange-600 font-bold"><Gift className="h-4 w-4"/> รายละเอียดของแถม / ข้อความโปรโมชั่น</FormLabel>
                  <FormControl><Input placeholder="เช่น ซื้อ 1 แถม 1, ฟรีค่าแรงขัน, ของแถมจำนวนจำกัด" {...field} /></FormControl>
                  <FormDescription className="text-[10px]">ข้อความนี้จะปรากฏเป็นไฮไลท์สีส้มบนหน้าเว็บ</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter className="pt-2">
                <Button variant="outline" type="button" onClick={() => setIsManaging(false)}>ยกเลิก</Button>
                <Button type="submit">บันทึกข้อมูลหน้าเว็บ</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
