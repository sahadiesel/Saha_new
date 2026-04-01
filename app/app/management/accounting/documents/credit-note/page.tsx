"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DocumentList } from "@/components/document-list";
import { CreditNoteForm } from "@/components/credit-note-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, List, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function CreditNoteTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "new" ? "new" : "list";

  const replaceTab = (next: "list" | "new") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "new") params.set("tab", "new");
    else params.delete("tab");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => replaceTab(v === "new" ? "new" : "list")} className="w-full">
        <div className={cn("flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8")}>
          <div className="grid gap-1">
            <h1 className="font-headline text-3xl md:text-4xl font-bold tracking-tighter">ใบลดหนี้</h1>
            <p className="text-muted-foreground">จัดการข้อมูลใบลดหนี้ (อ้างอิงใบกำกับภาษี)</p>
          </div>
          <TabsList className="grid h-auto w-full max-w-[400px] shrink-0 grid-cols-2 p-1">
            <TabsTrigger value="list" type="button" className="flex items-center gap-2">
              <List className="h-4 w-4" /> รายการทั้งหมด
            </TabsTrigger>
            <TabsTrigger value="new" type="button" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> สร้างใบลดหนี้ใหม่
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="list" className="mt-0">
          <DocumentList docType="CREDIT_NOTE" baseContext="accounting" />
        </TabsContent>

        <TabsContent value="new" className="mt-0">
          <CreditNoteForm onCancel={() => replaceTab("list")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ManagementCreditNotesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>}>
      <CreditNoteTabs />
    </Suspense>
  );
}
