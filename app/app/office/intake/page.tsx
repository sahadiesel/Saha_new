"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { collection, onSnapshot, query, orderBy, doc, getDoc } from "firebase/firestore";
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
import { JOB_DEPARTMENTS, DATA_LIMITS } from "@/lib/constants";
import { Loader2, Camera, X, ChevronsUpDown, PlusCircle, ImageIcon, AlertCircle, Hash, ExternalLink } from "lucide-react";
import type { Customer } from "@/lib/types";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { deptLabel } from "@/lib/ui-labels";
import { createJob, getNextAvailableJobId } from "@/firebase/jobs";

const FILE_SIZE_THRESHOLD = 500 * 1024; // 500KB

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
        const ctx = canvas.createElement("canvas").getContext("2d");
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

const intakeSchema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  department: z.enum(JOB_DEPARTMENTS, { required_error: "กรุณาเลือกแผนก" }),
  description: z.string().min(1, "กรุณากรอกรายละเอียดงาน").max(DATA_LIMITS.MAX_STRING_LONG, `รายละเอียดต้องไม่เกิน ${DATA_LIMITS.MAX_STRING_LONG} ตัวอักษร`),
  carServiceDetails: z.object({
    brand: z.string().optional().default(""),
    model: z.string().optional().default(""),
    licensePlate: z.string().optional().default(""),
  }).optional(),
  commonrailDetails: z.object({
    brand: z.string().optional().default(""),
    partNumber: z.string().optional().default(""),
    registrationNumber: z.string().optional().default(""),
  }).optional(),
  mechanicDetails: z.object({
    brand: z.string().optional().default(""),
    partNumber: z.string().optional().default(""),
    registrationNumber: z.string().optional().default(""),
  }).optional(),
}).superRefine((data, ctx) => {
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
  
  const [previewJobId, setPreviewJobId] = useState<string>("");
  const [indexErrorUrl, setIndexErrorUrl] = useState<string | null>(null);

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
    if (!customerSearch) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.phone.includes(customerSearch)
    );
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
    });
    return () => unsub();
  }, [db]);

  // Fetch sequential ID preview
  useEffect(() => {
    if (!db) return;
    const fetchPreview = async () => {
      try {
        const result = await getNextAvailableJobId(db);
        setPreviewJobId(result.jobId);
        if (result.indexErrorUrl) setIndexErrorUrl(result.indexErrorUrl);
      } catch (e) {}
    };
    fetchPreview();
  }, [db, isSubmitting]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (photos.length + newFiles.length > DATA_LIMITS.MAX_INTAKE_PHOTOS) {
        toast({ variant: "destructive", title: `คุณสามารถอัปโหลดรูปภาพได้สูงสุด ${DATA_LIMITS.MAX_INTAKE_PHOTOS} รูปเท่านั้น` });
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
    if (!selectedCustomer) return;
    
    setIsSubmitting(true);
    
    try {
        const photoURLs: string[] = [];
        for (const photo of photos) {
            const tempName = `${Date.now()}-${photo.name || 'blob'}`;
            const photoRef = ref(storage, `jobs/temp/${tempName}`);
            await uploadBytes(photoRef, photo);
            const url = await getDownloadURL(photoRef);
            photoURLs.push(url);
        }

        const marketingSource = selectedCustomer.acquisitionSource || 'EXISTING';
        const isActuallyNew = marketingSource !== 'EXISTING' && marketingSource !== 'NONE';

        const jobData: any = {
            customerId: values.customerId,
            department: values.department,
            mainDepartment: values.department, 
            description: values.description,
            customerSnapshot: { ...selectedCustomer },
            customerType: isActuallyNew ? 'NEW' : 'EXISTING',
            customerAcquisitionSource: marketingSource,
            photos: photoURLs,
        };

        if (values.department === 'CAR_SERVICE') jobData.carServiceDetails = values.carServiceDetails;
        if (values.department === 'COMMONRAIL') jobData.commonrailDetails = values.commonrailDetails;
        if (values.department === 'MECHANIC') jobData.mechanicDetails = values.mechanicDetails;

        const { jobId } = await createJob(db, jobData, profile);
        
        toast({ title: "สร้างใบงานสำเร็จ", description: `เลขที่ใบงาน: ${jobId}` });
        
        form.reset();
        setPhotos([]);
        setPhotoPreviews([]);
        setCustomerSearch("");
        router.push(`/app/jobs/${jobId}`);

    } catch (error: any) {
        console.error("Intake Error:", error);
        toast({ variant: "destructive", title: "สร้างงานไม่สำเร็จ", description: error.message });
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="เปิดงานใหม่" description={`สร้างใบงานใหม่ (แนบรูปประกอบได้สูงสุด ${DATA_LIMITS.MAX_INTAKE_PHOTOS} รูป)`} />
      
      {indexErrorUrl && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ต้องการดัชนี (Index)</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 mt-2">
            <span>ระบบต้องการดัชนีเพื่อรันเลขที่ใบงานอัตโนมัติ กรุณากดปุ่มเพื่อสร้าง Index</span>
            <Button asChild variant="outline" size="sm" className="w-fit bg-white text-destructive">
              <a href={indexErrorUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4"/>สร้าง Index</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl mx-auto">
              
              <div className="flex justify-between items-center p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-2">
                  <Hash className="h-5 w-5 text-primary" />
                  <span className="font-bold">เลขที่ใบงานถัดไป (Next Job ID):</span>
                </div>
                <Badge variant="outline" className="font-mono text-lg py-1 px-3 border-primary/30 text-primary bg-white shadow-sm">
                  {previewJobId || "กำลังโหลด..."}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <FormField
                  name="customerId"
                  control={form.control}
                  render={({ field }) => {
                    const selectedCustomer = field.value ? customers.find(c => c.id === field.value) : null;
                    return (
                      <FormItem className="flex flex-col">
                        <FormLabel>ลูกค้า (Customer) <span className="text-destructive">*</span></FormLabel>
                        <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn("w-full justify-between font-normal text-left", !field.value && "text-muted-foreground")}
                                disabled={isViewer || isSubmitting}
                              >
                                <span className="truncate">{selectedCustomer ? `${selectedCustomer.name} (${selectedCustomer.phone})` : "ค้นหาชื่อ หรือเบอร์โทรลูกค้า..."}</span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <div className="p-2">
                              <Input placeholder="พิมพ์ชื่อ หรือเบอร์โทร..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
                            </div>
                            <ScrollArea className="h-fit max-h-60">
                              {filteredCustomers.length > 0 ? (
                                filteredCustomers.map((customer) => (
                                  <Button
                                    variant="ghost"
                                    key={customer.id}
                                    type="button"
                                    onClick={() => { field.onChange(customer.id); setIsCustomerPopoverOpen(false); setCustomerSearch(''); }}
                                    className="w-full justify-start h-auto py-2 px-3 border-b last:border-0 rounded-none text-left"
                                  >
                                    <div className="flex flex-col items-start"><p className="font-medium">{customer.name}</p><p className="text-xs text-muted-foreground">{customer.phone}</p></div>
                                  </Button>
                                ))
                              ) : <div className="py-6 text-center text-sm text-muted-foreground">ไม่พบข้อมูลลูกค้า</div>}
                            </ScrollArea>
                            <div className="border-t p-2"><Button asChild variant="outline" className="w-full"><Link href="/app/office/customers/new"><PlusCircle className="mr-2 h-4 w-4" />เพิ่มลูกค้าใหม่</Link></Button></div>
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
                  <Select onValueChange={field.onChange} value={field.value} disabled={isViewer || isSubmitting}>
                    <FormControl><SelectTrigger><SelectValue placeholder="กรุณาเลือกแผนก..." /></SelectTrigger></FormControl>
                    <SelectContent>{JOB_DEPARTMENTS.map(d => (<SelectItem key={d} value={d}>{deptLabel(d)}</SelectItem>))}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              
              {selectedDepartment === 'CAR_SERVICE' && (
                <Card className="bg-muted/30 border-dashed border-primary/20">
                    <CardHeader><CardTitle className="text-base">รายละเอียดรถยนต์</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField name="carServiceDetails.brand" control={form.control} render={({ field }) => (<FormItem><FormLabel>ยี่ห้อรถ <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="เช่น Toyota" {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField name="carServiceDetails.model" control={form.control} render={({ field }) => (<FormItem><FormLabel>รุ่นรถ <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="เช่น Revo" {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <FormField name="carServiceDetails.licensePlate" control={form.control} render={({ field }) => (<FormItem><FormLabel>ทะเบียนรถ <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="เช่น 1กข 1234" {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                    </CardContent>
                </Card>
              )}

              {(selectedDepartment === 'COMMONRAIL' || selectedDepartment === 'MECHANIC') && (
                 <Card className="bg-muted/30 border-dashed border-primary/20">
                    <CardHeader><CardTitle className="text-base">รายละเอียดชิ้นส่วน</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.brand" : "mechanicDetails.brand"} control={form.control} render={({ field }) => (<FormItem><FormLabel>ยี่ห้อ <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="เช่น Denso" {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.registrationNumber" : "mechanicDetails.registrationNumber"} control={form.control} render={({ field }) => (<FormItem><FormLabel>เลขทะเบียนชิ้นส่วน <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <FormField name={selectedDepartment === 'COMMONRAIL' ? "commonrailDetails.partNumber" : "mechanicDetails.partNumber"} control={form.control} render={({ field }) => (<FormItem><FormLabel>เลขอะไหล่ <span className="text-destructive">*</span></FormLabel><FormControl><Input {...field} disabled={isSubmitting} /></FormControl><FormMessage /></FormItem>)} />
                    </CardContent>
                </Card>
              )}

              <FormField name="description" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>รายละเอียดงาน / อาการแจ้งซ่อม <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Textarea placeholder="ระบุรายละเอียดอาการเสีย..." rows={5} {...field} disabled={isSubmitting} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormItem>
                <FormLabel>รูปภาพประกอบ (สูงสุด {DATA_LIMITS.MAX_INTAKE_PHOTOS} รูป) <span className="text-destructive">*</span></FormLabel>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <Button type="button" variant="outline" className="h-24 flex-col gap-2 border-2 border-dashed border-primary/20 hover:border-primary hover:bg-primary/5" disabled={photos.length >= DATA_LIMITS.MAX_INTAKE_PHOTOS || isSubmitting || isCompressing} onClick={() => cameraInputRef.current?.click()}>
                            {isCompressing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Camera className="h-8 w-8 text-primary" />}
                            <span className="text-xs font-bold uppercase tracking-wider">{isCompressing ? "กำลังลดขนาด..." : "ถ่ายรูป"}</span>
                            <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handlePhotoChange} />
                        </Button>
                        <Button type="button" variant="outline" className="h-24 flex-col gap-2 border-2 border-dashed border-primary/20 hover:border-primary hover:bg-primary/5" disabled={photos.length >= DATA_LIMITS.MAX_INTAKE_PHOTOS || isSubmitting || isCompressing} onClick={() => galleryInputRef.current?.click()}>
                            <ImageIcon className="h-8 w-8 text-primary" />
                            <span className="text-xs font-bold uppercase tracking-wider">อัลบั้ม</span>
                            <input type="file" ref={galleryInputRef} className="hidden" multiple accept="image/*" onChange={handlePhotoChange} />
                        </Button>
                    </div>

                    {photoPreviews.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border rounded-lg bg-muted/20">
                        {photoPreviews.map((src, index) => (
                        <div key={index} className="relative group aspect-square">
                            <Image src={src} alt={`Preview ${index + 1}`} fill className="rounded-md border object-cover" />
                            <Button type="button" variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full shadow-md z-10" onClick={() => removePhoto(index)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        ))}
                    </div>
                    )}
                </div>
              </FormItem>

              <div className="pt-4">
                <Button type="submit" className="w-full h-12 text-lg font-semibold" disabled={isSubmitting || isViewer || isCompressing}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />กำลังสร้างใบงาน...</> : "สร้างใบงาน (Create Job)"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
