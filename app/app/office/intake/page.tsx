"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { JOB_DEPARTMENTS } from "@/lib/constants";
import { Loader2, Camera, X, ChevronsUpDown, PlusCircle, ImageIcon, AlertCircle } from "lucide-react";
import type { Customer } from "@/lib/types";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { deptLabel } from "@/lib/ui-labels";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

const MAX_INTAKE_PHOTOS = 8;
const FILE_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB

// Helper function to compress image step by step
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
                  console.log(`Compressed ${file.name}: ${(file.size / 1024 / 1024).toFixed(2)}MB -> ${(blob.size / 1024 / 1024).toFixed(2)}MB at quality ${q.toFixed(1)}`);
                  resolve(compressedFile);
                } else {
                  attemptCompression(q - 0.1);
                }
              } else {
                resolve(file); // Fallback to original
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

// Updated Schema to enforce all fields based on department
const intakeSchema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  department: z.enum(JOB_DEPARTMENTS, { required_error: "กรุณาเลือกแผนก" }),
  description: z.string().min(1, "กรุณากรอกรายละเอียดงาน"),
  carServiceDetails: z.object({
    brand: z.string().optional(),
    model: z.string().optional(),
    licensePlate: z.string().optional(),
  }).optional(),
  commonrailDetails: z.object({
    brand: z.string().optional(),
    partNumber: z.string().optional(),
    registrationNumber: z.string().optional(),
  }).optional(),
  mechanicDetails: z.object({
    brand: z.string().optional(),
    partNumber: z.string().optional(),
    registrationNumber: z.string().optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  // Enforce all fields for CAR_SERVICE
  if (data.department === 'CAR_SERVICE') {
    if (!data.carServiceDetails?.brand?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุยี่ห้อรถ", path: ['carServiceDetails', 'brand'] });
    }
    if (!data.carServiceDetails?.model?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุรุ่นรถ", path: ['carServiceDetails', 'model'] });
    }
    if (!data.carServiceDetails?.licensePlate?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุทะเบียนรถ", path: ['carServiceDetails', 'licensePlate'] });
    }
  }
  // Enforce all fields for COMMONRAIL
  if (data.department === 'COMMONRAIL') {
    if (!data.commonrailDetails?.brand?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุยี่ห้อ", path: ['commonrailDetails', 'brand'] });
    }
    if (!data.commonrailDetails?.partNumber?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุเลขอะไหล่", path: ['commonrailDetails', 'partNumber'] });
    }
    if (!data.commonrailDetails?.registrationNumber?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุเลขทะเบียนชิ้นส่วน", path: ['commonrailDetails', 'registrationNumber'] });
    }
  }
  // Enforce all fields for MECHANIC
  if (data.department === 'MECHANIC') {
    if (!data.mechanicDetails?.brand?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุยี่ห้อ", path: ['mechanicDetails', 'brand'] });
    }
    if (!data.mechanicDetails?.partNumber?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุเลขอะไหล่", path: ['mechanicDetails', 'partNumber'] });
    }
    if (!data.mechanicDetails?.registrationNumber?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "กรุณาระบุเลขทะเบียนชิ้นส่วน", path: ['mechanicDetails', 'registrationNumber'] });
    }
  }
});

