import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { findCustomerDocByPhoneRaw, registrationStateForCustomer } from "./customerPortalSignup";
import { normalizePhoneDigits } from "./phone-utils";

function normalizeNationalIdDigits(raw: string): string {
  return normalizePhoneDigits(String(raw || "").trim());
}

function isValidThaiNationalId13(digits: string): boolean {
  return /^[0-9]{13}$/.test(digits);
}

async function assertCallerIsAdmin(uid: string): Promise<void> {
  const db = getFirestore();
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.data()?.role as string | undefined;
  if (role !== "ADMIN") {
    throw new HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น");
  }
}

/**
 * ลูกค้ายื่นคำขอลืมรหัส — ตรวจเบอร์ + เลขบัตรตรงกับ customers และบัญชี ACTIVE
 */
export const submitCustomerPasswordResetRequest = onCall(
  { region: "us-central1", cors: true, invoker: "public" },
  async (request) => {
    const payload = (request.data || {}) as { phone?: string; nationalId?: string };
    const phoneRaw = String(payload.phone || "").trim();
    const nidSubmitted = normalizeNationalIdDigits(String(payload.nationalId || ""));

    if (!phoneRaw || phoneRaw.length < 9) {
      throw new HttpsError("invalid-argument", "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
    }
    if (!isValidThaiNationalId13(nidSubmitted)) {
      throw new HttpsError("invalid-argument", "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก");
    }

    const db = getFirestore();
    let customer;
    try {
      customer = await findCustomerDocByPhoneRaw(phoneRaw);
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("failed-precondition", "ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองใหม่");
    }

    if (!customer?.exists) {
      throw new HttpsError(
        "failed-precondition",
        "ข้อมูลไม่ตรงกับในระบบ กรุณาตรวจสอบเบอร์และเลขบัตรประชาชน หรือติดต่อศูนย์บริการ"
      );
    }

    const data = customer.data() || {};
    const registration = await registrationStateForCustomer(customer);
    if (registration !== "ACTIVE") {
      throw new HttpsError(
        "failed-precondition",
        "บัญชีพอร์ทัลยังไม่พร้อมใช้งานหรือยังไม่ได้เปิดใช้ กรุณาติดต่อศูนย์บริการ"
      );
    }

    const nidOnFile = normalizeNationalIdDigits(String(data.nationalId || ""));
    if (!nidOnFile || !isValidThaiNationalId13(nidOnFile)) {
      throw new HttpsError(
        "failed-precondition",
        "ยังไม่มีเลขบัตรประชาชนในระบบสำหรับเบอร์นี้ กรุณาติดต่อศูนย์บริการ"
      );
    }

    if (nidOnFile !== nidSubmitted) {
      throw new HttpsError(
        "failed-precondition",
        "ข้อมูลไม่ตรงกับในระบบ กรุณาตรวจสอบเบอร์และเลขบัตรประชาชน หรือติดต่อศูนย์บริการ"
      );
    }

    const authUid = data.authUid as string | undefined;
    if (!authUid) {
      throw new HttpsError("failed-precondition", "ไม่พบการผูกบัญชีพอร์ทัล กรุณาติดต่อศูนย์บริการ");
    }

    const pendingSnap = await db
      .collection("customerPasswordResetRequests")
      .where("authUid", "==", authUid)
      .where("status", "==", "PENDING")
      .limit(1)
      .get();

    if (!pendingSnap.empty) {
      throw new HttpsError(
        "already-exists",
        "มีคำขอรีเซ็ตรหัสผ่านค้างอยู่แล้ว — กรุณารอเจ้าหน้าที่ติดต่อกลับจากศูนย์บริการ"
      );
    }

    const customerName = String(data.name || "").trim() || "(ไม่มีชื่อในระบบ)";
    const phoneCanonical = customer.id;

    await db.collection("customerPasswordResetRequests").add({
      customerId: phoneCanonical,
      phone: phoneCanonical,
      customerName,
      nationalIdOnFile: nidOnFile,
      nationalIdSubmitted: nidSubmitted,
      authUid,
      status: "PENDING",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true as const };
  }
);

/** Admin ตั้งรหัสชั่วคราว + บังคับลูกค้าเปลี่ยนรหัสเมื่อเข้าครั้งถัดไป */
export const adminResetCustomerPasswordAfterForgot = onCall(
  { region: "us-central1", cors: true, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    }
    await assertCallerIsAdmin(request.auth.uid);

    const payload = (request.data || {}) as { requestDocId?: string; newPassword?: string };
    const requestDocId = String(payload.requestDocId || "").trim();
    const newPassword = String(payload.newPassword || "");

    if (!requestDocId) {
      throw new HttpsError("invalid-argument", "ไม่พบรายการคำขอ");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new HttpsError("invalid-argument", "รหัสผ่านอย่างน้อย 6 ตัวอักษร");
    }

    const db = getFirestore();
    const reqRef = db.collection("customerPasswordResetRequests").doc(requestDocId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบคำขอรีเซ็ตรหัสผ่าน");
    }

    const reqData = reqSnap.data()!;
    if (reqData.status !== "PENDING") {
      throw new HttpsError("failed-precondition", "รายการนี้ดำเนินการแล้วหรือถูกปิด");
    }

    const authUid = String(reqData.authUid || "").trim();
    if (!authUid) {
      throw new HttpsError("failed-precondition", "ข้อมูลคำขอไม่สมบูรณ์");
    }

    const userSnap = await db.collection("users").doc(authUid).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบบัญชีผู้ใช้ลูกค้า");
    }
    const uData = userSnap.data()!;
    if (uData.role !== "CUSTOMER" || uData.status !== "ACTIVE") {
      throw new HttpsError("failed-precondition", "บัญชีลูกค้าไม่พร้อมให้รีเซ็ตรหัสในขณะนี้");
    }

    try {
      await getAuth().updateUser(authUid, { password: newPassword });
    } catch (e: unknown) {
      console.error("adminResetCustomerPasswordAfterForgot updateUser", e);
      throw new HttpsError("internal", "ไม่สามารถตั้งรหัสผ่านใหม่ในระบบยืนยันตัวตนได้");
    }

    await db
      .collection("users")
      .doc(authUid)
      .set(
        {
          mustChangePassword: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await reqRef.set(
      {
        status: "COMPLETED",
        completedAt: FieldValue.serverTimestamp(),
        completedByUid: request.auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true as const };
  }
);
