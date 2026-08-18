import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/api_exception.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/admission/data/admission_repository.dart';
import 'package:mobile_app/features/admission/data/models/application_detail.dart';
import 'package:mobile_app/features/admission/data/models/approval_result.dart';
import 'package:mobile_app/features/admission/data/models/queue_item.dart';
import 'package:mobile_app/features/admission/data/models/section_summary.dart';
import 'package:mobile_app/features/admission/review/admissions_cubit.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeAdmissionsRepository extends AdmissionRepository {
  _FakeAdmissionsRepository({required super.api});

  List<QueueItem>? queueResult;
  Object? queueError;
  ApplicationDetail? detailResult;
  Object? detailError;
  ApprovalResult? approveResult;
  Object? approveError;
  Object? rejectError;
  List<SectionSummary>? sectionsResult;
  int queueCalls = 0;

  @override
  Future<List<QueueItem>> queue({String? status, String? q}) async {
    queueCalls++;
    if (queueError != null) throw queueError!;
    return queueResult ?? const [];
  }

  @override
  Future<ApplicationDetail> detail(String id) async {
    if (detailError != null) throw detailError!;
    return detailResult!;
  }

  @override
  Future<List<SectionSummary>> sections() async {
    return sectionsResult ?? const [
      SectionSummary(
        id: 'sec-1',
        code: 'SP26DM-EVE-A',
        name: 'A',
        capacity: 30,
        enrolledCount: 29,
        placesRemaining: 1,
        isFull: false,
        genderRestriction: 'FEMALE',
      ),
    ];
  }

  @override
  Future<ApprovalResult> approve({
    required String id,
    required num verifiedAmount,
    required DateTime paymentDate,
    required String method,
    String? bankReference,
    String? varianceReason,
    required String sectionId,
    bool capacityOverride = false,
    String? note,
  }) async {
    if (approveError != null) throw approveError!;
    return approveResult!;
  }

  @override
  Future<void> reject({
    required String id,
    required String reasonCode,
    String? note,
  }) async {
    if (rejectError != null) throw rejectError!;
  }
}

final _queueItem = QueueItem(
  id: 'r1',
  trackingRef: 'LMS-2026-000007',
  status: 'PENDING_REVIEW',
  fullName: 'Sara Ali',
  gender: 'FEMALE',
  phone: '+923001234567',
  email: 'sara@example.com',
  claimedAmount: 25000,
  acquisitionSource: 'INSTAGRAM',
  createdAt: DateTime(2026),
  isOverdue: true,
  isClaimed: false,
  desiredSection: null,
);

final _detail = ApplicationDetail(
  id: 'r1',
  trackingRef: 'LMS-2026-000007',
  status: 'PENDING_REVIEW',
  fullName: 'Sara Ali',
  fatherName: 'Imran Ali',
  dateOfBirth: null,
  gender: 'FEMALE',
  nationalId: '3520212345671',
  phone: '+923001234567',
  phoneIsWhatsapp: true,
  email: 'sara@example.com',
  address: 'Street 3, F-8',
  city: 'Islamabad',
  educationLevel: 'BACHELORS',
  qualification: 'BSc, 2024',
  occupation: null,
  acquisitionSource: 'REFERRAL',
  acquisitionDetail: null,
  claimedAmount: 25000,
  claimedPaymentDate: null,
  claimedBankRef: null,
  createdAt: DateTime(2026),
  desiredProgramme: null,
  desiredSection: null,
  documents: [],
);

final _approval = ApprovalResult(
  registrationNo: 'CIIT/SP26-BAI-034/ISB',
  rollNo: 7,
  sectionName: 'SP26-BAI-034 (Male)',
  returningStudent: false,
  temporaryPassword: 'Temp!2026x',
  accountNote: null,
  subjectCount: 5,
  whatsappChannel: null,
  whatsappGroup: 'https://whatsapp.com/grp',
  notificationsSent: ['Sign-in details emailed to sara@example.com.'],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeAdmissionsRepository repository;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    final store = TokenStore.instance;
    await store.init();
    repository = _FakeAdmissionsRepository(api: ApiClient(tokenStore: store));
  });

  AdmissionsCubit cubit() => AdmissionsCubit(repository: repository);

  group('AdmissionsCubit', () {
    test('loadQueue fills the queue oldest-first', () async {
      repository.queueResult = [_queueItem];
      final c = cubit();

      await c.loadQueue();

      expect(c.state.queue, hasLength(1));
      expect(c.state.queue.single.fullName, 'Sara Ali');
      expect(c.state.queue.single.isOverdue, isTrue);
      expect(repository.queueCalls, 1);
      await c.close();
    });

    test('queue failure surfaces the error and allows retry', () async {
      repository.queueError = const ApiException(
        status: 0,
        message: 'Unable to reach the server.',
      );
      final c = cubit();
      await c.loadQueue();
      expect(c.state.queueError?.message, 'Unable to reach the server.');

      repository.queueError = null;
      repository.queueResult = [_queueItem];
      await c.loadQueue();
      expect(c.state.queue, hasLength(1));
      expect(c.state.queueError, isNull);
      await c.close();
    });

    test('select loads the detail and the section list once', () async {
      repository.queueResult = [_queueItem];
      repository.detailResult = _detail;
      final c = cubit();
      await c.loadQueue();

      await c.select('r1');

      expect(c.state.detail?.fullName, 'Sara Ali');
      expect(c.state.sections, hasLength(1));

      await c.select('r1');
      expect(c.state.detail, _detail);
      await c.close();
    });

    test('approve shows the receipt and refreshes the queue (FR-REG-037)', () async {
      repository.queueResult = [_queueItem];
      repository.detailResult = _detail;
      repository.approveResult = _approval;
      final c = cubit();
      await c.loadQueue();
      await c.select('r1');

      await c.approve(
        id: 'r1',
        verifiedAmount: 25000,
        paymentDate: DateTime(2026, 8, 11),
        method: 'BANK_TRANSFER',
        sectionId: 'sec-1',
      );

      expect(c.state.receipt?.registrationNo, 'CIIT/SP26-BAI-034/ISB');
      expect(c.state.receipt?.temporaryPassword, 'Temp!2026x');
      expect(c.state.selectedId, isNull);
      expect(repository.queueCalls, 2, reason: 'queue refreshes after the decision');

      c.dismissReceipt();
      expect(c.state.receipt, isNull);
      await c.close();
    });

    test('approve rejects when the account exists: variance reason required', () async {
      repository.queueResult = [_queueItem];
      repository.detailResult = _detail;
      repository.approveError = const ApiException(
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'The verified amount (24500) differs from the claimed amount (25000). Record why.',
      );
      final c = cubit();
      await c.loadQueue();
      await c.select('r1');

      await c.approve(
        id: 'r1',
        verifiedAmount: 24500,
        paymentDate: DateTime(2026, 8, 11),
        method: 'CASH_DEPOSIT',
        sectionId: 'sec-1',
      );

      expect(c.state.receipt, isNull);
      expect(c.state.actionError?.code, 'VALIDATION_FAILED');
      expect(c.state.selectedId, 'r1', reason: 'the review stays open to fix the input');
      await c.close();
    });

    test('reject clears the review and refreshes the queue', () async {
      repository.queueResult = [_queueItem];
      repository.detailResult = _detail;
      final c = cubit();
      await c.loadQueue();
      await c.select('r1');

      await c.reject(id: 'r1', reasonCode: 'SLIP_ILLEGIBLE');

      expect(c.state.detail, isNull);
      expect(c.state.selectedId, isNull);
      expect(repository.queueCalls, 2);
      await c.close();
    });
  });
}