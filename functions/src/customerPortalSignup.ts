import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  phoneSearchTokens,
  customerAuthEmailFromDocId,
  dedupePhoneList,
  normalizePhoneDigits,
} from "./phone-utils";

function isLegalFullName(displayName: string): boolean {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}

function isValidThaiNationalId13(digits: string): boolean {
  return /^[0-9]{13}$/.test(digits);
}

function isSubstantialIdCardAddress(addr: string): boolean {
  return addr.trim().length >= 15;
}

type CustomerDoc = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

async function collectCustomerCandidates(tokens: string[]): Promise<CustomerDoc[]> {
  const db = getFirestore();
  const byId = new Map<string, CustomerDoc>();

  for (const t of tokens) {
    if (!t || t.length < 9) continue;
    const d = await db.collection("customers").doc(t).get();
    if (d.exists) {
      byId.set(d.id, d);
    }
  }

  for (const t of tokens) {
    if (!t) continue;
    const qPhone = await db.collection("customers").where("phone", "==", t).limit(25).get();
    for (const d of qPhone.docs) {
      byId.set(d.id, d);
    }
    const qPhones = await db.collection("customers").where("phones", "array-contains", t).limit(25).get();
    for (const d of qPhones.docs) {
      byId.set(d.id, d);
    }
  }

  return [...byId.values()];
}

export async function findCustomerDocByPhoneRaw(raw: string): Promise<CustomerDoc | null> {
  const tokens = phoneSearchTokens(raw);
  if (tokens.every((t) => !t || t.length < 9)) {
    return null;
  }
  const candidates = await collectCustomerCandidates(tokens);
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const ids = new Set(candidates.map((c) => c.id));
    if (ids.size > 1) {
      throw new HttpsError("failed-precondition", "พบเบอร์ซ้ำในหลายรายชื่อลูกค้า กรุณาติดต่อศูนย์ค่ะ");
    }
  }
  return candidates[0] ?? null;
}

async function registrationStateForCustomer(
  customer: CustomerDoc
): Promise<"NONE" | "PENDING" | "ACTIVE"> {
  const db = getFirestore();
  const authUid = customer.data()?.authUid as string | undefined;
  if (!authUid) return "NONE";
  const u = await db.collection("users").doc(authUid).get();
  if (!u.exists) return "NONE";
  const st = u.data()?.status as string | undefined;
  if (st === "ACTIVE") return "ACTIVE";
  if (st === "PENDING") return "PENDING";
  return "NONE";
}

