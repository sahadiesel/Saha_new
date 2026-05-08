"use client";

import type { FirebaseApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

export type CustomerPortalQuotationDecision = "APPROVE" | "NO_REPAIR" | "REQUEST_CHANGES";
export type CustomerPortalQuotationMessageVariant = "jobPage" | "documentPage";

function isFirebaseLikeError(e: unknown): e is { code: string; message?: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}

export function formatCustomerPortalQuotationDecisionError(error: unknown): string {
  if (isFirebaseLikeError(error)) {
    const code = error.code;
    if (code === "functions/not-found") {
      return "ยังไม่ deploy ฟังก์ชันบนเซิร์ฟเวอร์ — แจ้งผู้ดูแลให้รัน firebase deploy --only functions";
    }
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จชั่วคราว กรุณาลองใหม่";
    }
    const msg = typeof error.message === "string" ? error.message : "";
    if (msg) return msg;
    return code;
  }
  if (error instanceof Error) return error.message;
  return "ดำเนินการไม่สำเร็จ";
}

export async function callCustomerPortalQuotationDecision(
  firebaseApp: FirebaseApp,
  params: {
    jobId: string;
    decision: CustomerPortalQuotationDecision;
    messageVariant?: CustomerPortalQuotationMessageVariant;
  }
): Promise<void> {
  const fn = httpsCallable<
    { jobId: string; decision: string; messageVariant?: string },
    { ok: boolean }
  >(getFunctions(firebaseApp, "us-central1"), "customerPortalQuotationDecision");
  await fn({
    jobId: params.jobId,
    decision: params.decision,
    messageVariant: params.messageVariant ?? "jobPage",
  });
}
