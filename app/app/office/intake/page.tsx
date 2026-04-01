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
import { Loader2, Camera, X, ChevronsUpDown, PlusCircle, ImageIcon, AlertCircle, Hash, ExternalLink, ScanBarcode, Building2, User, Search } from "lucide-react";
import type { Customer } from "@/lib/types";
import { cn, sanitizeForFirestore } from "@/lib/utils";
import { compressImageIfNeeded } from "@/lib/image-compress";
import { deptLabel } from "@/lib/ui-labels";
import { createJob } from "@/firebase/jobs";

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
    const q = customerSearch.toLowerCase().trim();
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(q) ||
        (customer.taxName || "").toLowerCase().includes(q) ||
        customer.phone.includes(q)
    );
  }, [customers, customerSearch]);

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
    });
    return () => unsub();
  }, [db]);

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
    <div className="space-y-6">
      <PageHeader title="เปิดงานใหม่" description={`สร้างใบงานใหม่ (แนบรูปประกอบได้สูงสุด ${DATA_LIMITS.MAX_INTAKE_PHOTOS} รูป)`} />
      
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl mx-auto">
              
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
                                className={cn("w-full justify-between font-normal text-left h-12", !field.value && "text-muted-foreground")}
                                disabled={isViewer || isSubmitting}
                              >
                                <span className="truncate">
                                  {selectedCustomer ? (
                                    <div className="flex flex-col overflow-hidden">
                                      <span className="font-bold text-sm truncate">{selectedCustomer.name}</span>
                                      {selectedCustomer.taxName && <span className="text-[10px] text-primary truncate flex items-center gap-1"><Building2 className="h-2.5 w-2.5" /> {selectedCustomer.taxName}</span>}
                                    </div>
                                  ) : "ค้นหาชื่อ หรือเบอร์โทรลูกค้า..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0 shadow-2xl">
                            <div className="p-3 border-b bg-muted/20">
                              <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input 
                                  placeholder="พิมพ์ชื่อติดต่อ, ชื่อบริษัท หรือเบอร์โทร..." 
                                  className="pl-9 h-10"
                                  value={customerSearch} 
                                  onChange={(e) => setCustomerSearch(e.target.value)} 
                                  autoFocus
                                />
                              </div>
                            </div>
                            <ScrollArea className="h-fit max-h-80">
                              {filteredCustomers.length > 0 ? (
                                <div className="p-1">
                                  {filteredCustomers.map((customer) => (
                                    <Button
                                      variant="ghost"
                                      key={customer.id}
                                      type="button"
                                      onClick={() => { field.onChange(customer.id); setIsCustomerPopoverOpen(false); setCustomerSearch(''); }}
                                      className="w-full justify-start h-auto py-3 px-4 border-b last:border-0 rounded-none text-left hover:bg-primary/5 group"
                                    >
                                      <div className="flex flex-col items-start w-full">
                                        <div className="flex items-center justify-between w-full">
                                          <p className="font-bold text-sm group-hover:text-primary transition-colors">{customer.name}</p>
                                          <Badge variant="outline" className="text-[9px] h-4 font-normal">{customer.phone}</Badge>
                                        </div>
                                        {customer.taxName && (
                                          <p className="text-[10px] text-primary font-medium mt-1 flex items-center gap-1.5 bg-primary/5 px-1.5 py-0.5 rounded">
                                            <Building2 className="h-3 w-3" /> {customer.taxName}
                                          </p>
                                        )}
                                      </div>
                                    </Button>
                                  ))}
                                </div>
                              ) : (
                                <div className="py-10 text-center flex flex-col items-center gap-2 text-muted-foreground">
                                  <User className="h-8 w-8 opacity-10" />
                                  <p className="text-sm">ไม่พบข้อมูลลูกค้า</p>
                                </div>
                              )}
                            </ScrollArea>
                            <div className="border-t p-2 bg-muted/10">
                              <Button asChild variant="ghost" className="w-full justify-center text-primary font-bold hover:bg-primary/10">
                                <Link href="/app/office/customers/new">
                                  <PlusCircle className="mr-2 h-4 w-4" />เพิ่มลูกค้าใหม่
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
    </div>
  );
}
