import 'package:equatable/equatable.dart';

/// What POST /public/registrations returns — FR-REG-018. The tracking
/// reference is the whole point: it is the only way back to the application
/// without an account. A duplicate (FR-REG-016) returns the EXISTING
/// application's reference rather than creating a second record.
class SubmissionResult extends Equatable {
  const SubmissionResult({
    required this.trackingRef,
    required this.email,
    required this.duplicate,
    required this.message,
    this.emailSent,
  });

  final String trackingRef;
  final String email;
  final bool duplicate;
  final String message;

  /// Absent when the application was a duplicate — nothing is emailed then.
  final bool? emailSent;

  factory SubmissionResult.fromJson(Map<String, dynamic> json) {
    return SubmissionResult(
      trackingRef: json['trackingRef'] as String? ?? '',
      email: json['email'] as String? ?? '',
      duplicate: json['duplicate'] as bool? ?? false,
      message: json['message'] as String? ?? '',
      emailSent: json['emailSent'] as bool?,
    );
  }

  @override
  List<Object?> get props => [trackingRef, email, duplicate, message, emailSent];
}

/// GET /public/registrations/:trackingRef/status — FR-REG-020.
///
/// Deliberately thin: only the state, when it last changed, and any message
/// directed at the applicant (SEC-PRV-012).
class ApplicationStatusResult extends Equatable {
  const ApplicationStatusResult({
    required this.status,
    required this.lastUpdatedAt,
    this.message,
    this.reasonCode,
  });

  final String status;
  final DateTime lastUpdatedAt;
  final String? message;
  final String? reasonCode;

  factory ApplicationStatusResult.fromJson(Map<String, dynamic> json) {
    return ApplicationStatusResult(
      status: json['status'] as String? ?? '',
      lastUpdatedAt:
          DateTime.tryParse(json['lastUpdatedAt'] as String? ?? '')?.toLocal() ??
              DateTime.now(),
      message: json['message'] as String?,
      reasonCode: json['reasonCode'] as String?,
    );
  }

  @override
  List<Object?> get props => [status, lastUpdatedAt, message, reasonCode];
}

/// Display helpers for the fixed enum lists the API validates against — the
/// mobile copies of the web's label maps.
abstract final class AdmissionLabels {
  static const shifts = {
    'MORNING': 'Morning',
    'AFTERNOON': 'Afternoon',
    'EVENING': 'Evening',
    'WEEKEND': 'Weekend',
  };

  static const sources = [
    ('FACEBOOK', 'Facebook'),
    ('INSTAGRAM', 'Instagram'),
    ('WHATSAPP', 'WhatsApp'),
    ('WEBSITE', 'The website'),
    ('REFERRAL', 'Somebody told me'),
    ('WALK_IN', 'I visited the office'),
    ('OTHER', 'Something else'),
  ];

  static const educationLevels = [
    ('MATRIC', 'Matric'),
    ('FSC', 'FSc / Intermediate'),
    ('BACHELORS', "Bachelor's degree"),
    ('DARS_E_NIZAMI', 'Dars-e-Nizami'),
    ('HIFZ_E_QURAN', 'Hifz-e-Quran'),
    ('OTHER', 'Something else'),
  ];

  static const paymentMethods = [
    ('BANK_TRANSFER', 'Bank transfer'),
    ('CASH_DEPOSIT', 'Cash deposit'),
    ('CHEQUE', 'Cheque'),
    ('OTHER', 'Other'),
  ];

  static const rejectionReasons = [
    ('PAYMENT_NOT_RECEIVED', 'Payment not received'),
    ('AMOUNT_INSUFFICIENT', 'Amount insufficient'),
    ('SLIP_ILLEGIBLE', 'Slip illegible'),
    ('DUPLICATE_APPLICATION', 'Duplicate application'),
    ('INELIGIBLE', 'Ineligible'),
    ('SECTION_FULL', 'Section full'),
    ('OTHER', 'Other'),
  ];

  static const statuses = {
    'PENDING_REVIEW': 'Pending review',
    'UNDER_REVIEW': 'Under review',
    'NEEDS_INFO': 'Needs information',
    'APPROVED': 'Approved',
    'REJECTED': 'Rejected',
  };

  static String shift(String code) => shifts[code] ?? code;
  static String status(String code) => statuses[code] ?? code;

  /// "FACEBOOK" → "Facebook"; "REFERRAL" → "referral" in sentence context.
  static String source(String code) {
    for (final (value, label) in sources) {
      if (value == code) return label;
    }
    return code.replaceAll('_', ' ').toLowerCase();
  }
}
