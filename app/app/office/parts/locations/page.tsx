
"use client";

import { useState, useMemo } from "react";
import { collection, query, orderBy, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useFirebase, useCollection } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, PlusCircle, Trash2, MapPin, Save, AlertCircle, Search } from "lucide-react";
import type { PartLocation } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

const locationSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อตำแหน่ง (เช่น ชั้นวาง A)"),
  zone: z.string().min(1, "กรุณาระบุโซนหรือพิกัด (เช่น โซน 1 แถว 2)"),
});

type LocationFormData = z.infer<typeof locationSchema>;

export default function PartLocationsPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [locationToDelete, setLocationToDelete] = useState<PartLocation | null>(null);

  const locationsQuery = useMemo(() => 
    db ? query(collection(db, "partLocations"), orderBy("name", "asc")) : null
  , [db]);

  const { data: locations, isLoading } = useCollection<PartLocation>(locationsQuery);

  const form = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: "", zone: "" },
  });

  const onSubmit = (values: LocationFormData) => {
    if (!db || !profile) return;
    setIsSubmitting(true);
    
    const colRef = collection(db, "partLocations");
    const data = {
      ...values,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Use non-blocking pattern
    addDoc(colRef, data)
      .then(() => {
        toast({ title: "เพิ่มตำแหน่งสำเร็จ" });
        form.reset();
        setIsDialogOpen(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: data,
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const confirmDelete = () => {
    if (!db || !locationToDelete) return;
    
    const docRef = doc(db, "partLocations", locationToDelete.id);
    
    // Use non-blocking pattern
    deleteDoc(docRef)
      .then(() => {
        toast({ title: "ลบตำแหน่งสำเร็จ" });
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setLocationToDelete(null);
      });
  };

  const filteredLocations = useMemo(() => {
    if (!locations) return [];
    if (!searchTerm) return locations;
    const q = searchTerm.toLowerCase();
    return locations.filter(l => 
      l.name.toLowerCase().includes(q) || 
      l.zone.toLowerCase().includes(q)
    );
  }, [locations, searchTerm]);

  return (
    <div className="space-y-6">
      <PageHeader title="จัดการชั้นวางสินค้า" description="กำหนดพิกัดตำแหน่งการจัดเก็บอะไหล่ในคลังเพื่อให้ค้นหาได้ง่ายขึ้น">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={isSubmitting}>
              <PlusCircle className="mr-2 h-4 w-4" />
              เพิ่มตำแหน่งใหม่
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>สร้างตำแหน่งชั้นวางใหม่</DialogTitle>
              <DialogDescription>ระบุรายละเอียดพิกัดที่เก็บสินค้าในโกดัง</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ชื่อตำแหน่ง (เช่น ชั้นวาง A, ตู้เหล็ก)</FormLabel>
                      <FormControl><Input placeholder="ระบุชื่อพิกัดหลัก..." {...field} disabled={isSubmitting} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="zone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>โซน/พิกัดย่อย (เช่น โซน 1 แถว 2 ชั้น 3)</FormLabel>
                      <FormControl><Input placeholder="ระบุตำแหน่งย่อย..." {...field} disabled={isSubmitting} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="pt-4">
                  <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    บันทึกตำแหน่ง
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามชื่อ หรือโซน..." 
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>ชื่อตำแหน่ง</TableHead>
                  <TableHead>โซน/พิกัด</TableHead>
                  <TableHead className="text-right w-24">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="mx-auto animate-spin" /></TableCell></TableRow>
                ) : filteredLocations.length > 0 ? (
                  filteredLocations.map((loc, idx) => (
                    <TableRow key={loc.id}>
                      <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-primary" />
                          {loc.name}
                        </div>
                      </TableCell>
                      <TableCell>{loc.zone}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setLocationToDelete(loc)}
                          disabled={isSubmitting}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground italic">
                      ไม่พบข้อมูลตำแหน่งชั้นวาง
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!locationToDelete} onOpenChange={(o) => !o && setLocationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบตำแหน่ง?</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการลบตำแหน่ง "{locationToDelete?.name}" ใช่หรือไม่? ข้อมูลนี้จะถูกลบออกถาวร
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">ยืนยันการลบ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
