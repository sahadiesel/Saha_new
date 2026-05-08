"use client";

import type { FirebaseApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

function isFirebaseLikeError(e: unknown): e is { code: string; message?: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}

export function formatJobCustomerChatCallableError(error: unknown): string {
  if (isFirebaseLikeError(error)) {
    const code = error.code;
    if (code === "functions/not-found") {
      return "ยังไม่ deploy ฟังก์ชันแชตบนเซิร์ฟเวอร์ — แจ้งผู้ดูแลให้รัน firebase deploy --only functions";
    }
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จชั่วคราว กรุณาลองใหม่";
    }
    const msg = typeof error.message === "string" ? error.message : "";
    if (msg) return msg;
    return code;
  }
  if (error instanceof Error) return error.message;
  return "ส่งข้อความไม่สำเร็จ";
}

export async function callPostJobCustomerChatMessage(
  firebaseApp: FirebaseApp,
  jobId: string,
  text: string
): Promise<void> {
  const fn = httpsCallable<{ jobId: string; text: string }, { ok: boolean }>(
    getFunctions(firebaseApp, "us-central1"),
    "postJobCustomerChatMessage"
  );
  await fn({ jobId, text });
}
