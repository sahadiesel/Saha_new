"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Edit, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

const profileSchema = z.object({
  displayName: z.string().min(1, "กรุณากรอกชื่อ-นามสกุล"),
  phone: z.string().min(1, "กรุณากรอกเบอร์โทรศัพท์"),
  personal: z.object({
    idCardNo: z.string().optional().default(""),
    address: z.string().optional().default(""),
    bank: z.object({
      bankName: z.string().optional().default(""),
      accountName: z.string().optional().default(""),
      accountNo: z.string().optional().default(""),
    }),
    emergencyContact: z.object({
      name: z.string().optional().default(""),
      relationship: z.string().optional().default(""),
      phone: z.string().optional().default(""),
    }),
  }),
});

const InfoRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between py-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="text-sm sm:text-right break-words">{value || '-'}</div>
    </div>
)

export default function SettingsPage() {
    const { profile, loading } = useAuth();
    const { db } = useFirebase();
    const { toast } = useToast();
    const [isEditing, setIsEditing] = useState(false);

    const form = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            displayName: "",
            phone: "",
            personal: {
                idCardNo: "",
                address: "",
                bank: { bankName: "", accountName: "", accountNo: "" },
                emergencyContact: { name: "", relationship: "", phone: "" },
            },
        },
    });

    useEffect(() => {
        if (profile) {
            form.reset({
                displayName: profile.displayName,
                phone: profile.phone,
                personal: {
                    idCardNo: profile.personal?.idCardNo || '',
                    address: profile.personal?.address || '',
                    bank: {
                        bankName: profile.personal?.bank?.bankName || '',
                        accountName: profile.personal?.bank?.accountName || '',
                        accountNo: profile.personal?.bank?.accountNo || '',
                    },
                    emergencyContact: {
                        name: profile.personal?.emergencyContact?.name || '',
                        relationship: profile.personal?.emergencyContact?.relationship || '',
                        phone: profile.personal?.emergencyContact?.phone || '',
                    }
                },
            });
        }
    }, [profile, form, isEditing]);

    const onSubmitProfile = async (values: z.infer<typeof profileSchema>) => {
        if (!db || !profile) return;
        try {
            const p = values.personal;
            const trimOrNull = (s: string | undefined) => {
                const t = (s ?? "").trim();
                return t.length > 0 ? t : null;
            };
            const nextPersonal = {
                ...profile.personal,
                idCardNo: trimOrNull(p.idCardNo),
                address: trimOrNull(p.address),
                bank: {
                    ...profile.personal?.bank,
                    bankName: trimOrNull(p.bank.bankName),
                    accountName: trimOrNull(p.bank.accountName),
                    accountNo: trimOrNull(p.bank.accountNo),
                },
                emergencyContact: {
                    ...profile.personal?.emergencyContact,
                    name: trimOrNull(p.emergencyContact.name),
                    relationship: trimOrNull(p.emergencyContact.relationship),
                    phone: trimOrNull(p.emergencyContact.phone),
                },
            };
            await updateDoc(doc(db, "users", profile.uid), {
                displayName: values.displayName.trim(),
                phone: values.phone.trim(),
                personal: nextPersonal,
                updatedAt: serverTimestamp(),
            });
            toast({ title: "อัปเดตโปรไฟล์สำเร็จ" });
            setIsEditing(false);
        } catch (error: any) {
            toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: error.message });
        }
    };

    if (loading || !profile) return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

    return (
        <div className="space-y-8 max-w-4xl mx-auto pb-12">
            <PageHeader title="โปรไฟล์และการตั้งค่า" description="จัดการข้อมูลส่วนตัวของคุณ" />

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Avatar className="h-16 w-16 border-2 border-primary/20">
                            <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${profile.displayName}`} />
                            <AvatarFallback>{profile.displayName[0]}</AvatarFallback>
                        </Avatar>
                        <div>
                            <CardTitle className="text-2xl">{profile.displayName}</CardTitle>
                            <CardDescription>{profile.email} • {profile.role}</CardDescription>
                        </div>
                    </div>
                    {!isEditing && <Button variant="outline" onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4"/> แก้ไขข้อมูล</Button>}
                </CardHeader>
                <CardContent className="space-y-4">
                    {isEditing ? (
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmitProfile)} className="space-y-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="displayName" render={({ field }) => (<FormItem><FormLabel>ชื่อ-นามสกุล</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel>เบอร์โทรศัพท์</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                </div>

                                <p className="text-xs text-muted-foreground rounded-md border border-dashed bg-muted/30 p-3">
                                  ข้อมูล<strong>เงินเดือน / ประกันสังคม / โรงพยาบาลประกันสังคม</strong>แก้ไขได้เฉพาะแผนกบุคคลเท่านั้น — หน้านี้ไม่แสดงและไม่บันทึกฟิลด์เหล่านั้น
                                </p>

                                <div className="space-y-3">
                                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่และบัตรประชาชน</h3>
                                  <FormField
                                    control={form.control}
                                    name="personal.address"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>ที่อยู่</FormLabel>
                                        <FormControl><Textarea rows={3} placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" {...field} /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name="personal.idCardNo"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>เลขบัตรประชาชน</FormLabel>
                                        <FormControl><Input {...field} placeholder="13 หลัก" inputMode="numeric" autoComplete="off" /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>

                                <div className="space-y-3">
                                  <h3 className="text-sm font-semibold text-foreground">บัญชีธนาคาร (สำหรับโอนเงิน)</h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="personal.bank.bankName" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>ชื่อธนาคาร</FormLabel><FormControl><Input {...field} placeholder="เช่น กสิกรไทย" /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="personal.bank.accountName" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>ชื่อบัญชี</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="personal.bank.accountNo" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>เลขที่บัญชี</FormLabel><FormControl><Input {...field} inputMode="numeric" autoComplete="off" /></FormControl><FormMessage /></FormItem>)} />
                                  </div>
                                </div>

                                <div className="space-y-3">
                                  <h3 className="text-sm font-semibold text-foreground">ผู้ติดต่อฉุกเฉิน</h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <FormField control={form.control} name="personal.emergencyContact.name" render={({ field }) => (<FormItem><FormLabel>ชื่อ</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="personal.emergencyContact.relationship" render={({ field }) => (<FormItem><FormLabel>ความสัมพันธ์</FormLabel><FormControl><Input {...field} placeholder="เช่น คู่สมรส, พ่อ, แม่" /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="personal.emergencyContact.phone" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>เบอร์โทรศัพท์</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end pt-2 border-t">
                                    <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>ยกเลิก</Button>
                                    <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}บันทึก</Button>
                                </div>
                            </form>
                        </Form>
                    ) : (
                        <div className="space-y-1">
                            <InfoRow label="เบอร์โทรศัพท์" value={profile.phone} />
                            <InfoRow label="แผนก" value={profile.department} />
                            <InfoRow label="ตำแหน่ง" value={profile.role} />
                            <InfoRow label="ที่อยู่" value={profile.personal?.address} />
                            <InfoRow label="เลขบัตรประชาชน" value={profile.personal?.idCardNo} />
                            <InfoRow
                              label="บัญชีธนาคาร"
                              value={
                                profile.personal?.bank
                                  ? [profile.personal.bank.bankName, profile.personal.bank.accountName, profile.personal.bank.accountNo].filter(Boolean).join(" • ") || null
                                  : null
                              }
                            />
                            <InfoRow
                              label="ผู้ติดต่อฉุกเฉิน"
                              value={
                                profile.personal?.emergencyContact
                                  ? [profile.personal.emergencyContact.name, profile.personal.emergencyContact.relationship, profile.personal.emergencyContact.phone].filter(Boolean).join(" • ") || null
                                  : null
                              }
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>การดำเนินการ</CardTitle></CardHeader>
                <CardContent>
                    <Button asChild variant="outline" className="text-primary border-primary hover:bg-primary/5">
                        <Link href="/">
                            <Home className="mr-2 h-4 w-4"/>
                            กลับสู่หน้าแรก
                        </Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
