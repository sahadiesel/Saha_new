"use client";

import { CreditNoteForm } from "@/components/credit-note-form";

export function DebitNoteForm({ onCancel }: { onCancel?: () => void }) {
  return <CreditNoteForm mode="DEBIT_NOTE" onCancel={onCancel} />;
}
