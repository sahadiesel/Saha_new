'use server';
/**
 * @fileOverview "น้องจิมมี่ (ฝ่ายเทคนิค)" - AI ผู้ช่วยวิเคราะห์อาการรถยนต์ประจำร้าน Sahadiesel
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { firebaseConfig } from '@/firebase/config';
import { FIRESTORE_DATABASE_ID } from '@/firebase/location';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, query, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';

function getServerFirestore() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

// --- Tools ---

const searchExperiences = ai.defineTool(
  {
    name: 'searchExperiences',
    description: 'ค้นหาบันทึกการซ่อมจริงในร้าน Sahadiesel เพื่อดูวิธีแก้ปัญหาที่พี่ๆ ช่างในร้านเคยทำสำเร็จ',
    inputSchema: z.object({
      keyword: z.string().describe('คำค้นหา เช่น รหัส DTC, อาการเสีย หรือชื่อรุ่นรถ'),
    }),
    outputSchema: z.array(z.any()),
  },
  async (input) => {
    try {
      const db = getServerFirestore();
      const snap = await getDocs(query(collection(db, 'carRepairExperiences'), orderBy('createdAt', 'desc'), limit(50)));
      const k = input.keyword.toLowerCase();
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((d: any) => 
          d.brand?.toLowerCase().includes(k) || 
          d.model?.toLowerCase().includes(k) || 
          d.symptoms?.toLowerCase().includes(k) ||
          d.solution?.toLowerCase().includes(k)
        );
    } catch (e) {
      console.error("Tool Error (searchExperiences):", e);
      return [];
    }
  }
);

const listManualsIndex = ai.defineTool(
  {
    name: 'listManualsIndex',
    description: 'ตรวจสอบรายชื่อคู่มือซ่อมใน Drive ของร้าน เพื่อส่งลิงก์ให้พี่ช่างเปิดดูข้อมูลสเปคที่แน่นอน',
    inputSchema: z.object({
      searchQuery: z.string().optional().describe('ยี่ห้อหรือรุ่นรถที่ต้องการหาคู่มือ'),
    }),
    outputSchema: z.array(z.any()),
  },
  async (input) => {
    try {
      const db = getServerFirestore();
      const snap = await getDocs(collection(db, 'carRepairManuals'));
      let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (input.searchQuery) {
        const q = input.searchQuery.toLowerCase();
        items = items.filter((m: any) => 
          m.name?.toLowerCase().includes(q) || 
          m.brand?.toLowerCase().includes(q)
        );
      }
      return items;
    } catch (e) {
      console.error("Tool Error (listManualsIndex):", e);
      return [];
    }
  }
);

// --- Flow ---

const AskAssistantInputSchema = z.object({
  message: z.string().describe('คำถาม อาการรถ หรือรหัส DTC จากช่าง'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string()
  })).optional(),
});

const AskAssistantOutputSchema = z.object({
  answer: z.string().describe('คำตอบหรือการวิเคราะห์จากจิมมี่'),
});

export async function askCarRepairAI(input: z.infer<typeof AskAssistantInputSchema>): Promise<z.infer<typeof AskAssistantOutputSchema>> {
  try {
    const db = getServerFirestore();
    const settingsSnap = await getDoc(doc(db, "settings", "ai"));
    if (settingsSnap.exists()) {
      const key = settingsSnap.data().geminiApiKey;
      if (key) process.env.GOOGLE_GENAI_API_KEY = key;
    }
    const result = await carRepairAssistantFlow(input);
    return result || { answer: "ขอโทษค่ะพี่ จิมมี่ประมวลผลพลาดไปนิด รบกวนถามใหม่อีกรอบนะคะ" };
  } catch (e: any) {
    return { answer: `ขอโทษทีค่ะพี่จ๋า ระบบของจิมมี่ขัดข้อง: ${e.message || 'Unknown Error'}. รบกวนพี่เช็ค API Key ในหน้าตั้งค่าอีกทีนะคะ` };
  }
}

const carRepairAssistantFlow = ai.defineFlow(
  {
    name: 'carRepairAssistantFlow',
    inputSchema: AskAssistantInputSchema,
    outputSchema: AskAssistantOutputSchema,
  },
  async (input) => {
    const response = await ai.generate({
      model: 'googleai/gemini-1.5-flash',
      tools: [searchExperiences, listManualsIndex],
      system: `คุณคือ "น้องจิมมี่" (Diagnostic Expert) ผู้ช่วยช่างอัจฉริยะประจำร้าน Sahadiesel

**บุคลิกและเป้าหมาย:**
- เป็นผู้หญิง เสียงหวาน ขี้เล่นนิดๆ แต่มีความรู้เรื่องเครื่องยนต์ดีเซลระดับวิศวกร
- แทนตัวเองว่า "จิมมี่" และลงท้ายว่า "ค่ะพี่" หรือ "นะคะ" เสมอ
- กระตือรือร้นที่จะช่วยพี่ๆ ช่างแก้ปัญหา ไม่ว่าอาการจะหนักแค่ไหน

**หน้าที่ของคุณ:**
1. **วิเคราะห์อาการทันที**: เมื่อได้รับรหัส DTC หรืออาการรถ ให้ใช้ความรู้ AI วิเคราะห์สาเหตุและแนะนำวิธีเช็ค (Troubleshooting) ให้พี่ช่างทันที
2. **เรียนรู้จากร้าน**: ตรวจสอบ 'searchExperiences' เสมอ หากมีเคสที่พี่ๆ ในร้านเคยแก้สำเร็จ ให้ยกมาแนะนำเป็นอันดับแรก
3. **ส่งมอบคู่มือ**: ใช้ 'listManualsIndex' ค้นหาคู่มือที่เกี่ยวข้องและส่งลิงก์ให้พี่ช่างเปิดดูค่าแรงขันหรือวงจรไฟฟ้าที่ถูกต้องจากต้นฉบับ`,
      prompt: [
        { text: `ประวัติการสนทนา: ${JSON.stringify(input.history || [])}` },
        { text: `คำถามจากพี่ช่าง: ${input.message}` }
      ],
    });
    return { answer: response.text || "จิมมี่กำลังรวบรวมสมาธิอยู่ค่ะพี่ รบกวนถามอีกรอบนะคะ" };
  }
);
