"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc, serverTimestamp, where } from "firebase/firestore";
import { useFirebase, useCollection, useDoc, type WithId } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MoreHorizontal, PlusCircle, Link as LinkIcon, Edit } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEPARTMENTS, USER_ROLES, USER_STATUSES, PAY_TYPES, STAFF_ROLES_FOR_QUERY } from "@/lib/constants";
import type { UserProfile, SSOHospital, PayType, Vendor } from "@/lib/types";
import { payTypeLabel, deptLabel, userStatusLabel } from "@/lib/ui-labels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const userProfileSchema = z.object({
  displayName: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  department: z.enum(DEPARTMENTS).optional(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  linkedVendorId: z.string().nullable().optional(),
  personal: z.object({
    idCardNo: z.string().optional().default(''),
    address: z.string().optional().default(''),
    bank: z.object({
      bankName: z.string().optional().default(''),
      accountName: z.string().optional().default(''),
      accountNo: z.string().optional().default(''),
    }).optional(),
    emergencyContact: z.object({
      name: z.string().optional().default(''),
      relationship: z.string().optional().default(''),
      phone: z.string().optional().default(''),
    }).optional(),
  }).optional(),
  hr: z.object({
    salaryMonthly: z.coerce.number().optional(),
    salaryDaily: z.coerce.number().optional(),
    payType: z.enum(["MONTHLY", "DAILY", "MONTHLY_NOSCAN", "NOPAY"]).optional(),
    startDate: z.string().optional().default(''),
    endDate: z.string().optional().default(''),
    ssoHospital: z.string().optional().default(''),
    note: z.string().optional().default(''),
    ssoRegistered: z.boolean().default(true),
  }).optional(),
});

type UserWithId = WithId<UserProfile>;

