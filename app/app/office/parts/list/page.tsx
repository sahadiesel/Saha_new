
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, where, getDocs, runTransaction } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase, useCollection } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { BrowserMultiFormatReader } from '@zxing/browser';

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle, Search, Edit, Trash2, Camera, X, Save, Box, MapPin, ImageIcon, Info, ScanBarcode, AlertCircle, MoreHorizontal, Eye, RefreshCw, TrendingUp, TrendingDown, Filter, ChevronsUpDown } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import type { Part, PartCategory, PartLocation, StockActivity } from "@/lib/types";
import type { WithId } from "@/firebase";
import { cn, sanitizeForFirestore } from "@/lib/utils";

const FILE_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB

const compressImageIfNeeded = async (file: File): Promise<File> => {
  if (file.size <= FILE_SIZE_THRESHOLD) return file;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let quality = 0.9;
        const attemptCompression = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                if (blob.size <= FILE_SIZE_THRESHOLD || q <= 0.1) {
                  const compressedFile = new File([blob], file.name, {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                } else {
                  attemptCompression(q - 0.1);
                }
              } else {
                resolve(file); 
              }
            },
            "image/jpeg",
            q
          );
        };
        attemptCompression(quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const partSchema = z.object({
  code: z.string().min(1, "กรุณากรอกหรัสอะไหล่"),
  name: z.string().min(1, "กรุณากรอกชื่ออะไหล่"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  sellingPrice: z.coerce.number().min(0, "ห้ามติดลบ"),
  stockQty: z.coerce.number().min(0, "ห้ามติดลบ"),
  costPrice: z.coerce.number().min(0, "ห้ามติดลบ").default(0),
  minStock: z.coerce.number().min(0, "ห้ามติดลบ").default(0),
  location: z.string().optional().default(""),
  details: z.string().optional().default(""),
});

type PartFormData = z.infer<typeof partSchema>;

const adjustStockSchema = z.object({
  type: z.enum(["ADJUST_ADD", "ADJUST_REMOVE"]),
  diffQty: z.coerce.number().min(0.01, "ต้องระบุจำนวนที่ต้องการปรับปรุง"),
  notes: z.string().min(1, "กรุณาระบุเหตุผลในการปรับปรุงยอดสต็อก"),
});

type AdjustStockFormData = z.infer<typeof adjustStockSchema>;

export default function PartsInventoryPage() {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [parts, setParts] = useState<WithId<Part>[]>([]);
  const [categories, setCategories] = useState<WithId<PartCategory>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Filtering States
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<WithId<Part> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [partToDelete, setPartToDelete] = useState<WithId<Part> | null>(null);

  const [isAdjustingStock, setIsAdjustingStock] = useState(false);
  const [isAdjustmentSubmitting, setIsAdjustmentSubmitting] = useState(false);

  // Autocomplete Location State
  const [locationSearch, setLocationSearch] = useState("");
  const [isLocationPopoverOpen, setIsLocationPopoverOpen] = useState(false);

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<any>(null);

  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const searchVideoRef = useRef<HTMLVideoElement>(null);
  const searchScannerControlsRef = useRef<any>(null);

  const locationsQuery = useMemo(() => 
    db ? query(collection(db, "partLocations"), orderBy("name", "asc")) : null
  , [db]);
  const { data: locations } = useCollection<PartLocation>(locationsQuery);

  const canManage = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'PURCHASING';

  const form = useForm<PartFormData>({
    resolver: zodResolver(partSchema),
    defaultValues: {
      code: "",
      name: "",
      categoryId: "",
      sellingPrice: 0,
      stockQty: 0,
      costPrice: 0,
      minStock: 0,
      location: "",
      details: "",
    },
  });

  const adjustForm = useForm<AdjustStockFormData>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: {
      type: "ADJUST_ADD",
      diffQty: 0,
      notes: "",
    },
  });

  const watchedCode = form.watch("code");

  useEffect(() => {
    if (!db) return;
    const unsubParts = onSnapshot(query(collection(db, "parts"), orderBy("createdAt", "desc")), (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Part>)));
      setLoading(false);
    }, (error) => {
      console.error("Error loading parts:", error);
      setLoading(false);
    });
    const unsubCats = onSnapshot(query(collection(db, "partCategories"), orderBy("name", "asc")), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<PartCategory>)));
    });
    return () => { unsubParts(); unsubCats(); };
  }, [db]);

  useEffect(() => {
    if (editingPart) {
      form.reset({
        code: editingPart.code,
        name: editingPart.name,
        categoryId: editingPart.categoryId,
        sellingPrice: editingPart.sellingPrice,
        stockQty: editingPart.stockQty,
        costPrice: editingPart.costPrice || 0,
        minStock: editingPart.minStock || 0,
        location: editingPart.location || "",
        details: editingPart.details || "",
      });
      setPhotoPreview(editingPart.imageUrl || null);
    } else {
      form.reset({ code: "", name: "", categoryId: "", sellingPrice: 0, stockQty: 0, costPrice: 0, minStock: 0, location: "", details: "" });
      setPhotoPreview(null);
      setPhoto(null);
    }
  }, [editingPart, isDialogOpen, form]);

  const startScanner = async () => {
    setIsScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const reader = new BrowserMultiFormatReader();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const controls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) {
            form.setValue("code", result.getText());
            toast({ title: "สแกนสำเร็จ", description: `รหัส: ${result.getText()}` });
            stopScanner();
          }
        });
        scannerControlsRef.current = controls;
      }
    } catch (error) {
      toast({ variant: "destructive", title: "ไม่สามารถเปิดกล้องได้" });
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

  const startSearchScanner = async () => {
    setIsSearchScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const reader = new BrowserMultiFormatReader();
      if (searchVideoRef.current) {
        searchVideoRef.current.srcObject = stream;
        const controls = await reader.decodeFromVideoElement(searchVideoRef.current, (result) => {
          if (result) {
            setSearchTerm(result.getText());
            stopSearchScanner();
          }
        });
        searchScannerControlsRef.current = controls;
      }
    } catch (error) {
      toast({ variant: "destructive", title: "ไม่สามารถเปิดกล้องได้" });
    }
  };

  const stopSearchScanner = () => {
    if (searchScannerControlsRef.current) searchScannerControlsRef.current.stop();
    if (searchVideoRef.current?.srcObject) {
      const stream = searchVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      searchVideoRef.current.srcObject = null;
    }
    setIsSearchScannerOpen(false);
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsCompressing(true);
      try {
        const processed = await compressImageIfNeeded(file);
        setPhoto(processed);
        setPhotoPreview(URL.createObjectURL(processed));
      } catch (err) {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาดในการจัดการรูปภาพ" });
      } finally {
        setIsCompressing(false);
        e.target.value = '';
      }
    }
  };

  const handleRemovePhoto = () => {
    if (photoPreview && photo) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
  };

  const onSubmit = async (values: PartFormData) => {
    if (!db || !profile || !storage) return;
    setIsSubmitting(true);

    try {
      let finalImageUrl = "";
      if (photo) {
        const photoRef = ref(storage, `parts/${Date.now()}-${photo.name}`);
        await uploadBytes(photoRef, photo);
        finalImageUrl = await getDownloadURL(photoRef);
      } else if (photoPreview) {
        finalImageUrl = editingPart?.imageUrl || "";
      }

      const category = categories.find(c => c.id === values.categoryId);
      const partData: any = {
        name: values.name,
        categoryId: values.categoryId,
        categoryNameSnapshot: category?.name || "",
        sellingPrice: values.sellingPrice,
        costPrice: values.costPrice,
        stockQty: values.stockQty, // Only used for new, but included for updates if needed (guarded by logic)
        minStock: values.minStock,
        location: values.location || "",
        details: values.details || "",
        imageUrl: finalImageUrl,
        updatedAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName,
      };

      if (editingPart) {
        const partRef = doc(db, "parts", editingPart.id);
        // Remove stockQty from updates, must use adjust transaction
        delete partData.stockQty;
        await updateDoc(partRef, sanitizeForFirestore(partData));
        toast({ title: "อัปเดตข้อมูลสำเร็จ" });
        setIsDialogOpen(false);
      } else {
        const finalData = { ...sanitizeForFirestore(partData), code: values.code, createdAt: serverTimestamp() };
        await addDoc(collection(db, "parts"), finalData);
        toast({ title: "เพิ่มอะไหล่ใหม่สำเร็จ" });
        setIsDialogOpen(false);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "ผิดพลาด", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onAdjustStock = async (values: AdjustStockFormData) => {
    if (!db || !profile || !editingPart) return;
    setIsAdjustmentSubmitting(true);
    try {
      await runTransaction(db, async (transaction) => {
        const partRef = doc(db, "parts", editingPart.id);
        const partSnap = await transaction.get(partRef);
        if (!partSnap.exists()) throw new Error("ไม่พบรายการอะไหล่ในระบบ");
        const currentQty = partSnap.data().stockQty || 0;
        const diff = values.type === "ADJUST_ADD" ? values.diffQty : -values.diffQty;
        const newQty = currentQty + diff;
        if (newQty < 0) throw new Error("สต็อกคงเหลือห้ามติดลบ");
        
        transaction.update(partRef, { stockQty: newQty, updatedAt: serverTimestamp() });
        
        const activityRef = doc(collection(db, "stockActivities"));
        transaction.set(activityRef, sanitizeForFirestore({
          partId: editingPart.id,
          partCode: editingPart.code,
          partName: editingPart.name,
          type: values.type,
          diffQty: values.diffQty,
          beforeQty: currentQty,
          afterQty: newQty,
          notes: values.notes,
          createdByUid: profile.uid,
          createdByName: profile.displayName,
          createdAt: serverTimestamp(),
        }));
      });
      toast({ title: "ปรับปรุงสต็อกสำเร็จ" });
      setIsAdjustingStock(false);
      adjustForm.reset();
    } catch (e: any) {
      toast({ variant: "destructive", title: "ล้มเหลว", description: e.message });
    } finally {
      setIsAdjustmentSubmitting(false);
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
    let result = [...parts];

    if (categoryFilter !== "ALL") {
      result = result.filter(p => p.categoryId === categoryFilter);
    }

    if (locationFilter !== "ALL") {
      result = result.filter(p => p.location === locationFilter);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.code.toLowerCase().includes(q) || 
        p.categoryNameSnapshot.toLowerCase().includes(q)
      );
    }
    return result;
  }, [parts, searchTerm, categoryFilter, locationFilter]);

  const filteredLocationOptions = useMemo(() => {
    if (!locations) return [];
    if (!locationSearch) return locations;
    return locations.filter(l => l.name.toLowerCase().includes(locationSearch.toLowerCase()));
  }, [locations, locationSearch]);

  return (
    <div className="space-y-6">
      <PageHeader title="รายการและสต๊อคสินค้า" description="จัดการฐานข้อมูลอะไหล่ สต็อก และราคาทั้งหมด">
        {canManage && <Button onClick={() => { setEditingPart(null); setIsDialogOpen(true); }}><PlusCircle className="mr-2 h-4 w-4" /> เพิ่มอะไหล่ใหม่</Button>}
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <div className="flex gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="ค้นหาตามชื่อ หรือรหัส..." className="pl-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <Button variant="secondary" size="icon" onClick={startSearchScanner}><ScanBarcode className="h-5 w-5" /></Button>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3 w-3 text-muted-foreground" />
                    <SelectValue placeholder="หมวดหมู่ทั้งหมด" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">หมวดหมู่ทั้งหมด</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-[180px]">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <SelectValue placeholder="ชั้นวางทั้งหมด" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">ชั้นวางทั้งหมด</SelectItem>
                  {locations?.map(loc => (
                    <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                  <TableHead className="text-right">ราคาทุน</TableHead>
                  <TableHead className="text-right">ราคาขาย</TableHead>
                  <TableHead className="text-right">สต็อก</TableHead>
                  <TableHead>ตำแหน่ง</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={8} className="h-24 text-center"><Loader2 className="animate-spin mx-auto text-primary" /></TableCell></TableRow>
                : filteredParts.length > 0 ? filteredParts.map(part => (
                    <TableRow key={part.id}>
                      <TableCell><div className="relative w-12 h-12 rounded border bg-muted overflow-hidden">{part.imageUrl ? <Image src={part.imageUrl} alt={part.name} fill className="object-cover" /> : <Box className="w-6 h-6 m-3 text-muted-foreground/30" />}</div></TableCell>
                      <TableCell><p className="font-bold text-sm font-mono">{part.code}</p><p className="text-sm">{part.name}</p></TableCell>
                      <TableCell><Badge variant="outline">{part.categoryNameSnapshot}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">฿{(part.costPrice || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold text-primary">฿{part.sellingPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={part.stockQty <= (part.minStock || 0) ? "destructive" : "secondary"}>
                          {part.stockQty}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs"><div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{part.location || '-'}</div></TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingPart(part); setIsDialogOpen(true); }}><Eye className="mr-2 h-4 w-4" /> ดู/แก้ไข</DropdownMenuItem>
                            {profile?.role === 'ADMIN' && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setPartToDelete(part)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> ลบ</DropdownMenuItem></>)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground italic">ไม่พบรายการอะไหล่</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto p-0 flex flex-col">
          <DialogHeader className="p-6 pb-2"><DialogTitle>{editingPart ? "รายละเอียดและแก้ไขอะไหล่" : "เพิ่มอะไหล่ใหม่เข้าระบบ"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(data => onSubmit(data))} className="space-y-6 p-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {/* Left side: Image and Code */}
                <div className="md:col-span-2 space-y-4">
                  <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg bg-muted/20 gap-4">
                    <div className="relative w-full aspect-square border rounded-md overflow-hidden bg-background shadow-inner">
                      {photoPreview ? <><Image src={photoPreview} alt="Preview" fill className="object-cover" /><Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 rounded-full" onClick={handleRemovePhoto} disabled={isSubmitting || isCompressing}><X className="h-3 w-3" /></Button></> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-12 w-12 opacity-20" /></div>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="w-full" disabled={isSubmitting || isCompressing}>{isCompressing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />} เลือกรูปภาพ</Button></DropdownMenuTrigger>
                      <DropdownMenuContent><DropdownMenuItem onClick={() => cameraInputRef.current?.click()}><Camera className="mr-2 h-4 w-4" /> กล้อง</DropdownMenuItem><DropdownMenuItem onClick={() => galleryInputRef.current?.click()}><ImageIcon className="mr-2 h-4 w-4" /> คลังรูป</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
                    <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handlePhotoChange} />
                    <input type="file" ref={galleryInputRef} className="hidden" accept="image/*" onChange={handlePhotoChange} />
                  </div>
                  <FormField name="code" control={form.control} render={({ field }) => (
                    <FormItem>
                      <FormLabel>รหัสสินค้า / Barcode <span className="text-destructive">*</span></FormLabel>
                      <div className="flex gap-2">
                        <FormControl><Input placeholder="รหัสสินค้า..." {...field} disabled={isSubmitting || !!editingPart} className={cn(!!editingPart && "bg-muted font-mono")} /></FormControl>
                        {!editingPart && <Button type="button" variant="secondary" size="icon" onClick={startScanner} disabled={isSubmitting}><ScanBarcode className="h-5 w-5" /></Button>}
                      </div>
                      {(watchedCode || editingPart?.code) && (
                        <div className="mt-2 flex flex-col items-center p-2 border rounded-lg bg-white shadow-sm overflow-hidden h-14">
                          <img src={`https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(watchedCode || editingPart?.code || '')}&scale=4&rotate=N&includetext&barheight=10&textsize=7`} alt="Barcode" className="w-full h-14 block" />
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Right side: Field inputs rearranged into 5 rows */}
                <div className="md:col-span-3 space-y-4">
                  {/* Row 1: Name */}
                  <FormField name="name" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชื่อรายการสินค้า <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                  
                  {/* Row 2: Category */}
                  <FormField name="categoryId" control={form.control} render={({ field }) => (
                    <FormItem>
                      <FormLabel>หมวดหมู่ <span className="text-destructive">*</span></FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                        <FormControl><SelectTrigger><SelectValue placeholder="เลือกหมวดหมู่..." /></SelectTrigger></FormControl>
                        <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Row 3: Sale Price | Cost Price */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField name="sellingPrice" control={form.control} render={({ field }) => (<FormItem><FormLabel className="text-primary font-bold">ราคาขาย (บาท) <span className="text-destructive">*</span></FormLabel><FormControl><Input type="number" step="0.01" {...field} disabled={isSubmitting} /></FormControl></FormItem>)} />
                    <FormField name="costPrice" control={form.control} render={({ field }) => (<FormItem><FormLabel>ราคาทุนเฉลี่ย</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value || ''} disabled={isSubmitting} /></FormControl></FormItem>)} />
                  </div>

                  {/* Row 4: Initial Stock | Minimum Stock */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField name="stockQty" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>{editingPart ? "สต็อกปัจจุบัน" : "สต็อกเริ่มต้น"}</FormLabel>
                        <FormControl><Input type="number" {...field} disabled={isSubmitting || !!editingPart} className={cn(!!editingPart && "bg-muted")} /></FormControl>
                        {!!editingPart && <Button type="button" variant="outline" size="sm" className="h-7 text-[10px] w-full mt-1 border-dashed" onClick={() => setIsAdjustingStock(true)}><RefreshCw className="mr-1 h-3 w-3" /> ปรับปรุงยอด</Button>}
                      </FormItem>
                    )} />
                    <FormField name="minStock" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>จำนวนสต็อกขั้นต่ำ (Min)</FormLabel>
                        <FormControl><Input type="number" {...field} disabled={isSubmitting} /></FormControl>
                        <FormDescription className="text-[10px]">ระบบจะเตือนเมื่อสินค้าใกล้หมด</FormDescription>
                      </FormItem>
                    )} />
                  </div>

                  {/* Row 5: Location | Details */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField name="location" control={form.control} render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>ชั้นจัดเก็บ</FormLabel>
                        <Popover open={isLocationPopoverOpen} onOpenChange={setIsLocationPopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder="พิมพ์พิกัด..."
                                  {...field}
                                  autoComplete="off"
                                  onChange={(e) => {
                                    field.onChange(e.target.value);
                                    setLocationSearch(e.target.value);
                                    if (!isLocationPopoverOpen) setIsLocationPopoverOpen(true);
                                  }}
                                  onFocus={() => setIsLocationPopoverOpen(true)}
                                  disabled={isSubmitting}
                                  className="pr-8"
                                />
                                <MapPin className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                              </div>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent 
                            className="p-0 w-[var(--radix-popover-trigger-width)]" 
                            align="start"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <ScrollArea className="h-60 border rounded-md shadow-md bg-popover">
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => { field.onChange(""); setIsLocationPopoverOpen(false); setLocationSearch(""); }}
                                className="w-full justify-start rounded-none border-b h-9 text-xs"
                              >
                                -- ไม่ระบุ --
                              </Button>
                              {filteredLocationOptions.length > 0 ? (
                                <div className="flex flex-col">
                                  {filteredLocationOptions.map((loc) => (
                                    <Button
                                      key={loc.id}
                                      variant="ghost"
                                      type="button"
                                      onClick={() => {
                                        field.onChange(loc.name);
                                        setIsLocationPopoverOpen(false);
                                        setLocationSearch("");
                                      }}
                                      className="justify-start font-normal h-9 rounded-none border-b last:border-0 text-xs text-left"
                                    >
                                      <MapPin className="mr-2 h-3 w-3 text-muted-foreground shrink-0" />
                                      <span className="truncate">{loc.name}</span>
                                    </Button>
                                  ))}
                                </div>
                              ) : (
                                <div className="p-4 text-center text-xs text-muted-foreground italic">
                                  {locationSearch ? "ไม่พบพิกัดเดิม (พิมพ์เพื่อบันทึกเป็นชื่อใหม่ได้ค่ะ)" : "พิมพ์เพื่อค้นหา..."}
                                </div>
                              )}
                            </ScrollArea>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="details" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>รายละเอียดเพิ่มเติม</FormLabel>
                        <FormControl><Input placeholder="ระบุข้อมูลแจ้งไว้..." {...field} disabled={isSubmitting} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                </div>
              </div>
              <DialogFooter className="pt-4 border-t mt-4"><Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} {editingPart ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAdjustingStock} onOpenChange={setIsAdjustingStock}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>ปรับปรุงสต็อก: {editingPart?.name}</DialogTitle></DialogHeader>
          <Form {...adjustForm}>
            <form onSubmit={adjustForm.handleSubmit(onAdjustStock)} className="space-y-6">
              <FormField name="type" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col gap-2">
                      <FormItem className="flex items-center space-x-3 p-3 border rounded-lg"><FormControl><RadioGroupItem value="ADJUST_ADD" /></FormControl><Label className="font-normal text-green-600 flex items-center gap-2 cursor-pointer"><TrendingUp className="h-4 w-4"/> ปรับเพิ่ม</Label></FormItem>
                      <FormItem className="flex items-center space-x-3 p-3 border rounded-lg"><FormControl><RadioGroupItem value="ADJUST_REMOVE" /></FormControl><Label className="font-normal text-destructive flex items-center gap-2 cursor-pointer"><TrendingDown className="h-4 w-4"/> ปรับลด</Label></FormItem>
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )} />
              <FormField name="diffQty" render={({ field }) => (<FormItem><FormLabel>จำนวนที่ปรับปรุง</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>)} />
              <FormField name="notes" render={({ field }) => (<FormItem><FormLabel>เหตุผล <span className="text-destructive">*</span></FormLabel><FormControl><Textarea placeholder="เช่น ปรับปรุงตามยอดนับจริง..." {...field} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter><Button variant="outline" type="button" onClick={() => setIsAdjustingStock(false)}>ยกเลิก</Button><Button type="submit" disabled={isAdjustmentSubmitting}>{isAdjustmentSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ยืนยัน</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isScannerOpen} onOpenChange={(open) => !open && stopScanner()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-black">
          <div className="relative aspect-square"><video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline /><div className="absolute inset-0 border-2 border-primary/50 m-12 rounded-lg pointer-events-none"><div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 animate-pulse" /></div></div>
          <DialogFooter className="p-4 bg-background"><Button variant="outline" className="w-full" onClick={stopScanner}>ยกเลิก</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSearchScannerOpen} onOpenChange={(open) => !open && stopSearchScanner()}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-black">
          <div className="relative aspect-square"><video ref={searchVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline /><div className="absolute inset-0 border-2 border-primary/50 m-12 rounded-lg pointer-events-none"><div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 animate-pulse" /></div></div>
          <DialogFooter className="p-4 bg-background"><Button variant="outline" className="w-full" onClick={stopSearchScanner}>ยกเลิก</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!partToDelete} onOpenChange={(o) => !o && setPartToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>ลบสินค้า?</AlertDialogTitle><AlertDialogDescription>คุณต้องการลบอะไหล่ "{partToDelete?.name}" ออกจากระบบใช่หรือไม่?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>ยกเลิก</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-destructive">ลบ</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
