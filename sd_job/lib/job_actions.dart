import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'data_location.dart';
import 'job.dart';
import 'staff.dart';

const maxActivityPhotos = 10;
const maxActivityLogs = 50;

Future<void> runJobAction(Staff staff, JobRecord job, JobAction action) async {
  final db = appFirestore;
  final jobRef = db.collection('jobs').doc(job.id);
  final batch = db.batch();
  final patch = <String, Object?>{
    'lastActivityAt': FieldValue.serverTimestamp(),
    'updatedAt': FieldValue.serverTimestamp(),
  };
  final String text;

  switch (action) {
    case JobAction.accept:
      patch['status'] = 'IN_PROGRESS';
      patch['assigneeUid'] = staff.uid;
      patch['assigneeName'] = staff.displayName;
      text = 'ช่างรับงานเองเรียบร้อยแล้ว';
    case JobAction.requestQuotation:
      patch['status'] = 'WAITING_QUOTATION';
      text = 'แจ้งฝ่ายออฟฟิศเพื่อขอใบเสนอราคา (Request Quotation)';
    case JobAction.informCustomer:
      final docId = quotationDocId(job);
      if (docId != null) {
        batch.update(db.collection('documents').doc(docId), {
          'status': 'OFFERED',
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      patch['status'] = 'WAITING_APPROVE';
      patch['salesDocStatus'] = 'OFFERED';
      patch['quotationAwaitingOfficeResubmit'] = false;
      text = 'ส่งเอกสาร/แจ้งลูกค้าแล้ว (โดย ${staff.displayName}) — สถานะเป็นรอลูกค้าอนุมัติ';
    case JobAction.approve:
      patch['status'] = 'PENDING_PARTS';
      patch['salesDocStatus'] = 'APPROVED';
      text = 'ลูกค้าอนุมัติการซ่อมแล้ว';
    case JobAction.partsReady:
      patch['status'] = 'IN_REPAIR_PROCESS';
      text = 'อะไหล่มาครบแล้ว เริ่มดำเนินการซ่อม';
    case JobAction.skipParts:
      patch['partsWithdrawalWaived'] = true;
      if (job.status == 'PENDING_PARTS') patch['status'] = 'IN_REPAIR_PROCESS';
      text = 'ไม่ต้องเบิกอะไหล่ — แจ้งดำเนินการซ่อม';
    case JobAction.moreParts:
      patch['status'] = 'PENDING_PARTS';
      text = 'ช่างแจ้งเบิกอะไหล่เพิ่ม (สถานะเปลี่ยนเป็น: กำลังจัดเตรียมอะไหล่)';
    case JobAction.finish:
      patch['status'] = 'DONE';
      text = 'ช่างแจ้งซ่อมเสร็จสิ้น - รอดำเนินการทำบิล';
  }

  batch.update(jobRef, patch);
  batch.set(jobRef.collection('activities').doc(), {
    'text': text,
    'userName': staff.displayName,
    'userId': staff.uid,
    'createdAt': FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

Future<void> saveNotebook(JobRecord job, String text) async {
  await appFirestore.collection('jobs').doc(job.id).update({
    'technicalReport': text.trim(),
    'officeNote': FieldValue.delete(),
    'lastActivityAt': FieldValue.serverTimestamp(),
  });
}

Future<void> addProgressPhotos({
  required Staff staff,
  required JobRecord job,
  required String caption,
  required List<Uint8List> images,
}) async {
  final note = caption.trim();
  if (images.isEmpty) {
    throw StateError('กรุณาแนบรูปอย่างน้อย 1 รูป');
  }
  if (note.isEmpty) {
    throw StateError('กรุณาอธิบายว่ารูปนี้แสดงอะไร');
  }
  if (images.length > maxActivityPhotos) {
    throw StateError('แนบรูปได้สูงสุด $maxActivityPhotos รูปต่อครั้ง');
  }
  for (final bytes in images) {
    if (bytes.length >= 5 * 1024 * 1024) {
      throw StateError('รูปต้องเล็กกว่า 5 MB');
    }
  }

  final db = appFirestore;
  final jobRef = db.collection('jobs').doc(job.id);
  final total = (await jobRef.collection('activities').count().get()).count ?? 0;
  if (total >= maxActivityLogs) {
    throw StateError('รายการกิจกรรมเต็มแล้ว ไม่สามารถบันทึกเพิ่มได้');
  }

  final urls = <String>[];
  final storage = appStorage;
  for (var index = 0; index < images.length; index++) {
    final ref = storage.ref('jobs/${job.id}/activity/${DateTime.now().millisecondsSinceEpoch}-$index.jpg');
    await ref.putData(images[index], SettableMetadata(contentType: 'image/jpeg'));
    urls.add(await ref.getDownloadURL());
  }

  final batch = db.batch();
  final patch = <String, Object?>{
    'lastActivityAt': FieldValue.serverTimestamp(),
    'updatedAt': FieldValue.serverTimestamp(),
  };
  if (job.status == 'RECEIVED') {
    patch['status'] = 'IN_PROGRESS';
    if ((job.assigneeUid ?? '').isEmpty) {
      patch['assigneeUid'] = staff.uid;
      patch['assigneeName'] = staff.displayName;
    }
  }
  batch.update(jobRef, patch);
  batch.set(jobRef.collection('activities').doc(), {
    'text': 'แนบรูปกิจกรรม: $note',
    'userName': staff.displayName,
    'userId': staff.uid,
    'createdAt': FieldValue.serverTimestamp(),
    'photos': urls,
  });
  await batch.commit();
}