const UserCard = ({ user, onEdit, onDelete, loggedInUser }: { user: UserWithId, onEdit: (user: UserWithId) => void, onDelete: (userId: string) => void, loggedInUser: UserProfile | null }) => {
    const isManagerOrAdmin = loggedInUser?.role === 'MANAGER' || loggedInUser?.role === 'ADMIN';
    const isAdminUser = user.role === 'ADMIN';
    const isLoggedInAdmin = loggedInUser?.role === 'ADMIN';

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{user.displayName}</CardTitle>
                    {isAdminUser ? (
                        isLoggedInAdmin ? (
                            <Button variant="outline" size="sm" onClick={() => onEdit(user)} className="h-8 gap-1">
                                <Edit className="h-3 w-3" /> แก้ไข
                            </Button>
                        ) : null
                    ) : (
                        isManagerOrAdmin && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => onEdit(user)}>แก้ไข</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onDelete(user.id)} className="text-destructive focus:text-destructive">
                                        ลบ
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    )}
                </div>
                <CardDescription>{user.phone}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm pt-0">
                <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-muted-foreground">แผนก</span>
                    <span className="font-medium">{deptLabel(user.department) || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-muted-foreground">ตำแหน่ง</span>
                    <span className="font-medium">{user.role}</span>
                </div>
                 <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-muted-foreground">สถานะ</span>
                    <span className="font-medium">{userStatusLabel(user.status)}</span>
                </div>
                {user.linkedVendorName && (
                    <div className="flex justify-between items-center border-t pt-2 text-primary font-bold">
                        <span className="flex items-center gap-1"><LinkIcon className="h-3 w-3"/> ร้านที่ผูก:</span>
                        <span>{user.linkedVendorName}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default function ManagementHREmployeesPage() {
  const { db } = useFirebase();
  const { profile: loggedInUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithId | null>(null);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  
  const [ssoHospitals, setSsoHospitals] = useState<WithId<SSOHospital>[]>([]);
  const [contractorVendors, setContractorVendors] = useState<WithId<Vendor>[]>([]);
  const [isLoadingHospitals, setIsLoadingHospitals] = useState(true);

  const isManagerOrAdmin = loggedInUser?.role === 'MANAGER' || loggedInUser?.role === 'ADMIN';
  const isLoggedInAdmin = loggedInUser?.role === 'ADMIN';

  const form = useForm<z.infer<typeof userProfileSchema>>({
    resolver: zodResolver(userProfileSchema),
    defaultValues: {
      displayName: '',
      phone: '',
      role: 'WORKER',
      status: 'PENDING',
      linkedVendorId: null,
      personal: {
        idCardNo: '',
        address: '',
        bank: {
          bankName: '',
          accountName: '',
          accountNo: '',
        },
        emergencyContact: {
          name: '',
          relationship: '',
          phone: '',
        },
      },
      hr: {
        payType: 'MONTHLY',
        startDate: '',
        endDate: '',
        ssoHospital: '',
        note: '',
        ssoRegistered: true,
      },
    },
  });

  const selectedDepartment = form.watch("department");

  useEffect(() => {
    if (!db) return;
    const q = query(
      collection(db, "users"),
      where("role", "in", [...STAFF_ROLES_FOR_QUERY]),
      orderBy("displayName", "asc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserWithId));
      setUsers(usersData);
      setLoading(false);
    },
    (error) => {
      toast({ variant: "destructive", title: "Failed to load users" });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, toast]);

  useEffect(() => {
    if (!db) return;
    setIsLoadingHospitals(true);
    const qHospitals = query(collection(db, "ssoHospitals"), orderBy("name", "asc"));
    const unsubHospitals = onSnapshot(qHospitals, (snapshot) => {
        setSsoHospitals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<SSOHospital>)));
        setIsLoadingHospitals(false);
    });

    const qContractors = query(collection(db, "vendors"), where("vendorType", "==", "CONTRACTOR"), where("isActive", "==", true));
    const unsubContractors = onSnapshot(qContractors, (snapshot) => {
        setContractorVendors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<Vendor>)));
    });

    return () => { unsubHospitals(); unsubContractors(); };
  }, [db]);
  
  useEffect(() => {
    if (isDialogOpen) {
      if (editingUser) {
        form.reset({
          displayName: editingUser.displayName,
          phone: editingUser.phone,
          department: editingUser.department || undefined,
          role: editingUser.role,
          status: editingUser.status,
          linkedVendorId: editingUser.linkedVendorId || null,
          personal: {
            idCardNo: editingUser.personal?.idCardNo || '',
            address: editingUser.personal?.address || '',
            bank: {
                bankName: editingUser.personal?.bank?.bankName || '',
                accountName: editingUser.personal?.bank?.accountName || '',
                accountNo: editingUser.personal?.bank?.accountNo || '',
            },
            emergencyContact: {
                name: editingUser.personal?.emergencyContact?.name || '',
                relationship: editingUser.personal?.emergencyContact?.relationship || '',
                phone: editingUser.personal?.emergencyContact?.phone || '',
            }
          },
          hr: {
              salaryMonthly: editingUser.hr?.salaryMonthly,
              salaryDaily: editingUser.hr?.salaryDaily,
              payType: editingUser.hr?.payType,
              startDate: editingUser.hr?.startDate || '',
              endDate: editingUser.hr?.endDate || '',
              ssoHospital: editingUser.hr?.ssoHospital || '',
              note: editingUser.hr?.note || '',
              ssoRegistered: editingUser.hr?.ssoRegistered ?? true,
          }
        });
      }
    } else {
        setEditingUser(null);
        form.reset({
            displayName: '',
            phone: '',
            role: 'WORKER',
            status: 'PENDING',
            linkedVendorId: null,
        });
    }
  }, [isDialogOpen, editingUser, form]);


  const openDialog = (user: UserWithId) => {
    setEditingUser(user);
    setIsDialogOpen(true);
  };

  const onSubmit = async (formValues: z.infer<typeof userProfileSchema>) => {
    if (!db || !editingUser) return;
    setIsSubmitting(true);
    
    try {
        const linkedVendor = contractorVendors.find(v => v.id === formValues.linkedVendorId);

        const finalUpdate: {[key: string]: any} = {
            displayName: formValues.displayName,
            phone: formValues.phone,
            department: formValues.department || null,
            role: formValues.role,
            status: formValues.status,
            linkedVendorId: formValues.department === 'OUTSOURCE' ? formValues.linkedVendorId || null : null,
            linkedVendorName: formValues.department === 'OUTSOURCE' ? linkedVendor?.companyName || null : null,
            'personal.idCardNo': formValues.personal?.idCardNo || null,
            'personal.address': formValues.personal?.address || null,
            'personal.bank.bankName': formValues.personal?.bank?.bankName || null,
            'personal.bank.accountName': formValues.personal?.bank?.accountName || null,
            'personal.bank.accountNo': formValues.personal?.bank?.accountNo || null,
            'personal.emergencyContact.name': formValues.personal?.emergencyContact?.name || null,
            'personal.emergencyContact.relationship': formValues.personal?.emergencyContact?.relationship || null,
            'personal.emergencyContact.phone': formValues.personal?.emergencyContact?.phone || null,
            'hr.payType': formValues.hr?.payType || null,
            'hr.startDate': formValues.hr?.startDate || null,
            'hr.endDate': formValues.hr?.endDate || null,
            'hr.ssoHospital': formValues.hr?.ssoHospital || null,
            'hr.note': formValues.hr?.note || null,
            'hr.ssoRegistered': formValues.hr?.ssoRegistered ?? true,
            updatedAt: serverTimestamp()
        };
        
        if (isManagerOrAdmin) {
            finalUpdate['hr.salaryMonthly'] = formValues.hr?.salaryMonthly === undefined || (formValues.hr.salaryMonthly as any) === '' ? null : Number(formValues.hr.salaryMonthly);
            finalUpdate['hr.salaryDaily'] = formValues.hr?.salaryDaily === undefined || (formValues.hr.salaryDaily as any) === '' ? null : Number(formValues.hr.salaryDaily);
        }
        
        const userDoc = doc(db, "users", editingUser.id);
        await updateDoc(userDoc, finalUpdate);
        
        toast({ title: "User profile updated successfully" });
        setIsDialogOpen(false);
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = (userId: string) => {
    setUserToDelete(userId);
    setIsDeleteAlertOpen(true);
  };

  const confirmDelete = async () => {
    if (!db || !userToDelete) return;
    
    try {
        const userDoc = doc(db, "users", userToDelete);
        await deleteDoc(userDoc);
        toast({title: "User profile deleted successfully"});
    } catch(error: any) {
        toast({variant: "destructive", title: "Deletion Failed", description: error.message});
    } finally {
        setIsDeleteAlertOpen(false);
        setUserToDelete(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>;
  }

  return (
    <>
        <PageHeader title="ผู้ใช้และพนักงาน" description="จัดการข้อมูลผู้ใช้และพนักงานทั้งหมด" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="mb-4"><PlusCircle className="mr-2 h-4 w-4" /> เพิ่มผู้ใช้</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ขั้นตอนการสร้างผู้ใช้</AlertDialogTitle>
              <AlertDialogDescription>
                หากต้องการเพิ่มผู้ใช้ใหม่ ให้ผู้ใช้ไปสมัครสมาชิกด้วยตนเองที่หน้า Sign Up
                <br /><br />
                เมื่อสร้างบัญชีแล้ว บัญชีจะปรากฏในรายการนี้พร้อมสถานะ "PENDING" จากนั้นคุณสามารถแก้ไขข้อมูลและเปลี่ยนสถานะเป็น "ACTIVE" เพื่อเปิดใช้งานบัญชีได้
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>ตกลง</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      
      <Card className="hidden sm:block">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ</TableHead>
                <TableHead>เบอร์โทร</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead>ตำแหน่ง</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length > 0 ? (
                users.map(user => {
                    const isAdminUser = user.role === 'ADMIN';
                    return (
                        <TableRow key={user.id}>
                        <TableCell className="font-medium">
                            {user.displayName}
                            {user.linkedVendorName && <p className="text-[10px] text-primary flex items-center gap-1 mt-0.5"><LinkIcon className="h-2 w-2"/> {user.linkedVendorName}</p>}
                        </TableCell>
                        <TableCell>{user.phone}</TableCell>
                        <TableCell>{deptLabel(user.department) || 'N/A'}</TableCell>
                        <TableCell>{user.role}</TableCell>
                        <TableCell>{userStatusLabel(user.status)}</TableCell>
                        <TableCell className="text-right">
                            {isAdminUser ? (
                                isLoggedInAdmin ? (
                                    <Button variant="ghost" size="sm" onClick={() => openDialog(user)} className="h-8 gap-1">
                                        <Edit className="h-3 w-3" /> แก้ไข
                                    </Button>
                                ) : null
                            ) : (
                                isManagerOrAdmin && (
                                    <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => openDialog(user)}>แก้ไข</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleDeleteRequest(user.id)} className="text-destructive focus:text-destructive">ลบ</DropdownMenuItem>
                                    </DropdownMenuContent>
                                    </DropdownMenu>
                                )
                            )}
                        </TableCell>
                        </TableRow>
                    );
                })
              ) : (
                <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                       ไม่พบข้อมูลผู้ใช้, ผู้ใช้ใหม่จะปรากฏที่นี่หลังจากสมัครสมาชิก
                    </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:hidden">
        {users.length > 0 ? (
            users.map(user => (
                <UserCard key={user.id} user={user} onEdit={openDialog} onDelete={handleDeleteRequest} loggedInUser={loggedInUser} />
            ))
        ) : (
            <Card className="text-center py-12">
                <CardHeader>
                    <CardTitle>ไม่พบข้อมูลผู้ใช้</CardTitle>
                    <CardDescription>ผู้ใช้ใหม่จะปรากฏที่นี่หลังจากสมัครสมาชิก</CardDescription>
                </CardHeader>
            </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !isSubmitting && setIsDialogOpen(open)}>
        <DialogContent 
            className="sm:max-w-[600px] flex flex-col max-h-[90vh]" 
            onInteractOutside={(e) => { if (isSubmitting) e.preventDefault(); }}
            onEscapeKeyDown={(e) => { if (isSubmitting) e.preventDefault(); }}
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>แก้ไขข้อมูลผู้ใช้</DialogTitle>
            <DialogDescription>อัปเดตข้อมูลด้านล่าง</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <div className="flex-1 overflow-y-auto -mx-6 px-6 py-4">
              <form id="edit-user-form-hr" onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>ข้อมูลบัญชี</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <FormField name="displayName" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชื่อ</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField name="phone" control={form.control} render={({ field }) => (<FormItem><FormLabel>เบอร์โทร</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <FormField name="department" control={form.control} render={({ field }) => (<FormItem><FormLabel>แผนก</FormLabel><Select onValueChange={field.onChange} value={field.value ?? ''}><FormControl><SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger></FormControl><SelectContent>{DEPARTMENTS.map(d=><SelectItem key={d} value={d}>{deptLabel(d)}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                <FormField name="role" control={form.control} render={({ field }) => (<FormItem><FormLabel>ตำแหน่ง</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger></FormControl><SelectContent>{USER_ROLES.map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                                <FormField name="status" control={form.control} render={({ field }) => (<FormItem><FormLabel>สถานะ</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger></FormControl><SelectContent>{USER_STATUSES.map(s=><SelectItem key={s} value={s}>{userStatusLabel(s)}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                            </div>

                            {/* --- Linked Vendor for OUTSOURCE --- */}
                            {selectedDepartment === 'OUTSOURCE' && (
                                <FormField name="linkedVendorId" control={form.control} render={({ field }) => (
                                    <FormItem className="bg-primary/5 p-4 rounded-md border border-primary/20 animate-in fade-in slide-in-from-top-1">
                                        <FormLabel className="flex items-center gap-2 text-primary font-bold"><LinkIcon className="h-4 w-4"/> เชื่อมโยงกับร้านผู้รับเหมา</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="เลือกชื่อร้าน..." /></SelectTrigger></FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">--- ไม่เชื่อมโยง ---</SelectItem>
                                                {contractorVendors.map(v => (
                                                    <SelectItem key={v.id} value={v.id}>{v.companyName} ({v.shortName})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormDescription className="text-[10px]">เมื่อเชื่อมโยงแล้ว พนักงานจะเห็นเฉพาะงานที่ส่งมอบให้ร้านนี้ในหน้า "งานของฉัน" ค่ะ</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            )}
                        </CardContent>
                    </Card>

                     <Card>
                        <CardHeader><CardTitle>ข้อมูลส่วนตัว</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                             <FormField name="personal.idCardNo" control={form.control} render={({ field }) => (<FormItem><FormLabel>เลขบัตรประชาชน</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                             <FormField name="personal.address" control={form.control} render={({ field }) => (<FormItem><FormLabel>ที่อยู่</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                             <p className="font-medium text-sm">บัญชีธนาคาร</p>
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                                 <FormField name="personal.bank.bankName" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชื่อธนาคาร</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                                 <FormField name="personal.bank.accountName" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชื่อบัญชี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                                 <FormField name="personal.bank.accountNo" control={form.control} render={({ field }) => (<FormItem><FormLabel>เลขบัญชี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                             </div>
                             <p className="font-medium text-sm">ผู้ติดต่อฉุกเฉิน</p>
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-md">
                                  <FormField name="personal.emergencyContact.name" control={form.control} render={({ field }) => (<FormItem><FormLabel>ชื่อ</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                                  <FormField name="personal.emergencyContact.relationship" control={form.control} render={({ field }) => (<FormItem><FormLabel>ความสัมพันธ์</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                                  <FormField name="personal.emergencyContact.phone" control={form.control} render={({ field }) => (<FormItem><FormLabel>เบอร์โทร</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                             </div>
                        </CardContent>
                    </Card>
                    
                    <Card>
                        <CardHeader><CardTitle>ข้อมูลฝ่ายบุคคล (HR)</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField name="hr.startDate" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>วันที่เริ่มงาน</FormLabel>
                                        <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField name="hr.endDate" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>วันที่สิ้นสุดการทำงาน</FormLabel>
                                        <FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField name="hr.salaryMonthly" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>เงินเดือน</FormLabel>
                                        <FormControl><Input type="number" {...field} disabled={!isManagerOrAdmin} value={field.value ?? ''} onChange={(e) => { const value = e.target.value; field.onChange(value === '' ? undefined : Number(value)); }} /></FormControl>
                                        {!isManagerOrAdmin && <FormDescription>เฉพาะ Manager/Admin</FormDescription>}
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                                <FormField name="hr.salaryDaily" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>ค่าแรงรายวัน</FormLabel>
                                        <FormControl><Input type="number" {...field} disabled={!isManagerOrAdmin} value={field.value ?? ''} onChange={(e) => { const value = e.target.value; field.onChange(value === '' ? undefined : Number(value)); }} /></FormControl>
                                        {!isManagerOrAdmin && <FormDescription>เฉพาะ Manager/Admin</FormDescription>}
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                              </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField name="hr.payType" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel>ประเภทการจ่ายเงิน</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {PAY_TYPES.map(p => <SelectItem key={p} value={p}>{payTypeLabel(p)}</SelectItem>)}
                                    </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                                )} />
                                <FormField
                                    name="hr.ssoRegistered"
                                    control={form.control}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>สิทธิ์ประกันสังคม</FormLabel>
                                            <Select 
                                                onValueChange={(v) => field.onChange(v === 'true')} 
                                                value={field.value ? "true" : "false"}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="true">ยื่นประกันสังคม</SelectItem>
                                                    <SelectItem value="false">ไม่ยื่นประกันสังคม</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                             <FormField
                                name="hr.ssoHospital"
                                control={form.control}
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>โรงพยาบาลประกันสังคม</FormLabel>
                                     <Select
                                        onValueChange={field.onChange}
                                        value={field.value ?? ''}
                                        disabled={!isManagerOrAdmin || isLoadingHospitals}
                                        >
                                        <FormControl>
                                            <SelectTrigger>
                                            <SelectValue placeholder={isLoadingHospitals ? "กำลังโหลด..." : "เลือกโรงพยาบาล"} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {ssoHospitals.map((hospital) => (
                                            <SelectItem key={hospital.id} value={hospital.name}>
                                                {hospital.name}
                                            </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {!isManagerOrAdmin && <FormDescription>เฉพาะ Manager/Admin</FormDescription>}
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                             <FormField name="hr.note" control={form.control} render={({ field }) => (<FormItem><FormLabel>หมายเหตุ</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                        </CardContent>
                    </Card>
              </form>
            </div>
            <DialogFooter className="flex-shrink-0 border-t pt-4 bg-background pb-6 -mx-6 px-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
              <Button type="submit" form="edit-user-form-hr" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} บันทึก
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>ยืนยันการลบ?</AlertDialogTitle>
                <AlertDialogDescription>
                    ข้อมูลโปรไฟล์ของผู้ใช้จะถูกลบออกจากฐานข้อมูลอย่างถาวร แต่บัญชีการยืนยันตัวตนจะยังคงอยู่
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">ลบ</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
