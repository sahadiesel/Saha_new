"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/context/auth-context";
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, User } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { customerAuthEmailFromDocId } from "@/lib/customer-auth-phone";
import { callLookupCustomerForPortalSignup } from "@/lib/callable-customer-portal";
import { CustomerPortalChrome } from "@/components/customer-portal-chrome";

const schema = z.object({
  phone: z.string().min(9, "กรุณากรอกเบอร์โทรให้ถูกต้อง"),
  password: z.string().min(6, "รหัสผ่านอย่างน้อย 6 ตัวอักษร"),
});

export default function CustomerLoginPage() {
  const { signIn, signOut, loading, authError } = useAuth();
  const { db } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { phone: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    if (!db) return;
    setIsSubmitting(true);
    try {
      const lookup = await callLookupCustomerForPortalSignup(values.phone);
      if (!lookup.found) {
        toast({
          variant: "destructive",
          title: "ไม่พบเบอร์ในระบบลูกค้า",
          description:
            "เบอร์นี้ยังไม่มีในรายชื่อของศูนย์ กรุณาติดต่อสหดีเซล หรือให้เจ้าหน้าที่บันทึกข้อมูลของคุณก่อน",
        });
        return;
      }
      if (lookup.registration === "NONE") {
        toast({
          variant: "destructive",
          title: "ยังไม่ได้สมัครพอร์ทัล",
          description: "กรุณาสมัครสมาชิกลูกค้าก่อน แล้วรอเจ้าหน้าที่อนุมัติ",
        });
        return;
      }

      const email = customerAuthEmailFromDocId(lookup.customerId);
      const userCredential = await signIn(email, values.password);
      const user = userCredential.user;
      const profileSnap = await getDoc(doc(db, "users", user.uid));

      if (!profileSnap.exists()) {
        await signOut();
        toast({
          variant: "destructive",
          title: "ไม่พบบัญชีในระบบ",
          description: "ไม่มีข้อมูลสมาชิกของคุณ กรุณาสมัครสมาชิกลูกค้าหรือติดต่อศูนย์บริการ",
        });
        return;
      }

      const profileData = profileSnap.data();
      if (profileData.role !== "CUSTOMER") {
        await signOut();
        toast({
          variant: "destructive",
          title: "บัญชีนี้ไม่ใช่บัญชีลูกค้า",
          description: "พนักงานกรุณาเข้าสู่ระบบที่หน้า /login",
        });
        return;
      }

      if (profileData.status === "PENDING") {
        toast({
          title: "เข้าสู่ระบบแล้ว",
          description: "บัญชีของคุณรอการอนุมัติจากศูนย์",
        });
        router.push("/pending");
        return;
      }

      if (profileData.status !== "ACTIVE") {
        await signOut();
        toast({
          variant: "destructive",
          title: "บัญชียังไม่พร้อมใช้งาน",
          description: "บัญชีถูกระงับ กรุณาติดต่อศูนย์บริการ",
        });
        return;
      }

      toast({ title: "เข้าสู่ระบบสำเร็จ" });
      router.push("/customer");
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast({
        variant: "destructive",
        title: "เข้าสู่ระบบไม่สำเร็จ",
        description: err.message || "เกิดข้อผิดพลาด",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CustomerPortalChrome>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <User className="h-6 w-6" />
            <CardTitle className="text-2xl font-headline">ลูกค้า — เข้าสู่ระบบ</CardTitle>
          </div>
          <CardDescription>
            ใช้เบอร์โทรและรหัสผ่านที่ตั้งไว้ตอนสมัครสมาชิกลูกค้า
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {authError && !isSubmitting && (
                <Alert variant="destructive">
                  <AlertTitle>การเชื่อมต่อ</AlertTitle>
                  <AlertDescription>
                    {authError.message || "ไม่สามารถเริ่มระบบยืนยันตัวตนได้ กรุณารีเฟรชหน้าแล้วลองใหม่"}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>เบอร์โทรศัพท์</FormLabel>
                    <FormControl>
                      <Input placeholder="0812345678" autoComplete="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>รหัสผ่าน</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full h-11 text-base font-bold" disabled={isSubmitting || loading}>
                {isSubmitting || loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                เข้าสู่ระบบ
              </Button>
              <p className="text-sm text-muted-foreground text-center w-full">
                ยังไม่มีบัญชี?{" "}
                <Link href="/signup/customer" className="text-primary font-bold underline">
                  สมัครสมาชิกลูกค้า
                </Link>
              </p>
              <p className="text-xs text-muted-foreground text-center w-full">
                พนักงาน{" "}
                <Link href="/login" className="underline font-medium text-foreground">
                  เข้าสู่ระบบที่นี่
                </Link>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </CustomerPortalChrome>
  );
}