export default function IntakePage() {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const isViewer = profile?.role === 'VIEWER';

  const form = useForm<z.infer<typeof intakeSchema>>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      customerId: "",
      description: "",
      carServiceDetails: { brand: '', model: '', licensePlate: '' },
      commonrailDetails: { brand: '', partNumber: '', registrationNumber: '' },
      mechanicDetails: { brand: '', partNumber: '', registrationNumber: '' },
    }
  });

  const selectedDepartment = form.watch("department");

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.phone.includes(customerSearch)
    );
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "customers"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
    },
    async (error: any) => {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: 'customers',
            operation: 'list',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        }
    });
    return () => unsubscribe();
  }, [db]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (photos.length + newFiles.length > MAX_INTAKE_PHOTOS) {
        toast({ variant: "destructive", title: `คุณสามารถอัปโหลดรูปภาพได้สูงสุด ${MAX_INTAKE_PHOTOS} รูปเท่านั้น` });
        e.target.value = '';
        return;
      }

      setIsCompressing(true);
      try {
        const processedFiles: File[] = [];
        for (const file of newFiles) {
          const processed = await compressImageIfNeeded(file);
          processedFiles.push(processed);
        }

        setPhotos(prev => [...prev, ...processedFiles]);
        const newPreviews = processedFiles.map(file => URL.createObjectURL(file));
        setPhotoPreviews(prev => [...prev, ...newPreviews]);
      } catch (err) {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาดในการจัดการรูปภาพ" });
      } finally {
        setIsCompressing(false);
        e.target.value = '';
      }
    }
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(p => p.filter((_, i) => i !== index));
  };

  const onSubmit = async (values: z.infer<typeof intakeSchema>) => {
    if (!db || !storage || !profile || isViewer) return;

    if (photos.length === 0) {
      toast({ 
        variant: "destructive", 
        title: "กรุณาแนบรูปภาพประกอบ", 
        description: "ต้องมีรูปประกอบอย่างน้อย 1 รูป เพื่อยืนยันสภาพก่อนเริ่มงานค่ะ" 
      });
      return;
    }

    const selectedCustomer = customers.find(c => c.id === values.customerId);
    if (!selectedCustomer) {
        toast({ variant: "destructive", title: "ไม่พบข้อมูลลูกค้า", description: "กรุณาเลือกลูกค้าใหม่อีกครั้งค่ะ" });
        return;
    }
    
    setIsSubmitting(true);
    
    try {
        const photoURLs: string[] = [];
        const jobDocRef = doc(collection(db, "jobs"));
        const jobId = jobDocRef.id;

        // Upload photos with error handling
        for (const photo of photos) {
            try {
                const photoRef = ref(storage, `jobs/${jobId}/${Date.now()}-${photo.name || 'blob'}`);
                await uploadBytes(photoRef, photo);
                const url = await getDownloadURL(photoRef);
                photoURLs.push(url);
            } catch (uploadErr: any) {
                console.error("Upload error:", uploadErr);
                throw new Error(`อัปโหลดรูปภาพล้มเหลว: ${uploadErr.message || "ปัญหาการเชื่อมต่อ"}`);
            }
        }

        const marketingSource = selectedCustomer.acquisitionSource || 'EXISTING';
        const isActuallyNew = marketingSource !== 'EXISTING' && marketingSource !== 'NONE';

        const jobData = {
            id: jobId,
            customerId: values.customerId,
            department: values.department,
            mainDepartment: values.department, 
            description: values.description,
            customerSnapshot: { ...selectedCustomer },
            status: "RECEIVED",
            customerType: isActuallyNew ? 'NEW' : 'EXISTING',
            customerAcquisitionSource: marketingSource,
            photos: photoURLs,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastActivityAt: serverTimestamp(),
        } as any;

        if (values.department === 'CAR_SERVICE') {
          jobData.carServiceDetails = values.carServiceDetails;
        }
        if (values.department === 'COMMONRAIL') {
          jobData.commonrailDetails = values.commonrailDetails;
        }
        if (values.department === 'MECHANIC') {
            jobData.mechanicDetails = values.mechanicDetails;
        }

        const batch = writeBatch(db);
        batch.set(jobDocRef, sanitizeForFirestore(jobData));
        
        const activityDocRef = doc(collection(db, "jobs", jobId, "activities"));
        batch.set(activityDocRef, {
            text: `เปิดงานใหม่ในแผนก ${deptLabel(values.department)} พร้อมรูปประกอบ ${photoURLs.length} รูป`,
            userName: profile.displayName,
            userId: profile.uid,
            createdAt: serverTimestamp(),
            photos: photoURLs,
        });

        await batch.commit();
        
        toast({ title: "สร้างใบงานสำเร็จ", description: `รหัสงาน: ${jobId}` });
        
        // Final state cleanup
        const currentPreviews = [...photoPreviews];
        form.reset();
        setPhotos([]);
        setPhotoPreviews([]);
        setCustomerSearch("");
        
        currentPreviews.forEach(url => {
            try { URL.revokeObjectURL(url); } catch (e) {}
        });

    } catch (error: any) {
        console.error("Intake Submission Error:", error);
        toast({ variant: "destructive", title: "สร้างงานไม่สำเร็จ", description: error.message || "เกิดข้อผิดพลาดในการบันทึกหรืออัปโหลดรูป" });
    } finally {
        setIsSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      photoPreviews.forEach(url => {
          try { URL.revokeObjectURL(url); } catch (e) {}
      });
    };
  }, [photoPreviews]);

  return (
    <>
      <PageHeader title="เปิดงานใหม่" description="สร้างใบงานใหม่สำหรับลูกค้าในระบบ (จำเป็นต้องกรอกข้อมูลให้ครบทุกช่องและแนบรูป)" />
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl mx-auto">
              <div className="grid grid-cols-1 gap-6">
                <FormField
                  name="customerId"
                  control={form.control}
                  render={({ field }) => {
                    const selectedCustomer = field.value
                      ? customers.find(
                          (customer) => customer.id === field.value
                        )
                      : null;
                    return (
                      <FormItem className="flex flex-col">
                        <FormLabel>ลูกค้า (Customer) <span className="text-destructive">*</span></FormLabel>
                        <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between font-normal text-left",
                                  !field.value && "text-muted-foreground"
                                )}
                                disabled={isViewer || isSubmitting || isCompressing}
                              >
                                <span className="truncate">
                                    {selectedCustomer
                                    ? `${selectedCustomer.name} (${selectedCustomer.phone})`
                                    : "ค้นหาชื่อ หรือเบอร์โทรลูกค้า..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <div className="p-2">
                              <Input
                                autoFocus
                                placeholder="พิมพ์ชื่อ หรือเบอร์โทรเพื่อค้นหา..."
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                              />
                            </div>
                            <ScrollArea className="h-fit max-h-60">
                              {filteredCustomers.length > 0 ? (
                                filteredCustomers.map((customer) => (
                                  <Button
                                    variant="ghost"
                                    key={customer.id}
                                    type="button"
                                    onClick={() => {
                                      field.onChange(customer.id);
                                      setIsCustomerPopoverOpen(false);
                                      setCustomerSearch('');
                                    }}
                                    className="w-full justify-start h-auto py-2 px-3 border-b last:border-0 rounded-none text-left"
                                  >
                                    <div className="flex flex-col items-start">
                                      <p className="font-medium">{customer.name}</p>
                                      <p className="text-xs text-muted-foreground">{customer.phone}</p>
                                    </div>
                                  </Button>
                                ))
                              ) : (
                                <div className="py-6 text-center text-sm text-muted-foreground">
                                  ไม่พบข้อมูลลูกค้าที่ค้นหา
                                </div>
                              )}
                            </ScrollArea>
                            <div className="border-t p-2">
                              <Button asChild variant="outline" className="w-full">
                                <Link href="/app/office/customers/new">
                                  <PlusCircle className="mr-2 h-4 w-4" />
                                  เพิ่มลูกค้าใหม่
                                </Link>
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              <FormField name="department" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>แผนกที่รับผิดชอบ (Department) <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isViewer || isSubmitting || isCompressing}>
                    <FormControl><SelectTrigger><SelectValue placeholder="กรุณาเลือกแผนก..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {JOB_DEPARTMENTS.map(d => (
                        <SelectItem key={d} value={d}>{deptLabel(d)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              
              {selectedDepartment === 'CAR_SERVICE' && (
                <Card className="bg-muted/30 border-dashed border-primary/20">
                    <CardHeader><CardTitle className="text-base">รายละเอียดรถยนต์ (ต้องระบุทุกช่อง)</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField name="carServiceDetails.brand" control={form.control} render={({ field }) => (
                            <FormItem>
                              <FormLabel>ยี่ห้อรถ <span className="text-destructive">*</span></FormLabel>
                              <FormControl>
                                <Input placeholder="เช่น Toyota, Isuzu" {...field} disabled={isViewer || isSubmitting || isCompressing} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField name="carServiceDetails.model" control={form.control} render={({ field }) => (
                            <FormItem>
                              <FormLabel>รุ่นรถ <span className="text-destructive">*</span></FormLabel>
                              <FormControl>
                                <Input placeholder="เช่น Revo, D-Max" {...field} disabled={isViewer || isSubmitting || isCompressing} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <FormField name="carServiceDetails.licensePlate" control={form.control} render={({ field }) => (
                          <FormItem>
                            <FormLabel>ทะเบียนรถ <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input placeholder="เช่น 1กข 1234" {...field} disabled={isViewer || isSubmitting || isCompressing} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                    </CardContent>
                </Card>
              )}

              {(selectedDepartment === 'COMMONRAIL' || selectedDepartment === 'MECHANIC') && (
                 <Card className="bg-muted/30 border-dashed border-primary/20">
                    <CardHeader><CardTitle className="text-base">รายละเอียดชิ้นส่วน (ต้องระบุทุกช่อง)</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField 
                            name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.brand" : "mechanicDetails.brand"} 
                            control={form.control} 
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>ยี่ห้อ <span className="text-destructive">*</span></FormLabel>
                                <FormControl>
                                  <Input placeholder="เช่น Denso, Bosch" {...field} disabled={isViewer || isSubmitting || isCompressing} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} 
                          />
                          <FormField 
                            name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.registrationNumber" : "mechanicDetails.registrationNumber"} 
                            control={form.control} 
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>เลขทะเบียนชิ้นส่วน <span className="text-destructive">*</span></FormLabel>
                                <FormControl>
                                  <Input placeholder="Registration Number" {...field} disabled={isViewer || isSubmitting || isCompressing} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} 
                          />
                        </div>
                        <FormField 
                          name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.partNumber" : "mechanicDetails.partNumber"} 
                          control={form.control} 
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>เลขอะไหล่ (Part Number) <span className="text-destructive">*</span></FormLabel>
                              <FormControl>
                                <Input placeholder="ระบุหมายเลขอะไหล่..." {...field} disabled={isViewer || isSubmitting || isCompressing} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} 
                        />
                    </CardContent>
                </Card>
              )}

              <FormField name="description" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>รายละเอียดงาน / อาการแจ้งซ่อม (Description) <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Textarea placeholder="ระบุรายละเอียดอาการเสีย หรือสิ่งที่ลูกค้าต้องการให้ทำ..." rows={5} {...field} disabled={isViewer || isSubmitting || isCompressing} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  รูปภาพประกอบ (ต้องมีอย่างน้อย 1 รูป) <span className="text-destructive">*</span>
                  {photos.length > 0 && <Badge variant="secondary" className="bg-green-100 text-green-700 h-5">เลือกแล้ว {photos.length} รูป</Badge>}
                </FormLabel>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <Button 
                          type="button"
                          variant="outline" 
                          className="h-24 flex-col gap-2 border-2 border-dashed border-primary/20 hover:border-primary hover:bg-primary/5" 
                          disabled={photos.length >= MAX_INTAKE_PHOTOS || isSubmitting || isCompressing}
                          onClick={() => cameraInputRef.current?.click()}
                        >
                            {isCompressing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Camera className="h-8 w-8 text-primary" />}
                            <span className="text-xs font-bold uppercase tracking-wider">{isCompressing ? "กำลังลดขนาดรูป..." : "ถ่ายรูปจากกล้อง"}</span>
                            <input 
                              type="file" 
                              ref={cameraInputRef}
                              className="hidden" 
                              accept="image/jpeg,image/png" 
                              capture="environment" 
                              onChange={handlePhotoChange} 
                            />
                        </Button>
                        
                        <Button 
                          type="button" 
                          variant="outline" 
                          className="h-24 flex-col gap-2 border-2 border-dashed border-primary/20 hover:border-primary hover:bg-primary/5" 
                          disabled={photos.length >= MAX_INTAKE_PHOTOS || isSubmitting || isCompressing}
                          onClick={() => galleryInputRef.current?.click()}
                        >
                            {isCompressing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <ImageIcon className="h-8 w-8 text-primary" />}
                            <span className="text-xs font-bold uppercase tracking-wider">{isCompressing ? "กำลังลดขนาดรูป..." : "เลือกจากอัลบั้ม"}</span>
                            <input 
                              type="file" 
                              ref={galleryInputRef}
                              className="hidden" 
                              multiple 
                              accept="image/jpeg,image/png" 
                              onChange={handlePhotoChange} 
                            />
                        </Button>
                    </div>

                    {photoPreviews.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border rounded-lg bg-muted/20">
                        {photoPreviews.map((src, index) => (
                        <div key={index} className="relative group aspect-square">
                            <Image src={src} alt={`Preview ${index + 1}`} fill className="rounded-md border object-cover" />
                            {(!isViewer && !isSubmitting && !isCompressing) && (
                            <Button type="button" variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full shadow-md z-10" onClick={() => removePhoto(index)}>
                                <X className="h-4 w-4" />
                            </Button>
                            )}
                        </div>
                        ))}
                    </div>
                    )}
                </div>
              </FormItem>

              <div className="pt-4">
                <Button type="submit" className="w-full h-12 text-lg font-semibold" disabled={isSubmitting || isViewer || isCompressing}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      กำลังบันทึกและอัปโหลด...
                    </>
                  ) : isCompressing ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      กำลังประมวลผลรูปภาพ...
                    </>
                  ) : isViewer ? "คุณไม่มีสิทธิ์สร้างใบงาน" : "สร้างใบงาน (Create Job)"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
