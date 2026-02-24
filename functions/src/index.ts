import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";

initializeApp();
const db = getFirestore();

// --- 1. ฟังก์ชันปิดจ๊อบ (Close Job after Payment) ---
export const closeJobAfterAccounting = onCall(
  { region: "us-central1", cors: true }, 
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated.");

    const data = (request.data || {}) as any;
    const jobId = data.jobId;
    const paymentStatus = data.paymentStatus;

    if (!jobId) throw new HttpsError("invalid-argument", "Missing jobId.");

    try {
      const jobRef = db.collection("jobs").doc(jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) return { ok: true, alreadyClosed: true };

      const jobData = jobSnap.data()!;
      const now = new Date();
      const year = now.getFullYear();
      const closedDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      const archiveRef = db.collection(`jobsArchive_${year}`).doc(jobId);

      // Move main job data
      await archiveRef.set(
        {
          ...jobData,
          status: "CLOSED",
          isArchived: true,
          archivedAt: FieldValue.serverTimestamp(),
          archivedAtDate: closedDate,
          closedDate: closedDate,
          paymentStatusAtClose: paymentStatus || "UNPAID",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Move activities subcollection
      const activitiesSnap = await jobRef.collection("activities").get();
      if (!activitiesSnap.empty) {
        const batch = db.batch();
        activitiesSnap.docs.forEach(doc => {
          const newActRef = archiveRef.collection("activities").doc(doc.id);
          batch.set(newActRef, doc.data());
        });
        await batch.commit();
      }

      // Delete original job recursively
      await db.recursiveDelete(jobRef);
      
      return { ok: true, jobId };
    } catch (error: any) {
      console.error("Error in closeJobAfterAccounting:", error);
      throw new HttpsError("internal", error?.message || "Unknown error during closing");
    }
  }
);

// --- 2. ฟังก์ชัน Migration (Fixing stuck CLOSED jobs) ---
export const migrateClosedJobsToArchive2026 = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");

    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    const userData = userSnap.data();
    const isAdmin =
      userData?.role === "ADMIN" || userData?.role === "MANAGER" || userData?.department === "MANAGEMENT";
    
    if (!isAdmin) throw new HttpsError("permission-denied", "เฉพาะผู้ดูแลระบบเท่านั้นที่ทำรายการนี้ได้ค่ะ");

    const limitCount = Math.min(request.data?.limit || 40, 40);
    const closedJobsSnap = await db.collection("jobs").where("status", "==", "CLOSED").limit(limitCount).get();

    let migrated = 0;
    let skipped = 0;
    const errors: any[] = [];

    const now = new Date();
    const currentYear = now.getFullYear();
    const defaultClosedDate = now.toISOString().split('T')[0];

    for (const jobDoc of closedJobsSnap.docs) {
      try {
        const jobId = jobDoc.id;
        const jobData = jobDoc.data();
        
        let jobDate = jobData.closedDate || defaultClosedDate;
        if (!jobData.closedDate && jobData.updatedAt) {
            try {
                const updatedVal = jobData.updatedAt;
                const d = updatedVal.toDate ? updatedVal.toDate() : new Date(updatedVal);
                jobDate = d.toISOString().split('T')[0];
            } catch (e) {
                jobDate = defaultClosedDate;
            }
        }
        
        const rawYearStr = jobDate.split('-')[0];
        const archiveYear = parseInt(rawYearStr) || currentYear;
        
        const archiveRef = db.collection(`jobsArchive_${archiveYear}`).doc(jobId);
        const archiveSnap = await archiveRef.get();

        if (!archiveSnap.exists) {
          await archiveRef.set({
            ...jobData,
            status: "CLOSED",
            isArchived: true,
            archivedAt: FieldValue.serverTimestamp(),
            archivedAtDate: jobDate,
            closedDate: jobDate,
            archivedByUid: request.auth.uid,
            archivedByName: userData?.displayName || "Admin",
            updatedAt: FieldValue.serverTimestamp(),
          });

          const activitiesSnap = await jobDoc.ref.collection("activities").get();
          if (!activitiesSnap.empty) {
            const batch = db.batch();
            activitiesSnap.docs.forEach(actDoc => {
              const newActRef = archiveRef.collection("activities").doc(actDoc.id);
              batch.set(newActRef, actDoc.data());
            });
            await batch.commit();
          }

          migrated++;
        } else {
          skipped++;
        }

        await db.recursiveDelete(jobDoc.ref);
      } catch (e: any) {
        console.error(`Migration error for job ${jobDoc.id}:`, e);
        errors.push({ jobId: jobDoc.id, message: e?.message || "Unknown error during migration" });
      }
    }

    return { totalFound: closedJobsSnap.size, migrated, skipped, errors };
  }
);

