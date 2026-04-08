"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, updateDoc, serverTimestamp, type DocumentReference } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { safeFormat } from "@/lib/date-utils";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, ArrowLeft, BookOpen, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AccountingAccount } from "@/lib/types";

const accountSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อบัญชี"),
  type: z.enum(["CASH", "BANK"], { required_error: "กรุณาเลือกประเภทบัญชี" }),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  isActive: z.boolean().default(true),
  openingBalance: z.coerce.number().optional(),
  openingBalanceDate: z.string().optional(),
}).refine(data => data.type !== 'BANK' || (data.bankName && data.bankName.length > 0 && data.accountNo && data.accountNo.length > 0), {
  message: "กรุณากรอกชื่อธนาคารและเลขบัญชี",
  path: ["bankName"], 
});

type AccountFormData = z.infer<typeof accountSchema>;

export default function EditAccountPage() {
  const router = useRouter();
  const params = useParams();
  const accountId = params.accountId as string;
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const isUserAdmin = profile?.role === 'ADMIN';
  const hasPermission = useMemo(() => {
    if (!profile) return false;
    return (profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'MANAGEMENT') && profile.role !== 'WORKER';
  }, [profile]);

  const accountDocRef = useMemo((): DocumentReference<AccountingAccount> | null => {
    if (!db || !accountId || !hasPermission) return null;
    return doc(db, "accountingAccounts", accountId) as DocumentReference<AccountingAccount>;
  }, [db, accountId, hasPermission]);

  const { data: account, isLoading, error } = useDoc<AccountingAccount>(accountDocRef);

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
        name: "",
        type: "CASH",
        bankName: "",
        accountNo: "",
        isActive: true,
        openingBalance: 0,
        openingBalanceDate: "",
    },
  });

  useEffect(() => {
    if (account) {
      form.reset({
        name: account.name,
        type: account.type,
        bankName: account.bankName || "",
        accountNo: account.accountNo || "",
        isActive: account.isActive,
        openingBalance: account.openingBalance ?? 0,
        openingBalanceDate: account.openingBalanceDate || "",
      });
    }
  }, [account, form]);

  const accountType = form.watch("type");

  const onSubmit = async (values: AccountFormData) => {
    if (!db || !accountDocRef || !profile) {
        toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ยังไม่พร้อมเชื่อมต่อฐานข้อมูล" });
        return;
    }
    
    try {
      const dataToUpdate: any = {
        name: values.name,
        type: values.type,
        bankName: values.type === 'BANK' ? values.bankName : null,
        accountNo: values.type === 'BANK' ? values.accountNo : null,
        isActive: values.isActive,
        updatedAt: serverTimestamp(),
      };

      if (isUserAdmin) {
        dataToUpdate.openingBalance = values.openingBalance;
        dataToUpdate.openingBalanceDate = values.openingBalanceDate;
        if (values.openingBalance !== account?.openingBalance || values.openingBalanceDate !== account?.openingBalanceDate) {
            dataToUpdate.openingBalanceSetByUid = profile.uid;
            dataToUpdate.openingBalanceSetAt = serverTimestamp();
        }
      }

      await updateDoc(accountDocRef, dataToUpdate);
      toast({ title: "บันทึกการแก้ไขสำเร็จ" });
      router.push("/app/management/accounting/accounts");
    } catch (error: any) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: error.message });
    }
  };

  if (!hasPermission) {
    return (
      <div className="w-full flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <Card className="max-w-md text-center">
            <CardHeader>
                <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
                <CardDescription>พนักงานตำแหน่งช่างไม่ได้รับอนุญาตให้จัดการบัญชีการเงินค่ะ</CardDescription>
            </CardHeader>
            <CardContent>
                <Button variant="outline" onClick={() => router.back()}>กลับ</Button>
            </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
        <>
            <PageHeader title="เกิดข้อผิดพลาด" description="โหลดข้อมูลบัญชีไม่สำเร็จ" />
            <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> กลับ</Button>
        </>
    )
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="กำลังโหลด..." description="กรุณารอสักครู่" />
        <Card><CardContent className="pt-6"><Skeleton className="h-96" /></CardContent></Card>
      </>
    );
  }
  
  if (!account) {
     return <PageHeader title="ไม่พบบัญชี" description="ไม่พบข้อมูลบัญชีที่ต้องการแก้ไข" />
  }

  return (
    <>
      <PageHeader title="แก้ไขบัญชี" description={`กำลังแก้ไขบัญชี: ${account.name}`}>
        <Button asChild variant="outline">
          <Link href={`/app/management/accounting/accounts/${accountId}/ledger`}>
            <BookOpen className="mr-2 h-4 w-4" /> ดูรายการเข้า-ออก
          </Link>
        </Button>
      </PageHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader><CardTitle>ข้อมูลบัญชี</CardTitle></CardHeader>
            <CardContent className="pt-6 space-y-4">
               <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ชื่อบัญชี</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทบัญชี</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="เลือกประเภท..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CASH">เงินสด</SelectItem>
                        <SelectItem value="BANK">ธนาคาร</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {accountType === 'BANK' && (
                <div className="space-y-4 pt-4 border-t">
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ชื่อธนาคาร</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accountNo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>เลขที่บัญชี</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
               <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>สถานะใช้งาน</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
            </CardContent>
          </Card>

           <Card>
                <CardHeader>
                    <CardTitle>ยอดยกมา</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     <FormField
                        control={form.control}
                        name="openingBalance"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>ยอดยกมา</FormLabel>
                            <FormControl><Input type="number" {...field} disabled={!isUserAdmin} value={field.value ?? 0} /></FormControl>
                            {!isUserAdmin && <FormDescription>แก้ไขได้เฉพาะแอดมิน</FormDescription>}
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="openingBalanceDate"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>วันที่ยอดยกมา</FormLabel>
                            <FormControl><Input type="date" {...field} disabled={!isUserAdmin} value={field.value ?? ''} /></FormControl>
                             {account.openingBalanceSetAt && (
                                <FormDescription>
                                    อัปเดตล่าสุด: {safeFormat(account.openingBalanceSetAt, 'dd MMM yyyy, HH:mm')}
                                </FormDescription>
                            )}
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                </CardContent>
            </Card>

          <div className="flex gap-4">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              บันทึกการแก้ไข
            </Button>
             <Button type="button" variant="outline" asChild>
              <Link href="/app/management/accounting/accounts"><ArrowLeft className="mr-2 h-4 w-4" /> ยกเลิก</Link>
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
