"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { collection, query, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, Search, Edit, Trash2, FileText, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { QuotationTemplate } from "@/lib/types";
import { safeFormat } from "@/lib/date-utils";

export const dynamic = 'force-dynamic';

export default function QuotationTemplatesPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [templateToDelete, setTemplateToDelete] = useState<QuotationTemplate | null>(null);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "quotationTemplates"));
    return onSnapshot(q, (snap) => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as QuotationTemplate)));
      setLoading(false);
    });
  }, [db]);

  const filteredTemplates = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = q ? templates.filter(t => t.name.toLowerCase().includes(q)) : templates;
    return [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "th", { sensitivity: "base", numeric: true })
    );
  }, [templates, searchTerm]);

  const handleDelete = async () => {
    if (!db || !templateToDelete) return;
    try {
      await deleteDoc(doc(db, "quotationTemplates", templateToDelete.id));
      toast({ title: "ลบ Template สำเร็จ" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "ลบไม่สำเร็จ", description: e.message });
    } finally {
      setTemplateToDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Template ใบเสนอราคา" description="จัดการชุดรายการสินค้ามาตรฐานสำหรับทำใบเสนอราคา">
        <Button asChild>
          <Link href="/app/office/documents/quotation/templates/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            สร้าง Template ใหม่
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ค้นหาชื่อ Template..."
              className="pl-8"
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
                  <TableHead className="h-7">ชื่อ Template</TableHead>
                  <TableHead className="h-7">จำนวนรายการ</TableHead>
                  <TableHead className="h-7">อัปเดตล่าสุด</TableHead>
                  <TableHead className="h-7 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="mx-auto animate-spin" /></TableCell></TableRow>
                ) : filteredTemplates.length > 0 ? (
                  filteredTemplates.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="py-2 font-medium">{t.name}</TableCell>
                      <TableCell className="py-2">{t.items.length} รายการ</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{safeFormat(t.updatedAt, "dd/MM/yyyy HH:mm")}</TableCell>
                      <TableCell className="py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild><Link href={`/app/office/documents/quotation/templates/${t.id}`}><Edit className="mr-2 h-4 w-4"/>แก้ไข</Link></DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setTemplateToDelete(t)}><Trash2 className="mr-2 h-4 w-4"/>ลบ</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">ยังไม่มี Template</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!templateToDelete} onOpenChange={(o) => !o && setTemplateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ Template?</AlertDialogTitle>
            <AlertDialogDescription>Template "{templateToDelete?.name}" จะถูกลบออกถาวร</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">ยืนยันการลบ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