/** ค้นหาลูกค้าจากเบอร์ (ไม่ต้องล็อกอิน) — ส่งเฉพาะข้อมูลที่จำเป็นสำหรับฟอร์มสมัคร */
export const lookupCustomerForPortalSignup = onCall(
  {
    region: "us-central1",
    cors: true,
    /** Gen 2 รันบน Cloud Run — ต้องเปิด public invoker ไม่งั้นผู้ไม่ล็อกอินเรียกแล้วได้ INTERNAL */
    invoker: "public",
  },
  async (request) => {
    const phone = String((request.data as { phone?: string })?.phone || "").trim();
    if (!phone || phone.length < 9) {
      throw new HttpsError("invalid-argument", "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
    }

    try {
      const customer = await findCustomerDocByPhoneRaw(phone);
      if (!customer || !customer.exists) {
        return {
          found: false,
        };
      }

      const data = customer.data() || {};
      const registration = await registrationStateForCustomer(customer);

      return {
        found: true,
        customerId: customer.id,
        name: (data.name as string) || "",
        nationalId: (data.nationalId as string) || "",
        idCardAddress: (data.idCardAddress as string) || "",
        registration,
      };
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      console.error("lookupCustomerForPortalSignup", e);
      // ใช้รหัสที่ไม่ใช่ internal เพื่อให้ข้อความไทยส่งถึง client ได้ (internal มักถูกตัดเหลือแค่ "internal")
      throw new HttpsError(
        "failed-precondition",
        "ระบบตรวจสอบเบอร์ขัดข้องชั่วคราว กรุณาลองใหม่ หรือแจ้งผู้ดูแลให้ตรวจสอบว่า deploy Cloud Functions แล้ว"
      );
    }
  }
);

/**
 * หลัง createUserWithEmailAndPassword สำเร็จแล้ว — เขียน users + customers ด้วย Admin SDK
 * (หลีกเลี่ยง PERMISSION_DENIED จาก Firestore rules บน client)
 */
export const provisionCustomerPortalProfile = onCall(
  {
    region: "us-central1",
    cors: true,
    /** Cloud Run ต้องเปิด invoker — ภายในยังตรวจ request.auth อยู่ */
    invoker: "public",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบหลังสมัครก่อนบันทึกโปรไฟล์");
    }
    const uid = request.auth.uid;
    const payload = (request.data || {}) as {
      phoneRaw?: string;
      displayName?: string;
      nationalId?: string;
      idCardAddress?: string;
    };

    const phoneRaw = String(payload.phoneRaw || "").trim();
    const displayName = String(payload.displayName || "").trim();
    const nid = normalizePhoneDigits(String(payload.nationalId || ""));
    const addr = String(payload.idCardAddress || "").trim();

    if (!isLegalFullName(displayName)) {
      throw new HttpsError("invalid-argument", "กรุณากรอกชื่อและนามสกุลจริงให้ครบ");
    }
    if (!isValidThaiNationalId13(nid)) {
      throw new HttpsError("invalid-argument", "เลขบัตรประชาชนไม่ถูกต้อง");
    }
    if (!isSubstantialIdCardAddress(addr)) {
      throw new HttpsError("invalid-argument", "กรุณากรอกที่อยู่ตามบัตรให้ครบถ้วน");
    }
    if (!phoneRaw || phoneRaw.length < 9) {
      throw new HttpsError("invalid-argument", "เบอร์โทรไม่ถูกต้อง");
    }

    const db = getFirestore();

    let customer: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;
    try {
      const c = await findCustomerDocByPhoneRaw(phoneRaw);
      if (!c?.exists) {
        throw new HttpsError("failed-precondition", "ไม่พบเบอร์นี้ในรายชื่อลูกค้า");
      }
      customer = c;
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      console.error("provisionCustomerPortalProfile lookup", e);
      throw new HttpsError("failed-precondition", "ค้นหาข้อมูลลูกค้าไม่สำเร็จ");
    }

    const registration = await registrationStateForCustomer(customer);
    if (registration === "ACTIVE") {
      throw new HttpsError("failed-precondition", "เบอร์นี้ลงทะเบียนแล้ว");
    }
    if (registration === "PENDING") {
      throw new HttpsError("failed-precondition", "เบอร์นี้อยู่ระหว่างรอการอนุมัติ");
    }

    const canonicalId = customer.id;
    const expectedEmail = customerAuthEmailFromDocId(canonicalId);

    let authUser;
    try {
      authUser = await getAuth().getUser(uid);
    } catch (e: unknown) {
      console.error("provisionCustomerPortalProfile getUser", e);
      throw new HttpsError("failed-precondition", "ไม่พบบัญชีผู้ใช้ กรุณาลองสมัครใหม่");
    }

    const authEmail = (authUser.email || "").toLowerCase();
    if (authEmail !== expectedEmail.toLowerCase()) {
      throw new HttpsError(
        "failed-precondition",
        "ข้อมูลบัญชีไม่ตรงกับรายชื่อลูกค้าในระบบ กรุณาติดต่อศูนย์"
      );
    }

    const prev = customer.data() || {};
    const existingAuthUid = prev.authUid as string | undefined;
    if (existingAuthUid && existingAuthUid !== uid) {
      throw new HttpsError("failed-precondition", "เบอร์นี้ผูกบัญชีอื่นในระบบแล้ว กรุณาติดต่อศูนย์");
    }

    const mergedPhones = dedupePhoneList([
      ...(Array.isArray(prev.phones) ? (prev.phones as string[]) : []),
      ...(prev.phone ? [String(prev.phone)] : []),
      canonicalId,
      phoneRaw,
    ]);

    const custRef = db.collection("customers").doc(canonicalId);
    const custSnap = await custRef.get();

    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          displayName: displayName.trim(),
          email: expectedEmail,
          phone: canonicalId,
          role: "CUSTOMER",
          status: "PENDING",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await custRef.set(
      {
        name: displayName.trim(),
        phone: canonicalId,
        phones: mergedPhones.length > 0 ? mergedPhones : [canonicalId],
        nationalId: nid,
        idCardAddress: addr,
        authUid: uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(custSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    return { ok: true, customerId: canonicalId };
  }
);

async function assertAdmin(uid: string): Promise<void> {
  const db = getFirestore();
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.data()?.role as string | undefined;
  if (role !== "ADMIN") {
    throw new HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น");
  }
}

/** ปฏิเสธการสมัครลูกค้า: ลบ Firebase Auth + ลบ users + เอา authUid ออกจาก customers */
export const rejectPortalCustomerRegistration = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    await assertAdmin(request.auth.uid);

    const payload = (request.data || {}) as { targetUid?: string; customerId?: string };
    const targetUid = String(payload.targetUid || "").trim();
    const customerId = String(payload.customerId || "").trim();
    if (!targetUid || !customerId) {
      throw new HttpsError("invalid-argument", "ข้อมูลไม่ครบ");
    }

    const db = getFirestore();
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบผู้ใช้");
    }
    const uData = userSnap.data()!;
    if (uData.role !== "CUSTOMER" || uData.status !== "PENDING") {
      throw new HttpsError("failed-precondition", "รายการนี้ไม่อยู่ในสถานะรออนุมัติ");
    }

    const custRef = db.collection("customers").doc(customerId);
    const custSnap = await custRef.get();
    if (!custSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบข้อมูลลูกค้า");
    }
    const authUid = custSnap.data()?.authUid as string | undefined;
    if (authUid !== targetUid) {
      throw new HttpsError("failed-precondition", "ข้อมูลการผูกบัญชีไม่ตรงกัน");
    }

    try {
      await getAuth().deleteUser(targetUid);
    } catch (e: unknown) {
      console.error("deleteUser", e);
      throw new HttpsError("internal", "ลบบัญชีผู้ใช้ไม่สำเร็จ (อาจถูกลบไปแล้ว)");
    }

    await db.collection("users").doc(targetUid).delete();
    await custRef.set(
      {
        authUid: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true };
  }
);
