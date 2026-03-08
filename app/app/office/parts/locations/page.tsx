"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, query, orderBy, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { useFirebase, useCollection } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Trash2, MapPin, Save, Edit, Search, Plus, Layers } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";

// Schema for a single location item
const locationItemSchema = z.object({
  name: z.string().optional().default(""),
  zone: z.string().optional().default(""),
}).refine(data => {
    // If either name or zone is filled, the other must be filled too (for specific rows)
    // But we allow empty rows to be skipped during submission
    return (data.name === "" && data.zone === "") || (data.name !== "" && data.zone !== "");
}, {
    message: "กรุณากรอกทั้งชื่อตำแหน่งและโซน",
    path: ["name"]
});

// Schema for bulk adding
const bulkLocationSchema = z.object({
  locations: z.array(locationItemSchema).min(1, "กรุณาเพิ่มอย่างน้อย 1 รายการ"),
});

type BulkLocationFormData = z.infer<typeof bulkLocationSchema>;

// Schema for single editing
const editLocationSchema = z.object({
    name: z.string().min(1, "กรุณากรอกชื่อตำแหน่ง"),
    zone: z.string().min(1, "กรุณาระบุโซน"),
});
type EditLocationFormData = z.infer<typeof editLocationSchema>;

export default function PartLocationsPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [locationToDelete, setLocationToDelete] = useState<PartLocation | null>(null);
  const [editingLocation, setEditingLocation] = useState<PartLocation | null>(null);

  const locationsQuery = useMemo(() => 
    db ? query(collection(db, "partLocations"), orderBy("name", "asc")) : null
  , [db]);

  const { data: locations, isLoading } = useCollection<PartLocation>(locationsQuery);

  // Bulk Form - Initialized with 20 empty rows
  const bulkForm = useForm<BulkLocationFormData>({
    resolver: zodResolver(bulkLocationSchema),
    defaultValues: {
      locations: Array.from({ length: 20 }, () => ({ name: "", zone: "" })),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: bulkForm.control,
    name: "locations",
  });

  // Edit Form
  const editForm = useForm<EditLocationFormData>({
    resolver: zodResolver(editLocationSchema),
    defaultValues: { name: "", zone: "" },
  });

  useEffect(() => {
    if (editingLocation && isEditDialogOpen) {
      editForm.reset({
        name: editingLocation.name,
        zone: editingLocation.zone,
      });
    }
  }, [editingLocation, isEditDialogOpen, editForm]);

  const onBulkSubmit = async (values: BulkLocationFormData) => {
    if (!db || !profile) return;
    
    // Filter out completely empty rows
    const validLocations = values.locations.filter(loc => loc.name?.trim() !== "" || loc.zone?.trim() !== "");
    
    if (validLocations.length === 0) {
        toast({ variant: "destructive", title: "ข้อมูลว่างเปล่า", description: "กรุณากรอกข้อมูลอย่างน้อย 1 แถวค่ะ" });
        return;
    }

    setIsSubmitting(true);
    
    try {
      const batch = writeBatch(db);
      const colRef = collection(db, "partLocations");

      validLocations.forEach((loc) => {
        const newDocRef = doc(colRef);
        batch.set(newDocRef, {
          name: loc.name?.trim(),
          zone: loc.zone?.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      toast({ title: `เพิ่มตำแหน่งใหม่ ${validLocations.length} รายการสำเร็จ` });
      bulkForm.reset({ locations: Array.from({ length: 20 }, () => ({ name: "", zone: "" })) });
      setIsBulkDialogOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "บันทึกไม่สำเร็จ", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onEditSubmit = (values: EditLocationFormData) => {
    if (!db || !profile || !editingLocation) return;
    setIsSubmitting(true);
    
    const docRef = doc(db, "partLocations", editingLocation.id);
    const updateData = {
      ...values,
      updatedAt: serverTimestamp(),
    };

    updateDoc(docRef, updateData)
      .then(() => {
        toast({ title: "ปรับปรุงตำแหน่งสำเร็จ" });
        setIsEditDialogOpen(false);
        setEditingLocation(null);
      })
      .catch(async (error) => {
        const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: updateData,
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => setIsSubmitting(false));
  };

  const handleEdit = (location: PartLocation) => {
    setEditingLocation(location);
    setIsEditDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!db || !locationToDelete) return;
    
    const docRef = doc(db, "partLocations", locationToDelete.id);
    
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
        <div className="flex gap-2">
          <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={isSubmitting} variant="default" className="bg-green-700 hover:bg-green-800">
                <PlusCircle className="mr-2 h-4 w-4" />
                เพิ่มหลายรายการ (Bulk Add 20+)
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0">
              <DialogHeader className="p-6 pb-0">
                <DialogTitle>เพิ่มตำแหน่งชั้นวางทีละหลายรายการ</DialogTitle>
                <DialogDescription>เพิ่มหลายตำแหน่งในครั้งเดียวเพื่อความรวดเร็ว ระบบเตรียมไว้ให้ 20 แถวค่ะ</DialogDescription>
              </DialogHeader>
              <Form {...bulkForm}>
                <form onSubmit={bulkForm.handleSubmit(onBulkSubmit)} className="flex flex-col flex-1 overflow-hidden">
                  <ScrollArea className="flex-1 px-6 py-4">
                    <div className="space-y-4">
                      {fields.map((field, index) => (
                        <div key={field.id} className="flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="pt-2 text-[10px] font-bold text-muted-foreground w-6">#{index + 1}</div>
                          <FormField
                            control={bulkForm.control}
                            name={`locations.${index}.name`}
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl><Input placeholder="ชื่อตำแหน่ง (เช่น A1)" {...field} disabled={isSubmitting} className="h-9 text-sm" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={bulkForm.control}
                            name={`locations.${index}.zone`}
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl><Input placeholder="โซน/พิกัดย่อย" {...field} disabled={isSubmitting} className="h-9 text-sm" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive mt-0.5 h-8 w-8" 
                            onClick={() => remove(index)}
                            disabled={isSubmitting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="mt-6 border-dashed w-full"
                      onClick={() => append({ name: "", zone: "" })}
                      disabled={isSubmitting}
                    >
                      <Plus className="mr-2 h-4 w-4" /> เพิ่มแถวใหม่ (ถ้าต้องการมากกว่า 20)
                    </Button>
                  </ScrollArea>
                  <DialogFooter className="p-6 pt-4 border-t bg-muted/10">
                    <Button variant="outline" type="button" onClick={() => setIsBulkDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      บันทึกข้อมูลทั้งหมด
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Button variant="outline" onClick={() => { setEditingLocation(null); setIsEditDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            เพิ่มทีละรายการ
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ค้นหาตามชื่อ หรือโซน..." 
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Badge variant="secondary" className="h-6">
              <Layers className="mr-1.5 h-3 w-3" /> รวม {locations?.length || 0} ตำแหน่ง
            </Badge>
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
                      <TableCell className="text-center text-muted-foreground font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-primary" />
                          {loc.name}
                        </div>
                      </TableCell>
                      <TableCell>{loc.zone}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                            onClick={() => handleEdit(loc)}
                            disabled={isSubmitting}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setLocationToDelete(loc)}
                            disabled={isSubmitting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขตำแหน่งชั้นวาง</DialogTitle>
            <DialogDescription>แก้ไขรายละเอียดชื่อหรือพิกัดของตำแหน่งนี้</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 py-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ชื่อตำแหน่ง</FormLabel>
                    <FormControl><Input placeholder="ระบุชื่อพิกัดหลัก..." {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="zone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>โซน/พิกัดย่อย</FormLabel>
                    <FormControl><Input placeholder="ระบุตำแหน่งย่อย..." {...field} disabled={isSubmitting} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button variant="outline" type="button" onClick={() => setIsEditDialogOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  บันทึกการแก้ไข
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
