class StaffCreationResult {
  const StaffCreationResult({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.temporaryPassword,
    required this.mustChangePassword,
    required this.emailSent,
    this.emailDetail,
  });

  final String id;
  final String email;
  final String fullName;
  final String role;
  final String temporaryPassword;
  final bool mustChangePassword;
  final bool emailSent;
  final String? emailDetail;

  factory StaffCreationResult.fromJson(Map<String, dynamic> json) {
    return StaffCreationResult(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      role: json['role'] as String? ?? 'teacher',
      temporaryPassword: json['temporaryPassword'] as String? ?? '',
      mustChangePassword: json['mustChangePassword'] as bool? ?? true,
      emailSent: json['emailSent'] as bool? ?? false,
      emailDetail: json['emailDetail'] as String?,
    );
  }
}
