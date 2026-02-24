"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { collection, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc, serverTimestamp, where } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
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
import type { Customer } from "@/lib/types";
import { ACQUISITION_SOURCES } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

const customerSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อลูกค้า"),
  phone: z.string().min(1, "กรุณากรอกเบอร์โทรศัพท์"),
  detail: z.string().optional().default(""),
  useTax: z.boolean().default(false),
  taxName: z.string().optional(),
  taxAddress: z.string().optional(),
  taxId: z.string().optional(),
  taxPhone: z.string().optional(),
  taxBranchType: z.enum(['HEAD_OFFICE', 'BRANCH']).optional(),
  taxBranchNo: z.string().optional(),
  acquisitionSource: z.enum(ACQUISITION_SOURCES).optional().nullable(),
}).refine(data => !data.useTax || (data.taxName && data.taxAddress && data.taxId), {
  message: "กรุณากรอกข้อมูลภาษีให้ครบถ้วนเมื่อเลือก 'ต้องการใบกำกับภาษี'",
  path: ["taxName"], 
}).refine(data => !data.useTax || data.taxBranchType !== 'BRANCH' || (data.taxBranchNo && data.taxBranchNo.length === 5), {
  message: "กรุณาระบุรหัสสาขา 5 หลัก",
  path: ["taxBranchNo"],
});

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

  const canEdit = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT' || profile?.department === 'OFFICE';
  const isAdmin = profile?.role === 'ADMIN';

  const form = useForm<z.infer<typeof customerSchema>>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      phone: "",
      detail: "",
      useTax: false,
      taxName: "",
      taxAddress: "",
      taxId: "",
      taxPhone: "",
      taxBranchType: 'HEAD_OFFICE',
      taxBranchNo: '00000',
    },
  });
  
  const useTax = form.watch("useTax");
  const taxBranchType = form.watch("taxBranchType");

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customersData);
      setLoading(false);
      
      const editPhone = searchParams.get("editPhone");
      if (editPhone && customersData.length > 0) {
        const target = customersData.find(c => c.phone === editPhone);
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
      result = result.filter(customer =>
        customer.name.toLowerCase().includes(lowercasedFilter) ||
        customer.phone.includes(searchTerm) ||
        (customer.detail || "").toLowerCase().includes(lowercasedFilter)
      );
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
        form.reset({
            name: editingCustomer.name || "",
            phone: editingCustomer.phone || "",
            detail: editingCustomer.detail || "",
            useTax: editingCustomer.useTax || false,
            taxName: editingCustomer.taxName || "",
            taxAddress: editingCustomer.taxAddress || "",
            taxId: editingCustomer.taxId || "",
            taxPhone: editingCustomer.taxPhone || editingCustomer.phone || "",
            taxBranchType: editingCustomer.taxBranchType || 'HEAD_OFFICE',
            taxBranchNo: editingCustomer.taxBranchNo || '00000',
            acquisitionSource: editingCustomer.acquisitionSource || null
        });
      }
    } else {
      setEditingCustomer(null);
      form.reset({
        name: "",
        phone: "",
        detail: "",
        useTax: false,
        taxName: "",
        taxAddress: "",
        taxId: "",
        taxPhone: "",
        taxBranchType: 'HEAD_OFFICE',
        taxBranchNo: '00000',
        acquisitionSource: null
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
    
    const customerDoc = doc(db, "customers", editingCustomer.id);
    const updateData = { 
      ...values, 
      updatedAt: serverTimestamp(),
      taxName: values.useTax ? values.taxName : "",
      taxAddress: values.useTax ? values.taxAddress : "",
      taxId: values.useTax ? values.taxId : "",
      taxPhone: values.useTax ? values.taxPhone : "",
      taxBranchType: values.useTax ? values.taxBranchType : null,
      taxBranchNo: values.useTax && values.taxBranchType === 'BRANCH' ? values.taxBranchNo : (values.taxBranchType === 'HEAD_OFFICE' ? '00000' : null),
    };

    updateDoc(customerDoc, updateData)
      .then(() => {
        toast({ title: "อัปเดตข้อมูลลูกค้าสำเร็จ" });
        setIsDialogOpen(false);
      })
      .catch(async (error: any) => {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: customerDoc.path,
            operation: 'update',
            requestResourceData: updateData,
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        } else {
          toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: error.message });
        }
      })
      .finally(() => {
        setIsSubmitting(false);
      });
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
                placeholder="ค้นหาชื่อ/เบอร์โทร..."
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
                      <TableCell>{customer.phone}</TableCell>
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
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] p-0 flex flex-col overflow-hidden">
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
                <FormField name="phone" control={form.control} render={({ field }) => (
                    <FormItem><FormLabel>เบอร์โทรศัพท์</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                
                <FormField name="detail" control={form.control} render={({ field }) => (
                    <FormItem><FormLabel>รายละเอียดเพิ่มเติม</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                
                <FormField name="useTax" control={form.control} render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/20">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <div className="space-y-1 leading-none">
                        <FormLabel className="cursor-pointer font-bold text-primary">ต้องการใบกำกับภาษี (Use Tax Invoice)</FormLabel>
                        <FormMessage />
                    </div>
                    </FormItem>
                )} />

                {useTax && (
                    <div className="space-y-4 p-4 border rounded-md bg-muted/50 border-primary/20 mb-4">
                        <h4 className="text-sm font-bold text-primary uppercase tracking-wider border-b pb-2">ข้อมูลภาษี</h4>
                        <FormField name="taxName" control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>ชื่อในใบกำกับภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="taxAddress" control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>ที่อยู่ในใบกำกับภาษี</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                            <FormField name="taxId" control={form.control} render={({ field }) => (
                                <FormItem><FormLabel>เลขประจำตัวผู้เสียภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField name="taxPhone" control={form.control} render={({ field }) => (
                                <FormItem><FormLabel>เบอร์โทรศัพท์ (บิล)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                            )} />
                        </div>
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