import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'data_location.dart';
import 'job_record.dart';
import 'staff_session.dart';

const maxActivityPhotos = 10;
const maxActivityLogs = 50;

enum IntakeAction { requestQuotation, informCustomer, approve, partsReady, skipParts, moreParts, finish }

String? quotationDocId(JobRecord job) {
  if (job.salesDocType != 'QUOTATION' || job.salesDocId.isEmpty) return null;
  if (job.salesDocStatus.toUpperCase() == 'CANCELLED') return null;
  return job.salesDocId;
}

bool quotationIssued(JobRecord job) {
  if (quotationDocId(job) == null) return false;
  return job.salesDocStatus.toUpperCase() != 'DRAFT';
}

bool _approved(JobRecord job) {
  if (!quotationIssued(job)) return false;
  if (job.salesDocStatus.toUpperCase() == 'APPROVED') return true;
  return job.status == 'PENDING_PARTS' || job.status == 'IN_REPAIR_PROCESS';
}

bool _partsReady(JobRecord job) => job.partsWithdrawalWaived || job.hasPartsWithdrawal;

List<IntakeAction> intakeActions(JobRecord job) {
  final actions = <IntakeAction>[];
  if (job.status == 'IN_PROGRESS') actions.add(IntakeAction.requestQuotation);
  if (quotationIssued(job) && (job.status == 'WAITING_QUOTATION' || job.status == 'PENDING_CUSTOMER_INFORM')) {
    actions.add(IntakeAction.informCustomer);
  }
  if (job.status == 'WAITING_APPROVE') actions.add(IntakeAction.approve);
  final approved = _approved(job);
  if (job.status == 'PENDING_PARTS' && approved && job.hasPartsWithdrawal) actions.add(IntakeAction.partsReady);
  if ((job.status == 'PENDING_PARTS' || job.status == 'IN_REPAIR_PROCESS') && approved && !_partsReady(job)) {
    actions.add(IntakeAction.skipParts);
  }
  if (job.status == 'IN_REPAIR_PROCESS' && approved && _partsReady(job)) actions.add(IntakeAction.moreParts);
  if (job.status == 'IN_REPAIR_PROCESS') actions.add(IntakeAction.finish);
  return actions;
}

String intakeActionLabel(IntakeAction action) {
  switch (action) {
    case IntakeAction.requestQuotation:
      return 'แจ้งเสนอราคา';
    case IntakeAction.informCustomer:
      return 'แจ้งราคาลูกค้า';
    case IntakeAction.approve:
      return 'อนุมัติเริ่มซ่อม';
    case IntakeAction.partsReady:
      return 'อะไหล่มาครบแล้ว (เริ่มซ่อม)';
    case IntakeAction.skipParts:
      return 'ไม่ต้องเบิกอะไหล่';
    case IntakeAction.moreParts:
      return 'แจ้งเบิกอะไหล่เพิ่ม';
    case IntakeAction.finish:
      return 'งานเสร็จแจ้งทำบิล';
  }
}

String intakeActionConfirm(IntakeAction action) {
  switch (action) {
    case IntakeAction.requestQuotation:
      return 'แจ้งฝ่ายออฟฟิศเพื่อออกใบเสนอราคาใช่ไหม?';
    case IntakeAction.informCustomer:
      return 'ยืนยันว่าแจ้งราคาให้ลูกค้าแล้ว และเปลี่ยนสถานะเป็นรอลูกค้าอนุมัติใช่ไหม?';
    case IntakeAction.approve:
      return 'ยืนยันว่าลูกค้าอนุมัติแล้ว และเปลี่ยนสถานะเป็นกำลังจัดอะไหล่ใช่ไหม?';
    case IntakeAction.partsReady:
      return 'ยืนยันว่าอะไหล่มาครบ และเริ่มดำเนินการซ่อมใช่ไหม?';
    case IntakeAction.skipParts:
      return 'งานนี้ไม่ต้องเบิกอะไหล่จากสต๊อก และพร้อมเริ่มซ่อมใช่ไหม?';
    case IntakeAction.moreParts:
      return 'ยืนยันว่าต้องเบิกอะไหล่เพิ่มใช่ไหม? ใบเบิกตัวจริงทำต่อบนเว็บ';
    case IntakeAction.finish:
      return 'ซ่อมเสร็จแล้ว และต้องการส่งไปรอทำบิลใช่ไหม?';
  }
}

