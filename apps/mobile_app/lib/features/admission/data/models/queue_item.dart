import 'package:equatable/equatable.dart';

/// A row in the admission review queue (GET /registration-requests) — FR-REG-022/023.
class QueueItem extends Equatable {
  const QueueItem({
    required this.id,
    required this.trackingRef,
    required this.status,
    required this.fullName,
    required this.gender,
    required this.phone,
    required this.email,
    required this.claimedAmount,
    required this.acquisitionSource,
    required this.createdAt,
    required this.isOverdue,
    required this.isClaimed,
    required this.desiredSection,
  });

  final String id;
  final String trackingRef;
  final String status;
  final String fullName;
  final String gender;
  final String phone;
  final String email;
  final num claimedAmount;
  final String acquisitionSource;
  final DateTime createdAt;
  final bool isOverdue;
  final bool isClaimed;
  final DesiredSection? desiredSection;

  factory QueueItem.fromJson(Map<String, dynamic> json) {
    return QueueItem(
      id: json['id'] as String? ?? '',
      trackingRef: json['trackingRef'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING_REVIEW',
      fullName: json['fullName'] as String? ?? '',
      gender: json['gender'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      email: json['email'] as String? ?? '',
      claimedAmount: json['claimedAmount'] as num? ?? 0,
      acquisitionSource: json['acquisitionSource'] as String? ?? '',
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
          DateTime.now(),
      isOverdue: json['isOverdue'] as bool? ?? false,
      isClaimed: json['isClaimed'] as bool? ?? false,
      desiredSection: json['desiredSection'] != null
          ? DesiredSection.fromJson(json['desiredSection'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [
        id, trackingRef, status, fullName, gender, phone, email,
        claimedAmount, acquisitionSource, createdAt, isOverdue, isClaimed,
        desiredSection,
      ];
}

class DesiredSection extends Equatable {
  const DesiredSection({required this.id, required this.code, required this.name});

  final String id;
  final String code;
  final String name;

  factory DesiredSection.fromJson(Map<String, dynamic> json) {
    return DesiredSection(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [id, code, name];
}
