/// Models for the fees domain — SRS §5.11, FR-FEE-001..028.
library;

class FeeSummary {
  const FeeSummary({
    required this.currency,
    required this.totalFee,
    required this.charged,
    required this.waived,
    required this.verified,
    required this.reversed,
    required this.pending,
    required this.pendingCount,
    required this.remaining,
    required this.standing,
    this.headline,
  });

  final String currency;
  final num totalFee;
  final num charged;
  final num waived;
  final num verified;
  final num reversed;
  final num pending;
  final int pendingCount;
  final num remaining;
  final String standing;
  final String? headline;

  factory FeeSummary.fromJson(Map<String, dynamic> json) {
    return FeeSummary(
      currency: json['currency'] as String? ?? 'PKR',
      totalFee: json['totalFee'] as num? ?? 0,
      charged: json['charged'] as num? ?? 0,
      waived: json['waived'] as num? ?? 0,
      verified: json['verified'] as num? ?? 0,
      reversed: json['reversed'] as num? ?? 0,
      pending: json['pending'] as num? ?? 0,
      pendingCount: (json['pendingCount'] as num?)?.toInt() ?? 0,
      remaining: json['remaining'] as num? ?? 0,
      standing: json['standing'] as String? ?? 'NOTHING_DUE',
      headline: json['headline'] as String?,
    );
  }
}

class PaymentSubmission {
  const PaymentSubmission({
    required this.id,
    required this.reference,
    required this.status,
    required this.amount,
    this.verifiedAmount,
    required this.currency,
    required this.method,
    required this.methodLabel,
    this.bankReference,
    required this.paidOn,
    required this.submittedAt,
    this.reviewedAt,
    this.reviewNote,
    this.receiptNo,
    this.proof = const [],
  });

  final String id;
  final String reference;
  final String status;
  final num amount;
  final num? verifiedAmount;
  final String currency;
  final String method;
  final String methodLabel;
  final String? bankReference;
  final String paidOn;
  final String submittedAt;
  final String? reviewedAt;
  final String? reviewNote;
  final String? receiptNo;
  final List<ProofFile> proof;

