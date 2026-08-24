import 'package:equatable/equatable.dart';

/// The user as POST /auth/login returns it.
class AuthUser extends Equatable {
  const AuthUser({
    required this.id,
    required this.fullName,
    required this.email,
    required this.roles,
    this.photoUrl,
    this.student,
    this.subPermissions = const [],
  });

  final String id;
  final String fullName;
  final String email;
  final List<String> roles;
  final String? photoUrl;
  final StudentProfile? student;
  final List<String> subPermissions;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      email: json['email'] as String? ?? '',
      roles: (json['roles'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
      photoUrl: json['photoUrl'] as String?,
      student: json['student'] != null
          ? StudentProfile.fromJson(json['student'] as Map<String, dynamic>)
          : null,
      subPermissions: (json['subPermissions'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  /// GET /auth/me returns the user under `userId` rather than `id`, and is
  /// the shape the app restores a session from.
  factory AuthUser.fromMe(Map<String, dynamic> json) {
    return AuthUser(
      id: json['userId'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      email: json['email'] as String? ?? '',
      roles: (json['roles'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
      photoUrl: json['photoUrl'] as String?,
      student: json['student'] != null
          ? StudentProfile.fromJson(json['student'] as Map<String, dynamic>)
          : null,
      subPermissions: (json['subPermissions'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  bool get isStudent => roles.contains('student');
  bool get isTeacher => roles.contains('teacher');
  bool get isAdmin => roles.contains('admin');
  bool get isSuperAdmin => roles.contains('super_admin');

  /// Whether this user may create or manage other admin accounts.
  /// Requires either the `admin_manager` sub-permission or super_admin role.
  bool get canManageAdmins =>
      isSuperAdmin || subPermissions.contains('admin_manager');

  /// The human-readable role label the shell shows under the name.
  String get roleLabel {
    if (isSuperAdmin) return 'Super Admin';
    if (isAdmin) return 'Administrator';
    if (isTeacher) return 'Teacher';
    if (isStudent) return 'Student';
    return 'Member';
  }

  @override
  List<Object?> get props => [id, fullName, email, roles, photoUrl, student, subPermissions];
}

class StudentProfile extends Equatable {
  const StudentProfile({
    required this.registrationNo,
    this.rollNo,
    this.sectionId,
    this.sectionName,
  });

  final String registrationNo;
  final int? rollNo;
  final String? sectionId;
  final String? sectionName;

  factory StudentProfile.fromJson(Map<String, dynamic> json) {
    return StudentProfile(
      registrationNo: json['registrationNo'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      sectionId: json['sectionId'] as String?,
      sectionName: json['sectionName'] as String?,
    );
  }

  @override
  List<Object?> get props => [registrationNo, rollNo, sectionId, sectionName];
}

/// What POST /auth/login and POST /auth/refresh return. The response envelope
/// `{ data, meta }` is unwrapped by the ApiClient before this parses.
class AuthSession extends Equatable {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
    required this.mustChangePassword,
  });

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final AuthUser user;
  final bool mustChangePassword;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final userJson = json['user'] as Map<String, dynamic>? ?? const {};
    return AuthSession(
      accessToken: json['accessToken'] as String? ?? '',
      refreshToken: json['refreshToken'] as String? ?? '',
      expiresIn: json['expiresIn'] as int? ?? 0,
      user: AuthUser.fromJson(userJson),
      mustChangePassword: json['mustChangePassword'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [accessToken, refreshToken, expiresIn, user, mustChangePassword];
}