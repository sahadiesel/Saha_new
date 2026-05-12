"use client";

import { useEffect, useMemo, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { doc, updateDoc, serverTimestamp, getDocs, query, where, collection, documentId } from "firebase/firestore";
import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VENDOR_TYPES } from "@/lib/constants";
import { vendorTypeLabel } from "@/lib/ui-labels";
import type { Vendor } from "@/lib/types";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  vendorFormSchema,
  vendorFormDefaultValues,
  vendorToFormDefaults,
  vendorFormValuesToFirestore,
  type VendorFormData,
} from "@/lib/vendor-form";

function EditVendorPageContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const vendorId = params.vendorId as string;
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();

  const isViewMode = searchParams.get("view") === "1";
  
  const canEditPermission = useMemo(() => {
    if (!profile || profile.role === 'VIEWER') return false;
    return profile.role === 'ADMIN' || profile.role === 'MANAGER' || profile.department === 'OFFICE' || profile.department === 'MANAGEMENT';
  }, [profile]);

  const canEdit = canEditPermission && !isViewMode;

  const vendorDocRef = useMemo(() => {
    if (!db || !vendorId) return null;
    return doc(db, "vendors", vendorId);
  }, [db, vendorId]);

  const { data: vendor, isLoading, error } = useDoc<Vendor>(vendorDocRef);

  const form = useForm<VendorFormData>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: vendorFormDefaultValues,
  });

  const hasTax = form.watch("hasTax");
  const taxBranchType = form.watch("taxBranchType");

  useEffect(() => {
    if (vendor) {
      form.reset(vendorToFormDefaults(vendor));
    }
  }, [vendor, form]);

  const onSubmit = async (values: VendorFormData) => {
    if (!canEdit) {
      toast({ variant: "destructive", title: "ไม่มีสิทธิ์", description: "คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้" });
      return;
    }
    if (!db || !vendorDocRef) {
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: "ยังไม่พร้อมเชื่อมต่อฐานข้อมูล" });
      return;
    }

    try {
      // Check for unique shortName (excluding this vendor)
      const qShort = query(
        collection(db, "vendors"),
        where("shortName", "==", values.shortName.toUpperCase()),
        where(documentId(), "!=", vendorId)
      );
      const snapShort = await getDocs(qShort);
      if (!snapShort.empty) {
        form.setError("shortName", { type: "manual", message: "ชื่อย่อนี้ถูกใช้ไปแล้ว" });
        return;
      }

      // Check for duplicate phone (excluding this vendor)
      const qPhone = query(
        collection(db, "vendors"),
        where("phone", "==", values.phone.trim()),
        where(documentId(), "!=", vendorId)
      );
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        form.setError("phone", { type: "manual", message: "เบอร์โทรศัพท์นี้ถูกใช้งานโดยร้านค้าอื่นแล้ว" });
        return;
      }
      
      const dataToUpdate = {
        ...vendorFormValuesToFirestore(values, { mode: "update" }),
        updatedAt: serverTimestamp(),
      };

      await updateDoc(vendorDocRef, dataToUpdate);
      toast({ title: "บันทึกการแก้ไขสำเร็จ" });
      router.push("/app/office/parts/vendors");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ variant: "destructive", title: "เกิดข้อผิดพลาด", description: message });
    }
  };

  if (isLoading) {
    return <Card><CardContent><Skeleton className="h-96" /></CardContent></Card>;
  }

  if (error || !vendor) {
    return <PageHeader title="ไม่พบร้านค้า" description="ไม่พบข้อมูลร้านค้าที่ต้องการแก้ไข" />;
  }

  return (
    <>
      <PageHeader title={canEdit ? "แก้ไขข้อมูลร้านค้า" : "ดูข้อมูลร้านค้า"} description={`ร้านค้า: ${vendor.companyName}`} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-4xl mx-auto pb-10">
           <Card>
            <CardHeader>
              <CardTitle>ข้อมูลหลัก</CardTitle>
              <CardDescription>ข้อมูลที่จำเป็นสำหรับระบุร้านค้า</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="shortName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ชื่อย่อ (ไม่ซ้ำ)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ''} className="uppercase" disabled={!canEdit} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>ชื่อร้าน/บริษัท</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="vendorType" render={({ field }) => (
                <FormItem>
                  <FormLabel>ประเภทธุรกิจ</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!canEdit}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="เลือกประเภทธุรกิจ" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {VENDOR_TYPES.map(type => (
                        <SelectItem key={type} value={type}>{vendorTypeLabel(type)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>ข้อมูลการติดต่อและที่อยู่</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold text-primary">เบอร์โทรศัพท์ร้าน (จำเป็น)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>ที่อยู่</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>อีเมล</FormLabel><FormControl><Input type="email" {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <Separator />
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem><FormLabel>ผู้ติดต่อ</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="contactPhone" render={({ field }) => (
                  <FormItem><FormLabel>เบอร์โทรผู้ติดต่อ</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!canEdit} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ข้อมูลภาษีและหมายเหตุ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="hasTax"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>สถานะภาษี</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={(v) => {
                          if (!canEdit) return;
                          const next = v === "true";
                          field.onChange(next);
                          if (!next) {
                            form.setValue("taxId", "");
                            form.setValue("taxBranchType", undefined);
                            form.setValue("taxBranchNo", "");
                            form.clearErrors(["taxId", "taxBranchType", "taxBranchNo"]);
                          }
                        }}
                        value={field.value ? "true" : "false"}
                        className="flex flex-wrap gap-6 pt-1"
                        disabled={!canEdit}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="true" id="edit-vendor-tax-yes" />
                          <Label htmlFor="edit-vendor-tax-yes" className="font-normal cursor-pointer">
                            มีภาษี
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="false" id="edit-vendor-tax-no" />
                          <Label htmlFor="edit-vendor-tax-no" className="font-normal cursor-pointer">
                            ไม่มีภาษี
                          </Label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {hasTax && (
                <>
                  <FormField
                    control={form.control}
                    name="taxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>เลขประจำตัวผู้เสียภาษี</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} disabled={!canEdit} placeholder="เลข 13 หลัก" />
                        </FormControl>
                        <FormDescription className="text-[10px]">จำเป็นหากต้องการออกใบหัก ณ ที่จ่าย</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxBranchType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>สำนักงานใหญ่ / สาขา</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={(v) => {
                              if (!canEdit) return;
                              field.onChange(v as "HEAD_OFFICE" | "BRANCH");
                              if (v === "HEAD_OFFICE") {
                                form.setValue("taxBranchNo", "");
                                form.clearErrors("taxBranchNo");
                              }
                            }}
                            value={field.value ?? ""}
                            className="flex flex-wrap gap-6 pt-1"
                            disabled={!canEdit}
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="HEAD_OFFICE" id="edit-vendor-branch-hq" />
                              <Label htmlFor="edit-vendor-branch-hq" className="font-normal cursor-pointer">
                                สำนักงานใหญ่
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="BRANCH" id="edit-vendor-branch-br" />
                              <Label htmlFor="edit-vendor-branch-br" className="font-normal cursor-pointer">
                                สาขา
                              </Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {taxBranchType === "BRANCH" && (
                    <FormField
                      control={form.control}
                      name="taxBranchNo"
                      render={({ field }) => (
                        <FormItem className="max-w-xs">
                          <FormLabel>รหัสสาขา (5 หลัก)</FormLabel>
                          <FormControl>
                            <Input
                              inputMode="numeric"
                              maxLength={5}
                              placeholder="00001"
                              {...field}
                              value={field.value ?? ""}
                              disabled={!canEdit}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>หมายเหตุเพิ่มเติม</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} disabled={!canEdit} placeholder="ข้อมูลอื่นๆ เช่น เงื่อนไขการส่งของ..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex gap-4">
            {canEdit && (
                <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Save className="mr-2 h-4 w-4" />
                    บันทึกการแก้ไข
                </Button>
            )}
            <Button type="button" variant="outline" asChild>
              <Link href="/app/office/parts/vendors"><ArrowLeft className="mr-2 h-4 w-4" /> กลับ</Link>
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}

export default function EditVendorPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <EditVendorPageContent />
    </Suspense>
  )
}
