"use client";

import { useState, useEffect } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Globe, Edit, ArrowLeft, X, ShieldCheck, CheckCircle2, Wrench, Gauge, MapPin, Phone, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const landingPageSchema = z.object({
  // Hero Section
  heroTitle: z.string().min(1, "กรุณากรอกพาดหัวหลัก"),
  heroDescription: z.string().min(1, "กรุณากรอกคำอธิบาย"),
  buttonText: z.string().min(1, "กรุณากรอกข้อความบนปุ่ม"),
  // 4S Services
  servicesTitle: z.string().min(1, "กรุณากรอกหัวข้อบริการ"),
  s1Title: z.string().min(1, "กรุณากรอกชื่อบริการที่ 1"),
  s1Desc: z.string().min(1, "กรุณากรอกคำอธิบายที่ 1"),
  s2Title: z.string().min(1, "กรุณากรอกชื่อบริการที่ 2"),
  s2Desc: z.string().min(1, "กรุณากรอกคำอธิบายที่ 2"),
  s3Title: z.string().min(1, "กรุณากรอกชื่อบริการที่ 3"),
  s3Desc: z.string().min(1, "กรุณากรอกคำอธิบายที่ 3"),
  s4Title: z.string().min(1, "กรุณากรอกชื่อบริการที่ 4"),
  s4Desc: z.string().min(1, "กรุณากรอกคำอธิบายที่ 4"),
  // Footer
  footerAboutTitle: z.string().min(1, "กรุณากรอกหัวข้อเกี่ยวกับเรา"),
  footerAboutDesc: z.string().min(1, "กรุณากรอกคำอธิบายเกี่ยวกับเรา"),
  footerContactTitle: z.string().min(1, "กรุณากรอกหัวข้อติดต่อเรา"),
  footerPhone: z.string().min(1, "กรุณากรอกเบอร์โทรศัพท์"),
  footerAddress: z.string().min(1, "กรุณากรอกที่อยู่"),
  footerWebsite: z.string().min(1, "กรุณากรอกชื่อเว็บไซต์"),
  footerFacebookUrl: z.string().optional(),
});

type LandingPageFormData = z.infer<typeof landingPageSchema>;

