"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UserPlus } from "lucide-react";
import { signUpCustomerWithPhone } from "@/firebase/auth";
import { callLookupCustomerForPortalSignup } from "@/lib/callable-customer-portal";
import type { PortalCustomerLookupResult } from "@/lib/callable-customer-portal";
import {
  isLegalFullName,
  isSubstantialIdCardAddress,
  isValidThaiNationalId13,
  normalizeNationalIdDigits,
} from "@/lib/customer-portal-registration-validators";
import { CustomerPortalChrome } from "@/components/customer-portal-chrome";

const verifySchema = z.object({
  phone: z.string().min(9, "กรุณากรอกเบอร์โทรให้ถูกต้อง"),
});

const registerSchema = z
  .object({
    displayName: z
      .string()
      .min(3, "กรุณากรอกชื่อ-นามสกุล")
      .refine((s) => isLegalFullName(s), "กรุณากรอกชื่อและนามสกุลจริงให้ครบ (อย่างน้อย 2 คำ)"),
    nationalId: z
      .string()
      .min(1, "กรุณากรอกเลขบัตรประชาชน")
      .refine(
        (s) => isValidThaiNationalId13(normalizeNationalIdDigits(s)),
        "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก"
      ),
    idCardAddress: z
      .string()
      .min(1, "กรุณากรอกที่อยู่ตามบัตรประชาชน")
      .refine(
        (s) => isSubstantialIdCardAddress(s),
        "กรุณากรอกที่อยู่ตามบัตรให้ครบถ้วน (อย่างน้อยประมาณ 15 ตัวอักษร)"
      ),
    password: z.string().min(6, "รหัสผ่านอย่างน้อย 6 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน กรุณากรอกให้เหมือนกันทั้งสองช่อง",
    path: ["confirmPassword"],
  });

export default function CustomerSignupPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  const [lookup, setLookup] = useState<Extract<PortalCustomerLookupResult, { found: true }> | null>(
    null
  );
  const [phoneLocked, setPhoneLocked] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const verifyForm = useForm<z.infer<typeof verifySchema>>({
    resolver: zodResolver(verifySchema),
    defaultValues: { phone: "" },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      displayName: "",
      nationalId: "",
      idCardAddress: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onVerify(values: z.infer<typeof verifySchema>) {
    setIsVerifying(true);
    try {
      const res = await callLookupCustomerForPortalSignup(values.phone);
      if (!res.found) {
        toast({
          variant: "destructive",
          title: "ไม่พบเบอร์ในระบบ",
          description:
            "การสมัครเปิดให้เฉพาะลูกค้าที่ศูนย์มีข้อมูลไว้แล้วเท่านั้น กรุณาติดต่อสหดีเซล หรือให้เจ้าหน้าที่บันทึกเบอร์ของคุณก่อน",
        });
        return;
      }
      if (res.registration === "ACTIVE") {
        toast({
          variant: "destructive",
          title: "เบอร์นี้ลงทะเบียนแล้ว",
          description: "กรุณาเข้าสู่ระบบแทนการสมัครซ้ำ",
        });
        return;
      }
      if (res.registration === "PENDING") {
        toast({
          variant: "destructive",
          title: "รอการอนุมัติอยู่แล้ว",
          description: "บัญชีนี้อยู่ระหว่างรอเจ้าหน้าที่อนุมัติ กรุณาเข้าสู่ระบบเพื่อดูสถานะ",
        });
        return;
      }
      setLookup(res);
      setPhoneLocked(values.phone.trim());
      registerForm.reset({
        displayName: res.name || "",
        nationalId: res.nationalId ? normalizeNationalIdDigits(res.nationalId) : "",
        idCardAddress: res.idCardAddress || "",
        password: "",
        confirmPassword: "",
      });
      setStep(1);
      toast({ title: "พบข้อมูลลูกค้าในระบบ", description: "กรุณาตรวจสอบและกรอกข้อมูลให้ครบ" });
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast({
        variant: "destructive",
        title: "ตรวจสอบเบอร์ไม่สำเร็จ",
        description: err.message || "เกิดข้อผิดพลาด",
      });
    } finally {
      setIsVerifying(false);
    }
  }

  async function onRegister(values: z.infer<typeof registerSchema>) {
    if (!lookup) return;
    setIsSubmitting(true);
    try {
      await signUpCustomerWithPhone(
        phoneLocked,
        values.password,
        values.displayName,
        values.nationalId,
        values.idCardAddress
      );
      toast({
        title: "ส่งคำขอสมัครแล้ว",
        description: "รอเจ้าหน้าที่อนุมัติที่เมนู Admin — การจัดการ user ลูกค้า",
      });
      router.push("/pending");
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast({
        variant: "destructive",
        title: "สมัครไม่สำเร็จ",
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
            <UserPlus className="h-6 w-6" />
            <CardTitle className="text-2xl font-headline">สมัครสมาชิกลูกค้า</CardTitle>
          </div>
          <CardDescription>
            ใช้เบอร์โทรที่มีในระบบรายชื่อลูกค้าของศูนย์เท่านั้น ต้องกรอกชื่อ-นามสกุลจริง เลขบัตรประชาชน และที่อยู่ตามบัตร —
            หลังสมัครรอผู้ดูแลระบบ (Admin) อนุมัติจึงจะใช้งานได้
          </CardDescription>
        </CardHeader>

        {step === 0 ? (
          <Form {...verifyForm}>
            <form onSubmit={verifyForm.handleSubmit(onVerify)}>
              <CardContent className="space-y-4">
                <FormField
                  control={verifyForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>เบอร์โทรศัพท์ (เบอร์ที่ลงทะเบียนกับศูนย์)</FormLabel>
                      <FormControl>
                        <Input placeholder="0812345678" autoComplete="tel" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full h-11 font-bold" disabled={isVerifying}>
                  {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  ตรวจสอบเบอร์
                </Button>
                <p className="text-sm text-muted-foreground text-center w-full">
                  มีบัญชีแล้ว?{" "}
                  <Link href="/login/customer" className="text-primary font-bold underline">
                    เข้าสู่ระบบ
                  </Link>
                </p>
              </CardFooter>
            </form>
          </Form>
        ) : (
          <Form {...registerForm}>
            <form onSubmit={registerForm.handleSubmit(onRegister)}>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">เบอร์ที่ยืนยันแล้ว: </span>
                  <span className="font-mono font-bold">{phoneLocked}</span>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 ml-2 text-xs"
                    onClick={() => {
                      setStep(0);
                      setLookup(null);
                    }}
                  >
                    เปลี่ยนเบอร์
                  </Button>
                </div>
                <FormField
                  control={registerForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ชื่อและนามสกุลจริง (ตามบัตรประชาชน)</FormLabel>
                      <FormControl>
                        <Input placeholder="เช่น สมชาย ใจดี" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="nationalId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>เลขบัตรประชาชน (บังคับ)</FormLabel>
                      <FormControl>
                        <Input placeholder="13 หลัก" inputMode="numeric" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="idCardAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ที่อยู่ตามบัตรประชาชน (บังคับ)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ตั้งรหัสผ่าน</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ยืนยันรหัสผ่าน</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full h-11 font-bold" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  ส่งคำขอสมัคร
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  หลังกดสมัคร สถานะบัญชีจะเป็น &quot;รออนุมัติ&quot; จนกว่า Admin จะอนุมัติที่เมนูการจัดการ user
                </p>
              </CardFooter>
            </form>
          </Form>
        )}
      </Card>
    </CustomerPortalChrome>
  );
}
