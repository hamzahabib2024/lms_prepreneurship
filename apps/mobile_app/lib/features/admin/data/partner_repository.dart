import '../../../core/network/api_client.dart';
import 'models/partner.dart';
import 'models/partner_invoice.dart';

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

  /// FR-PTR — what the next invoice would contain, before it is raised.
  ///
  /// Read first, always. The preview names the students who cannot be priced
  /// and why, and those are rows to fix BEFORE an invoice goes out rather
  /// than after the partner queries it.
  Future<BillingPreview> billingPreview(String partnerId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/partners/$partnerId/billing-preview',
    );
    return BillingPreview.fromJson(data);
  }

  /// Raise it.
  ///
  /// `partner_invoice:create` is behind STEP-UP on the server (§4.5): this
  /// creates a claim for money against another organisation, and the matrix
  /// already says re-authentication is the price of that. A 401 asking for
  /// step-up is therefore an ordinary outcome here, not a failure.
  Future<PartnerInvoice> createInvoice({
    required String partnerId,
    required String periodLabel,
    DateTime? dueDate,
    String? notes,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/partners/$partnerId/invoices',
      {
        'periodLabel': periodLabel.trim(),
        'dueDate': ?dueDate?.toIso8601String(),
        'notes': ?(notes == null || notes.trim().isEmpty ? null : notes.trim()),
      },
    );
    return PartnerInvoice.fromJson(data);
  }
}
