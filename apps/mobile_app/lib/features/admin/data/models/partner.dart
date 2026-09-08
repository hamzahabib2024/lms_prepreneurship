class Partner {
  const Partner({
    required this.id,
    required this.name,
    required this.code,
    this.city,
    this.contactName,
    this.contactEmail,
    this.contactPhone,
    required this.billingMode,
    required this.isActive,
    required this.studentCount,
    required this.billingLabel,
  });

  final String id;
  final String name;
  final String code;
  final String? city;
  final String? contactName;
  final String? contactEmail;
  final String? contactPhone;
  final String billingMode;
  final bool isActive;
  final int studentCount;
  final String billingLabel;

  factory Partner.fromJson(Map<String, dynamic> json) {
    return Partner(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
      city: json['city'] as String?,
      contactName: json['contactName'] as String?,
      contactEmail: json['contactEmail'] as String?,
      contactPhone: json['contactPhone'] as String?,
      billingMode: json['billingMode'] as String? ?? 'STUDENT_PAYS',
      isActive: json['isActive'] as bool? ?? true,
      studentCount: json['studentCount'] as int? ?? 0,
      billingLabel: json['billingLabel'] as String? ?? '',
    );
  }
}

class PartnerAccount {
  const PartnerAccount({
    required this.id,
    required this.email,
    required this.fullName,
    this.temporaryPassword,
    this.emailSent,
    this.emailDetail,
  });

  final String id;
  final String email;
  final String fullName;
  final String? temporaryPassword;
  final bool? emailSent;
  final String? emailDetail;

  factory PartnerAccount.fromJson(Map<String, dynamic> json) {
    return PartnerAccount(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      temporaryPassword: json['temporaryPassword'] as String?,
      emailSent: json['emailSent'] as bool?,
      emailDetail: json['emailDetail'] as String?,
    );
  }
}
