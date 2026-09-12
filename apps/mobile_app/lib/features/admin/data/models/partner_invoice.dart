/// Invoicing a partner institute — SRS §9.12, FR-PTR.
///
/// A partner sends the Institute a cohort of students and is billed for them.
/// Two sides live here: what the office sees before raising an invoice
/// ([BillingPreview]), and the invoices themselves ([PartnerInvoice]), which
/// the partner reads in their own portal.
library;

/// What the next invoice would contain, before it is raised.
///
/// The three lists are the point. A total on its own is a number somebody has
/// to trust; these say who is in it, who was left out, and why — which is the
/// difference between an invoice the partner queries and one they pay.
class BillingPreview {
  const BillingPreview({
    required this.partnerId,
    required this.partnerName,
    required this.billable,
    required this.alreadyBilled,
    required this.unpriced,
    required this.total,
    required this.currency,
  });

  final String partnerId;
  final String partnerName;

  /// Students who would be on the invoice, each with their price.
  final List<BillableStudent> billable;

  /// Already on an invoice, so left off this one. Nothing is billed twice.
  final List<AlreadyBilledStudent> alreadyBilled;

  /// Cannot be priced, each with the reason — no batch, or a programme with
  /// no published fee structure. These are the rows the office must fix
  /// BEFORE raising the invoice, not discover afterwards.
  final List<UnpricedStudent> unpriced;

  final double total;
  final String currency;

  bool get canRaise => billable.isNotEmpty;

  factory BillingPreview.fromJson(Map<String, dynamic> json) {
    final partner = (json['partner'] as Map<String, dynamic>?) ?? const {};
    return BillingPreview(
      partnerId: partner['id'] as String? ?? '',
      partnerName: partner['name'] as String? ?? 'Partner',
      billable: (json['billable'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(BillableStudent.fromJson)
          .toList(),
      alreadyBilled: (json['alreadyBilled'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AlreadyBilledStudent.fromJson)
          .toList(),
      unpriced: (json['unpriced'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(UnpricedStudent.fromJson)
          .toList(),
      total: (json['total'] as num?)?.toDouble() ?? 0,
      currency: json['currency'] as String? ?? 'PKR',
    );
  }
}

class BillableStudent {
  const BillableStudent({
    required this.studentId,
    required this.name,
    required this.registrationNo,
    required this.programme,
    required this.amount,
  });

  final String studentId;
  final String name;
  final String registrationNo;
  final String? programme;
  final double amount;

  factory BillableStudent.fromJson(Map<String, dynamic> json) {
    return BillableStudent(
      studentId: json['studentId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      programme: json['programme'] as String?,
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
    );
  }
}

class AlreadyBilledStudent {
  const AlreadyBilledStudent({
    required this.name,
    required this.registrationNo,
    required this.onInvoice,
  });

  final String name;
  final String registrationNo;

  /// The invoice number they are already on, so the office can go and look.
  final String onInvoice;

  factory AlreadyBilledStudent.fromJson(Map<String, dynamic> json) {
    return AlreadyBilledStudent(
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      onInvoice: json['onInvoice'] as String? ?? '',
    );
  }
}

class UnpricedStudent {
  const UnpricedStudent({
    required this.name,
    required this.registrationNo,
    required this.why,
  });

  final String name;
  final String registrationNo;
  final String why;

  factory UnpricedStudent.fromJson(Map<String, dynamic> json) {
    return UnpricedStudent(
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      why: json['why'] as String? ?? 'Cannot be priced.',
    );
  }
}

/// One invoice, as it appears in a list.
class PartnerInvoice {
  const PartnerInvoice({
    required this.id,
    required this.number,
    required this.periodLabel,
    required this.status,
    required this.currency,
    required this.total,
    required this.paid,
    required this.outstanding,
    required this.issuedAt,
    required this.dueDate,
    required this.studentCount,
  });

  final String id;
  final String number;

  /// What the invoice is FOR, in the Institute's own words — "Spring 2026,
  /// Graphic Designing". A date range alone tells the reader nothing they can
  /// check against their own records.
  final String periodLabel;
  final String status;
  final String currency;
  final double total;
  final double paid;
  final double outstanding;
  final DateTime? issuedAt;
  final DateTime? dueDate;
  final int studentCount;

  bool get isSettled => outstanding <= 0;

  /// Past its due date with money still owed. Not the same as "unpaid": an
  /// invoice raised yesterday is unpaid and perfectly fine.
  bool get isOverdue =>
      !isSettled && dueDate != null && dueDate!.isBefore(DateTime.now());

  factory PartnerInvoice.fromJson(Map<String, dynamic> json) {
    final issued = json['issuedAt'] as String?;
    final due = json['dueDate'] as String?;
    return PartnerInvoice(
      id: json['id'] as String,
      number: json['number'] as String? ?? '',
      periodLabel: json['periodLabel'] as String? ?? '',
      status: json['status'] as String? ?? 'ISSUED',
      currency: json['currency'] as String? ?? 'PKR',
      total: (json['total'] as num?)?.toDouble() ?? 0,
      paid: (json['paid'] as num?)?.toDouble() ?? 0,
      outstanding: (json['outstanding'] as num?)?.toDouble() ?? 0,
      issuedAt: issued == null ? null : DateTime.tryParse(issued)?.toLocal(),
      dueDate: due == null ? null : DateTime.tryParse(due)?.toLocal(),
      studentCount: json['studentCount'] as int? ?? 0,
    );
  }
}

/// One invoice with the students on it — what a partner opens to check a
/// figure against their own records.
class PartnerInvoiceDetail {
  const PartnerInvoiceDetail({
    required this.invoice,
    required this.notes,
    required this.lines,
  });

  final PartnerInvoice invoice;
  final String? notes;
  final List<InvoiceLine> lines;

  factory PartnerInvoiceDetail.fromJson(Map<String, dynamic> json) {
    return PartnerInvoiceDetail(
      invoice: PartnerInvoice.fromJson(json),
      notes: json['notes'] as String?,
      lines: (json['lines'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(InvoiceLine.fromJson)
          .toList(),
    );
  }
}

class InvoiceLine {
  const InvoiceLine({
    required this.id,
    required this.studentName,
    required this.registrationNo,
    required this.programme,
    required this.description,
    required this.amount,
  });

  final String id;

  /// SNAPSHOTTED at issue. A student who later changes name or programme does
  /// not change an invoice that was already sent (BR-DAT-02).
  final String studentName;
  final String? registrationNo;
  final String? programme;
  final String? description;
  final double amount;

  factory InvoiceLine.fromJson(Map<String, dynamic> json) {
    return InvoiceLine(
      id: json['id'] as String? ?? '',
      studentName: json['studentNameAtIssue'] as String? ??
          json['studentName'] as String? ??
          '',
      registrationNo: json['registrationNoAtIssue'] as String?,
      programme: json['programmeAtIssue'] as String?,
      description: json['description'] as String?,
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
    );
  }
}
