
"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, PackagePlus, AlertTriangle, Box, MapPin, ExternalLink, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Part } from "@/lib/types";
import type { WithId } from "@/firebase";
import Image from "next/image";

export default function LowStockPartsPage() {
  const { db } = useFirebase();
  
  const [parts, setParts] = useState<WithId<Part>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    
    const q = query(collection(db, "parts"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const allParts = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>));
      
      // Filter logic: 
      // 1. Stock is below or equal to Min Stock
      // 2. BUT exclude if Min Stock is 0 AND user marked it as "No order required"
      const lowStock = allParts.filter(p => {
        const isBelowMin = p.stockQty <= (p.minStock || 0);
        const isIgnoredIfZero = (p.minStock === 0 && p.isOrderRequired === false);
        return isBelowMin && !isIgnoredIfZero;
      });
      
      setParts(lowStock);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db]);

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return parts;
    const q = searchTerm.toLowerCase();
    return parts.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.code.toLowerCase().includes(q)
    );
  }, [parts, searchTerm]);

  return (
    <div className="space-y-6">
      <PageHeader 
        title="รายการที่ต้องเตรียมสั่ง" 
        description="รายการอะไหล่ที่ยอดคงเหลือต่ำกว่าจุดสั่งซื้อขั้นต่ำ (Min Stock)" 
      >
        <Button asChild className="bg-primary hover:bg-primary/90">
          <Link href="/app/office/parts/purchases/new">
            <PackagePlus className="mr-2 h-4 w-4" /> สร้างรายการซื้อ
          </Link>
        </Button>
      </PageHeader>

      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle className="text-lg">รายการสินค้าใกล้หมด ({parts.length})</CardTitle>
          </div>
          <CardDescription className="text-amber-600">
            รายการด้านล่างกรองเอาสินค้าที่ไม่จำเป็นต้องสต็อกออกให้แล้วค่ะ (กรณี Min Stock เป็น 0 และติ๊กไม่จำเป็นต้องสั่ง)
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาชื่อหรือรหัสอะไหล่ที่ต้องสั่ง..." 
              className="pl-10"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16 text-center">รูป</TableHead>
                  <TableHead>รหัส / ชื่อสินค้า</TableHead>
                  <TableHead className="text-right">คงเหลือ</TableHead>
                  <TableHead className="text-right">ยอดขั้นต่ำ (Min)</TableHead>
                  <TableHead>ตำแหน่ง</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : filteredParts.length > 0 ? (
                  filteredParts.map(part => (
                    <TableRow key={part.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="relative w-10 h-10 rounded border bg-muted overflow-hidden mx-auto">
                          {part.imageUrl ? (
                            <Image src={part.imageUrl} alt={part.name} fill className="object-cover" />
                          ) : (
                            <Box className="w-5 h-5 m-2.5 text-muted-foreground/30" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-bold text-sm font-mono text-primary uppercase">{part.code}</p>
                        <p className="text-xs">{part.name}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="font-bold font-mono">
                          {part.stockQty}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">
                        {part.minStock || 0}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {part.location || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm" className="h-8">
                          <Link href={`/app/office/parts/list?search=${part.code}`}>
                            <ExternalLink className="mr-1.5 h-3 w-3" /> ดูคลัง
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground italic">
                      {searchTerm ? "ไม่พบรายการที่ค้นหา" : "ยอดสต็อกสินค้าทุกรายการยังอยู่ในเกณฑ์ปกติค่ะ"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
