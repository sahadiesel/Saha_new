"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, Trash2, Tags, Save } from "lucide-react";
import type { PartCategory } from "@/lib/types";
import type { WithId } from "@/firebase";
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

export default function PartCategoriesPage() {
  const { db } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [categories, setCategories] = useState<WithId<PartCategory>[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<WithId<PartCategory> | null>(null);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "partCategories"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<PartCategory>)));
      setLoading(false);
    }, (error) => {
      console.error("Error loading categories:", error);
      toast({ variant: "destructive", title: "โหลดข้อมูลไม่สำเร็จ", description: error.message });
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, toast]);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !newCategoryName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const exists = categories.find(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
      if (exists) {
        toast({ variant: "destructive", title: "ชื่อหมวดหมู่ซ้ำ", description: "มีหมวดหมู่นี้อยู่ในระบบแล้วค่ะ" });
        setIsSubmitting(false);
        return;
      }

      await addDoc(collection(db, "partCategories"), {
        name: newCategoryName.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: "เพิ่มหมวดหมู่สำเร็จ" });
      setNewCategoryName("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "เพิ่มไม่สำเร็จ", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!db || !categoryToDelete) return;
    try {
      await deleteDoc(doc(db, "partCategories", categoryToDelete.id));
      toast({ title: "ลบหมวดหมู่สำเร็จ" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: error.message });
    } finally {
      setCategoryToDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="จัดการหมวดหมู่อะไหล่" description="กำหนดรายการหมวดหมู่เพื่อใช้ในการจัดกลุ่มสินค้าและอะไหล่" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PlusCircle className="h-4 w-4 text-primary" />
              เพิ่มหมวดหมู่ใหม่
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div className="space-y-2">
                <Input
                  placeholder="ชื่อหมวดหมู่ (เช่น น้ำมันเครื่อง, กรอง)"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <Button type="submit" className="w-full" disabled={!newCategoryName.trim() || isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                บันทึกหมวดหมู่
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="h-4 w-4 text-primary" />
              รายการหมวดหมู่ทั้งหมด
            </CardTitle>
            <CardDescription>แสดงรายการที่กำหนดไว้ในระบบ</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อหมวดหมู่</TableHead>
                    <TableHead className="text-right w-24">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={2} className="h-24 text-center"><Loader2 className="mx-auto animate-spin" /></TableCell></TableRow>
                  ) : categories.length > 0 ? (
                    categories.map(category => (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setCategoryToDelete(category)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center text-muted-foreground italic">
                        ยังไม่มีการกำหนดหมวดหมู่
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!categoryToDelete} onOpenChange={(o) => !o && setCategoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบหมวดหมู่?</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการลบหมวดหมู่ "{categoryToDelete?.name}" ใช่หรือไม่? การลบจะไม่มีผลกับอะไหล่ที่เคยเลือกหมวดหมู่ไว้แล้ว แต่จะไม่มีให้เลือกในรายการใหม่
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
