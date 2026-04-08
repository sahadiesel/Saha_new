"use client";

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { collection, addDoc, serverTimestamp, query, orderBy, type Query } from "firebase/firestore";
import { useFirebase, useCollection } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Share2, Search, MessageSquarePlus, History, Wrench } from "lucide-react";
import type { CarRepairExperience } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

const experienceSchema = z.object({
  brand: z.string().min(1, "กรุณาระบุยี่ห้อ"),
  model: z.string().min(1, "กรุณาระบุรุ่นรถ"),
  symptoms: z.string().min(1, "กรุณาระบุอาการที่เจอ"),
  solution: z.string().min(1, "กรุณาระบุวิธีแก้ปัญหา"),
});

export default function ShareExperiencePage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const experiencesQuery = useMemo(() => 
    db ? query(collection(db, "carRepairExperiences"), orderBy("createdAt", "desc")) : null
  , [db]);

  const { data: experiences, isLoading } = useCollection<CarRepairExperience>(
    experiencesQuery as Query<CarRepairExperience> | null
  );

  const form = useForm<z.infer<typeof experienceSchema>>({
    resolver: zodResolver(experienceSchema),
    defaultValues: { brand: "", model: "", symptoms: "", solution: "" },
  });

  const onSubmit = async (values: z.infer<typeof experienceSchema>) => {
    if (!db || !profile) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "carRepairExperiences"), {
        ...values,
        createdAt: serverTimestamp(),
        createdByUid: profile.uid,
        createdByName: profile.displayName,
      });
      toast({ title: "บันทึกประสบการณ์สำเร็จ", description: "ข้อมูลนี้จะเป็นประโยชน์ต่อเพื่อนร่วมงานและระบบ AI ค่ะ" });
      form.reset();
    } catch (e: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    if (!experiences) return [];
    const q = searchTerm.toLowerCase();
    return experiences.filter(e => 
      e.brand.toLowerCase().includes(q) || 
      e.model.toLowerCase().includes(q) || 
      e.symptoms.toLowerCase().includes(q)
    );
  }, [experiences, searchTerm]);

  return (
    <div className="space-y-8">
      <PageHeader 
        title="แชร์ประสบการณ์การซ่อม" 
        description="บันทึกความรู้ อาการเสียที่พบยาก และวิธีแก้ไข เพื่อเป็นฐานข้อมูลให้ทีมช่างและ AI" 
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-1 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
              บันทึกเคสใหม่
            </CardTitle>
            <CardDescription>เติมความรู้เข้าสู่ระบบ</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="brand" render={({ field }) => (
                    <FormItem><FormLabel>ยี่ห้อ</FormLabel><FormControl><Input placeholder="เช่น Toyota" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="model" render={({ field }) => (
                    <FormItem><FormLabel>รุ่นรถ</FormLabel><FormControl><Input placeholder="เช่น Revo 2020" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="symptoms" render={({ field }) => (
                  <FormItem><FormLabel>อาการที่พบ</FormLabel><FormControl><Textarea placeholder="ระบุอาการเสีย หรือรหัส Error..." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="solution" render={({ field }) => (
                  <FormItem><FormLabel>วิธีการแก้ไข</FormLabel><FormControl><Textarea placeholder="อธิบายขั้นตอนการแก้ปัญหาที่ได้ผล..." rows={5} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
                  แชร์เข้าสู่ระบบ
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> คลังประสบการณ์</CardTitle>
                <CardDescription>ประวัติเคสที่เคยบันทึกไว้ในร้าน</CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="ค้นหายี่ห้อ หรืออาการ..." 
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-32">วันที่/ผู้บันทึก</TableHead>
                      <TableHead className="w-40">รถ</TableHead>
                      <TableHead>อาการเสีย</TableHead>
                      <TableHead>วิธีแก้</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length > 0 ? filtered.map(e => (
                      <TableRow key={e.id} className="align-top">
                        <TableCell className="text-[10px]">
                          <p className="font-bold">{safeFormat(e.createdAt, "dd/MM/yy")}</p>
                          <p className="text-muted-foreground truncate">{e.createdByName}</p>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="outline" className="mr-1">{e.brand}</Badge>
                          <span className="font-medium">{e.model}</span>
                        </TableCell>
                        <TableCell className="text-sm whitespace-pre-wrap">{e.symptoms}</TableCell>
                        <TableCell className="text-sm whitespace-pre-wrap text-green-700 bg-green-50/30 font-medium">{e.solution}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground italic">ไม่พบข้อมูลประสบการณ์ที่ค้นหา</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
