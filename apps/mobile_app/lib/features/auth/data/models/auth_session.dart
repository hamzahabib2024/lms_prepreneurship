import 'package:equatable/equatable.dart';

class AuthUser extends Equatable {
  const AuthUser({
    required this.id,
    required this.fullName,
    required this.email,
    required this.roles,
    this.photoUrl,
    this.student,
  });

  final String id;
  final String fullName;
  final String email;
  final List<String> roles;
  final String? photoUrl;
  final StudentProfile? student;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      email: json['email'] as String? ?? '',
      roles: (json['roles'] as List<dynamic>? ?? const []).map((e) => e.toString()).toList(),
      photoUrl: json['photoUrl'] as String?,
      student: json['student'] != null ? StudentProfile.fromJson(json['student'] as Map<String, dynamic>) : null,
    );
  }

  @override
  List<Object?> get props => [id, fullName, email, roles, photoUrl, student];
}

class StudentProfile extends Equatable {
  const StudentProfile({
    required this.registrationNo,
    required this.rollNo,
    required this.sectionId,
    required this.sectionName,
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