Future<void> runIntakeAction(StaffSession staff, JobRecord job, IntakeAction action) async {
  final db = appFirestore;
  final jobRef = db.collection('jobs').doc(job.id);
  final batch = db.batch();
  final patch = <String, Object?>{
    'lastActivityAt': FieldValue.serverTimestamp(),
    'updatedAt': FieldValue.serverTimestamp(),
  };
  final String text;
  switch (action) {
    case IntakeAction.requestQuotation:
      patch['status'] = 'WAITING_QUOTATION';
      text = 'แจ้งฝ่ายออฟฟิศเพื่อขอใบเสนอราคา (Request Quotation)';
    case IntakeAction.informCustomer:
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
    case IntakeAction.approve:
      patch['status'] = 'PENDING_PARTS';
      patch['salesDocStatus'] = 'APPROVED';
      text = 'ลูกค้าอนุมัติการซ่อมแล้ว';
    case IntakeAction.partsReady:
      patch['status'] = 'IN_REPAIR_PROCESS';
      text = 'อะไหล่มาครบแล้ว เริ่มดำเนินการซ่อม';
    case IntakeAction.skipParts:
      patch['partsWithdrawalWaived'] = true;
      if (job.status == 'PENDING_PARTS') patch['status'] = 'IN_REPAIR_PROCESS';
      text = 'ไม่ต้องเบิกอะไหล่ — แจ้งดำเนินการซ่อม';
    case IntakeAction.moreParts:
      patch['status'] = 'PENDING_PARTS';
      text = 'ช่างแจ้งเบิกอะไหล่เพิ่ม (สถานะเปลี่ยนเป็น: กำลังจัดเตรียมอะไหล่)';
    case IntakeAction.finish:
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
  required StaffSession staff,
  required JobRecord job,
  required String caption,
  required List<Uint8List> images,
}) async {
  final note = caption.trim();
  if (images.isEmpty) throw StateError('กรุณาแนบรูปอย่างน้อย 1 รูป');
  if (note.isEmpty) throw StateError('กรุณาอธิบายว่ารูปนี้แสดงอะไร');
  if (images.length > maxActivityPhotos) throw StateError('แนบรูปได้สูงสุด $maxActivityPhotos รูปต่อครั้ง');
  for (final bytes in images) {
    if (bytes.length >= 5 * 1024 * 1024) throw StateError('รูปต้องเล็กกว่า 5 MB');
  }
  final db = appFirestore;
  final jobRef = db.collection('jobs').doc(job.id);
  final total = (await jobRef.collection('activities').count().get()).count ?? 0;
  if (total >= maxActivityLogs) throw StateError('รายการกิจกรรมเต็มแล้ว ไม่สามารถบันทึกเพิ่มได้');

  final urls = <String>[];
  for (var index = 0; index < images.length; index++) {
    final ref = appStorage.ref('jobs/${job.id}/activity/${DateTime.now().millisecondsSinceEpoch}-$index.jpg');
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

Future<void> sendCustomerChat(StaffSession staff, String jobId, String text) async {
  final note = text.trim();
  if (note.isEmpty) return;
  await appFirestore.collection('jobs').doc(jobId).collection('customerChat').add({
    'text': note,
    'authorRole': 'STAFF',
    'userName': staff.displayName,
    'userId': staff.uid,
    'createdAt': FieldValue.serverTimestamp(),
  });
}

Future<void> markCustomerChatRead(String uid, String jobId) async {
  await appFirestore.collection('users').doc(uid).collection('jobCustomerChatReads').doc('summary').set({
    'reads': {jobId: FieldValue.serverTimestamp()},
    'updatedAt': FieldValue.serverTimestamp(),
  }, SetOptions(merge: true));
}
