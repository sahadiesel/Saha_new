"use client";

import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { initializeFirebase } from "@/firebase/init";
import { createUserProfile } from "./user";
import { customerAuthEmailFromDocId } from "@/lib/customer-auth-phone";
import { callLookupCustomerForPortalSignup } from "@/lib/callable-customer-portal";
import { dedupePhoneList } from "@/lib/customer-utils";
import {
  isLegalFullName,
  isSubstantialIdCardAddress,
  isValidThaiNationalId13,
  normalizeNationalIdDigits,
} from "@/lib/customer-portal-registration-validators";

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
 * สมัครลูกค้า: ต้องมีเบอร์ใน customers แล้ว → สร้างบัญชีด้วยอีเมลสังเคราะห์ → รอ Admin อนุมัติ (status PENDING)
 */
export async function signUpCustomerWithPhone(
  phoneRaw: string,
  password: string,
  displayName: string,
  nationalId: string,
  idCardAddress: string
) {
  const { auth, firestore } = initializeFirebase();
  if (!auth || !firestore) throw new Error("Auth not initialized");

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

  const existingSnap = await getDoc(doc(firestore, "customers", canonicalId));
  const prev = existingSnap.exists() ? existingSnap.data() : {};

  const mergedPhones = dedupePhoneList([
    ...(Array.isArray(prev.phones) ? (prev.phones as string[]) : []),
    ...(prev.phone ? [String(prev.phone)] : []),
    canonicalId,
    phoneRaw,
  ]);

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  await updateProfile(cred.user, { displayName: displayName.trim() });

  try {
    await setDoc(doc(firestore, "users", uid), {
      displayName: displayName.trim(),
      email,
      phone: canonicalId,
      role: "CUSTOMER",
      status: "PENDING",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      doc(firestore, "customers", canonicalId),
      {
        name: displayName.trim(),
        phone: canonicalId,
        phones: mergedPhones.length > 0 ? mergedPhones : [canonicalId],
        nationalId: nid,
        idCardAddress: addr,
        authUid: uid,
        updatedAt: serverTimestamp(),
        ...(existingSnap.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  } catch (e) {
    try {
      await cred.user.delete();
    } catch {
      /* ignore */
    }
    throw e;
  }

  return cred.user;
}
