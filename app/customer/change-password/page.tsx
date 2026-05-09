"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "firebase/auth";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, KeyRound } from "lucide-react";

import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { PublicHeader } from "@/components/public-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const schema = z
  .object({
    password: z.string().min(6, "รหัสผ่านอย่างน้อย 6 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export default function CustomerChangePasswordAfterResetPage() {
  const { user, profile, loading, signOut } = useAuth();
  const { auth, db } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (loading) return;
    if (!user || !profile) {
      router.replace("/login/customer");
      return;
    }
    if (profile.role !== "CUSTOMER" || profile.status !== "ACTIVE") {
      router.replace("/pending");
      return;
    }
    if (!profile.mustChangePassword) {
      router.replace("/customer");
    }
  }, [loading, user, profile, router]);

  async function onSubmit(values: z.infer<typeof schema>) {
    if (!auth?.currentUser || !db || !profile) return;
    setBusy(true);
    try {
      await updatePassword(auth.currentUser, values.password);
      await updateDoc(doc(db, "users", profile.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: "ตั้งรหัสผ่านใหม่แล้ว",
        description: "กรุณาเข้าสู่ระบบอีกครั้งด้วยรหัสผ่านใหม่",
      });
      await signOut();
      router.replace("/login/customer");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      toast({ variant: "destructive", title: "ไม่สำเร็จ", description: msg });
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile?.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <PublicHeader />
      <main className="container mx-auto flex flex-1 flex-col items-center px-4 pb-16 pt-24 max-w-md">
        <Card className="w-full border-white/10 bg-slate-900/85 text-white shadow-xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <KeyRound className="h-6 w-6" />
              <CardTitle className="text-xl font-headline">ตั้งรหัสผ่านใหม่</CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              ศูนย์ได้รีเซ็ตรหัสผ่านชั่วคราวให้แล้ว — โปรดตั้งรหัสผ่านของคุณเองด้านล่าง จากนั้นเข้าสู่ระบบใหม่ด้วยรหัสนี้
            </CardDescription>
          </CardHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>รหัสผ่านใหม่</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ยืนยันรหัสผ่านใหม่</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full font-bold" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  ยืนยัน
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </main>
    </div>
  );
}
