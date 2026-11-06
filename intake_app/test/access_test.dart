import 'package:flutter_test/flutter_test.dart';
import 'package:intake/access.dart';
import 'package:intake/job_record.dart';
import 'package:intake/job_updates.dart';

void main() {
  test('admin and office staff can open jobs', () {
    expect(canOpenJob(role: 'ADMIN', department: 'MANAGEMENT', status: 'ACTIVE'), isTrue);
    expect(canOpenJob(role: 'MANAGER', department: 'CAR_SERVICE', status: 'ACTIVE'), isTrue);
    expect(canOpenJob(role: 'OFFICER', department: 'OFFICE', status: 'ACTIVE'), isTrue);
    expect(canOpenJob(role: 'ADMIN', status: null), isTrue);
  });

  test('open-job list hides closed jobs and matches a search', () {
    const open = JobRecord(
      id: 'abc',
      jobNo: 'SJ2026-1299',
      customerName: 'เจ๊เป้า',
      phone: '0815409022',
      department: 'COMMONRAIL',
      description: 'หัวฉีดไม่จ่าย',
      status: 'RECEIVED',
      updatedAt: null,
      detailLines: [('ทะเบียน', 'กข 1234')],
      photos: [],
    );
    const closed = JobRecord(
      id: 'def',
      jobNo: 'SJ2026-1000',
      customerName: 'ปิดแล้ว',
      phone: '',
      department: 'OFFICE',
      description: '',
      status: 'CLOSED',
      updatedAt: null,
      detailLines: [],
      photos: [],
    );

    expect(jobVisible(open, 'OPEN', ''), isTrue);
    expect(jobVisible(closed, 'OPEN', ''), isFalse);
    expect(jobVisible(open, 'OPEN', 'กข 1234'), isTrue);
    expect(jobVisible(open, 'RECEIVED', 'ไม่พบ'), isFalse);
  });

  test('viewers, customers, and other departments cannot open jobs', () {
    expect(canOpenJob(role: 'VIEWER', department: 'OFFICE', status: 'ACTIVE'), isFalse);
    expect(canOpenJob(role: 'CUSTOMER', department: 'OFFICE', status: 'ACTIVE'), isFalse);
    expect(canOpenJob(role: 'WORKER', department: 'MECHANIC', status: 'ACTIVE'), isFalse);
    expect(canOpenJob(role: 'ADMIN', department: 'MANAGEMENT', status: 'SUSPENDED'), isFalse);
  });

  test('office detail can finish a repair and keeps the technician notebook', () {
    const repairing = JobRecord(
      id: 'job',
      jobNo: 'SJ1',
      customerName: 'ลูกค้า',
      phone: '',
      department: 'MECHANIC',
      description: '',
      status: 'IN_REPAIR_PROCESS',
      updatedAt: null,
      detailLines: [],
      photos: [],
      technicalReport: 'หัวฉีดตัน',
      salesDocId: 'doc1',
      salesDocType: 'QUOTATION',
      salesDocStatus: 'APPROVED',
      hasPartsWithdrawal: true,
    );
    expect(repairing.notebook, 'หัวฉีดตัน');
    expect(intakeActions(repairing), contains(IntakeAction.finish));
  });

  test('repair history filters by month, name, phone, and plate', () {
    final closed = JobRecord(
      id: 'hist',
      jobNo: 'SJ2026-1301',
      customerName: 'เฮียสาโรจน์ มาเลย์',
      phone: '081-094-3888',
      department: 'CAR_SERVICE',
      description: 'เช็คหัวฉีด',
      status: 'CLOSED',
      updatedAt: DateTime(2026, 10, 1),
      detailLines: [('ทะเบียน', 'PLW9333')],
      photos: [],
      closedAt: DateTime(2026, 11, 6),
    );
    expect(historyVisible(closed, month: 11, query: ''), isTrue);
    expect(historyVisible(closed, month: 10, query: ''), isFalse);
    expect(historyVisible(closed, query: 'สาโรจน์'), isTrue);
    expect(historyVisible(closed, query: '0810943888'), isTrue);
    expect(historyVisible(closed, query: 'plw9333'), isTrue);
    expect(historyVisible(closed, query: 'ไม่มีชื่อนี้'), isFalse);
  });
}
