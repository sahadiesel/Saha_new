import 'package:flutter_test/flutter_test.dart';
import 'package:sdjob/job.dart';
import 'package:sdjob/staff.dart';

void main() {
  const worker = Staff(uid: 'w1', displayName: 'ช่าง', role: 'WORKER', department: 'CAR_SERVICE', status: 'ACTIVE');
  const office = Staff(uid: 'o1', displayName: 'ออฟฟิศ', role: 'OFFICER', department: 'OFFICE', status: 'ACTIVE');
  const admin = Staff(uid: 'a1', displayName: 'แอดมิน', role: 'ADMIN', department: 'MANAGEMENT', status: 'ACTIVE');

  JobRecord job({required String status, String department = 'CAR_SERVICE', String salesDocStatus = '', bool withdrawn = false, bool waived = false}) {
    return JobRecord(
      id: 'job1',
      jobNo: 'SJ1',
      customerName: 'ลูกค้า',
      phone: '081',
      department: department,
      description: 'ซ่อม',
      status: status,
      detailLines: const [],
      photos: const [],
      salesDocId: salesDocStatus.isEmpty ? '' : 'doc1',
      salesDocType: salesDocStatus.isEmpty ? '' : 'QUOTATION',
      salesDocStatus: salesDocStatus,
      hasPartsWithdrawal: withdrawn,
      partsWithdrawalWaived: waived,
    );
  }

  test('shop staff see only their department', () {
    expect(worker.board.kind, BoardKind.oneShop);
    expect(worker.board.department, 'CAR_SERVICE');
  });

  test('office and admin see every shop', () {
    expect(office.board.kind, BoardKind.allShops);
    expect(admin.board.kind, BoardKind.allShops);
  });

  test('outsource worker sees assigned jobs only', () {
    const vendor = Staff(uid: 'u1', displayName: 'นอก', role: 'WORKER', department: 'OUTSOURCE', linkedVendorId: 'vendor-1', status: 'ACTIVE');
    expect(vendor.board.kind, BoardKind.assignedOnly);
    expect(vendor.board.assigneeUid, 'vendor-1');
  });

  test('customer and inactive accounts are blocked', () {
    const customer = Staff(uid: 'c', displayName: 'ลูกค้า', role: 'CUSTOMER', status: 'ACTIVE');
    const paused = Staff(uid: 'p', displayName: 'พัก', role: 'WORKER', department: 'MECHANIC', status: 'INACTIVE');
    expect(customer.board.kind, BoardKind.blocked);
    expect(paused.board.kind, BoardKind.blocked);
  });

  test('worker in the same department can accept a received job', () {
    expect(jobActions(worker, job(status: 'RECEIVED')), contains(JobAction.accept));
    expect(jobActions(worker, job(status: 'RECEIVED', department: 'MECHANIC')), isNot(contains(JobAction.accept)));
  });

  test('checking a job can request a quotation and finish only while repairing', () {
    expect(jobActions(worker, job(status: 'IN_PROGRESS')), [JobAction.requestQuotation]);
    expect(jobActions(worker, job(status: 'IN_REPAIR_PROCESS')), contains(JobAction.finish));
  });

  test('office informs the customer only after a real quotation exists', () {
    expect(jobActions(office, job(status: 'WAITING_QUOTATION', salesDocStatus: 'FINAL')), contains(JobAction.informCustomer));
    expect(jobActions(office, job(status: 'WAITING_QUOTATION', salesDocStatus: 'DRAFT')), isNot(contains(JobAction.informCustomer)));
    expect(jobActions(worker, job(status: 'WAITING_QUOTATION', salesDocStatus: 'FINAL')), isNot(contains(JobAction.informCustomer)));
  });

  test('approval moves toward parts and parts-ready needs a withdrawal', () {
    expect(jobActions(office, job(status: 'WAITING_APPROVE', salesDocStatus: 'OFFERED')), contains(JobAction.approve));
    final ready = job(status: 'PENDING_PARTS', salesDocStatus: 'APPROVED', withdrawn: true);
    expect(jobActions(worker, ready), contains(JobAction.partsReady));
    expect(jobActions(worker, job(status: 'PENDING_PARTS', salesDocStatus: 'APPROVED')), contains(JobAction.skipParts));
  });

  test('notebook shows the technician note before an older office note', () {
    const record = JobRecord(
      id: 'j',
      jobNo: '',
      customerName: 'a',
      phone: '',
      department: 'CAR_SERVICE',
      description: '',
      status: 'IN_PROGRESS',
      detailLines: [],
      photos: [],
      salesDocId: '',
      salesDocType: '',
      salesDocStatus: '',
      hasPartsWithdrawal: false,
      partsWithdrawalWaived: false,
      technicalReport: 'สาเหตุ: หัวฉีดตัน',
      officeNote: 'บันทึกเก่า',
    );
    expect(record.notebook, 'สาเหตุ: หัวฉีดตัน');
  });

  test('age counts the creation day as day one', () {
    final created = DateTime(2026, 11, 1, 8);
    final record = JobRecord(
      id: 'j',
      jobNo: '',
      customerName: 'a',
      phone: '',
      department: 'CAR_SERVICE',
      description: '',
      status: 'RECEIVED',
      detailLines: const [],
      photos: const [],
      salesDocId: '',
      salesDocType: '',
      salesDocStatus: '',
      hasPartsWithdrawal: false,
      partsWithdrawalWaived: false,
      createdAt: created,
    );
    expect(jobAgeDays(record, DateTime(2026, 11, 1, 20)), 1);
    expect(jobAgeDays(record, DateTime(2026, 11, 8, 9)), 8);
  });
}
