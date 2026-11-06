import 'package:cloud_firestore/cloud_firestore.dart';

import 'data_location.dart';
import 'job_record.dart';

JobRecord jobFromDoc(String id, Map<String, dynamic> data) {
  final snapshot = _map(data['customerSnapshot']);
  final details = <(String, String)>[];

  void addMap(Map<String, dynamic> source, List<(String, String)> labels) {
    for (final label in labels) {
      final value = _text(source[label.$1]);
      if (value.isNotEmpty) details.add((label.$2, value));
    }
  }

  addMap(_map(data['carServiceDetails']), const [
    ('brand', 'ยี่ห้อ'),
    ('model', 'รุ่น'),
    ('licensePlate', 'ทะเบียน'),
  ]);
  if (!details.any((line) => line.$1 == 'ทะเบียน')) {
    final plate = _text(_map(data['carSnapshot'])['licensePlate']);
    if (plate.isNotEmpty) details.add(('ทะเบียน', plate));
  }
  addMap(_map(data['commonrailDetails']), const [
    ('brand', 'ยี่ห้อ'),
    ('partNumber', 'เลขอะไหล่'),
    ('registrationNumber', 'เลขทะเบียนชิ้นส่วน'),
  ]);
  addMap(_map(data['mechanicDetails']), const [
    ('brand', 'ยี่ห้อ'),
    ('partNumber', 'เลขอะไหล่'),
    ('registrationNumber', 'เลขทะเบียนชิ้นส่วน'),
  ]);

  final photos = <String>[
    for (final item in (data['photos'] as List?) ?? const [])
      if (item is String && item.trim().isNotEmpty) storageFileUrl(item.trim()),
  ];

  return JobRecord(
    id: id,
    jobNo: _text(data['jobNo']),
    customerName: _text(snapshot['name']).isNotEmpty ? _text(snapshot['name']) : 'ไม่ระบุชื่อ',
    phone: _text(snapshot['phone']),
    department: _text(data['department']),
    description: _text(data['description']),
    status: _text(data['status']),
    updatedAt: _time(data['lastActivityAt']) ?? _time(data['updatedAt']),
    detailLines: details,
    photos: photos,
    technicalReport: _text(data['technicalReport']),
    officeNote: _text(data['officeNote']),
    salesDocId: _text(data['salesDocId']),
    salesDocType: _text(data['salesDocType']),
    salesDocStatus: _text(data['salesDocStatus']),
    assigneeName: _text(data['assigneeName']).isEmpty ? null : _text(data['assigneeName']),
    assigneeUid: _text(data['assigneeUid']).isEmpty ? null : _text(data['assigneeUid']),
    hasPartsWithdrawal: data['hasPartsWithdrawal'] == true,
    partsWithdrawalWaived: data['partsWithdrawalWaived'] == true,
    closedAt: _time(data['closedAt']) ?? _closedDate(data['closedDate']),
  );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

String _text(dynamic value) {
  if (value is String) return value.trim();
  return '';
}

DateTime? _time(dynamic value) {
  if (value is Timestamp) return value.toDate();
  return null;
}

DateTime? _closedDate(dynamic value) {
  if (value is! String || value.trim().length < 7) return null;
  return DateTime.tryParse(value.trim());
}