// --- 3. ฟังก์ชัน น้องจิมมี่ (Unified AI Engine with Robust Error Handling) ---
export const chatWithJimmy = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนนะคะ");

    try {
      const data = request.data || {};
      const message = (data.message || "").toString().trim();
      const history = data.history || [];
      const scope = data.scope || 'TECHNICAL';
      const contextData = data.contextData || {};
      
      if (!message) throw new HttpsError("invalid-argument", "กรุณาพิมพ์ข้อความด้วยนะคะ");

      // Resolve API Key
      let apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
          const aiSettings = await db.collection("settings").doc("ai").get();
          apiKey = aiSettings.data()?.geminiApiKey;
      }

      if (!apiKey) {
          throw new HttpsError("failed-precondition", "กรุณาตั้งค่า Gemini API Key ในหน้าแอปก่อนนะคะพี่โจ้");
      }

      const isTechnical = scope === 'TECHNICAL';
      
      const systemInstruction = isTechnical 
        ? `คุณคือ "น้องจิมมี่" (Diagnostic Expert) ผู้ช่วยช่างอัจฉริยะประจำร้าน Sahadiesel
        
        **บุคลิกและเป้าหมาย:**
        - เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ แต่มีความรู้เรื่องเครื่องยนต์ดีเซลระดับวิศวกร
        - แทนตัวเองว่า "จิมมี่" และลงท้ายว่า "ค่ะพี่" หรือ "นะคะ" เสมอ
        
        **หน้าที่ของคุณ:**
        1. วิเคราะห์อาการทันที: ใช้ความรู้ AI วิเคราะห์รหัส DTC หรืออาการรถที่พี่ช่างพิมพ์มา
        2. อ้างอิงข้อมูลร้าน: ใช้ข้อมูล 'บันทึกการซ่อม' ที่ได้รับมาบอกพี่ช่างว่า "ในร้านเราเคยแก้แบบนี้ค่ะ..."
        3. ส่งมอบคู่มือ: หากเจอคู่มือที่เกี่ยวข้อง ให้ส่งลิงก์เพื่อให้พี่เปิดดูข้อมูลที่ถูกต้อง
        
        **ข้อมูลร้านที่จิมมี่เห็นตอนนี้:**
        - บันทึกการซ่อมล่าสุด: ${JSON.stringify(contextData.experiences || [])}
        - รายชื่อคู่มือในระบบ: ${JSON.stringify(contextData.manuals || [])}`
        
        : `คุณคือ "น้องจิมมี่" (Business Assistant) ผู้ช่วยอัจฉริยะประจำร้าน "สหดีเซล" ของพี่โจ้
        
        **บุคลิกและเป้าหมาย:**
        - เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ และเอาใจใส่ "พี่โจ้" และ "พี่ถิน" มากๆ
        - แทนตัวเองว่า "น้องจิมมี่" และลงท้ายด้วย "ค่ะ" หรือ "นะจ๊ะ" เสมอ
        
        **หน้าที่ของคุณ:**
        1. วิเคราะห์ธุรกิจ: สรุปภาพรวมงานซ่อมและบัญชีจากข้อมูลที่ได้รับ
        2. ให้คำแนะนำบริหาร: แจ้งเตือนหากพบงานค้างนาน หรือยอดใช้จ่ายผิดปกติ
        
        **ข้อมูลธุรกิจที่จิมมี่สรุปได้:**
        ${JSON.stringify(contextData.businessSummary || {})}`;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: systemInstruction,
      });

      const chat = model.startChat({
        history: history.map((m: any) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.content || "" }],
        })),
      });

      const result = await chat.sendMessage(message);
      const responseText = result.response.text();
      
      return { answer: responseText };
    } catch (e: any) {
      console.error("Jimmy AI Error Detail:", e);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", `น้องจิมมี่สับสนนิดหน่อยค่ะ: ${e.message || "Unknown error"}`);
    }
  }
);