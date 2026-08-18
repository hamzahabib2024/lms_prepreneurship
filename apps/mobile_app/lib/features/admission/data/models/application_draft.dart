/// The public application form — FR-REG-003..015.
///
/// Held flat, exactly as it is posted: a shape that matches the request is one
/// fewer thing to get wrong (the web form does the same).
class ApplicationDraft {
  String fullName = '';
  String fatherName = '';
  DateTime? dateOfBirth;
  String gender = '';
  String nationalId = '';
  String phone = '';
  String email = '';
  String address = '';
  String city = '';
  String educationLevel = '';
  String qualification = '';
  String occupation = '';
  String desiredProgrammeId = '';
  String desiredSectionId = '';
  String acquisitionSource = '';
  String acquisitionDetail = '';
  String claimedAmount = '';
  DateTime? claimedPaymentDate;
  String claimedBankRef = '';
  bool consentAccepted = false;

  /// Slip ids, uploaded first and referenced here (FR-REG-008, 1–5).
  final List<String> documentIds = [];

  /// The consent notice version recorded with the acknowledgement (SEC-PRV-003).
  static const consentVersion = '2026-01';

  bool get sectionChosen => desiredSectionId.isNotEmpty;

  bool get aboutComplete =>
      fullName.trim().length >= 2 &&
      fatherName.trim().length >= 2 &&
      dateOfBirth != null &&
      gender.isNotEmpty &&
      _validCnic &&
      educationLevel.isNotEmpty &&
      qualification.trim().length >= 2;

  bool get contactComplete =>
      phone.trim().isNotEmpty &&
      email.trim().contains('@') &&
      address.trim().length >= 5 &&
      city.trim().length >= 2 &&
      acquisitionSource.isNotEmpty &&
      (!requiresAcquisitionDetail || acquisitionDetail.trim().isNotEmpty);

  bool get paymentComplete =>
      documentIds.isNotEmpty &&
      double.tryParse(claimedAmount) != null &&
      double.parse(claimedAmount) > 0 &&
      claimedPaymentDate != null &&
      consentAccepted;

  bool get requiresAcquisitionDetail =>
      acquisitionSource == 'REFERRAL' || acquisitionSource == 'OTHER';

  /// 13 digits, dashes and spaces tolerated — the server normalises too.
  bool get _validCnic {
    final digits = nationalId.replaceAll(RegExp(r'[\s-]'), '');
    return RegExp(r'^\d{13}$').hasMatch(digits);
  }

  /// "0300 1234567" → "+923001234567", matching the server's phoneSchema.
  String get normalizedPhone {
    final digits = phone.replaceAll(RegExp(r'[\s()-]'), '');
    if (digits.startsWith('+')) return digits;
    if (digits.startsWith('00')) return '+${digits.substring(2)}';
    if (digits.startsWith('0')) return '+92${digits.substring(1)}';
    return '+$digits';
  }

  String get normalizedCnic => nationalId.replaceAll(RegExp(r'[\s-]'), '');

  /// The API's dates are `z.coerce.date()` — plain "yyyy-MM-dd" like the web
  /// form sends.
  static String dateOnly(DateTime d) {
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '${d.year}-$m-$day';
  }

  Map<String, dynamic> toSubmitJson() {
    return {
      'fullName': fullName.trim(),
      'fatherName': fatherName.trim(),
      'dateOfBirth': dateOfBirth == null ? null : dateOnly(dateOfBirth!),
      'gender': gender,
      'nationalId': normalizedCnic,
      'phone': normalizedPhone,
      'phoneIsWhatsapp': true,
      'email': email.trim().toLowerCase(),
      'address': address.trim(),
      'city': city.trim(),
      'educationLevel': educationLevel,
      'qualification': qualification.trim(),
      if (occupation.trim().isNotEmpty) 'occupation': occupation.trim(),
      'desiredProgrammeId': desiredProgrammeId,
      'desiredSectionId': desiredSectionId,
      'acquisitionSource': acquisitionSource,
      if (acquisitionDetail.trim().isNotEmpty) 'acquisitionDetail': acquisitionDetail.trim(),
      'claimedAmount': num.parse(claimedAmount),
      'claimedPaymentDate':
          claimedPaymentDate == null ? null : dateOnly(claimedPaymentDate!),
      if (claimedBankRef.trim().isNotEmpty) 'claimedBankRef': claimedBankRef.trim(),
      'consentVersion': consentVersion,
      'consentAccepted': true,
      'documentIds': documentIds,
    };
  }
}
