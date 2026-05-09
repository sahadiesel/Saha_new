"use client";

import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { deleteObject, getStorage, ref, uploadBytes } from "firebase/storage";
import { initializeFirebase } from "@/firebase/init";
import { createUserProfile } from "./user";
import { customerAuthEmailFromDocId } from "@/lib/customer-auth-phone";
import {
  callLookupCustomerForPortalSignup,
  callProvisionCustomerPortalProfile,
} from "@/lib/callable-customer-portal";
import {
  isLegalFullName,
  isSubstantialIdCardAddress,
  isValidThaiNationalId13,
  normalizeNationalIdDigits,
} from "@/lib/customer-portal-registration-validators";

export function sanitizeCustomerIdCardDisplayFileName(name: string): string {
  const base = String(name || "")
    .replace(/^.*[/\\]/, "")
    .replace(/[^\w.\u0E00-\u0E7F()\- ]+/g, "")
    .trim()
    .slice(0, 180);
  return base || "id-card.jpg";
}

export async function signUp(email: string, password: string, displayName: string, phone: string) {
  const { auth } = initializeFirebase();
  if (!auth) throw new Error("Auth not initialized");

  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  await updateProfile(user, { displayName });

  await createUserProfile(user.uid, {
    displayName,
    email,
    phone,
    role: "WORKER",
    status: "PENDING",
  });

  return user;
}

/**
 * สมัครลูกค้า: ต้องมีเบอร์ใน customers → Auth (อีเมลสังเคราะห์) → Cloud Function เขียน users/customers (Admin SDK)
 */
export async function signUpCustomerWithPhone(
  phoneRaw: string,
  password: string,
  displayName: string,
  nationalId: string,
  idCardAddress: string,
  idCardJpegBlob: Blob,
  idCardOriginalFileName: string
) {
  const { auth, firebaseApp, storage } = initializeFirebase();
  if (!auth || !firebaseApp || !storage) throw new Error("Auth not initialized");

  const dn = displayName.trim();
  if (!isLegalFullName(dn)) {
    throw new Error("กรุณากรอกชื่อและนามสกุลจริงให้ครบ (อย่างน้อย 2 คำ)");
  }
  const nid = normalizeNationalIdDigits(nationalId);
  if (!isValidThaiNationalId13(nid)) {
    throw new Error("กรุณากรอกเลขบัตรประชาชน 13 หลักให้ถูกต้อง");
  }
  const addr = idCardAddress.trim();
  if (!isSubstantialIdCardAddress(addr)) {
    throw new Error("กรุณากรอกที่อยู่ตามบัตรประชาชนให้ครบถ้วน");
  }
  if (!idCardJpegBlob || idCardJpegBlob.size > 512 * 1024) {
    throw new Error("รูปบัตรประชาชนต้องมีขนาดไม่เกิน 500KB หลังบีบอัด");
  }

  const lookup = await callLookupCustomerForPortalSignup(phoneRaw);
  if (!lookup.found) {
    throw new Error(
      "ไม่พบเบอร์นี้ในรายชื่อลูกค้าของศูนย์ การสมัครเปิดให้เฉพาะลูกค้าที่ศูนย์มีข้อมูลไว้แล้วเท่านั้น กรุณาติดต่อสหดีเซล หรือให้เจ้าหน้าที่บันทึกเบอร์ของคุณในระบบก่อน"
    );
  }
  if (lookup.registration === "ACTIVE") {
    throw new Error("เบอร์นี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ");
  }
  if (lookup.registration === "PENDING") {
    throw new Error("เบอร์นี้อยู่ระหว่างรอการอนุมัติจากศูนย์ กรุณารอแจ้งผลหรือติดต่อเจ้าหน้าที่");
  }

  const canonicalId = lookup.customerId;
  const email = customerAuthEmailFromDocId(canonicalId);

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(cred.user, { displayName: displayName.trim() });

  const storagePath = `customerPortalIdCards/${canonicalId}/${cred.user.uid}/id-card.jpg`;
  const storageRef = ref(storage, storagePath);
  const safeOriginalName = sanitizeCustomerIdCardDisplayFileName(idCardOriginalFileName);

  try {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }
    await cred.user.getIdToken(true);
    await uploadBytes(storageRef, idCardJpegBlob, { contentType: "image/jpeg" });
    await callProvisionCustomerPortalProfile({
      phoneRaw,
      displayName,
      nationalId,
      idCardAddress,
      idCardStoragePath: storagePath,
      idCardImageOriginalName: safeOriginalName,
    });
  } catch (e) {
    try {
      await deleteObject(storageRef);
    } catch {
      /* ignore */
    }
    try {
      await cred.user.delete();
    } catch {
      /* ignore */
    }
    throw e;
  }

  return cred.user;
}
