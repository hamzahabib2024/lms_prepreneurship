import '../../../core/network/api_client.dart';

class Signatory {
  const Signatory({
    required this.id,
    required this.name,
    required this.designation,
    this.signatureAssetId,
    required this.isActive,
    required this.sortOrder,
  });

  final String id;
  final String name;
  final String designation;
  final String? signatureAssetId;
  final bool isActive;
  final int sortOrder;

  factory Signatory.fromJson(Map<String, dynamic> json) {
    return Signatory(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      designation: json['designation'] as String? ?? '',
      signatureAssetId: json['signatureAssetId'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }
}

class SignatoriesRepository {
  SignatoriesRepository({required this.api});

  final ApiClient api;

  Future<List<Signatory>> list() async {
    final data = await api.get<List<dynamic>>('/signatories');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Signatory.fromJson)
        .toList();
  }

  Future<Signatory> create({
    required String name,
    required String designation,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/signatories', {
      'name': name.trim(),
      'designation': designation.trim(),
    });
    return Signatory.fromJson(data);
  }

  Future<void> update({
    required String id,
    bool? isActive,
    int? sortOrder,
    String? signatureAssetId,
  }) async {
    await api.patch<Map<String, dynamic>>('/signatories/$id', {
      if (isActive != null) 'isActive': isActive,
      if (sortOrder != null) 'sortOrder': sortOrder,
      if (signatureAssetId != null) 'signatureAssetId': signatureAssetId,
    });
  }

  Future<void> remove({required String id}) async {
    await api.delete<void>('/signatories/$id');
  }
}
