"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, setDoc } from "firebase/firestore";

import { useFirebase, useDoc } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import type { StoreSettings } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Edit, X } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Separator } from "./ui/separator";

const storeSettingsSchema = z.object({
  taxName: z.string().optional(),
  taxAddress: z.string().optional(),
  branch: z.string().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  informalName: z.string().optional(),
  openingHours: z.string().optional(),
});

const InfoRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between py-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="text-sm sm:text-right break-words max-w-md">{value || '-'}</div>
    </div>
);

export function StoreSettingsForm() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const canEditSettings = profile?.role === 'ADMIN' || profile?.department === 'ACCOUNTING_HR';

  const settingsDocRef = useMemo(() => {
    if (!db) return null;
    return doc(db, "settings", "store");
  }, [db]);

  const { data: settings, isLoading } = useDoc<StoreSettings>(settingsDocRef);

  const form = useForm<z.infer<typeof storeSettingsSchema>>({
    resolver: zodResolver(storeSettingsSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (settings) {
      form.reset(settings);
    }
  }, [settings, form]);

  const onSubmit = async (values: z.infer<typeof storeSettingsSchema>) => {
    if (!settingsDocRef) return;
    try {
      await setDoc(settingsDocRef, values, { merge: true });
      toast({
        title: "Settings Saved",
        description: "Store settings have been updated successfully.",
      });
      setIsEditing(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error Saving Settings",
        description: error.message,
      });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  
  if (!isEditing) {
    return (
        <div className="space-y-8">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>ข้อมูลร้าน</CardTitle>
                        <CardDescription>ข้อมูลสำหรับออกเอกสารและข้อมูลทั่วไปของร้าน</CardDescription>
                    </div>
                    {canEditSettings && <Button variant="outline" onClick={() => setIsEditing(true)}><Edit /> Edit</Button>}
                </CardHeader>
                <CardContent className="space-y-1">
                    <Separator />
                    <InfoRow label="ชื่อสำหรับออกภาษี" value={settings?.taxName} />
                    <Separator />
                    <InfoRow label="ที่อยู่" value={<span className="whitespace-pre-wrap">{settings?.taxAddress}</span>} />
                    <Separator />
                    <InfoRow label="สาขา" value={settings?.branch} />
                    <Separator />
                    <InfoRow label="เบอร์โทร" value={settings?.phone} />
                    <Separator />
                    <InfoRow label="เลขที่ผู้เสียภาษี" value={settings?.taxId} />
                    <Separator />
                    <InfoRow label="ชื่อไม่เป็นทางการ" value={settings?.informalName} />
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>เวลาทำการ</CardTitle>
                </CardHeader>
                <CardContent>
                    <InfoRow label="รายละเอียดเวลาทำการ" value={<span className="whitespace-pre-wrap">{settings?.openingHours}</span>} />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>แก้ไขข้อมูลร้าน</CardTitle>
            <CardDescription>ข้อมูลสำหรับออกเอกสารและข้อมูลทั่วไปของร้าน</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField control={form.control} name="taxName" render={({ field }) => (<FormItem><FormLabel>ชื่อสำหรับออกภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <FormField control={form.control} name="taxAddress" render={({ field }) => (<FormItem><FormLabel>ที่อยู่</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="branch" render={({ field }) => (<FormItem><FormLabel>สาขา</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel>เบอร์โทร</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="taxId" render={({ field }) => (<FormItem><FormLabel>เลขที่ผู้เสียภาษี</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            </div>
             <FormField control={form.control} name="informalName" render={({ field }) => (<FormItem><FormLabel>ชื่อไม่เป็นทางการ</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
          </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>เวลาทำการ</CardTitle>
            </CardHeader>
            <CardContent>
                <FormField control={form.control} name="openingHours" render={({ field }) => (<FormItem><FormLabel>รายละเอียดเวลาทำการ</FormLabel><FormControl><Textarea placeholder="เช่น จันทร์-เสาร์: 8:00 - 17:00" {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
            </CardContent>
        </Card>
        <div className="flex justify-end gap-4">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)} disabled={form.formState.isSubmitting}><X className="mr-2 h-4 w-4" /> Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
              Save Settings
            </Button>
        </div>
      </form>
    </Form>
  );
}
