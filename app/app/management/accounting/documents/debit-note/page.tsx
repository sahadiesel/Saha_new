"use client";

import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { DocumentList } from "@/components/document-list";
import { DebitNoteForm } from "@/components/debit-note-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, List, PlusCircle } from "lucide-react";

export default function ManagementDebitNotesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <div className="space-y-6">
        <Tabs defaultValue="list" className="w-full">
          <PageHeader title="ใบเพิ่มหนี้" description="จัดการข้อมูลใบเพิ่มหนี้ (อ้างอิงใบกำกับภาษี)">
            <TabsList className="grid w-full max-w-[400px] grid-cols-2">
              <TabsTrigger value="list" className="flex items-center gap-2">
                <List className="h-4 w-4" /> รายการทั้งหมด
              </TabsTrigger>
              <TabsTrigger value="new" className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4" /> สร้างใบเพิ่มหนี้ใหม่
              </TabsTrigger>
            </TabsList>
          </PageHeader>

          <TabsContent value="list" className="mt-6">
            <DocumentList docType="DEBIT_NOTE" baseContext="accounting" />
          </TabsContent>

          <TabsContent value="new" className="mt-6">
            <DebitNoteForm />
          </TabsContent>
        </Tabs>
      </div>
    </Suspense>
  );
}
