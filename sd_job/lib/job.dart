import 'package:cloud_firestore/cloud_firestore.dart';

import 'data_location.dart';
import 'staff.dart';

const departmentViewStatuses = [
  'RECEIVED',
  'IN_PROGRESS',
  'WAITING_QUOTATION',
  'PENDING_CUSTOMER_INFORM',
  'WAITING_APPROVE',
  'PENDING_PARTS',
  'IN_REPAIR_PROCESS',
];

const statusLabels = <String, String>{
  'RECEIVED': 'รอช่างรับงาน',
  'IN_PROGRESS': 'กำลังตรวจสอบ',
  'WAITING_QUOTATION': 'รอเสนอราคา',
  'PENDING_CUSTOMER_INFORM': 'รอแจ้งลูกค้า',
  'WAITING_APPROVE': 'รอลูกค้าอนุมัติ',
  'PENDING_PARTS': 'กำลังจัดเตรียมอะไหล่',
  'IN_REPAIR_PROCESS': 'กำลังดำเนินการซ่อม',
  'DONE': 'ทำเสร็จรอทำบิล',
  'WAITING_CUSTOMER_PICKUP': 'รอลูกค้ารับสินค้า',
  'PICKED_UP': 'รับสินค้าแล้ว',
  'CLOSED': 'ปิดงาน',
};

String statusLabel(String status) => statusLabels[status] ?? status;

enum JobAction {
  accept,
  requestQuotation,
  informCustomer,
  approve,
  partsReady,
  skipParts,
  moreParts,
  finish,
}

