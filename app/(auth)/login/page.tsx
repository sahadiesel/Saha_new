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
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function LoginPage() {
  const { signIn, signOut, loading, authError } = useAuth();
  const { db } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    if (!db) return;
    setIsSubmitting(true);
    try {
      const userCredential = await signIn(values.email, values.password);
      const user = userCredential.user;

      // Direct check for status before allowing entry
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      
      if (!profileSnap.exists()) {
        await signOut();
        toast({
          variant: "destructive",
          title: "Login Denied",
          description: "ไม่พบข้อมูลโปรไฟล์ของคุณในระบบ กรุณาติดต่อแอดมิน",
        });
        return;
      }

      const profileData = profileSnap.data();
      if (profileData.status !== 'ACTIVE') {
        await signOut();
        toast({
          variant: "destructive",
          title: "บัญชียังไม่อนุมัติ",
          description: "บัญชีของคุณรอการอนุมัติ หรือถูกระงับการใช้งาน กรุณาติดต่อแอดมิน",
        });
        return;
      }

      toast({ title: "Login Successful" });
      // Always redirect to Home page after successful login as requested
      router.push("/"); 
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: error.message || "An unknown error occurred.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-headline">ลงชื่อเข้าใช้</CardTitle>
        <CardDescription>
          กรุณากรอกอีเมลและรหัสผ่านเพื่อเข้าใช้งานระบบ
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {(authError && !isSubmitting) && (
              <Alert variant="destructive">
                <AlertTitle>Authentication Error</AlertTitle>
                <AlertDescription>
                  {authError.message || "Could not initialize authentication. Please refresh and try again."}
                </AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="m@example.com" {...field} />
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
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/login" // TODO: Implement forgot password page
                      className="text-xs text-primary hover:underline font-medium"
                      onClick={(e) => {
                        e.preventDefault();
                        toast({ title: "ระบบกู้คืนรหัสผ่าน", description: "กรุณาติดต่อแอดมินแผนกบุคคลเพื่อรีเซ็ตรหัสผ่านค่ะ" });
                      }}
                    >
                      ลืมรหัสผ่าน?
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full h-11 text-base font-bold" disabled={isSubmitting || loading}>
              {isSubmitting || loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              เข้าสู่ระบบ (Login)
            </Button>
            
            <div className="flex flex-col items-center gap-3 text-sm w-full">
              <div className="text-muted-foreground">
                ยังไม่มีบัญชีผู้ใช้?{" "}
                <Link href="/signup" className="underline text-primary font-bold">
                  สมัครสมาชิก (Sign up)
                </Link>
              </div>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
