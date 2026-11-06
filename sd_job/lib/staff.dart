const shopDepartments = <(String, String)>[
  ('CAR_SERVICE', 'งานซ่อมหน้าร้าน'),
  ('COMMONRAIL', 'แผนกคอมมอนเรล'),
  ('MECHANIC', 'แผนกแมคคานิค'),
  ('OUTSOURCE', 'งานส่งออกร้านนอก'),
];

enum BoardKind { allShops, oneShop, assignedOnly, blocked }

class BoardAccess {
  const BoardAccess._(this.kind, {this.department, this.assigneeUid, this.message = ''});

  final BoardKind kind;
  final String? department;
  final String? assigneeUid;
  final String message;

  static const blockedInactive = BoardAccess._(
    BoardKind.blocked,
    message: 'บัญชีนี้ถูกปิดการใช้งาน',
  );
  static const blockedRole = BoardAccess._(
    BoardKind.blocked,
    message: 'บัญชีนี้ใช้ดูงานแผนกไม่ได้',
  );
  static const blockedNoShop = BoardAccess._(
    BoardKind.blocked,
    message: 'บัญชีนี้ไม่ได้ผูกกับแผนกซ่อม ใช้เว็บสำหรับงานของแผนกนั้น',
  );
}

class Staff {
  const Staff({
    required this.uid,
    required this.displayName,
    required this.role,
    this.department,
    this.status,
    this.linkedVendorId,
  });

  final String uid;
  final String displayName;
  final String role;
  final String? department;
  final String? status;
  final String? linkedVendorId;

  bool get isOfficeOrManager {
    return role == 'ADMIN' ||
        role == 'MANAGER' ||
        department == 'OFFICE' ||
        department == 'MANAGEMENT';
  }

  BoardAccess get board {
    final accountStatus = status?.trim() ?? '';
    if (accountStatus.isNotEmpty && accountStatus != 'ACTIVE') {
      return BoardAccess.blockedInactive;
    }
    if (role.isEmpty || role == 'VIEWER' || role == 'CUSTOMER') {
      return BoardAccess.blockedRole;
    }
    if (role == 'ADMIN' || department == 'OFFICE' || department == 'MANAGEMENT') {
      return const BoardAccess._(BoardKind.allShops);
    }
    if (department == 'OUTSOURCE' && role == 'WORKER') {
      final assignee = (linkedVendorId ?? '').trim();
      return BoardAccess._(
        BoardKind.assignedOnly,
        department: 'OUTSOURCE',
        assigneeUid: assignee.isEmpty ? uid : assignee,
      );
    }
    if (shopDepartments.any((item) => item.$1 == department)) {
      return BoardAccess._(BoardKind.oneShop, department: department);
    }
    return BoardAccess.blockedNoShop;
  }
}

String shopLabel(String? code) {
  for (final item in shopDepartments) {
    if (item.$1 == code) return item.$2;
  }
  return code ?? '';
}
