"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { collection, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc, serverTimestamp, deleteField } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, MoreHorizontal, PlusCircle, Search, Edit, Eye, Trash2, ChevronsUpDown, Filter } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Customer, CustomerTaxProfile } from "@/lib/types";
import {
  normalizeCustomerPhones,
  normalizeCustomerTaxProfiles,
  dedupePhoneList,
  findCustomerPhoneConflict,
} from "@/lib/customer-utils";
import { ACQUISITION_SOURCES } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

const taxProfileRowSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  taxName: z.string(),
  taxAddress: z.string(),
  taxId: z.string(),
  taxPhone: z.string().optional(),
  taxBranchType: z.enum(["HEAD_OFFICE", "BRANCH"]),
  taxBranchNo: z.string().optional(),
});

const customerSchema = z
  .object({
    name: z.string().min(1, "กรุณากรอกชื่อลูกค้า"),
    phones: z.array(z.string()),
    detail: z.string().optional().default(""),
    useTax: z.boolean().default(false),
    taxProfiles: z.array(taxProfileRowSchema),
    /** ลูกค้าเก่าอาจไม่มีฟิลด์นี้ — default ตอน parse เพื่อไม่บล็อกการแก้ภาษี/ข้อมูลอื่น */
    acquisitionSource: z
      .enum(ACQUISITION_SOURCES, {
        errorMap: () => ({
          message: "กรุณาเลือกช่องทางที่ลูกค้ารู้จักร้าน เพื่อใช้ทำสถิติในแดชบอร์ด",
        }),
      })
      .default("OTHER"),
  })
  .superRefine((data, ctx) => {
    const trimmed = data.phones.map((p) => p.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "กรุณากรอกอย่างน้อย 1 เบอร์โทรศัพท์",
        path: ["phones", 0],
      });
    }
    const keys = trimmed.map((p) => p.replace(/\D/g, ""));
    if (keys.length > 0 && new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "มีเบอร์โทรซ้ำในฟอร์ม",
        path: ["phones", 0],
      });
    }
    if (!data.useTax) return;
    if (data.taxProfiles.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "กรุณาเพิ่มอย่างน้อย 1 ชุดชื่อ/ที่อยู่สำหรับใบกำกับภาษี",
        path: ["taxProfiles"],
      });
      return;
    }
    data.taxProfiles.forEach((p, i) => {
      if (!p.taxName?.trim() || !p.taxAddress?.trim() || !p.taxId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณากรอกชื่อ ที่อยู่ และเลขผู้เสียภาษีให้ครบทุกชุด",
          path: ["taxProfiles", i, "taxName"],
        });
      }
      if (p.taxBranchType === "BRANCH" && (!p.taxBranchNo || p.taxBranchNo.length !== 5)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณาระบุรหัสสาขา 5 หลัก",
          path: ["taxProfiles", i, "taxBranchNo"],
        });
      }
    });
  });

function emptyTaxProfileRow(): CustomerTaxProfile {
  return {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : `tp_${Date.now()}`,
    label: "",
    taxName: "",
    taxAddress: "",
    taxId: "",
    taxPhone: "",
    taxBranchType: "HEAD_OFFICE",
    taxBranchNo: "00000",
  };
}

