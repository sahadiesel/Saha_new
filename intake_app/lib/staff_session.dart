class StaffSession {
  const StaffSession({
    required this.uid,
    required this.displayName,
    required this.role,
    this.department,
  });

  final String uid;
  final String displayName;
  final String role;
  final String? department;
}
