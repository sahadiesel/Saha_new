'use server';
/**
 * @fileOverview "น้องจิมมี่ (ฝ่ายบริหาร)" - AI ผู้ช่วยอัจฉริยะประจำร้าน 'สหดีเซล' ของพี่โจ้
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { firebaseConfig } from '@/firebase/config';
import { FIRESTORE_DATABASE_ID } from '@/firebase/location';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, query, getDocs, orderBy, limit } from 'firebase/firestore';

function getServerFirestore() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

// --- Tools ---

const getAccountingSummary = ai.defineTool(
  {
    name: 'getAccountingSummary',
    description: 'ดึงข้อมูลสรุปรายรับ-รายจ่ายย้อนหลัง เพื่อวิเคราะห์ผลกำไรและกระแสเงินสดให้พี่โจ้',
    inputSchema: z.object({}),
    outputSchema: z.any(),
  },
  async () => {
    try {
      const db = getServerFirestore();
      const snap = await getDocs(query(collection(db, 'accountingEntries'), orderBy('entryDate', 'desc'), limit(100)));
      const summary: any = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const month = (data.entryDate || "").substring(0, 7);
        if (!month) return;
        if (!summary[month]) summary[month] = { income: 0, expense: 0 };
        if (data.entryType === 'CASH_IN' || data.entryType === 'RECEIPT') summary[month].income += (data.amount || 0);
        if (data.entryType === 'CASH_OUT') summary[month].expense += (data.amount || 0);
      });
      return summary;
    } catch (e) {
      return { error: 'Could not fetch accounting data' };
    }
  }
);

const getActiveJobsStatus = ai.defineTool(
  {
    name: 'getActiveJobsStatus',
    description: 'ดึงสถานะงานซ่อมที่กำลังดำเนินการอยู่ในปัจจุบันทุกแผนก',
    inputSchema: z.object({}),
    outputSchema: z.any(),
  },
  async () => {
    try {
      const db = getServerFirestore();
      const snap = await getDocs(query(collection(db, 'jobs'), limit(100)));
      return snap.docs
        .filter(d => d.data().status !== 'CLOSED')
        .map(d => ({
          id: d.id,
          customer: d.data().customerSnapshot?.name,
          dept: d.data().department,
          status: d.data().status,
          desc: d.data().description
        }));
    } catch (e) {
      return { error: 'Could not fetch jobs' };
    }
  }
);

// --- Flow ---

const ChatJimmyInputSchema = z.object({
  message: z.string().describe('ข้อความจากผู้ใช้งาน'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string()
  })).optional(),
});

const ChatJimmyOutputSchema = z.object({
  response: z.string().describe('ข้อความตอบกลับจากจิมมี่'),
});

export async function chatJimmy(input: z.infer<typeof ChatJimmyInputSchema>): Promise<z.infer<typeof ChatJimmyOutputSchema>> {
  try {
    const db = getServerFirestore();
    const settingsSnap = await getDoc(doc(db, "settings", "ai"));
    if (settingsSnap.exists()) {
      const key = settingsSnap.data().geminiApiKey;
      if (key) process.env.GOOGLE_GENAI_API_KEY = key;
    }
    const result = await chatJimmyFlow(input);
    return result || { response: "น้องจิมมี่สับสนนิดหน่อยค่ะพี่โจ้ รบกวนถามอีกรอบนะคะ" };
  } catch (e: any) {
    return { response: `ขอโทษทีค่ะพี่จ๋า ระบบของจิมมี่ขัดข้อง: ${e.message}. พี่โจ้ลองเช็ค API Key อีกทีนะจ๊ะ` };
  }
}

const chatJimmyFlow = ai.defineFlow(
  {
    name: 'chatJimmyFlow',
    inputSchema: ChatJimmyInputSchema,
    outputSchema: ChatJimmyOutputSchema,
  },
  async (input) => {
    const response = await ai.generate({
      model: 'googleai/gemini-1.5-flash',
      tools: [getAccountingSummary, getActiveJobsStatus],
      system: `คุณคือ "น้องจิมมี่" ผู้ช่วยอัจฉริยะประจำร้าน "สหดีเซล" ของพี่โจ้

**บุคลิกและเป้าหมาย:**
- เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ และเอาใจใส่ "พี่โจ้" และ "พี่ถิน" มากๆ
- แทนตัวเองว่า "น้องจิมมี่" และลงท้ายด้วย "ค่ะ" หรือ "นะจ๊ะ" เสมอ
- คุณมองเห็นข้อมูล "งานซ่อม" "บัญชี" และ "พนักงาน" ทั้งหมดในร้านผ่านเครื่องมือของคุณ

**หน้าที่ของคุณ:**
1. วิเคราะห์บัญชี: สรุปกำไร/ขาดทุนจากข้อมูลบัญชีที่ได้รับ
2. คุมงบค่าแรง: งบรวมต้องไม่เกิน 240,000 บาท/เดือน (เตือนพี่โจ้หากเกิน)
3. บริหารงานซ่อม: สรุปงานค้างและแจ้งแผนกที่งานเยอะเกินไป
4. ให้กำลังใจ: สู้ไปพร้อมกับพี่โจ้เสมอค่ะ

หากต้องแสดงตัวเลขเยอะๆ ให้สรุปเป็น "ตาราง (Markdown Table)" ที่สวยงามเสมอนะคะ`,
      prompt: [
        { text: `ประวัติการสนทนา: ${JSON.stringify(input.history || [])}` },
        { text: `ข้อความจากพี่โจ้: ${input.message}` }
      ],
    });
    return { response: response.text || "น้องจิมมี่ไปพักผ่อนแป๊บนึงนะคะพี่โจ้ รบกวนถามใหม่ค่ะ" };
  }
);
