class UserDirectoryItem {
  const UserDirectoryItem({
    required this.id,
    required this.email,
    required this.fullName,
    this.phone,
    required this.status,
    this.lastLoginAt,
    required this.mustChangePassword,
    required this.roles,
    this.subPermissions = const [],
    this.registrationNo,
    this.employeeCode,
  });

  final String id;
  final String email;
  final String fullName;
  final String? phone;
  final String status;
  final String? lastLoginAt;
  final bool mustChangePassword;
  final List<String> roles;
  final List<String> subPermissions;
  final String? registrationNo;
  final String? employeeCode;

  factory UserDirectoryItem.fromJson(Map<String, dynamic> json) {
    return UserDirectoryItem(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      phone: json['phone'] as String?,
      status: json['status'] as String? ?? 'ACTIVE',
      lastLoginAt: json['lastLoginAt'] as String?,
      mustChangePassword: json['mustChangePassword'] as bool? ?? false,
      roles: (json['roles'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
      subPermissions: (json['subPermissions'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
      registrationNo: json['registrationNo'] as String?,
      employeeCode: json['employeeCode'] as String?,
    );
  }

  bool get isStudent => roles.contains('student');
  bool get isTeacher => roles.contains('teacher');
  bool get isAdmin => roles.contains('admin') || roles.contains('super_admin');
  bool get isSuperAdmin => roles.contains('super_admin');

  String get statusLabel => switch (status) {
        'ACTIVE' => 'Active',
        'SUSPENDED' => 'Suspended',
        'LOCKED' => 'Locked',
        'INVITED' => 'Invited',
        'WITHDRAWN' => 'Withdrawn',
        'ARCHIVED' => 'Archived',
        _ => status,
      };
}
