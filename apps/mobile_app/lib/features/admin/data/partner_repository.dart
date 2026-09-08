import '../../../core/network/api_client.dart';
import 'models/partner.dart';

class PartnerRepository {
  PartnerRepository({required this.api});

  final ApiClient api;

  Future<List<Partner>> listPartners() async {
    final data = await api.get<List<dynamic>>('/partners');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Partner.fromJson)
        .toList();
  }

  Future<Partner> createPartner({
    required String name,
    required String code,
    required String billingMode,
    String? city,
    String? contactName,
    String? contactEmail,
    String? contactPhone,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/partners', {
      'name': name.trim(),
      'code': code.trim(),
      'billingMode': billingMode,
      if (city != null && city.trim().isNotEmpty) 'city': city.trim(),
      if (contactName != null && contactName.trim().isNotEmpty)
        'contactName': contactName.trim(),
      if (contactEmail != null && contactEmail.trim().isNotEmpty)
        'contactEmail': contactEmail.trim(),
      if (contactPhone != null && contactPhone.trim().isNotEmpty)
        'contactPhone': contactPhone.trim(),
    });
    return Partner.fromJson(data);
  }

  Future<Partner> updatePartner({
    required String id,
    bool? isActive,
    String? name,
    String? code,
    String? billingMode,
    String? city,
    String? contactName,
    String? contactEmail,
    String? contactPhone,
  }) async {
    final data = await api.patch<Map<String, dynamic>>('/partners/$id', {
      if (isActive != null) 'isActive': isActive,
      if (name != null) 'name': name,
      if (code != null) 'code': code,
      if (billingMode != null) 'billingMode': billingMode,
      if (city != null) 'city': city,
      if (contactName != null) 'contactName': contactName,
      if (contactEmail != null) 'contactEmail': contactEmail,
      if (contactPhone != null) 'contactPhone': contactPhone,
    });
    return Partner.fromJson(data);
  }

  Future<PartnerAccount> createPartnerAccount({
    required String partnerId,
    required String fullName,
    required String email,
    String? phone,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/admin/users', {
      'email': email.trim().toLowerCase(),
      'fullName': fullName.trim(),
      'role': 'partner_admin',
      'partnerInstituteId': partnerId,
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
    });
    return PartnerAccount.fromJson(data);
  }
}
