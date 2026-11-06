const jobStatusLabels = <String, String>{
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

String jobStatusLabel(String? status) {
  if (status == null || status.isEmpty) return '';
  return jobStatusLabels[status] ?? status;
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
    required this.updatedAt,
    required this.detailLines,
    required this.photos,
    this.technicalReport = '',
    this.officeNote = '',
    this.salesDocId = '',
    this.salesDocType = '',
    this.salesDocStatus = '',
    this.assigneeName,
    this.assigneeUid,
    this.hasPartsWithdrawal = false,
    this.partsWithdrawalWaived = false,
    this.closedAt,
  });

  final String id;
  final String jobNo;
  final String customerName;
  final String phone;
  final String department;
  final String description;
  final String status;
  final DateTime? updatedAt;
  final List<(String, String)> detailLines;
  final List<String> photos;
  final String technicalReport;
  final String officeNote;
  final String salesDocId;
  final String salesDocType;
  final String salesDocStatus;
  final String? assigneeName;
  final String? assigneeUid;
  final bool hasPartsWithdrawal;
  final bool partsWithdrawalWaived;
  final DateTime? closedAt;

  String get displayNo => jobNo.isNotEmpty ? jobNo : id;

  String get notebook {
    final report = technicalReport.trim();
    if (report.isNotEmpty) return report;
    return officeNote.trim();
  }

  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    final haystack = [
      displayNo,
      id,
      customerName,
      phone,
      description,
      for (final line in detailLines) line.$2,
    ].join(' ').toLowerCase();
    return haystack.contains(q);
  }
}

bool historyVisible(JobRecord job, {int? month, required String query}) {
  if (month != null) {
    final when = job.closedAt ?? job.updatedAt;
    if (when == null || when.toLocal().month != month) return false;
  }
  final term = query.trim().toLowerCase();
  if (term.isEmpty) return true;
  final digits = term.replaceAll(RegExp(r'\D'), '');
  final phoneDigits = job.phone.replaceAll(RegExp(r'\D'), '');
  if (digits.isNotEmpty && phoneDigits.contains(digits)) return true;
  final haystack = [
    job.customerName,
    job.phone,
    for (final line in job.detailLines) line.$2,
  ].join(' ').toLowerCase();
  return haystack.contains(term);
}

bool jobVisible(JobRecord job, String statusFilter, String query) {
  if (statusFilter == 'OPEN') {
    if (job.status == 'CLOSED') return false;
  } else if (statusFilter.isNotEmpty && job.status != statusFilter) {
    return false;
  }
  return job.matches(query);
}

String formatJobTime(DateTime? time) {
  if (time == null) return '';
  final local = time.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}
