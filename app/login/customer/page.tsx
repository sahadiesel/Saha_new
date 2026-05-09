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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  callSubmitCustomerPasswordResetRequest,
  formatSubmitPasswordResetError,
} from "@/lib/callable-customer-password-reset";
import {
  isValidThaiNationalId13,
  normalizeNationalIdDigits,
} from "@/lib/customer-portal-registration-validators";

const schema = z.object({
  phone: z.string().min(9, "กรุณากรอกเบอร์โทรให้ถูกต้อง"),
  password: z.string().min(6, "รหัสผ่านอย่างน้อย 6 ตัวอักษร"),
});

export default function CustomerLoginPage() {
  const { signIn, signOut, loading, authError } = useAuth();
  const { db, app } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotNationalId, setForgotNationalId] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotDoneMessage, setForgotDoneMessage] = useState<string | null>(null);

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

      if (profileData.mustChangePassword === true) {
        toast({
          title: "เข้าสู่ระบบแล้ว",
          description: "กรุณาตั้งรหัสผ่านใหม่เพื่อความปลอดภัย",
        });
        router.push("/customer/change-password");
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
              <Button
                type="button"
                variant="link"
                className="w-full text-sm text-muted-foreground"
                disabled={isSubmitting || loading}
                onClick={() => {
                  setForgotDoneMessage(null);
                  setForgotNationalId("");
                  setForgotOpen(true);
                }}
              >
                ลืมรหัสผ่าน?
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

      <Dialog open={forgotOpen} onOpenChange={(o) => !forgotBusy && setForgotOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ลืมรหัสผ่าน</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  กรอกเลขบัตรประชาชน 13 หลักให้ตรงกับที่ใช้สมัครพอร์ทัล — ใช้คู่กับ{" "}
                  <strong className="text-foreground">เบอร์โทรในช่องด้านบนของฟอร์มเข้าสู่ระบบ</strong>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          {forgotDoneMessage ? (
            <>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{forgotDoneMessage}</p>
              <DialogFooter>
                <Button type="button" onClick={() => setForgotOpen(false)}>
                  ปิด
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="grid gap-2 py-2">
                <Label htmlFor="forgot-national-id">เลขบัตรประชาชน (13 หลัก)</Label>
                <Input
                  id="forgot-national-id"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="เช่น 1234567890123"
                  value={forgotNationalId}
                  onChange={(e) => setForgotNationalId(e.target.value)}
                  disabled={forgotBusy}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" disabled={forgotBusy} onClick={() => setForgotOpen(false)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  disabled={forgotBusy}
                  onClick={async () => {
                    const phone = form.getValues("phone").trim();
                    if (!phone || phone.length < 9) {
                      toast({
                        variant: "destructive",
                        title: "กรุณากรอกเบอร์โทร",
                        description: "กรอกเบอร์โทรในฟอร์มเข้าสู่ระบบด้านบนก่อนยืนยันคำขอลืมรหัสผ่าน",
                      });
                      return;
                    }
                    const nid = normalizeNationalIdDigits(forgotNationalId);
                    if (!isValidThaiNationalId13(nid)) {
                      toast({
                        variant: "destructive",
                        title: "เลขบัตรไม่ถูกต้อง",
                        description: "กรุณากรอกเลขบัตรประชาชน 13 หลัก",
                      });
                      return;
                    }
                    if (!app) {
                      toast({ variant: "destructive", title: "ระบบไม่พร้อม", description: "ลองรีเฟรชหน้าแล้วใหม่" });
                      return;
                    }
                    setForgotBusy(true);
                    try {
                      await callSubmitCustomerPasswordResetRequest(app, { phone, nationalId: nid });
                      setForgotDoneMessage(
                        "กรุณารอการติดต่อกลับจากทางศูนย์บริการภายใน 5 วันทำการ"
                      );
                    } catch (e: unknown) {
                      toast({
                        variant: "destructive",
                        title: "ไม่สามารถส่งคำขอได้",
                        description: formatSubmitPasswordResetError(e),
                      });
                    } finally {
                      setForgotBusy(false);
                    }
                  }}
                >
                  {forgotBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  ยืนยัน
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CustomerPortalChrome>
  );
}
