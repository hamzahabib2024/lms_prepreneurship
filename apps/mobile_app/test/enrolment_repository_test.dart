import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/enrolment/data/enrolment_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'helpers/fake_adapter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late TokenStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = TokenStore.instance;
    await store.init();
  });

  ApiClient client(FakeAdapter adapter) => ApiClient(
        tokenStore: store,
        dio: Dio(BaseOptions(baseUrl: 'http://test/v1'))
          ..httpClientAdapter = adapter,
      );

  group('EnrolmentRepository', () {
    test('roster parses the server shape and keeps the register order', () async {
      final adapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': [
                {
                  'studentId': 's1',
                  'rollNo': 7,
                  'registrationNo': 'LMS-2026-000114',
                  'name': 'Ayesha Khan',
                  'photoUrl': null,
                  'accountStatus': 'ACTIVE',
                  'subjects': ['SP26GD-MORA', 'SP26GD-COM'] ,
                },
                {
                  'studentId': 's2',
                  'rollNo': 8,
                  'registrationNo': 'LMS-2026-000115',
                  'name': 'Bilal Ahmed',
                  'photoUrl': null,
                  'accountStatus': 'SUSPENDED',
                  'subjects': [],
                },
              ],
              'meta': {},
            })),
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final rows = await repository.roster('sec-1');

      expect(adapter.calls.single.path, '/sections/sec-1/roster');
      expect(rows, hasLength(2));
      expect(rows.first.name, 'Ayesha Khan');
      expect(rows.first.rollNo, 7);
      expect(rows.first.subjects, ['SP26GD-MORA', 'SP26GD-COM']);
      expect(rows.last.accountStatus, 'SUSPENDED');
    });

    test('history parses nested subject and section, dates and reason', () async {
      final adapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': [
                {
                  'id': 'e1',
                  'subject': {'code': 'SP26GD-MORA', 'name': 'Moral Studies'},
                  'section': {'code': 'GD-MOR-A', 'name': 'Graphic Designing A'},
                  'status': 'TRANSFERRED',
                  'rollNoAtEnrolment': 3,
                  'enrolledAt': '2026-02-01T09:00:00.000Z',
                  'endedAt': '2026-06-15T09:00:00.000Z',
                  'reason': 'Moved to the morning shift',
                },
              ],
              'meta': {},
            })),
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final rows = await repository.history('s1');

      expect(adapter.calls.single.path, '/students/s1/enrolments');
      expect(rows, hasLength(1));
      expect(rows.single.subjectCode, 'SP26GD-MORA');
      expect(rows.single.sectionCode, 'GD-MOR-A');
      expect(rows.single.status, 'TRANSFERRED');
      expect(rows.single.enrolledAt, isNotNull);
      expect(rows.single.reason, 'Moved to the morning shift');
    });

    test('transfer sends the server contract and parses the result', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/students/s1/transfer');
          expect(o.method, 'POST');
          expect(body['toSectionId'], 'sec-2');
          expect(body['carryHistory'], true);
          expect(body['capacityOverride'], false);
          expect(body['reason'], 'Family relocated to the evening shift');
          return Future.value(jsonResponse(200, {
                'data': {
                  'studentId': 's1',
                  'registrationNo': 'LMS-2026-000114',
                  'from': {'id': 'sec-1', 'code': 'GD-MOR-A', 'name': 'Graphic A'},
                  'to': {'id': 'sec-2', 'code': 'GD-EVE-A', 'name': 'Graphic B'},
                  'newRollNo': 4,
                  'subjectsEnrolled': 6,
                },
                'meta': {},
              }));
        },
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final result = await repository.transfer(
        studentId: 's1',
        toSectionId: 'sec-2',
        carryHistory: true,
        reason: 'Family relocated to the evening shift',
      );

      expect(result.fromCode, 'GD-MOR-A');
      expect(result.toCode, 'GD-EVE-A');
      expect(result.newRollNo, 4);
      expect(result.subjectsEnrolled, 6);
    });

    test('suspend sends the mandatory reason', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/students/s1/suspend');
          expect(body['reason'], 'Repeated absence without notice');
          return Future.value(jsonResponse(200, {
                'data': {'studentId': 's1', 'status': 'SUSPENDED', 'reason': body['reason']},
                'meta': {},
              }));
        },
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final result = await repository.suspend(
        studentId: 's1',
        reason: 'Repeated absence without notice',
      );

      expect(result.status, 'SUSPENDED');
    });

    test('withdraw parses the released roll number', () async {
      final adapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': {
                'studentId': 's1',
                'status': 'WITHDRAWN',
                'registrationNo': 'LMS-2026-000114',
                'rollNumberReleased': 7,
              },
              'meta': {},
            })),
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final result =
          await repository.withdraw(studentId: 's1', reason: 'Left mid-term');

      expect(result.status, 'WITHDRAWN');
      expect(result.rollNumberReleased, 7);
    });

    test('reinstate omits an empty reason and parses requiresReEnrolment', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map?) ?? const {};
          expect(o.path, '/students/s1/reinstate');
          expect(body.containsKey('reason'), isFalse);
          return Future.value(jsonResponse(200, {
                'data': {
                  'studentId': 's1',
                  'status': 'ACTIVE',
                  'requiresReEnrolment': true,
                  'message': 'Account reactivated. Enrol into a section to restore access.',
                },
                'meta': {},
              }));
        },
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final result = await repository.reinstate(studentId: 's1');

      expect(result.status, 'ACTIVE');
      expect(result.requiresReEnrolment, isTrue);
    });

    test('bulk transfer preview posts the list and destination', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/admin/bulk/transfer/preview');
          expect(body['studentIds'], ['s1', 's2']);
          expect(body['toSectionId'], 'sec-2');
          return Future.value(jsonResponse(200, {
                'data': {
                  'section': {'id': 'sec-2', 'name': 'Graphic B', 'placesRemaining': 8},
                  'total': 2,
                  'succeeded': 1,
                  'failed': 1,
                  'skipped': 0,
                  'rows': [
                    {
                      'studentId': 's2',
                      'name': 'Bilal Ahmed',
                      'outcome': 'FAILED',
                      'message': 'SP26 is full.',
                    },
                    {
                      'studentId': 's1',
                      'name': 'Ayesha Khan',
                      'outcome': 'WOULD_SUCCEED',
                    },
                  ],
                  'summary': '1 of 2 would go through.',
                },
                'meta': {},
              }));
        },
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final report = await repository.bulkTransferPreview(
        studentIds: ['s1', 's2'],
        toSectionId: 'sec-2',
      );

      expect(report.total, 2);
      expect(report.failed, 1);
      expect(report.sectionName, 'Graphic B');
      expect(report.placesRemaining, 8);
      expect(report.rows.first.outcome, 'FAILED');
      expect(report.summary, '1 of 2 would go through.');
    });

    test('bulk transfer and bulk withdraw send their reasons', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/admin/bulk/transfer');
          expect(body['reason'], 'Consolidating morning and evening sections');
          return Future.value(jsonResponse(200, {
                'data': {
                  'total': 1, 'succeeded': 1, 'failed': 0, 'skipped': 0,
                  'rows': [
                    {'studentId': 's1', 'outcome': 'SUCCEEDED'},
                  ],
                  'summary': 'All 1 done.',
                },
                'meta': {},
              }));
        },
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/admin/bulk/withdraw');
          expect(body['reason'], 'Batch closed by the institute');
          return Future.value(jsonResponse(200, {
                'data': {
                  'total': 2, 'succeeded': 2, 'failed': 0, 'skipped': 0,
                  'rows': [
                    {'studentId': 's1', 'outcome': 'SUCCEEDED'},
                    {'studentId': 's2', 'outcome': 'SUCCEEDED'},
                  ],
                  'summary': 'All 2 done.',
                },
                'meta': {},
              }));
        },
      ]);
      final repository = EnrolmentRepository(api: client(adapter));

      final moved =
          await repository.bulkTransfer(studentIds: ['s1'], toSectionId: 'sec-2', reason: 'Consolidating morning and evening sections');
      final withdrawn =
          await repository.bulkWithdraw(studentIds: ['s1', 's2'], reason: 'Batch closed by the institute');

      expect(moved.succeeded, 1);
      expect(withdrawn.total, 2);
      expect(adapter.calls.map((c) => c.path).toList(),
          ['/admin/bulk/transfer', '/admin/bulk/withdraw']);
    });
  });
}