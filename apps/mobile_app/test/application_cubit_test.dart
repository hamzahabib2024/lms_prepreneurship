import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/api_exception.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/admission/application/application_cubit.dart';
import 'package:mobile_app/features/admission/data/admission_repository.dart';
import 'package:mobile_app/features/admission/data/models/application_draft.dart';
import 'package:mobile_app/features/admission/data/models/prospectus.dart';
import 'package:mobile_app/features/admission/data/models/submission_result.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeAdmissionRepository extends AdmissionRepository {
  _FakeAdmissionRepository({required super.api});

  List<ProspectusProgramme>? prospectusResult;
  Object? prospectusError;
  String? uploadResult;
  Object? uploadError;
  SubmissionResult? submitResult;
  Object? submitError;

  @override
  Future<List<ProspectusProgramme>> prospectus() async {
    if (prospectusError != null) throw prospectusError!;
    return prospectusResult ?? const [];
  }

  @override
  Future<String> uploadSlip({required String filename, required List<int> bytes}) async {
    if (uploadError != null) throw uploadError!;
    return uploadResult ?? 'doc-1';
  }

  @override
  Future<SubmissionResult> submit(ApplicationDraft draft) async {
    if (submitError != null) throw submitError!;
    return submitResult!;
  }
}

const _prospectus = ProspectusProgramme(
  id: 'p1',
  name: 'Diploma in Digital Marketing',
  code: 'DM',
  description: null,
  durationWeeks: 24,
  sections: [
    ProspectusSection(
      id: 'sec-1',
      name: 'SP26-DM-EVE-A (Female)',
      code: 'SP26DM-EVE-A',
      shift: 'EVENING',
      genderRestriction: 'FEMALE',
      session: 'Spring 2026',
    ),
  ],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeAdmissionRepository repository;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    final store = TokenStore.instance;
    await store.init();
    repository = _FakeAdmissionRepository(api: ApiClient(tokenStore: store));
  });

  ApplicationCubit cubit() => ApplicationCubit(repository: repository);

  group('ApplicationCubit', () {
    test('start loads the prospectus into ready', () async {
      repository.prospectusResult = const [_prospectus];
      final c = cubit();
      final states = <ApplicationStatus>[];
      c.stream.listen((s) => states.add(s.status));

      await c.start();

      expect(states, contains(ApplicationStatus.loading));
      expect(c.state.status, ApplicationStatus.ready);
      expect(c.state.programmes.single.sections.single.isGenderRestricted, isTrue);
      await c.close();
    });

    test('prospectus failure lands on failure', () async {
      repository.prospectusError = const ApiException(
        status: 0,
        message: 'Unable to reach the server.',
      );
      final c = cubit();

      await c.start();

      expect(c.state.status, ApplicationStatus.failure);
      expect(c.state.error?.message, 'Unable to reach the server.');
      await c.close();
    });

    test('uploadSlip appends the id and removeSlip drops it', () async {
      repository.prospectusResult = const [];
      final c = cubit();
      await c.start();

      await c.uploadSlip(filename: 'slip.jpg', bytes: [1]);
      expect(c.state.documentIds, ['doc-1']);
      expect(c.state.uploading, isFalse);

      c.removeSlip('doc-1');
      expect(c.state.documentIds, isEmpty);
      await c.close();
    });

    test('uploadSlip surfaces a FILE_TYPE_NOT_ALLOWED from the server', () async {
      repository.prospectusResult = const [];
      repository.uploadError = const ApiException(
        status: 415,
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: 'That file is not a photo or a PDF.',
      );
      final c = cubit();
      await c.start();

      await c.uploadSlip(filename: 'virus.exe', bytes: [1]);

      expect(c.state.error?.code, 'FILE_TYPE_NOT_ALLOWED');
      expect(c.state.documentIds, isEmpty);
      await c.close();
    });

    test('submit ends on submitted with the tracking reference', () async {
      repository.prospectusResult = const [];
      repository.submitResult = const SubmissionResult(
        trackingRef: 'LMS-2026-000123',
        email: 'ali@example.com',
        duplicate: false,
        message: 'received',
        emailSent: true,
      );
      final c = cubit();
      await c.start();

      await c.submit(ApplicationDraft());

      expect(c.state.status, ApplicationStatus.submitted);
      expect(c.state.result?.trackingRef, 'LMS-2026-000123');
      await c.close();
    });

    test('a probable duplicate returns the existing reference (FR-REG-016)', () async {
      repository.prospectusResult = const [];
      repository.submitResult = const SubmissionResult(
        trackingRef: 'LMS-2026-000100',
        email: 'other@example.com',
        duplicate: true,
        message: 'We already have an application from you.',
        emailSent: null,
      );
      final c = cubit();
      await c.start();

      await c.submit(ApplicationDraft());

      expect(c.state.result?.duplicate, isTrue);
      expect(c.state.result?.trackingRef, 'LMS-2026-000100');
      expect(c.state.result?.emailSent, isNull);
      await c.close();
    });

    test('submit failure stays on the form with the server message and keeps slips', () async {
      repository.prospectusResult = const [];
      repository.submitError = const ApiException(
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Enter a valid date of birth.',
      );
      final c = cubit();
      await c.start();

      await c.uploadSlip(filename: 'slip.jpg', bytes: [1]);
      await c.submit(ApplicationDraft());

      expect(c.state.status, ApplicationStatus.ready);
      expect(c.state.error?.message, 'Enter a valid date of birth.');
      expect(c.state.documentIds, ['doc-1']);
      await c.close();
    });
  });
}