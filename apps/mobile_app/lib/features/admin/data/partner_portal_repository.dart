import '../../../core/network/api_client.dart';

class PartnerMe {
  const PartnerMe({
    required this.id,
    required this.name,
    required this.code,
    required this.billingMode,
    required this.studentCount,
    required this.seesInvoices,
  });

  final String id;
  final String name;
  final String code;
  final String billingMode;
  final int studentCount;
  final bool seesInvoices;

  factory PartnerMe.fromJson(Map<String, dynamic> json) {
    return PartnerMe(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
      billingMode: json['billingMode'] as String? ?? 'STUDENT_PAYS',
      studentCount: json['studentCount'] as int? ?? 0,
      seesInvoices: json['seesInvoices'] as bool? ?? false,
    );
  }
}

class PartnerStudentRow {
  const PartnerStudentRow({
    required this.id,
    required this.name,
    required this.registrationNo,
    this.rollNo,
    this.programme,
    this.section,
    required this.feePaidBy,
  });

  final String id;
  final String name;
  final String registrationNo;
  final String? rollNo;
  final String? programme;
  final String? section;
  final String feePaidBy;

  factory PartnerStudentRow.fromJson(Map<String, dynamic> json) {
    return PartnerStudentRow(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      rollNo: json['rollNo'] as String?,
      programme: json['programme'] as String?,
      section: json['section'] as String?,
      feePaidBy: json['feePaidBy'] as String? ?? '',
    );
  }
}

class PartnerStudentSubject {
  const PartnerStudentSubject({
    required this.subject,
    required this.decision,
    this.percent,
    required this.criteriaMet,
    this.decidedAt,
  });

  final String subject;
  final String decision;
  final double? percent;
  final bool criteriaMet;
  final String? decidedAt;

  factory PartnerStudentSubject.fromJson(Map<String, dynamic> json) {
    return PartnerStudentSubject(
      subject: json['subject'] as String? ?? '',
      decision: json['decision'] as String? ?? '',
      percent: (json['percent'] as num?)?.toDouble(),
      criteriaMet: json['criteriaMet'] as bool? ?? false,
      decidedAt: json['decidedAt'] as String?,
    );
  }
}

class PartnerAttendanceWarning {
  const PartnerAttendanceWarning({
    required this.subject,
    required this.severity,
    required this.percentage,
    required this.threshold,
    this.raisedAt,
  });

  final String subject;
  final String severity;
  final double percentage;
  final double threshold;
  final String? raisedAt;

  factory PartnerAttendanceWarning.fromJson(Map<String, dynamic> json) {
    return PartnerAttendanceWarning(
      subject: json['subject'] as String? ?? '',
      severity: json['severity'] as String? ?? '',
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
      threshold: (json['threshold'] as num?)?.toDouble() ?? 0,
      raisedAt: json['raisedAt'] as String?,
    );
  }
}

class PartnerCertificate {
  const PartnerCertificate({
    required this.id,
    required this.number,
    required this.kind,
    required this.status,
    this.issuedAt,
  });

  final String id;
  final String number;
  final String kind;
  final String status;
  final String? issuedAt;

  factory PartnerCertificate.fromJson(Map<String, dynamic> json) {
    return PartnerCertificate(
      id: json['id'] as String? ?? '',
      number: json['number'] as String? ?? '',
      kind: json['kind'] as String? ?? '',
      status: json['status'] as String? ?? '',
      issuedAt: json['issuedAt'] as String?,
    );
  }
}

class PartnerStudentDetail {
  const PartnerStudentDetail({
    required this.student,
    required this.subjects,
    required this.attendanceWarnings,
    required this.certificates,
  });

  final PartnerStudentRow student;
  final List<PartnerStudentSubject> subjects;
  final List<PartnerAttendanceWarning> attendanceWarnings;
  final List<PartnerCertificate> certificates;

  factory PartnerStudentDetail.fromJson(Map<String, dynamic> json) {
    return PartnerStudentDetail(
      student: PartnerStudentRow.fromJson(
          json['student'] as Map<String, dynamic>? ?? {}),
      subjects: (json['subjects'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PartnerStudentSubject.fromJson)
          .toList(),
      attendanceWarnings: (json['attendanceWarnings'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PartnerAttendanceWarning.fromJson)
          .toList(),
      certificates: (json['certificates'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PartnerCertificate.fromJson)
          .toList(),
    );
  }
}

class PartnerPortalRepository {
  PartnerPortalRepository({required this.api});

  final ApiClient api;

  Future<PartnerMe> getMe() async {
    final data = await api.get<Map<String, dynamic>>('/partner/me');
    return PartnerMe.fromJson(data);
  }

  Future<List<PartnerStudentRow>> getStudents({String? query}) async {
    final path = query != null && query.trim().isNotEmpty
        ? '/partner/students?q=${Uri.encodeQueryComponent(query.trim())}'
        : '/partner/students';
    final data = await api.get<List<dynamic>>(path);
    return data
        .whereType<Map<String, dynamic>>()
        .map(PartnerStudentRow.fromJson)
        .toList();
  }

  Future<PartnerStudentDetail> getStudentDetail(String id) async {
    final data = await api.get<Map<String, dynamic>>('/partner/students/$id');
    return PartnerStudentDetail.fromJson(data);
  }
}
