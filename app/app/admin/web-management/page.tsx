"use client";

import { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Globe, Eye } from "lucide-react";
import Link from "next/link";

const landingPageSchema = z.object({
  heroTitle: z.string().min(1, "กรุณากรอกพาดหัวหลัก"),
  heroDescription: z.string().min(1, "กรุณากรอกคำอธิบาย"),
  buttonText: z.string().min(1, "กรุณากรอกข้อความบนปุ่ม"),
  footerText: z.string().optional(),
});

type LandingPageFormData = z.infer<typeof landingPageSchema>;

export default function WebManagementPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  const form = useForm<LandingPageFormData>({
    resolver: zodResolver(landingPageSchema),
    defaultValues: {
      heroTitle: "SAHADIESEL SERVICE CENTER",
      heroDescription: "ศูนย์บริการรถยนต์ครบวงจรที่มีมาตรฐานและเครื่องมือครบครัน...",
      buttonText: "ตรวจสอบสถานะรถ",
      footerText: "",
    },
  });

  useEffect(() => {
    if (!db) return;
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "settings", "landingPage"));
        if (docSnap.exists()) {
          form.reset(docSnap.data() as LandingPageFormData);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [db, form]);

  const onSubmit = async (values: LandingPageFormData) => {
    if (!db || !profile) return;
    try {
      await setDoc(doc(db, "settings", "landingPage"), {
        ...values,
        updatedAt: serverTimestamp(),
        updatedByUid: profile.uid,
        updatedByName: profile.displayName,
      });
      toast({ title: "บันทึกการเปลี่ยนแปลงสำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="จัดการหน้าแรก (Home)" description="แก้ไขข้อความที่ปรากฏบนหน้าแรกของเว็บไซต์">
        <Button asChild variant="outline">
          <Link href="/" target="_blank">
            <Eye className="mr-2 h-4 w-4" />
            ดูหน้าเว็บจริง
          </Link>
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            เนื้อหาหลัก (Hero Section)
          </CardTitle>
          <CardDescription>ข้อความส่วนหัวที่แสดงบนภาพแบคกราวด์</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="heroTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>พาดหัวหลัก (Main Title)</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormDescription>ใช้ตัวพิมพ์ใหญ่เพื่อความสวยงามตามธีมเดิม</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="heroDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>คำอธิบายหลัก (Hero Description)</FormLabel>
                    <FormControl><Textarea rows={6} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="buttonText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ข้อความบนปุ่มกด</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="mr-2 h-4 w-4" />
                  บันทึกข้อมูล
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
