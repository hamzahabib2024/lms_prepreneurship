import 'package:equatable/equatable.dart';

/// What an approval returns — FR-REG-039..044. The registration number, roll
/// number and the ONE-time temporary password are shown on screen because
/// credentials are relayed by WhatsApp and email delivery may fail (FR-REG-042).
class ApprovalResult extends Equatable {
  const ApprovalResult({
    required this.registrationNo,
    required this.rollNo,
    required this.sectionName,
    required this.returningStudent,
    required this.temporaryPassword,
    required this.accountNote,
    required this.subjectCount,
    required this.whatsappChannel,
    required this.whatsappGroup,
    required this.notificationsSent,
  });

  final String registrationNo;
  final int rollNo;
  final String sectionName;
  final bool returningStudent;
  final String? temporaryPassword;
  final String? accountNote;
  final int subjectCount;
  final String? whatsappChannel;
  final String? whatsappGroup;
  final List<String> notificationsSent;

  factory ApprovalResult.fromJson(Map<String, dynamic> json) {
    final student = json['student'] as Map<String, dynamic>? ?? const {};
    final account = json['account'] as Map<String, dynamic>? ?? const {};
    final enrolments = json['enrolments'] as Map<String, dynamic>? ?? const {};
    final links = json['whatsappLinks'] as Map<String, dynamic>? ?? const {};
    return ApprovalResult(
      registrationNo: student['registrationNo'] as String? ?? '',
      rollNo: (student['rollNo'] as num?)?.toInt() ?? 0,
      sectionName: student['sectionName'] as String? ?? '',
      returningStudent: student['returningStudent'] as bool? ?? false,
      temporaryPassword: account['temporaryPassword'] as String?,
      accountNote: account['note'] as String?,
      subjectCount: (enrolments['count'] as num?)?.toInt() ?? 0,
      whatsappChannel: links['channel'] as String?,
      whatsappGroup: links['group'] as String?,
      notificationsSent: (json['notificationsSent'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  @override
  List<Object?> get props => [
        registrationNo, rollNo, sectionName, returningStudent, temporaryPassword,
        accountNote, subjectCount, whatsappChannel, whatsappGroup, notificationsSent,
      ];
}
