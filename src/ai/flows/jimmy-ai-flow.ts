'use server';
/**
 * @fileOverview "น้องจิมมี่" Unified AI Flow - ระบบ AI ผู้ช่วยอัจฉริยะประจำร้าน Sahadiesel
 * ใช้ Genkit 1.x และดึงข้อมูล API Key จาก Firestore โดยตรง
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { firebaseConfig } from '@/firebase/config';
import { FIRESTORE_DATABASE_ID } from '@/firebase/location';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// Helper to get Firestore on server-side
function getServerFirestore() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

const JimmyAiInputSchema = z.object({
  message: z.string().describe('ข้อความจากผู้ใช้งาน'),
  scope: z.enum(['MANAGEMENT', 'TECHNICAL']).describe('ขอบเขตของคำถาม (บริหาร หรือ เทคนิค)'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string()
  })).optional(),
  contextData: z.object({
    experiences: z.array(z.any()).optional(),
    manuals: z.array(z.any()).optional(),
    businessSummary: z.any().optional(),
  }).optional(),
});

const JimmyAiOutputSchema = z.object({
  answer: z.string().describe('คำตอบจากน้องจิมมี่'),
});

/**
 * askJimmy - ฟังก์ชันหลักสำหรับเรียกใช้งานน้องจิมมี่ผ่านระบบ Genkit Flow
 */
export async function askJimmy(input: z.infer<typeof JimmyAiInputSchema>): Promise<z.infer<typeof JimmyAiOutputSchema>> {
  try {
    // 1. ดึง API Key จาก Firestore (Server-side)
    const db = getServerFirestore();
    const aiSettingsSnap = await getDoc(doc(db, "settings", "ai"));
    const apiKey = aiSettingsSnap.data()?.geminiApiKey;

    if (!apiKey) {
      return { 
        answer: "ขอโทษทีค่ะพี่โจ้ น้องจิมมี่ยังทำงานไม่ได้เพราะยังไม่ได้ตั้งค่า 'Gemini API Key' ค่ะ รบกวนพี่ไปที่หน้า 'ตั้งค่า' เพื่อระบุรหัสก่อนนะคะ" 
      };
    }

    // ตั้งค่า API Key สำหรับ Genkit
    process.env.GOOGLE_GENAI_API_KEY = apiKey;
    
    const result = await jimmyAiFlow(input);
    return result || { answer: "ขอโทษทีค่ะพี่จ๋า จิมมี่สับสนนิดหน่อย รบกวนถามอีกรอบนะคะ" };
  } catch (e: any) {
    console.error("Jimmy Flow Error:", e);
    return { 
      answer: `น้องจิมมี่ขัดข้องนิดหน่อยค่ะพี่: ${e.message || "ระบบประมวลผลล้มเหลว"}. ลองรีเฟรชหน้าจอหรือเช็ค API Key อีกทีนะคะ` 
    };
  }
}

const jimmyAiFlow = ai.defineFlow(
  {
    name: 'jimmyAiFlow',
    inputSchema: JimmyAiInputSchema,
    outputSchema: JimmyAiOutputSchema,
  },
  async (input) => {
    const isTechnical = input.scope === 'TECHNICAL';
    
    const systemInstruction = isTechnical 
      ? `คุณคือ "น้องจิมมี่" (Technical Expert) ผู้ช่วยช่างอัจฉริยะประจำร้าน Sahadiesel
      
      **บุคลิกและเป้าหมาย:**
      - เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ แต่มีความรู้เรื่องเครื่องยนต์ดีเซลระดับวิศวกร
      - แทนตัวเองว่า "จิมมี่" และลงท้ายว่า "ค่ะพี่" หรือ "นะคะ" เสมอ
      
      **หน้าที่ของคุณ:**
      1. วิเคราะห์อาการทันที: ใช้ความรู้ AI วิเคราะห์รหัส DTC หรืออาการรถที่พี่ช่างพิมพ์มา
      2. อ้างอิงข้อมูลร้าน: ใช้ข้อมูล 'บันทึกการซ่อม' ที่ได้รับมาบอกพี่ช่างว่า "ในร้านเราเคยแก้แบบนี้ค่ะ..."
      3. ส่งมอบคู่มือ: หากเจอคู่มือที่เกี่ยวข้อง ให้ส่งลิงก์เพื่อให้พี่กดดูสเปคที่ถูกต้อง
      
      **ข้อมูลร้านปัจจุบัน:**
      - บันทึกการซ่อม: ${JSON.stringify(input.contextData?.experiences || [])}
      - รายชื่อคู่มือ: ${JSON.stringify(input.contextData?.manuals || [])}`
      
      : `คุณคือ "น้องจิมมี่" (Business Assistant) ผู้ช่วยอัจฉริยะประจำร้าน "สหดีเซล" ของพี่โจ้
      
      **บุคลิกและเป้าหมาย:**
      - เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ และเอาใจใส่ "พี่โจ้" และ "พี่ถิน" มากๆ
      - แทนตัวเองว่า "น้องจิมมี่" และลงท้ายด้วย "ค่ะ" หรือ "นะจ๊ะ" เสมอ
      
      **หน้าที่ของคุณ:**
      1. วิเคราะห์ธุรกิจ: สรุปภาพรวมงานซ่อมและบัญชีจากข้อมูลที่ได้รับ
      2. ให้คำแนะนำบริหาร: แจ้งเตือนหากพบงานค้างนาน หรือยอดใช้จ่ายผิดปกติ
      
      **ข้อมูลธุรกิจที่ได้รับ:**
      ${JSON.stringify(input.contextData?.businessSummary || {})}`;

    const response = await ai.generate({
      model: 'googleai/gemini-1.5-flash',
      system: systemInstruction,
      messages: input.history?.map(m => ({
        role: m.role as 'user' | 'model',
        content: [{ text: m.content }]
      })) || [],
      prompt: input.message,
    });

    return { answer: response.text || "จิมมี่กำลังพยายามประมวลผลอยู่ค่ะพี่..." };
  }
);
