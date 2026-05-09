"use client";

import type { FirebaseApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

function isFirebaseLikeError(e: unknown): e is { code: string; message?: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}

export function formatSubmitPasswordResetError(error: unknown): string {
  if (isFirebaseLikeError(error)) {
    const code = error.code;
    if (code === "functions/not-found") {
      return "ยังไม่ deploy ฟังก์ชันบนเซิร์ฟเวอร์ — แจ้งผู้ดูแลให้รัน firebase deploy --only functions";
    }
    if (code === "functions/already-exists") {
      return typeof error.message === "string" && error.message
        ? error.message
        : "มีคำขอรีเซ็ตรหัสผ่านค้างอยู่แล้ว";
    }
    const msg = typeof error.message === "string" ? error.message : "";
    if (msg) return msg;
    return code;
  }
  if (error instanceof Error) return error.message;
  return "ส่งคำขอไม่สำเร็จ";
}

export async function callSubmitCustomerPasswordResetRequest(
  firebaseApp: FirebaseApp,
  params: { phone: string; nationalId: string }
): Promise<void> {
  const fn = httpsCallable<{ phone: string; nationalId: string }, { ok: boolean }>(
    getFunctions(firebaseApp, "us-central1"),
    "submitCustomerPasswordResetRequest"
  );
  await fn(params);
}

export async function callAdminResetCustomerPasswordAfterForgot(
  firebaseApp: FirebaseApp,
  params: { requestDocId: string; newPassword: string }
): Promise<void> {
  const fn = httpsCallable<{ requestDocId: string; newPassword: string }, { ok: boolean }>(
    getFunctions(firebaseApp, "us-central1"),
    "adminResetCustomerPasswordAfterForgot"
  );
  await fn(params);
}
