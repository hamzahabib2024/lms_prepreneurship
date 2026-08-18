import 'package:equatable/equatable.dart';

/// One application, as the reviewer sees it (GET /registration-requests/:id) —
/// FR-REG-025. Every submitted field, plus the slip documents.
class ApplicationDetail extends Equatable {
  const ApplicationDetail({
    required this.id,
    required this.trackingRef,
    required this.status,
    required this.fullName,
    required this.fatherName,
    required this.dateOfBirth,
    required this.gender,
    required this.nationalId,
    required this.phone,
    required this.phoneIsWhatsapp,
    required this.email,
    required this.address,
    required this.city,
    required this.educationLevel,
    required this.qualification,
    required this.occupation,
    required this.acquisitionSource,
    required this.acquisitionDetail,
    required this.claimedAmount,
    required this.claimedPaymentDate,
    required this.claimedBankRef,
    required this.createdAt,
    required this.desiredProgramme,
    required this.desiredSection,
    required this.documents,
  });

  final String id;
  final String trackingRef;
  final String status;
  final String fullName;
  final String fatherName;
  final DateTime? dateOfBirth;
  final String gender;
  final String nationalId;
  final String phone;
  final bool phoneIsWhatsapp;
  final String email;
  final String address;
  final String city;
  final String educationLevel;
  final String qualification;
  final String? occupation;
  final String acquisitionSource;
  final String? acquisitionDetail;
  final num claimedAmount;
  final DateTime? claimedPaymentDate;
  final String? claimedBankRef;
  final DateTime createdAt;
  final ProgrammeRef? desiredProgramme;
  final SectionRef? desiredSection;
  final List<RegistrationDocument> documents;

  factory ApplicationDetail.fromJson(Map<String, dynamic> json) {
    return ApplicationDetail(
      id: json['id'] as String? ?? '',
      trackingRef: json['trackingRef'] as String? ?? '',
      status: json['status'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      fatherName: json['fatherName'] as String? ?? '',
      dateOfBirth: DateTime.tryParse(json['dateOfBirth'] as String? ?? ''),
      gender: json['gender'] as String? ?? '',
      nationalId: json['nationalId'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      phoneIsWhatsapp: json['phoneIsWhatsapp'] as bool? ?? false,
      email: json['email'] as String? ?? '',
      address: json['address'] as String? ?? '',
      city: json['city'] as String? ?? '',
      educationLevel: json['educationLevel'] as String? ?? '',
      qualification: json['qualification'] as String? ?? '',
      occupation: json['occupation'] as String?,
      acquisitionSource: json['acquisitionSource'] as String? ?? '',
      acquisitionDetail: json['acquisitionDetail'] as String?,
      claimedAmount: json['claimedAmount'] as num? ?? 0,
      claimedPaymentDate:
          DateTime.tryParse(json['claimedPaymentDate'] as String? ?? ''),
      claimedBankRef: json['claimedBankRef'] as String?,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
          DateTime.now(),
      desiredProgramme: json['desiredProgramme'] != null
          ? ProgrammeRef.fromJson(json['desiredProgramme'] as Map<String, dynamic>)
          : null,
      desiredSection: json['desiredSection'] != null
          ? SectionRef.fromJson(json['desiredSection'] as Map<String, dynamic>)
          : null,
      documents: (json['documents'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RegistrationDocument.fromJson)
          .toList(),
    );
  }

  @override
  List<Object?> get props => [
        id, trackingRef, status, fullName, fatherName, dateOfBirth, gender,
        nationalId, phone, phoneIsWhatsapp, email, address, city,
        educationLevel, qualification, occupation, acquisitionSource,
        acquisitionDetail, claimedAmount, claimedPaymentDate, claimedBankRef,
        createdAt, desiredProgramme, desiredSection, documents,
      ];
}

class ProgrammeRef extends Equatable {
  const ProgrammeRef({required this.id, required this.name, required this.code});

  final String id;
  final String name;
  final String code;

  factory ProgrammeRef.fromJson(Map<String, dynamic> json) {
    return ProgrammeRef(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [id, name, code];
}

class SectionRef extends Equatable {
  const SectionRef({required this.id, required this.name, required this.code});

  final String id;
  final String name;
  final String code;

  factory SectionRef.fromJson(Map<String, dynamic> json) {
    return SectionRef(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [id, name, code];
}

/// A payment slip attached to the application — FR-REG-008/024.
class RegistrationDocument extends Equatable {
  const RegistrationDocument({
    required this.id,
    required this.documentType,
    required this.originalFilename,
    required this.contentType,
    required this.sizeBytes,
    required this.scanStatus,
    required this.createdAt,
  });

  final String id;
  final String documentType;
  final String originalFilename;
  final String contentType;
  final int sizeBytes;
  final String scanStatus;
  final DateTime createdAt;

  bool get isPdf => contentType == 'application/pdf';

  factory RegistrationDocument.fromJson(Map<String, dynamic> json) {
    return RegistrationDocument(
      id: json['id'] as String? ?? '',
      documentType: json['documentType'] as String? ?? '',
      originalFilename: json['originalFilename'] as String? ?? '',
      contentType: json['contentType'] as String? ?? '',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      scanStatus: json['scanStatus'] as String? ?? 'PENDING',
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
          DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [
        id, documentType, originalFilename, contentType, sizeBytes, scanStatus, createdAt,
      ];
}