function CustomersContent() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(searchParams.get("phone") || "");
  const [taxFilter, setTaxFilter] = useState<string>("ALL");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 20;

  /** สอดคล้องกับ canEditJobs() ใน firestore.rules — รวม OFFICER (พนักงานออฟฟิศที่อาจไม่มี department ในโปรไฟล์) */
  const canEdit =
    !!profile &&
    profile.role !== "VIEWER" &&
    (profile.role === "ADMIN" ||
      profile.role === "MANAGER" ||
      profile.role === "OFFICER" ||
      profile.department === "MANAGEMENT" ||
      profile.department === "OFFICE" ||
      profile.department === "PURCHASING" ||
      profile.department === "ACCOUNTING_HR" ||
      profile.department === "CAR_SERVICE" ||
      profile.department === "COMMONRAIL" ||
      profile.department === "MECHANIC" ||
      profile.department === "OUTSOURCE");
  const isAdmin = profile?.role === 'ADMIN';

  const form = useForm<z.infer<typeof customerSchema>>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      phones: [""],
      detail: "",
      useTax: false,
      taxProfiles: [],
      acquisitionSource: "OTHER",
    },
  });

  const { fields: phoneFields, append: appendPhone, remove: removePhone } = useFieldArray({
    control: form.control,
    name: "phones",
  });

  const {
    fields: taxProfileFields,
    append: appendTaxProfile,
    remove: removeTaxProfile,
  } = useFieldArray({
    control: form.control,
    name: "taxProfiles",
  });

  const useTax = form.watch("useTax");

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customersData);
      setLoading(false);
      
      const editCustomerId = searchParams.get("editCustomerId");
      const editPhone = searchParams.get("editPhone");
      if (customersData.length > 0) {
        let target: Customer | undefined;
        if (editCustomerId) {
          target = customersData.find((c) => c.id === editCustomerId);
        }
        if (!target && editPhone) {
          const q = editPhone.trim();
          target = customersData.find(
            (c) =>
              normalizeCustomerPhones(c).some(
                (p) => p === q || p.replace(/\D/g, "") === q.replace(/\D/g, "")
              )
          );
        }
        if (target) {
          setEditingCustomer(target);
          setIsDialogOpen(true);
        }
      }
    },
    async (error: any) => {
      if (error.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: 'customers',
          operation: 'list',
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
      } else {
        toast({ variant: "destructive", title: "ไม่สามารถโหลดข้อมูลลูกค้าได้" });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, toast, searchParams]);
  
  const filteredCustomers = useMemo(() => {
    let result = [...customers];

    if (taxFilter === "USED") {
      result = result.filter(c => c.useTax === true);
    } else if (taxFilter === "NOT_USED") {
      result = result.filter(c => c.useTax === false);
    }

    if (searchTerm.trim()) {
      const lowercasedFilter = searchTerm.toLowerCase();
      const qDigits = searchTerm.replace(/\D/g, "");
      result = result.filter((customer) => {
        const phones = normalizeCustomerPhones(customer);
        const taxLabels = normalizeCustomerTaxProfiles(customer)
          .map((p) => `${p.label || ""} ${p.taxName} ${p.taxId}`)
          .join(" ")
          .toLowerCase();
        return (
          customer.name.toLowerCase().includes(lowercasedFilter) ||
          phones.some((p) => p.includes(searchTerm.trim()) || (qDigits && p.replace(/\D/g, "").includes(qDigits))) ||
          (customer.taxName || "").toLowerCase().includes(lowercasedFilter) ||
          taxLabels.includes(lowercasedFilter) ||
          (customer.detail || "").toLowerCase().includes(lowercasedFilter)
        );
      });
    }
    return result;
  }, [customers, searchTerm, taxFilter]);

  const paginatedCustomers = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filteredCustomers.slice(start, end);
  }, [filteredCustomers, currentPage]);

  const totalPages = Math.ceil(filteredCustomers.length / PAGE_SIZE);

  useEffect(() => {
    if (isDialogOpen) {
      if (editingCustomer) {
        const phones = normalizeCustomerPhones(editingCustomer);
        const rawProfiles = normalizeCustomerTaxProfiles(editingCustomer);
        const taxProfilesForForm: CustomerTaxProfile[] =
          rawProfiles.length > 0
            ? rawProfiles.map((p) => ({
                ...p,
                id: p.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `tp_${Date.now()}`),
                label: p.label || "",
                taxPhone: p.taxPhone || "",
                taxBranchType: p.taxBranchType || "HEAD_OFFICE",
                taxBranchNo: p.taxBranchNo || "00000",
              }))
            : [];
        form.reset({
          name: editingCustomer.name || "",
          phones: phones.length > 0 ? phones : [""],
          detail: editingCustomer.detail || "",
          useTax: editingCustomer.useTax || false,
          taxProfiles: taxProfilesForForm,
          acquisitionSource: editingCustomer.acquisitionSource ?? "OTHER",
        });
      }
    } else {
      setEditingCustomer(null);
      form.reset({
        name: "",
        phones: [""],
        detail: "",
        useTax: false,
        taxProfiles: [],
        acquisitionSource: "OTHER",
      });
    }
  }, [isDialogOpen, editingCustomer, form]);

  const openEditDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    setIsDialogOpen(true);
  };

  const onSubmit = async (values: z.infer<typeof customerSchema>) => {
    if (!db || !editingCustomer) return;
    setIsSubmitting(true);

    try {
      const dedupedPhones = dedupePhoneList(values.phones.map((p) => p.trim()).filter(Boolean));
      if (dedupedPhones.length === 0) {
        toast({ variant: "destructive", title: "กรุณากรอกอย่างน้อย 1 เบอร์โทรศัพท์" });
        setIsSubmitting(false);
        return;
      }

      const conflict = findCustomerPhoneConflict(customers, dedupedPhones, editingCustomer.id);
      if (conflict) {
        toast({
          variant: "destructive",
          title: "เบอร์โทรศัพท์ซ้ำกับลูกค้าท่านอื่น",
          description: `เบอร์ ${conflict.phone} ถูกใช้โดย: ${conflict.customer.name}`,
        });
        setIsSubmitting(false);
        return;
      }

      const primary = dedupedPhones[0];
      const profiles: CustomerTaxProfile[] = values.useTax
        ? values.taxProfiles.map((p) => ({
            id: p.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `tp_${Date.now()}`),
            label: (p.label || "").trim(),
            taxName: p.taxName.trim(),
            taxAddress: p.taxAddress.trim(),
            taxId: p.taxId.trim(),
            taxPhone: (p.taxPhone || "").trim() || undefined,
            taxBranchType: p.taxBranchType,
            taxBranchNo:
              p.taxBranchType === "BRANCH" ? (p.taxBranchNo || "").trim() : "00000",
          }))
        : [];

      const first = profiles[0];

      const customerDoc = doc(db, "customers", editingCustomer.id);
      const updateData: Record<string, unknown> = {
        name: values.name.trim(),
        phone: primary,
        phones: dedupedPhones,
        detail: values.detail || "",
        useTax: values.useTax,
        acquisitionSource: values.acquisitionSource,
        updatedAt: serverTimestamp(),
      };

      if (values.useTax && first) {
        updateData.taxProfiles = profiles;
        updateData.taxName = first.taxName;
        updateData.taxAddress = first.taxAddress;
        updateData.taxId = first.taxId;
        updateData.taxPhone = first.taxPhone || primary;
        updateData.taxBranchType = first.taxBranchType;
        updateData.taxBranchNo =
          first.taxBranchType === "BRANCH" ? first.taxBranchNo : "00000";
      } else {
        updateData.taxProfiles = deleteField();
        updateData.taxName = "";
        updateData.taxAddress = "";
        updateData.taxId = "";
        updateData.taxPhone = "";
        updateData.taxBranchType = null;
        updateData.taxBranchNo = null;
      }

      await updateDoc(customerDoc, updateData);
      toast({ title: "อัปเดตข้อมูลลูกค้าสำเร็จ" });
      setIsDialogOpen(false);
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `customers/${editingCustomer.id}`,
          operation: 'update',
          requestResourceData: values,
        }));
      } else {
        toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: error.message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = (customerId: string) => {
    setCustomerToDelete(customerId);
    setIsDeleteAlertOpen(true);
  };

  const confirmDelete = async () => {
    if (!db || !customerToDelete) return;
    
    const customerDoc = doc(db, "customers", customerToDelete);
    deleteDoc(customerDoc)
      .then(() => {
        toast({title: "ลบข้อมูลลูกค้าเรียบร้อยแล้ว"});
      })
      .catch(async (error: any) => {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: customerDoc.path,
            operation: 'delete',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        } else {
          toast({variant: "destructive", title: "ไม่สามารถลบได้", description: error.message});
        }
      })
      .finally(() => {
        setIsDeleteAlertOpen(false);
        setCustomerToDelete(null);
      });
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="รายชื่อลูกค้า" description="จัดการข้อมูลลูกค้าและรายละเอียดการออกบิล">
        <Button asChild>
          <Link href="/app/office/customers/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            เพิ่มลูกค้า
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาชื่อ/เบอร์โทร/ชื่อภาษี..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex flex-col gap-1.5 min-w-[200px]">
              <Select value={taxFilter} onValueChange={setTaxFilter}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="สถานะภาษี" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">ลูกค้าทั้งหมด</SelectItem>
                  <SelectItem value="USED">ใช้ใบกำกับภาษี</SelectItem>
                  <SelectItem value="NOT_USED">ไม่ใช้ใบกำกับภาษี</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อลูกค้า</TableHead>
                  <TableHead>เบอร์โทรศัพท์</TableHead>
                  <TableHead>ใช้ใบกำกับภาษี</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedCustomers.length > 0 ? (
                  paginatedCustomers.map(customer => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="text-sm max-w-[220px]">
                        {normalizeCustomerPhones(customer).join(", ")}
                      </TableCell>
                      <TableCell>
                        {customer.useTax ? <Badge>ใช่</Badge> : <Badge variant="outline">ไม่</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
                        {customer.detail || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(customer)}>
                              <Eye className="mr-2 h-4 w-4" /> ดู/แก้ไข
                            </DropdownMenuItem>
                            {isAdmin && (
                              <DropdownMenuItem onClick={() => handleDeleteRequest(customer.id)} className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" /> ลบ
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      ไม่พบข้อมูลลูกค้า
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {totalPages > 1 && (
          <CardFooter className="justify-between">
            <p className="text-xs text-muted-foreground">หน้า {currentPage + 1} จาก {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 0}>ก่อนหน้า</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages - 1}>ถัดไป</Button>
            </div>
          </CardFooter>
        )}
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !isSubmitting && setIsDialogOpen(open)}>
        <DialogContent className="sm:max-w-[720px] max-h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>ข้อมูลลูกค้า</DialogTitle>
            <DialogDescription>ดูและแก้ไขรายละเอียดข้อมูลลูกค้า</DialogDescription>
          </DialogHeader>
          
          <div className="overflow-y-auto px-6">
            <Form {...form}>
                <form id="edit-customer-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField name="name" control={form.control} render={({ field }) => (
                    <FormItem><FormLabel>ชื่อลูกค้า</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="space-y-2">
                  <FormLabel>เบอร์โทรศัพท์ (เพิ่มได้หลายเบอร์)</FormLabel>
                  <p className="text-xs text-muted-foreground">ห้ามซ้ำกับลูกค้าคนอื่นในระบบ และห้ามซ้ำกันในฟอร์ม</p>
                  {phoneFields.map((pf, idx) => (
                    <FormField
                      key={pf.id}
                      control={form.control}
                      name={`phones.${idx}` as const}
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input {...field} placeholder={`เบอร์ ${idx + 1}`} />
                            </FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={phoneFields.length <= 1}
                              onClick={() => removePhone(idx)}
                              aria-label="ลบเบอร์"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {idx === 0 ? <FormMessage /> : null}
                        </FormItem>
                      )}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed"
                    onClick={() => appendPhone("")}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มเบอร์โทรศัพท์
                  </Button>
                </div>
                
                <Card className="bg-primary/5 border-primary/20 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold text-primary">การตลาด (Marketing)</CardTitle>
                      <CardDescription className="text-xs">ข้อมูลนี้ใช้ทำสถิติในหน้าแดชบอร์ด</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-2">
                        <FormField
                            control={form.control}
                            name="acquisitionSource"
                            render={({ field }) => (
                                <FormItem className="space-y-3">
                                <FormLabel className="flex items-center gap-1 font-bold">ลูกค้ารู้จักร้านจากช่องทางไหน? <span className="text-destructive">*</span></FormLabel>
                                <FormControl>
                                    <RadioGroup
                                    onValueChange={field.onChange}
                                    value={field.value}
                                    className="grid grid-cols-2 sm:grid-cols-3 gap-4"
                                    >
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="REFERRAL" id="r-referral" />
                                        <Label htmlFor="r-referral" className="font-normal cursor-pointer">ลูกค้าแนะนำ</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="GOOGLE" id="r-google" />
                                        <Label htmlFor="r-google" className="font-normal cursor-pointer">Google</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="FACEBOOK" id="r-facebook" />
                                        <Label htmlFor="r-facebook" className="font-normal cursor-pointer">Facebook</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="TIKTOK" id="r-tiktok" />
                                        <Label htmlFor="r-tiktok" className="font-normal cursor-pointer">Tiktok</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="YOUTUBE" id="r-youtube" />
                                        <Label htmlFor="r-youtube" className="font-normal cursor-pointer">Youtube</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="OTHER" id="r-other" />
                                        <Label htmlFor="r-other" className="font-normal cursor-pointer">อื่นๆ</Label>
                                    </div>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                <FormField name="detail" control={form.control} render={({ field }) => (
                    <FormItem><FormLabel>รายละเอียดเพิ่มเติม</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                
                <FormField name="useTax" control={form.control} render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/20">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={(v) => {
                      field.onChange(v);
                      if (v && form.getValues("taxProfiles").length === 0) {
                        appendTaxProfile(emptyTaxProfileRow());
                      }
                    }} /></FormControl>
                    <div className="space-y-1 leading-none">
                        <FormLabel className="cursor-pointer font-bold text-primary">ต้องการใบกำกับภาษี (Use Tax Invoice)</FormLabel>
                        <FormMessage />
                    </div>
                    </FormItem>
                )} />

                {useTax && (
                    <div className="space-y-4 p-4 border rounded-md bg-muted/50 border-primary/20 mb-4">
                        <div className="flex flex-col gap-1 border-b pb-2">
                          <h4 className="text-sm font-bold text-primary uppercase tracking-wider">ชื่อ / ที่อยู่สำหรับออกใบกำกับภาษี</h4>
                          <p className="text-xs text-muted-foreground">เพิ่มได้หลายชุด (หลายบริษัทหรือหลายสาขา) — ตอนออกใบกำกับระบบจะให้เลือกนามที่ใช้</p>
                        </div>
                        {taxProfileFields.map((tp, profileIdx) => {
                          const branchType = form.watch(`taxProfiles.${profileIdx}.taxBranchType`);
                          return (
                          <div key={tp.id} className="rounded-lg border bg-background p-4 space-y-3 relative">
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-xs font-semibold text-muted-foreground">ชุดที่ {profileIdx + 1}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive h-8"
                                disabled={taxProfileFields.length <= 1}
                                onClick={() => removeTaxProfile(profileIdx)}
                              >
                                <Trash2 className="h-4 w-4 mr-1" /> ลบชุดนี้
                              </Button>
                            </div>
                            <FormField control={form.control} name={`taxProfiles.${profileIdx}.label`} render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">ป้ายเรียก (ไม่บังคับ)</FormLabel>
                                <FormControl><Input {...field} value={field.value ?? ""} placeholder="เช่น สำนักงานใหญ่, สาขาชลบุรี" /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={form.control} name={`taxProfiles.${profileIdx}.taxName`} render={({ field }) => (
                              <FormItem><FormLabel>ชื่อในใบกำกับภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name={`taxProfiles.${profileIdx}.taxAddress`} render={({ field }) => (
                              <FormItem><FormLabel>ที่อยู่ในใบกำกับภาษี</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <div className="grid grid-cols-2 gap-4">
                              <FormField control={form.control} name={`taxProfiles.${profileIdx}.taxId`} render={({ field }) => (
                                <FormItem><FormLabel>เลขประจำตัวผู้เสียภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                              )} />
                              <FormField control={form.control} name={`taxProfiles.${profileIdx}.taxPhone`} render={({ field }) => (
                                <FormItem><FormLabel>เบอร์โทรศัพท์ (บิล)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                              )} />
                            </div>
                            <FormField
                              control={form.control}
                              name={`taxProfiles.${profileIdx}.taxBranchType`}
                              render={({ field }) => (
                                <FormItem className="space-y-3">
                                  <FormLabel>สถานะสถานประกอบการ</FormLabel>
                                  <FormControl>
                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1">
                                      <div className="flex items-center space-x-3">
                                        <RadioGroupItem value="HEAD_OFFICE" id={`ho-${tp.id}`} />
                                        <Label htmlFor={`ho-${tp.id}`} className="font-normal cursor-pointer">สำนักงานใหญ่</Label>
                                      </div>
                                      <div className="flex items-center space-x-3">
                                        <RadioGroupItem value="BRANCH" id={`br-${tp.id}`} />
                                        <Label htmlFor={`br-${tp.id}`} className="font-normal cursor-pointer">สาขา</Label>
                                      </div>
                                    </RadioGroup>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            {branchType === "BRANCH" && (
                              <FormField control={form.control} name={`taxProfiles.${profileIdx}.taxBranchNo`} render={({ field }) => (
                                <FormItem>
                                  <FormLabel>รหัสสาขา (5 หลัก)</FormLabel>
                                  <FormControl><Input {...field} value={field.value ?? ""} placeholder="เช่น 00001" maxLength={5} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            )}
                          </div>
                        );
                        })}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full border-dashed"
                          onClick={() => appendTaxProfile(emptyTaxProfileRow())}
                        >
                          <PlusCircle className="mr-2 h-4 w-4" /> เพิ่มชุดชื่อ/ที่อยู่สำหรับใบกำกับ
                        </Button>
                    </div>
                )}
                </form>
            </Form>
          </div>

          <DialogFooter className="p-6 border-t">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
            <Button type="submit" form="edit-customer-form" disabled={isSubmitting || !canEdit}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึกการเปลี่ยนแปลง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>ยืนยันการลบข้อมูล?</AlertDialogTitle>
                <AlertDialogDescription>การกระทำนี้ไม่สามารถย้อนกลับได้</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete} className="bg-destructive">ลบข้อมูล</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ManagementCustomersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <CustomersContent />
    </Suspense>
  );
}
