"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle, Search, Edit, Trash2, Camera, X, Save, Box, Package, MapPin, ImageIcon, Info } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Image from "next/image";
import type { Part, PartCategory, Vendor } from "@/lib/types";
import type { WithId } from "@/firebase";
import { cn, sanitizeForFirestore } from "@/lib/utils";

const partSchema = z.object({
  code: z.string().min(1, "กรุณากรอกรหัสอะไหล่"),
  name: z.string().min(1, "กรุณากรอกชื่ออะไหล่"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  vendorId: z.string().min(1, "กรุณาเลือกผู้ขาย"),
  sellingPrice: z.coerce.number().min(0, "ห้ามติดลบ"),
  stockQty: z.coerce.number().min(0, "ห้ามติดลบ"),
  location: z.string().optional().default(""),
});

type PartFormData = z.infer<typeof partSchema>;

export default function PartsInventoryPage() {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [parts, setParts] = useState<WithId<Part>[]>([]);
  const [categories, setCategories] = useState<WithId<PartCategory>[]>([]);
  const [vendors, setVendors] = useState<WithId<Vendor>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<WithId<Part> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [partToDelete, setPartToDelete] = useState<WithId<Part> | null>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManage = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'PURCHASING';

  const form = useForm<PartFormData>({
    resolver: zodResolver(partSchema),
    defaultValues: {
      code: "",
      name: "",
      categoryId: "",
      vendorId: "",
      sellingPrice: 0,
      stockQty: 0,
      location: "",
    },
  });

  useEffect(() => {
    if (!db) return;
    const unsubParts = onSnapshot(query(collection(db, "parts"), orderBy("createdAt", "desc")), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>)));
      setLoading(false);
    });
    const unsubCats = onSnapshot(query(collection(db, "partCategories"), orderBy("name", "asc")), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<PartCategory>)));
    });
    // Fix: Client-side sort to avoid index requirement for where + orderBy
    const unsubVendors = onSnapshot(query(collection(db, "vendors"), where("isActive", "==", true)), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Vendor>));
      data.sort((a, b) => (a.shortName || "").localeCompare(b.shortName || "", 'th'));
      setVendors(data);
    });
    return () => { unsubParts(); unsubCats(); unsubVendors(); };
  }, [db]);

  useEffect(() => {
    if (editingPart) {
      form.reset({
        code: editingPart.code,
        name: editingPart.name,
        categoryId: editingPart.categoryId,
        vendorId: editingPart.vendorId,
        sellingPrice: editingPart.sellingPrice,
        stockQty: editingPart.stockQty,
        location: editingPart.location || "",
      });
      setPhotoPreview(editingPart.imageUrl || null);
    } else {
      form.reset({ code: "", name: "", categoryId: "", vendorId: "", sellingPrice: 0, stockQty: 0, location: "" });
      setPhotoPreview(null);
      setPhoto(null);
    }
  }, [editingPart, isDialogOpen, form]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const onSubmit = async (values: PartFormData) => {
    if (!db || !profile || !storage) return;
    setIsSubmitting(true);

    try {
      let finalImageUrl = editingPart?.imageUrl || "";
      if (photo) {
        const photoRef = ref(storage, `parts/${Date.now()}-${photo.name}`);
        await uploadBytes(photoRef, photo);
        finalImageUrl = await getDownloadURL(photoRef);
      }

      const category = categories.find(c => c.id === values.categoryId);
      const vendor = vendors.find(v => v.id === values.vendorId);

      const partData = {
        ...values,
        categoryNameSnapshot: category?.name || "",
        vendorNameSnapshot: vendor?.companyName || "",
        imageUrl: finalImageUrl,
        updatedAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName,
        costPrice: editingPart?.costPrice || 0, // Preserve avg cost
      };

      if (editingPart) {
        await updateDoc(doc(db, "parts", editingPart.id), sanitizeForFirestore(partData));
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        await addDoc(collection(db, "parts"), {
          ...sanitizeForFirestore(partData),
          createdAt: serverTimestamp(),
        });
        toast({ title: "เพิ่มอะไหล่ใหม่สำเร็จ" });
      }
      setIsDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "ผิดพลาด", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!db || !partToDelete) return;
    try {
      await deleteDoc(doc(db, "parts", partToDelete.id));
      toast({ title: "ลบข้อมูลสำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setPartToDelete(null);
    }
  };

  const filteredParts = useMemo(() => {
    if (!searchTerm) return parts;
    const q = searchTerm.toLowerCase();
    return parts.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.code.toLowerCase().includes(q) || 
      p.categoryNameSnapshot.toLowerCase().includes(q)
    );
  }, [parts, searchTerm]);

  return (
    <div className="space-y-6">
      <PageHeader title="รายการอะไหล่/ค้นหา" description="จัดการฐานข้อมูลอะไหล่ สต็อก และราคาทั้งหมด">
        {canManage && (
          <Button onClick={() => { setEditingPart(null); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มอะไหล่ใหม่
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามชื่อ, รหัส, หรือหมวดหมู่..." 
              className="pl-10" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">รูป</TableHead>
                  <TableHead>รหัส / ชื่อสินค้า</TableHead>
                  <TableHead>หมวดหมู่</TableHead>
                  <TableHead className="text-right">ต้นทุนเฉลี่ย</TableHead>
                  <TableHead className="text-right">ราคาขาย</TableHead>
                  <TableHead className="text-right">สต็อก</TableHead>
                  <TableHead>ตำแหน่ง</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                ) : filteredParts.length > 0 ? (
                  filteredParts.map(part => (
                    <TableRow key={part.id}>
                      <TableCell>
                        <div className="relative w-12 h-12 rounded border bg-muted overflow-hidden">
                          {part.imageUrl ? (
                            <Image src={part.imageUrl} alt={part.name} fill className="object-cover" />
                          ) : (
                            <Box className="w-6 h-6 m-3 text-muted-foreground/30" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-bold text-sm font-mono">{part.code}</p>
                        <p className="text-sm">{part.name}</p>
                      </TableCell>
                      <TableCell><Badge variant="outline">{part.categoryNameSnapshot}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">฿{(part.costPrice || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-primary">฿{part.sellingPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={part.stockQty > 5 ? "secondary" : "destructive"}>{part.stockQty}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{part.location || '-'}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingPart(part); setIsDialogOpen(true); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          {profile?.role === 'ADMIN' && (
                            <Button variant="ghost" size="icon" onClick={() => setPartToDelete(part)} className="text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground italic">ไม่พบรายการอะไหล่</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPart ? "แก้ไขข้อมูลอะไหล่" : "เพิ่มอะไหล่ใหม่เข้าระบบ"}</DialogTitle>
            <DialogDescription>กรอกข้อมูลรายละเอียดของอะไหล่ให้ครบถ้วนเพื่อความแม่นยำของสต็อกสินค้า</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg bg-muted/20 gap-4">
                    <div className="relative w-40 h-40 border rounded-md overflow-hidden bg-background">
                      {photoPreview ? (
                        <Image src={photoPreview} alt="Preview" fill className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-12 w-12 opacity-20" /></div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
                      <Camera className="mr-2 h-4 w-4" /> เลือกรูปภาพ (1 รูป)
                    </Button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoChange} />
                  </div>
                  
                  <FormField name="code" control={form.control} render={({ field }) => (
                    <FormItem>
                      <FormLabel>รหัสสินค้า / Barcode <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส..." {...field} disabled={isSubmitting} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="space-y-4">
                  <FormField name="name" control={form.control} render={({ field }) => (
                    <FormItem><FormLabel>ชื่อรายการสินค้า <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="เช่น กรองน้ำมันเครื่อง Revo" {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>
                  )} />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField name="categoryId" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>หมวดหมู่ <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                          <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="vendorId" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>ร้านค้าที่ซื้อ <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                          <FormControl><SelectTrigger><SelectValue placeholder="เลือก..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.shortName}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 border-t pt-4">
                    <FormField name="sellingPrice" control={form.control} render={({ field }) => (<FormItem><FormLabel className="text-primary font-bold">ราคาขาย (บาท) <span className="text-destructive">*</span></FormLabel><FormControl><Input type="number" step="0.01" {...field} disabled={isSubmitting} /></FormControl></FormItem>)} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField name="stockQty" control={form.control} render={({ field }) => (<FormItem><FormLabel>สต็อกเริ่มต้น</FormLabel><FormControl><Input type="number" {...field} disabled={isSubmitting} /></FormControl></FormItem>)} />
                    <FormField name="location" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชั้นจัดเก็บ (Location)</FormLabel><FormControl><Input placeholder="เช่น A1-02" {...field} disabled={isSubmitting} /></FormControl></FormItem>)} />
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-[10px] text-blue-700">
                      ราคาทุนจะถูกคำนวณแบบถัวเฉลี่ยถ่วงน้ำหนักโดยอัตโนมัติจากรายการซื้อในระบบค่ะ
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {editingPart ? "บันทึกการแก้ไข" : "เพิ่มสินค้าลงสต็อก"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!partToDelete} onOpenChange={(o) => !o && setPartToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">ยืนยันการลบสินค้า?</AlertDialogTitle>
            <AlertDialogDescription>คุณต้องการลบอะไหล่รหัส "{partToDelete?.code}" ({partToDelete?.name}) ออกจากระบบถาวรใช่หรือไม่? การลบนี้จะทำให้ข้อมูลสต็อกหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">ยืนยันการลบ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
