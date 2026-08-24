import 'package:dio/dio.dart';

import '../../../core/constants.dart';
import '../../../core/network/api_client.dart';
import 'models/certificate.dart';
import 'models/certificate_candidate.dart';
import 'models/programme_standing.dart';

/// Certificate management endpoints — FR-CRT-001..015.
///
/// Every call is guarded by the same permission matrix the web hits.
/// Students can only read their own; admins can issue; super admins
/// can revoke.
class CertificatesRepository {
  CertificatesRepository({required this.api});

  final ApiClient api;

  // --------------------------------------------------------------- student ---

  /// The signed-in student's own certificates.
  Future<List<Certificate>> myCertificates() async {
    final data = await api.get<List<dynamic>>('/me/certificates');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Certificate.fromJson)
        .toList();
  }

  /// Certificates for a specific student (admin/teacher view).
  Future<List<Certificate>> studentCertificates(String studentId) async {
    final data =
        await api.get<List<dynamic>>('/students/$studentId/certificates');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Certificate.fromJson)
        .toList();
  }

  // ----------------------------------------------------------- issuance ---

  /// The issuance worklist for a section-subject — FR-CRT-006.
  Future<IssuanceView> issuanceView(String sectionSubjectId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/certificates',
    );
    return IssuanceView.fromJson(data);
  }

  /// Issue a subject certificate — FR-CRT-002.
  Future<Certificate> issueSubject({
    required String studentId,
    required String sectionSubjectId,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/students/$studentId/certificates/subject/$sectionSubjectId',
    );
    return Certificate.fromJson(data);
  }

  /// Check programme certificate standing — FR-CRT-011.
  Future<ProgrammeStanding> programmeStanding({
    required String studentId,
    required String programmeId,
  }) async {
    final data = await api.get<Map<String, dynamic>>(
      '/students/$studentId/certificates/programme/$programmeId/standing',
    );
    return ProgrammeStanding.fromJson(data);
  }

  /// Issue a programme certificate — FR-CRT-010.
  Future<Certificate> issueProgramme({
    required String studentId,
    required String programmeId,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/students/$studentId/certificates/programme/$programmeId',
    );
    return Certificate.fromJson(data);
  }

  /// Revoke a certificate — FR-CRT-012, super_admin only.
  Future<void> revoke({
    required String certificateId,
    required String reason,
  }) async {
    await api.post<void>(
      '/certificates/$certificateId/revoke',
      {'reason': reason},
    );
  }

  /// Public verification — FR-CRT-015. No auth required.
  Future<VerifyResult> verify(String code) async {
    // Public endpoint — uses a raw Dio call without auth headers.
    final dio = Dio(BaseOptions(
      baseUrl: AppConstants.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
    ));
    final response = await dio.get<Map<String, dynamic>>(
      '/public/certificates/$code/verify',
      options: Options(headers: {'Accept': 'application/json'}),
    );
    return VerifyResult.fromJson(response.data ?? {});
  }
}

/// The issuance view response — students + summary counts.
class IssuanceView {
  const IssuanceView({
    this.students = const [],
    this.eligible = 0,
    this.issued = 0,
  });

  final List<CertificateCandidate> students;
  final int eligible;
  final int issued;

  factory IssuanceView.fromJson(Map<String, dynamic> json) =>
      IssuanceView(
        students: (json['students'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CertificateCandidate.fromJson)
            .toList(),
        eligible: json['eligible'] as int? ?? 0,
        issued: json['issued'] as int? ?? 0,
      );
}

/// The public verification result.
class VerifyResult {
  const VerifyResult({
    this.found = false,
    this.certificateNo = '',
    this.holderName = '',
    this.awardedFor = '',
    this.type = '',
    this.issuedAt = '',
    this.valid = false,
    this.revokedAt,
    this.message = '',
  });

  final bool found;
  final String certificateNo;
  final String holderName;
  final String awardedFor;
  final String type;
  final String issuedAt;
  final bool valid;
  final String? revokedAt;
  final String message;

  factory VerifyResult.fromJson(Map<String, dynamic> json) =>
      VerifyResult(
        found: json['found'] as bool? ?? false,
        certificateNo: json['certificateNo'] as String? ?? '',
        holderName: json['holderName'] as String? ?? '',
        awardedFor: json['awardedFor'] as String? ?? '',
        type: json['type'] as String? ?? '',
        issuedAt: json['issuedAt'] as String? ?? '',
        valid: json['valid'] as bool? ?? false,
        revokedAt: json['revokedAt'] as String?,
        message: json['message'] as String? ?? '',
      );
}
