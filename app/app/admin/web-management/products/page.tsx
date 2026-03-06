
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, Package, Globe, ExternalLink, Box } from "lucide-react";
import type { Part, PartCategory } from "@/lib/types";
import type { WithId } from "@/firebase";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function WebManagementProductsPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const [parts, setParts] = useState<WithId<Part>[]>([]);
  const [categories, setCategories] = useState<WithId<PartCategory>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    const unsubParts = onSnapshot(query(collection(db, "parts"), orderBy("name", "asc")), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>)));
      setLoading(false);
    });
    const unsubCats = onSnapshot(query(collection(db, "partCategories"), orderBy("name", "asc")), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<PartCategory>)));
    });
    return () => { unsubParts(); unsubCats(); };
  }, [db]);

  const handleToggleWeb = async (partId: string, currentVal: boolean) => {
    if (!db) return;
    setUpdatingId(partId);
    try {
      await updateDoc(doc(db, "parts", partId), {
        showOnWeb: !currentVal,
        updatedAt: serverTimestamp()
      });
      toast({ title: !currentVal ? "นำขึ้นหน้าเว็บแล้ว" : "นำออกจากหน้าเว็บแล้ว" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredParts = useMemo(() => {
    if (!searchTerm) return parts;
    const q = searchTerm.toLowerCase();
    return parts.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.code.toLowerCase().includes(q) || 
      p.categoryNameSnapshot?.toLowerCase().includes(q)
    );
  }, [parts, searchTerm]);

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="จัดการหน้าสินค้า" description="เลือกอะไหล่จากสต๊อกเพื่อแสดงบนหน้าเว็บไซต์สาธารณะ">
        <Button asChild variant="outline">
          <Link href="/products" target="_blank">
            <Globe className="mr-2 h-4 w-4" /> ดูหน้าเว็บจริง
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาชื่อหรือรหัสอะไหล่..." 
                className="pl-10" 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              รายการทั้งหมด {parts.length} รายการ
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-12 text-center">รูป</TableHead>
                  <TableHead>สินค้า (สต๊อก)</TableHead>
                  <TableHead>หมวดหมู่</TableHead>
                  <TableHead className="text-right">ราคาขาย</TableHead>
                  <TableHead className="text-center w-32">โชว์บนเว็บ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="h-32 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                ) : filteredParts.length > 0 ? (
                  filteredParts.map(part => (
                    <TableRow key={part.id} className={cn(part.showOnWeb && "bg-primary/5")}>
                      <TableCell>
                        <div className="relative w-10 h-10 rounded border bg-muted overflow-hidden">
                          {part.imageUrl ? (
                            <Image src={part.imageUrl} alt={part.name} fill className="object-cover" />
                          ) : (
                            <Box className="w-5 h-5 m-2.5 text-muted-foreground/30" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-bold text-sm truncate max-w-[250px]">{part.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground font-mono">{part.code}</span>
                          <Badge variant={part.stockQty > 0 ? "outline" : "destructive"} className="h-3 text-[8px] px-1">
                            คงเหลือ: {part.stockQty}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{part.categoryNameSnapshot}</Badge></TableCell>
                      <TableCell className="text-right font-bold text-primary">฿{part.sellingPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          {updatingId === part.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          ) : (
                            <Switch 
                              checked={!!part.showOnWeb} 
                              onCheckedChange={() => handleToggleWeb(part.id, !!part.showOnWeb)} 
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground italic">ไม่พบรายการสินค้า</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
