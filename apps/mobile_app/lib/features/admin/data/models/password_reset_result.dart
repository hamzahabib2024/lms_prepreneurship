class PasswordResetResult {
  const PasswordResetResult({
    required this.id,
    required this.fullName,
    required this.temporaryPassword,
    required this.mustChangePassword,
    required this.emailSent,
    this.emailDetail,
  });

  final String id;
  final String fullName;
  final String temporaryPassword;
  final bool mustChangePassword;
  final bool emailSent;
  final String? emailDetail;

  factory PasswordResetResult.fromJson(Map<String, dynamic> json) {
    return PasswordResetResult(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      temporaryPassword: json['temporaryPassword'] as String? ?? '',
      mustChangePassword: json['mustChangePassword'] as bool? ?? true,
      emailSent: json['emailSent'] as bool? ?? false,
      emailDetail: json['emailDetail'] as String?,
    );
  }
}