  factory PaymentSubmission.fromJson(Map<String, dynamic> json) {
    return PaymentSubmission(
      id: json['id'] as String? ?? '',
      reference: json['reference'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      amount: json['amount'] as num? ?? 0,
      verifiedAmount: json['verifiedAmount'] as num?,
      currency: json['currency'] as String? ?? 'PKR',
      method: json['method'] as String? ?? 'BANK_TRANSFER',
      methodLabel: json['methodLabel'] as String? ?? 'Bank Transfer',
      bankReference: json['bankReference'] as String?,
      paidOn: json['paidOn'] as String? ?? '',
      submittedAt: json['submittedAt'] as String? ?? '',
      reviewedAt: json['reviewedAt'] as String?,
      reviewNote: json['reviewNote'] as String?,
      receiptNo: json['receiptNo'] as String?,
      proof: (json['proof'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProofFile.fromJson)
          .toList(),
    );
  }
}

class ProofFile {
  const ProofFile({
    required this.id,
    required this.filename,
    this.contentType,
  });

  final String id;
  final String filename;
  final String? contentType;

  factory ProofFile.fromJson(Map<String, dynamic> json) {
    return ProofFile(
      id: json['id'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      contentType: json['contentType'] as String?,
    );
  }
}

class BankDetails {
  const BankDetails({
    this.bankName,
    this.accountName,
    this.accountNumber,
    this.iban,
    this.instructions,
    this.configured = false,
  });

  final String? bankName;
  final String? accountName;
  final String? accountNumber;
  final String? iban;
  final String? instructions;
  final bool configured;

  factory BankDetails.fromJson(Map<String, dynamic> json) {
    return BankDetails(
      bankName: json['bankName'] as String?,
      accountName: json['accountName'] as String?,
      accountNumber: json['accountNumber'] as String?,
      iban: json['iban'] as String?,
      instructions: json['instructions'] as String?,
      configured: json['configured'] as bool? ?? false,
    );
  }
}

class Receipt {
  const Receipt({
    required this.receiptNo,
    required this.issuedAt,
    required this.status,
    this.institute,
    this.student,
    this.payment,
    this.verification,
    this.reversal,
  });

  final String receiptNo;
  final String issuedAt;
  final String status;
  final InstituteInfo? institute;
  final StudentInfo? student;
  final PaymentInfo? payment;
  final VerificationInfo? verification;
  final ReversalInfo? reversal;

  factory Receipt.fromJson(Map<String, dynamic> json) {
    return Receipt(
      receiptNo: json['receiptNo'] as String? ?? '',
      issuedAt: json['issuedAt'] as String? ?? '',
      status: json['status'] as String? ?? 'VERIFIED',
      institute: json['institute'] != null
          ? InstituteInfo.fromJson(json['institute'] as Map<String, dynamic>)
          : null,
      student: json['student'] != null
          ? StudentInfo.fromJson(json['student'] as Map<String, dynamic>)
          : null,
      payment: json['payment'] != null
          ? PaymentInfo.fromJson(json['payment'] as Map<String, dynamic>)
          : null,
      verification: json['verification'] != null
          ? VerificationInfo.fromJson(
              json['verification'] as Map<String, dynamic>)
          : null,
      reversal: json['reversal'] != null
          ? ReversalInfo.fromJson(json['reversal'] as Map<String, dynamic>)
          : null,
    );
  }
}

class InstituteInfo {
  const InstituteInfo({
    this.name,
    this.campus,
    this.phone,
    this.email,
    this.website,
  });

  final String? name;
  final String? campus;
  final String? phone;
  final String? email;
  final String? website;

  factory InstituteInfo.fromJson(Map<String, dynamic> json) {
    return InstituteInfo(
      name: json['name'] as String?,
      campus: json['campus'] as String?,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      website: json['website'] as String?,
    );
  }
}

class StudentInfo {
  const StudentInfo({
    this.fullName,
    this.registrationNo,
    this.programme,
    this.section,
    this.rollNo,
  });

  final String? fullName;
  final String? registrationNo;
  final String? programme;
  final String? section;
  final String? rollNo;

  factory StudentInfo.fromJson(Map<String, dynamic> json) {
    return StudentInfo(
      fullName: json['fullName'] as String?,
      registrationNo: json['registrationNo'] as String?,
      programme: json['programme'] as String?,
      section: json['section'] as String?,
      rollNo: json['rollNo'] as String?,
    );
  }
}

class PaymentInfo {
  const PaymentInfo({
    this.amount,
    this.currency,
    this.paidOn,
    this.method,
    this.methodLabel,
    this.bankReference,
    this.submissionReference,
  });

  final num? amount;
  final String? currency;
  final String? paidOn;
  final String? method;
  final String? methodLabel;
  final String? bankReference;
  final String? submissionReference;

  factory PaymentInfo.fromJson(Map<String, dynamic> json) {
    return PaymentInfo(
      amount: json['amount'] as num?,
      currency: json['currency'] as String?,
      paidOn: json['paidOn'] as String?,
      method: json['method'] as String?,
      methodLabel: json['methodLabel'] as String?,
      bankReference: json['bankReference'] as String?,
      submissionReference: json['submissionReference'] as String?,
    );
  }
}

class VerificationInfo {
  const VerificationInfo({this.verifiedBy, this.verifiedAt, this.note});
  final String? verifiedBy;
  final String? verifiedAt;
  final String? note;

  factory VerificationInfo.fromJson(Map<String, dynamic> json) {
    return VerificationInfo(
      verifiedBy: json['verifiedBy'] as String?,
      verifiedAt: json['verifiedAt'] as String?,
      note: json['note'] as String?,
    );
  }
}

class ReversalInfo {
  const ReversalInfo({this.reversedAt, this.reason});
  final String? reversedAt;
  final String? reason;

  factory ReversalInfo.fromJson(Map<String, dynamic> json) {
    return ReversalInfo(
      reversedAt: json['reversedAt'] as String?,
      reason: json['reason'] as String?,
    );
  }
}

class DebtorRow {
  const DebtorRow({
    required this.studentId,
    required this.name,
    required this.registrationNo,
    required this.programme,
    required this.section,
    required this.outstanding,
    required this.currency,
  });

  final String studentId;
  final String name;
  final String registrationNo;
  final String programme;
  final String section;
  final num outstanding;
  final String currency;

  factory DebtorRow.fromJson(Map<String, dynamic> json) {
    return DebtorRow(
      studentId: json['studentId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      programme: json['programme'] as String? ?? '',
      section: json['section'] as String? ?? '',
      outstanding: json['outstanding'] as num? ?? 0,
      currency: json['currency'] as String? ?? 'PKR',
    );
  }
}

class VerificationQueueRow {
  const VerificationQueueRow({
    required this.id,
    required this.reference,
    required this.status,
    required this.studentName,
    required this.registrationNo,
    required this.amount,
    this.verifiedAmount,
    required this.currency,
    required this.method,
    required this.methodLabel,
    required this.paidOn,
    required this.submittedAt,
    this.receiptNo,
    this.proofCount = 0,
  });

  final String id;
  final String reference;
  final String status;
  final String studentName;
  final String registrationNo;
  final num amount;
  final num? verifiedAmount;
  final String currency;
  final String method;
  final String methodLabel;
  final String paidOn;
  final String submittedAt;
  final String? receiptNo;
  final int proofCount;

  factory VerificationQueueRow.fromJson(Map<String, dynamic> json) {
    return VerificationQueueRow(
      id: json['id'] as String? ?? '',
      reference: json['reference'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      studentName: json['studentName'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      amount: json['amount'] as num? ?? 0,
      verifiedAmount: json['verifiedAmount'] as num?,
      currency: json['currency'] as String? ?? 'PKR',
      method: json['method'] as String? ?? 'BANK_TRANSFER',
      methodLabel: json['methodLabel'] as String? ?? 'Bank Transfer',
      paidOn: json['paidOn'] as String? ?? '',
      submittedAt: json['submittedAt'] as String? ?? '',
      receiptNo: json['receiptNo'] as String?,
      proofCount: (json['proofCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class StudentStatement {
  const StudentStatement({
    required this.student,
    required this.balance,
    required this.aging,
    required this.lines,
    required this.charges,
    required this.payments,
    this.note = '',
  });

  final StatementStudent student;
  final StatementBalance balance;
  final StatementAging aging;
  final List<StatementLine> lines;
  final List<StatementCharge> charges;
  final List<StatementPayment> payments;
  final String note;

  factory StudentStatement.fromJson(Map<String, dynamic> json) {
    return StudentStatement(
      student: StatementStudent.fromJson(
        json['student'] as Map<String, dynamic>? ?? const {},
      ),
      balance: StatementBalance.fromJson(
        json['balance'] as Map<String, dynamic>? ?? const {},
      ),
      aging: StatementAging.fromJson(
        json['aging'] as Map<String, dynamic>? ?? const {},
      ),
      lines: (json['lines'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StatementLine.fromJson)
          .toList(),
      charges: (json['charges'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StatementCharge.fromJson)
          .toList(),
      payments: (json['payments'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StatementPayment.fromJson)
          .toList(),
      note: json['note'] as String? ?? '',
    );
  }
}

class StatementStudent {
  const StatementStudent({
    required this.id,
    required this.name,
    required this.registrationNo,
  });

  final String id;
  final String name;
  final String registrationNo;

  factory StatementStudent.fromJson(Map<String, dynamic> json) {
    return StatementStudent(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
    );
  }
}

class StatementBalance {
  const StatementBalance({
    required this.charged,
    required this.waived,
    required this.paid,
    required this.reversed,
    required this.outstanding,
  });

  final num charged;
  final num waived;
  final num paid;
  final num reversed;
  final num outstanding;

  factory StatementBalance.fromJson(Map<String, dynamic> json) {
    return StatementBalance(
      charged: json['charged'] as num? ?? 0,
      waived: json['waived'] as num? ?? 0,
      paid: json['paid'] as num? ?? 0,
      reversed: json['reversed'] as num? ?? 0,
      outstanding: json['outstanding'] as num? ?? 0,
    );
  }
}

class StatementAging {
  const StatementAging({
    required this.current,
    required this.overdue30,
    required this.overdue60,
    required this.overdue90Plus,
    this.oldestOverdueDays,
  });

  final num current;
  final num overdue30;
  final num overdue60;
  final num overdue90Plus;
  final int? oldestOverdueDays;

  factory StatementAging.fromJson(Map<String, dynamic> json) {
    return StatementAging(
      current: json['current'] as num? ?? 0,
      overdue30: json['overdue30'] as num? ?? 0,
      overdue60: json['overdue60'] as num? ?? 0,
      overdue90Plus: json['overdue90Plus'] as num? ?? 0,
      oldestOverdueDays: (json['oldestOverdueDays'] as num?)?.toInt(),
    );
  }
}

class StatementLine {
  const StatementLine({
    required this.date,
    required this.kind,
    required this.description,
    this.debit,
    this.credit,
    required this.balance,
  });

  final String date;
  final String kind;
  final String description;
  final num? debit;
  final num? credit;
  final num balance;

  factory StatementLine.fromJson(Map<String, dynamic> json) {
    return StatementLine(
      date: json['date'] as String? ?? '',
      kind: json['kind'] as String? ?? 'CHARGE',
      description: json['description'] as String? ?? '',
      debit: json['debit'] as num?,
      credit: json['credit'] as num?,
      balance: json['balance'] as num? ?? 0,
    );
  }
}

class StatementCharge {
  const StatementCharge({
    required this.id,
    required this.description,
    required this.amount,
    required this.dueDate,
    required this.waived,
  });

  final String id;
  final String description;
  final num amount;
  final String dueDate;
  final bool waived;

  factory StatementCharge.fromJson(Map<String, dynamic> json) {
    return StatementCharge(
      id: json['id'] as String? ?? '',
      description: json['description'] as String? ?? '',
      amount: json['amount'] as num? ?? 0,
      dueDate: json['dueDate'] as String? ?? '',
      waived: json['waived'] as bool? ?? false,
    );
  }
}

class StatementPayment {
  const StatementPayment({
    required this.id,
    required this.amount,
    required this.paidOn,
    required this.method,
    this.reference,
    required this.isReversed,
    this.reversedAt,
    this.reversalReason,
  });

  final String id;
  final num amount;
  final String paidOn;
  final String method;
  final String? reference;
  final bool isReversed;
  final String? reversedAt;
  final String? reversalReason;

  factory StatementPayment.fromJson(Map<String, dynamic> json) {
    return StatementPayment(
      id: json['id'] as String? ?? '',
      amount: json['amount'] as num? ?? 0,
      paidOn: json['paidOn'] as String? ?? '',
      method: json['method'] as String? ?? 'OTHER',
      reference: json['reference'] as String?,
      isReversed: json['isReversed'] as bool? ?? false,
      reversedAt: json['reversedAt'] as String?,
      reversalReason: json['reversalReason'] as String?,
    );
  }
}

class InstalmentPlanPreview {
  const InstalmentPlanPreview({
    required this.instalments,
    this.problem,
    this.message = '',
  });

  final List<PlanInstalment> instalments;
  final PlanProblem? problem;
  final String message;

  factory InstalmentPlanPreview.fromJson(Map<String, dynamic> json) {
    return InstalmentPlanPreview(
      instalments: (json['instalments'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PlanInstalment.fromJson)
          .toList(),
      problem: json['problem'] != null
          ? PlanProblem.fromJson(json['problem'] as Map<String, dynamic>)
          : null,
      message: json['message'] as String? ?? '',
    );
  }
}

class PlanInstalment {
  const PlanInstalment({
    required this.number,
    required this.amount,
    required this.dueDate,
    required this.description,
  });

  final int number;
  final num amount;
  final String dueDate;
  final String description;

  factory PlanInstalment.fromJson(Map<String, dynamic> json) {
    return PlanInstalment(
      number: (json['number'] as num?)?.toInt() ?? 0,
      amount: json['amount'] as num? ?? 0,
      dueDate: json['dueDate'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

class PlanProblem {
  const PlanProblem({this.code = '', this.message = ''});

  final String code;
  final String message;

  factory PlanProblem.fromJson(Map<String, dynamic> json) {
    return PlanProblem(
      code: json['code'] as String? ?? '',
      message: json['message'] as String? ?? '',
    );
  }
}

class VerificationStats {
  const VerificationStats({
    this.pendingCount = 0,
    this.pendingAmount = 0,
    this.verifiedTodayCount = 0,
    this.verifiedTodayAmount = 0,
    this.totalCollected = 0,
    this.studentsOwing = 0,
    this.totalOutstanding = 0,
  });

  final int pendingCount;
  final num pendingAmount;
  final int verifiedTodayCount;
  final num verifiedTodayAmount;
  final num totalCollected;
  final int studentsOwing;
  final num totalOutstanding;

  factory VerificationStats.fromJson(Map<String, dynamic> json) {
    return VerificationStats(
      pendingCount: (json['pendingCount'] as num?)?.toInt() ?? 0,
      pendingAmount: json['pendingAmount'] as num? ?? 0,
      verifiedTodayCount: (json['verifiedTodayCount'] as num?)?.toInt() ?? 0,
      verifiedTodayAmount: json['verifiedTodayAmount'] as num? ?? 0,
      totalCollected: json['totalCollected'] as num? ?? 0,
      studentsOwing: (json['studentsOwing'] as num?)?.toInt() ?? 0,
      totalOutstanding: json['totalOutstanding'] as num? ?? 0,
    );
  }
}
