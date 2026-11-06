/// สิทธิ์เดียวกับ Cloud Function `createJob`
bool canOpenJob({
  required String role,
  String? department,
  String? status,
}) {
  if (status != null && status.isNotEmpty && status != 'ACTIVE') {
    return false;
  }
  if (role.isEmpty || role == 'VIEWER' || role == 'CUSTOMER') {
    return false;
  }
  return role == 'ADMIN' || role == 'MANAGER' || department == 'OFFICE';
}

const jobDepartments = <(String, String)>[
  ('OFFICE', 'แผนกออฟฟิศ'),
  ('CAR_SERVICE', 'งานซ่อมหน้าร้าน'),
  ('COMMONRAIL', 'แผนกคอมมอนเรล'),
  ('MECHANIC', 'แผนกแมคคานิค'),
  ('OUTSOURCE', 'งานนอก'),
];

String departmentLabel(String? code) {
  for (final item in jobDepartments) {
    if (item.$1 == code) return item.$2;
  }
  return code ?? '';
}
