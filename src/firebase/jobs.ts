'use client';

import type { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type CreateJobDepartment = 'OFFICE' | 'CAR_SERVICE' | 'COMMONRAIL' | 'MECHANIC' | 'OUTSOURCE';

/** ส่งให้ Cloud Function `createJob` — รูปต้องอัปโหลดเข้า Storage ใต้ jobs/ ก่อน */
export type CreateJobInput = {
  customerId: string;
  department: CreateJobDepartment;
  description: string;
  photos: string[];
  carServiceDetails?: {
    brand?: string;
    model?: string;
    licensePlate?: string;
  };
  commonrailDetails?: {
    brand?: string;
    partNumber?: string;
    registrationNumber?: string;
  };
  mechanicDetails?: {
    brand?: string;
    partNumber?: string;
    registrationNumber?: string;
  };
};

function isFirebaseLikeError(e: unknown): e is { code: string; message?: string } {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

function formatCreateJobError(error: unknown): string {
  if (isFirebaseLikeError(error)) {
    const code = error.code;
    if (code === 'functions/not-found') {
      return 'ยังไม่ deploy ฟังก์ชันสร้างใบงาน — แจ้งผู้ดูแลให้รัน firebase deploy --only functions:createJob';
    }
    if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จชั่วคราว กรุณาลองใหม่';
    }
    const msg = typeof error.message === 'string' ? error.message.trim() : '';
    if (msg && !/^internal$/i.test(msg)) return msg;
    return 'สร้างงานไม่สำเร็จ';
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'สร้างงานไม่สำเร็จ';
}

/**
 * เปิดใบงานผ่าน Cloud Function เดียวกันกับแอป Android
 * เลขที่ใบงาน ลูกค้า และสิทธิ์ถูกตรวจบนเซิร์ฟเวอร์
 */
export async function createJob(
  firebaseApp: FirebaseApp,
  input: CreateJobInput
): Promise<{ jobId: string; jobNo: string }> {
  try {
    const fn = httpsCallable<CreateJobInput, { jobId: string; jobNo: string }>(
      getFunctions(firebaseApp, 'us-central1'),
      'createJob'
    );
    const res = await fn(input);
    const jobId = res.data?.jobId;
    const jobNo = res.data?.jobNo;
    if (!jobId || !jobNo) {
      throw new Error('เซิร์ฟเวอร์ไม่ส่งเลขที่ใบงานกลับมา');
    }
    return { jobId, jobNo };
  } catch (error) {
    throw new Error(formatCreateJobError(error));
  }
}