export default function WebManagementPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<LandingPageFormData>({
    resolver: zodResolver(landingPageSchema),
    defaultValues: {
      heroTitle: "SAHADIESEL SERVICE CENTER",
      heroDescription: "ศูนย์บริการรถยนต์ครบวงจรที่มีมาตรฐานและเครื่องมือครบครัน...",
      buttonText: "ตรวจสอบสถานะรถ",
      servicesTitle: "SAHADIESEL บริการแบบ 4S",
      s1Title: "Standard",
      s1Desc: "บริการมาตรฐานสากล ใส่ใจทุกขั้นตอนการตรวจเช็คและซ่อมบำรุง",
      s2Title: "Space",
      s2Desc: "ให้บริการบนพื้นที่กว้างขวาง รองรับรถได้มากกว่า 50 คันต่อวัน พร้อมห้องรับรองลูกค้า",
      s3Title: "Specialist",
      s3Desc: "ทีมช่างผู้เชี่ยวชาญเฉพาะทาง แก้ปัญหาได้ตรงจุด รวดเร็ว แม่นยำ ด้วยระบบวิเคราะห์อัจฉริยะ",
      s4Title: "Service",
      s4Desc: "ศูนย์บริการรถยนต์นำเข้าและปั๊มหัวฉีดแบบครบวงจร One Stop Service ครอบคลุมแบบ 360 องศา ดูแลรักษา ซ่อม ทำสี เคลมประกัน ครบจบในที่เดียว",
      footerAboutTitle: "เกี่ยวกับเรา",
      footerAboutDesc: "Sahadiesel Service Center ผู้เชี่ยวชาญด้านการซ่อมบำรุงรถยนต์และระบบปั๊มหัวฉีดคอมมอนเรล ด้วยประสบการณ์กว่า 20 ปี เรามุ่งมั่นส่งมอบบริการที่ดีที่สุดให้กับลูกค้าทุกท่าน",
      footerContactTitle: "ติดต่อเรา",
      footerPhone: "02-XXX-XXXX",
      footerAddress: "เขตภาษีเจริญ กรุงเทพมหานคร",
      footerWebsite: "www.sahadiesel.com",
      footerFacebookUrl: "https://facebook.com/sahadiesel",
    },
  });

  useEffect(() => {
    if (!db) return;
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "settings", "landingPage"));
        if (docSnap.exists()) {
          const data = docSnap.data();
          form.reset({
            heroTitle: data.heroTitle ?? "",
            heroDescription: data.heroDescription ?? "",
            buttonText: data.buttonText ?? "",
            servicesTitle: data.servicesTitle ?? "",
            s1Title: data.s1Title ?? "",
            s1Desc: data.s1Desc ?? "",
            s2Title: data.s2Title ?? "",
            s2Desc: data.s2Desc ?? "",
            s3Title: data.s3Title ?? "",
            s3Desc: data.s3Desc ?? "",
            s4Title: data.s4Title ?? "",
            s4Desc: data.s4Desc ?? "",
            footerAboutTitle: data.footerAboutTitle ?? "เกี่ยวกับเรา",
            footerAboutDesc: data.footerAboutDesc ?? "",
            footerContactTitle: data.footerContactTitle ?? "ติดต่อเรา",
            footerPhone: data.footerPhone ?? "",
            footerAddress: data.footerAddress ?? "",
            footerWebsite: data.footerWebsite ?? "",
            footerFacebookUrl: data.footerFacebookUrl ?? "",
          });
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
      setIsEditing(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    }
  };

  const handleCancel = () => {
    form.reset();
    setIsEditing(false);
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <Button variant="outline" onClick={() => router.push('/app')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          ย้อนกลับหน้าหลัก
        </Button>
        <div className="flex gap-2">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)}>
              <Edit className="mr-2 h-4 w-4" />
              แก้ไขเนื้อหา
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleCancel}>
              <X className="mr-2 h-4 w-4" />
              ยกเลิก
            </Button>
          )}
        </div>
      </div>

      <PageHeader title="จัดการหน้าแรก (Home)" description="แก้ไขข้อความที่ปรากฏบนหน้าแรกและส่วนท้ายของเว็บไซต์" />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                ส่วนหัวเว็บไซต์ (Hero Section)
              </CardTitle>
              <CardDescription>เนื้อหาที่จะปรากฏส่วนบนสุดของเว็บไซต์</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="heroTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>พาดหัวหลัก (Main Title)</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted cursor-default")} />
                    </FormControl>
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
                    <FormControl>
                      <Textarea 
                        rows={4} 
                        {...field} 
                        disabled={!isEditing} 
                        className={cn(!isEditing && "bg-muted cursor-default")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="buttonText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ข้อความบนปุ่มกด</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        disabled={!isEditing} 
                        className={cn(!isEditing && "bg-muted cursor-default")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                ส่วนบริการแบบ 4S (Services Section)
              </CardTitle>
              <CardDescription>เนื้อหาในส่วนอธิบายการบริการของบริษัท</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <FormField
                control={form.control}
                name="servicesTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>หัวข้อหลักส่วนบริการ</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted cursor-default")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                  <div className="flex items-center gap-2 font-bold text-primary"><ShieldCheck className="h-4 w-4"/> S1: Standard</div>
                  <FormField
                    control={form.control}
                    name="s1Title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ชื่อหัวข้อ</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="s1Desc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>คำอธิบาย</FormLabel>
                        <FormControl><Textarea {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                  <div className="flex items-center gap-2 font-bold text-primary"><CheckCircle2 className="h-4 w-4"/> S2: Space</div>
                  <FormField
                    control={form.control}
                    name="s2Title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ชื่อหัวข้อ</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="s2Desc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>คำอธิบาย</FormLabel>
                        <FormControl><Textarea {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                  <div className="flex items-center gap-2 font-bold text-primary"><Wrench className="h-4 w-4"/> S3: Specialist</div>
                  <FormField
                    control={form.control}
                    name="s3Title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ชื่อหัวข้อ</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="s3Desc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>คำอธิบาย</FormLabel>
                        <FormControl><Textarea {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                  <div className="flex items-center gap-2 font-bold text-primary"><Gauge className="h-4 w-4"/> S4: Service</div>
                  <FormField
                    control={form.control}
                    name="s4Title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ชื่อหัวข้อ</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="s4Desc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>คำอธิบาย</FormLabel>
                        <FormControl><Textarea {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                ส่วนท้ายเว็บไซต์ (Footer Section)
              </CardTitle>
              <CardDescription>ข้อมูลที่จะปรากฏส่วนล่างสุดของทุกหน้าในโหมดสาธารณะ</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-bold text-sm border-b pb-1">หัวข้อเกี่ยวกับเรา</h4>
                  <FormField
                    control={form.control}
                    name="footerAboutTitle"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>พาดหัว (เช่น เกี่ยวกับเรา)</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerAboutDesc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>คำอธิบายย่อ</FormLabel>
                        <FormControl><Textarea rows={4} {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <h4 className="font-bold text-sm border-b pb-1">หัวข้อติดต่อเรา</h4>
                  <FormField
                    control={form.control}
                    name="footerContactTitle"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>พาดหัว (เช่น ติดต่อเรา)</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2"><Phone className="h-3 w-3" /> เบอร์โทรศัพท์</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2"><MapPin className="h-3 w-3" /> ที่อยู่ (สั้นๆ)</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerWebsite"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2"><Globe className="h-3 w-3" /> ชื่อเว็บไซต์</FormLabel>
                        <FormControl><Input {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />
              
              <div className="space-y-4">
                <h4 className="font-bold text-sm">การติดตามเรา (Social Links)</h4>
                <FormField
                  control={form.control}
                  name="footerFacebookUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ลิงก์ Facebook (URL)</FormLabel>
                      <FormControl><Input placeholder="https://facebook.com/..." {...field} disabled={!isEditing} className={cn(!isEditing && "bg-muted")} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {isEditing && (
            <div className="flex justify-end gap-3 sticky bottom-6 z-20">
              <Button type="button" variant="outline" size="lg" onClick={handleCancel}>ยกเลิก</Button>
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />
                บันทึกข้อมูลทั้งหมด
              </Button>
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
