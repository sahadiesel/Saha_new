"use client";

import { getFunctions, httpsCallable } from "firebase/functions";
import { initializeFirebase } from "@/firebase/init";

function isFirebaseLikeError(e: unknown): e is { code: string; message?: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}

/** แปลง error จาก httpsCallable เป็นข้อความที่ผู้ใช้เข้าใจ */
export function formatCustomerPortalCallableError(error: unknown): string {
  if (isFirebaseLikeError(error)) {
    const code = error.code;
    if (code === "functions/not-found") {
      return "ยังไม่พบฟังก์ชันตรวจสอบเบอร์บนเซิร์ฟเวอร์ กรุณาให้ผู้ดูแลรัน deploy Cloud Functions (lookupCustomerForPortalSignup) ให้ตรงโปรเจกต์ Firebase";
    }
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จชั่วคราว กรุณาลองใหม่";
    }
    if (code === "functions/permission-denied" || code === "permission-denied") {
      return "ไม่ได้รับอนุญาตให้เรียกระบบบันทึกข้อมูล — แจ้งผู้ดูแลให้ deploy Functions แล้วตั้ง invoker เป็น public สำหรับ lookupCustomerForPortalSignup และ provisionCustomerPortalProfile";
    }
    const msg = typeof error.message === "string" ? error.message : "";
    if (/missing or insufficient permissions/i.test(msg)) {
      return "ไม่มีสิทธิ์เขียนข้อมูล — มักเกิดจากยังไม่ deploy provisionCustomerPortalProfile หรือ Cloud Run บล็อกการเรียกฟังก์ชัน (ต้องตั้ง invoker public) หรือ token เข้า Firestore ยังไม่พร้อมหลังสมัคร กรุณารีเฟรชแล้วลองใหม่";
    }
    if (msg && msg !== "internal" && msg !== "INTERNAL") {
      return msg;
    }
    if (code === "functions/internal") {
      return "ระบบขัดข้อง (internal) — มักเกิดจากยังไม่ deploy Functions หรือ Cloud Run ไม่อนุญาตให้เรียกแบบไม่ล็อกอิน แจ้งผู้ดูแลตรวจสอบ";
    }
    return msg || code;
  }
  if (error instanceof Error) return error.message;
  return "เกิดข้อผิดพลาดไม่ทราบสาเหตุ";
}

export type PortalCustomerLookupResult =
  | { found: false }
  | {
      found: true;
      customerId: string;
      name: string;
      nationalId: string;
      idCardAddress: string;
      registration: "NONE" | "PENDING" | "ACTIVE";
    };

export async function callLookupCustomerForPortalSignup(phone: string): Promise<PortalCustomerLookupResult> {
  const { firebaseApp } = initializeFirebase();
  if (!firebaseApp) throw new Error("ไม่สามารถเชื่อมต่อระบบได้ กรุณารีเฟรชหน้า");

  const fn = httpsCallable<{ phone: string }, PortalCustomerLookupResult>(
    getFunctions(firebaseApp, "us-central1"),
    "lookupCustomerForPortalSignup"
  );
  try {
    const res = await fn({ phone: phone.trim() });
    return res.data;
  } catch (e) {
    throw new Error(formatCustomerPortalCallableError(e));
  }
}

/** หลังสร้าง Firebase Auth แล้ว — บันทึก users + customers บนเซิร์ฟเวอร์ (Admin SDK) */
export async function callProvisionCustomerPortalProfile(params: {
  phoneRaw: string;
  displayName: string;
  nationalId: string;
  idCardAddress: string;
}): Promise<void> {
  const { firebaseApp } = initializeFirebase();
  if (!firebaseApp) throw new Error("ไม่สามารถเชื่อมต่อระบบได้ กรุณารีเฟรชหน้า");

  const fn = httpsCallable<
    { phoneRaw: string; displayName: string; nationalId: string; idCardAddress: string },
    { ok: boolean }
  >(getFunctions(firebaseApp, "us-central1"), "provisionCustomerPortalProfile");
  try {
    await fn({
      phoneRaw: params.phoneRaw.trim(),
      displayName: params.displayName.trim(),
      nationalId: params.nationalId.trim(),
      idCardAddress: params.idCardAddress.trim(),
    });
  } catch (e) {
    throw new Error(formatCustomerPortalCallableError(e));
  }
}

export async function callRejectPortalCustomerRegistration(
  targetUid: string,
  customerId: string
): Promise<void> {
  const { firebaseApp } = initializeFirebase();
  if (!firebaseApp) throw new Error("ไม่สามารถเชื่อมต่อระบบได้");

  const fn = httpsCallable<{ targetUid: string; customerId: string }, { ok: boolean }>(
    getFunctions(firebaseApp, "us-central1"),
    "rejectPortalCustomerRegistration"
  );
  await fn({ targetUid, customerId });
}