class JobRecord {
  const JobRecord({
    required this.id,
    required this.jobNo,
    required this.customerName,
    required this.phone,
    required this.department,
    required this.description,
    required this.status,
    required this.detailLines,
    required this.photos,
    required this.salesDocId,
    required this.salesDocType,
    required this.salesDocStatus,
    required this.hasPartsWithdrawal,
    required this.partsWithdrawalWaived,
    this.assigneeName,
    this.assigneeUid,
    this.technicalReport = '',
    this.officeNote = '',
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String jobNo;
  final String customerName;
  final String phone;
  final String department;
  final String description;
  final String status;
  final List<(String, String)> detailLines;
  final List<String> photos;
  final String salesDocId;
  final String salesDocType;
  final String salesDocStatus;
  final bool hasPartsWithdrawal;
  final bool partsWithdrawalWaived;
  final String? assigneeName;
  final String? assigneeUid;
  final String technicalReport;
  final String officeNote;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  String get displayNo => jobNo.isNotEmpty ? jobNo : id;

  String get notebook {
    final report = technicalReport.trim();
    if (report.isNotEmpty) return report;
    return officeNote.trim();
  }
}

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

  final photos = photoUrls(data['photos']);

  return JobRecord(
    id: id,
    jobNo: _text(data['jobNo']),
    customerName: _text(snapshot['name']).isNotEmpty ? _text(snapshot['name']) : 'ไม่ระบุชื่อ',
    phone: _text(snapshot['phone']),
    department: _text(data['department']),
    description: _text(data['description']),
    status: _text(data['status']),
    detailLines: details,
    photos: photos,
    salesDocId: _text(data['salesDocId']),
    salesDocType: _text(data['salesDocType']),
    salesDocStatus: _text(data['salesDocStatus']),
    hasPartsWithdrawal: data['hasPartsWithdrawal'] == true,
    partsWithdrawalWaived: data['partsWithdrawalWaived'] == true,
    assigneeName: _text(data['assigneeName']).isEmpty ? null : _text(data['assigneeName']),
    assigneeUid: _text(data['assigneeUid']).isEmpty ? null : _text(data['assigneeUid']),
    technicalReport: _text(data['technicalReport']),
    officeNote: _text(data['officeNote']),
    createdAt: _time(data['createdAt']),
    updatedAt: _time(data['lastActivityAt']) ?? _time(data['updatedAt']),
  );
}

List<String> photoUrls(dynamic value) {
  return [
    for (final item in (value as List?) ?? const [])
      if (item is String && item.trim().isNotEmpty) storageFileUrl(item.trim()),
  ];
}

int jobAgeDays(JobRecord job, [DateTime? now]) {
  final start = job.createdAt ?? job.updatedAt;
  if (start == null) return 0;
  final clock = now ?? DateTime.now();
  final days = clock.difference(start).inMilliseconds ~/ Duration.millisecondsPerDay + 1;
  return days < 1 ? 1 : days;
}

String? quotationDocId(JobRecord job) {
  if (job.salesDocType != 'QUOTATION' || job.salesDocId.isEmpty) return null;
  if (job.salesDocStatus.toUpperCase() == 'CANCELLED') return null;
  return job.salesDocId;
}

bool quotationIssued(JobRecord job) {
  if (quotationDocId(job) == null) return false;
  return job.salesDocStatus.toUpperCase() != 'DRAFT';
}

bool customerApprovedForParts(JobRecord job) {
  if (!quotationIssued(job)) return false;
  if (job.salesDocStatus.toUpperCase() == 'APPROVED') return true;
  return job.status == 'PENDING_PARTS' || job.status == 'IN_REPAIR_PROCESS';
}

bool partsStepSatisfied(JobRecord job) {
  return job.partsWithdrawalWaived || job.hasPartsWithdrawal;
}

bool jobMatchesSearch(JobRecord job, String term) {
  final query = term.trim().toLowerCase();
  if (query.isEmpty) return true;
  final haystack = [
    job.customerName,
    job.phone,
    job.description,
    job.jobNo,
    job.id,
    for (final line in job.detailLines) line.$2,
  ].join(' ').toLowerCase();
  return haystack.contains(query);
}

List<JobAction> jobActions(Staff staff, JobRecord job) {
  final actions = <JobAction>[];
  final ownShop = staff.department != null && staff.department == job.department;
  final shopStaff = ownShop && shopDepartments.any((item) => item.$1 == staff.department);
  if (job.status == 'RECEIVED' && (staff.role == 'ADMIN' || staff.role == 'MANAGER' || shopStaff)) {
    actions.add(JobAction.accept);
  }
  if (job.status == 'IN_PROGRESS') actions.add(JobAction.requestQuotation);
  if (staff.isOfficeOrManager &&
      quotationIssued(job) &&
      (job.status == 'WAITING_QUOTATION' || job.status == 'PENDING_CUSTOMER_INFORM')) {
    actions.add(JobAction.informCustomer);
  }
  if (staff.isOfficeOrManager && job.status == 'WAITING_APPROVE') {
    actions.add(JobAction.approve);
  }
  final approved = customerApprovedForParts(job);
  if (job.status == 'PENDING_PARTS' && approved && job.hasPartsWithdrawal) {
    actions.add(JobAction.partsReady);
  }
  if ((job.status == 'PENDING_PARTS' || job.status == 'IN_REPAIR_PROCESS') &&
      approved &&
      !partsStepSatisfied(job)) {
    actions.add(JobAction.skipParts);
  }
  if (job.status == 'IN_REPAIR_PROCESS' && approved && partsStepSatisfied(job)) {
    actions.add(JobAction.moreParts);
  }
  if (job.status == 'IN_REPAIR_PROCESS') actions.add(JobAction.finish);
  return actions;
}

String actionLabel(JobAction action) {
  switch (action) {
    case JobAction.accept:
      return 'รับงาน';
    case JobAction.requestQuotation:
      return 'แจ้งเสนอราคา';
    case JobAction.informCustomer:
      return 'แจ้งราคาลูกค้า';
    case JobAction.approve:
      return 'ลูกค้าอนุมัติ';
    case JobAction.partsReady:
      return 'อะไหล่มาครบแล้ว';
    case JobAction.skipParts:
      return 'ไม่ต้องเบิกอะไหล่';
    case JobAction.moreParts:
      return 'แจ้งเบิกอะไหล่เพิ่ม';
    case JobAction.finish:
      return 'แจ้งงานจบ';
  }
}

String actionConfirm(JobAction action) {
  switch (action) {
    case JobAction.accept:
      return 'ยืนยันว่าพร้อมรับงานนี้และเริ่มตรวจสอบใช่ไหม?';
    case JobAction.requestQuotation:
      return 'แจ้งฝ่ายออฟฟิศเพื่อออกใบเสนอราคาใช่ไหม?';
    case JobAction.informCustomer:
      return 'ยืนยันว่าแจ้งราคาให้ลูกค้าแล้ว และเปลี่ยนสถานะเป็นรอลูกค้าอนุมัติใช่ไหม?';
    case JobAction.approve:
      return 'ยืนยันว่าลูกค้าอนุมัติแล้ว และเปลี่ยนสถานะเป็นกำลังจัดอะไหล่ใช่ไหม?';
    case JobAction.partsReady:
      return 'ยืนยันว่าอะไหล่มาครบ และเริ่มดำเนินการซ่อมใช่ไหม?';
    case JobAction.skipParts:
      return 'งานนี้ไม่ต้องเบิกอะไหล่จากสต๊อก และพร้อมเริ่มซ่อมใช่ไหม?';
    case JobAction.moreParts:
      return 'ยืนยันว่าต้องเบิกอะไหล่เพิ่ม และเปลี่ยนสถานะไปรออะไหล่ใช่ไหม? ใบเบิกตัวจริงทำต่อบนเว็บ';
    case JobAction.finish:
      return 'ซ่อมเสร็จแล้ว และต้องการส่งไปรอทำบิลใช่ไหม?';
  }
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
