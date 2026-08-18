import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/admission/data/admission_repository.dart';
import 'package:mobile_app/features/admission/data/models/application_draft.dart';
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

  ApiClient client(FakeAdapter adapter) =>
      ApiClient(tokenStore: store, dio: Dio(BaseOptions(baseUrl: 'http://test/v1'))..httpClientAdapter = adapter);

  group('AdmissionRepository public', () {
    test('prospectus parses programmes and sections', () async {
      final adapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': [
                {
                  'id': 'p1',
                  'name': 'Diploma in Digital Marketing',
                  'code': 'DM',
                  'description': null,
                  'durationWeeks': 24,
                  'sections': [
                    {
                      'id': 'sec-1',
                      'name': 'SP26-DM-EVE-A (Female)',
                      'code': 'SP26DM-EVE-A',
                      'shift': 'EVENING',
                      'genderRestriction': 'FEMALE',
                      'session': 'Spring 2026',
                    },
                  ],
                },
              ],
              'meta': {},
            })),
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final programmes = await repository.prospectus();

      expect(programmes, hasLength(1));
      expect(programmes.single.name, 'Diploma in Digital Marketing');
      expect(programmes.single.sections.single.genderRestriction, 'FEMALE');
      expect(programmes.single.sections.single.isGenderRestricted, isTrue);
      expect(adapter.calls.single.path, '/public/prospectus');
    });

    test('submit sends the server contract: normalized phone/CNIC, dates, consent, slip ids', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/public/registrations');
          expect(body['phone'], '+923001234567');
          expect(body['nationalId'], '3520212345671');
          expect(body['dateOfBirth'], '2004-05-12');
          expect(body['claimedAmount'], 45000);
          expect(body['claimedPaymentDate'], '2026-08-10');
          expect(body['consentVersion'], ApplicationDraft.consentVersion);
          expect(body['consentAccepted'], true);
          expect(body['documentIds'], ['doc-1']);
          return Future.value(jsonResponse(200, {
                'data': {
                  'trackingRef': 'LMS-2026-000123',
                  'email': 'ali@example.com',
                  'emailSent': true,
                  'message': 'received',
                },
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final draft = ApplicationDraft()
        ..fullName = 'Ali Khan'
        ..fatherName = 'Ahmed Khan'
        ..dateOfBirth = DateTime(2004, 5, 12)
        ..gender = 'MALE'
        ..nationalId = '35202-1234567-1'
        ..phone = '0300 1234567'
        ..email = 'Ali@Example.com'
        ..address = 'House 4, Street 9, G-10'
        ..city = 'Islamabad'
        ..educationLevel = 'FSC'
        ..qualification = 'FSc Pre-Engineering, 2024'
        ..desiredProgrammeId = 'p1'
        ..desiredSectionId = 'sec-1'
        ..acquisitionSource = 'FACEBOOK'
        ..claimedAmount = '45000'
        ..claimedPaymentDate = DateTime(2026, 8, 10)
        ..consentAccepted = true;
      draft.documentIds.add('doc-1');

      final result = await repository.submit(draft);

      expect(result.trackingRef, 'LMS-2026-000123');
      expect(result.emailSent, isTrue);
    });

    test('uploadSlip posts multipart and returns the document id', () async {
      final adapter = FakeAdapter([
        (o) {
          expect(o.path, '/public/registrations/slips');
          expect(o.data, isA<FormData>());
          return Future.value(jsonResponse(200, {
                'data': {'documentId': 'doc-9', 'deduplicated': false},
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final id = await repository.uploadSlip(filename: 'slip.jpg', bytes: [1, 2, 3]);

      expect(id, 'doc-9');
    });

    test('publicStatus parses the thin FR-REG-020 envelope', () async {
      final adapter = FakeAdapter([
        (o) {
          expect(o.path, '/public/registrations/LMS-2026-000123/status');
          return Future.value(jsonResponse(200, {
                'data': {
                  'status': 'REJECTED',
                  'lastUpdatedAt': '2026-08-11T10:00:00.000Z',
                  'message': 'The slip was illegible.',
                  'reasonCode': 'SLIP_ILLEGIBLE',
                },
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final status = await repository.publicStatus('LMS-2026-000123');

      expect(status.status, 'REJECTED');
      expect(status.reasonCode, 'SLIP_ILLEGIBLE');
      expect(status.message, 'The slip was illegible.');
    });
  });

  group('AdmissionRepository administrative', () {
    const queueRow = {
      'id': 'r1',
      'trackingRef': 'LMS-2026-000007',
      'status': 'PENDING_REVIEW',
      'fullName': 'Sara Ali',
      'gender': 'FEMALE',
      'phone': '+923001234567',
      'email': 'sara@example.com',
      'claimedAmount': 25000,
      'acquisitionSource': 'INSTAGRAM',
      'createdAt': '2026-08-10T10:00:00.000Z',
      'isOverdue': true,
      'isClaimed': false,
      'desiredSection': {'id': 'sec-1', 'code': 'SP26DM-EVE-A', 'name': 'SP26-DM-EVE-A (Female)'},
    };

    test('queue parses rows and keeps the default open-state filter', () async {
      final adapter = FakeAdapter([
        (o) {
          expect(o.path, '/registration-requests');
          return Future.value(jsonResponse(200, {
                'data': [queueRow],
                'pagination': {'page': 1, 'pageSize': 25, 'total': 1},
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final rows = await repository.queue();

      expect(rows, hasLength(1));
      expect(rows.single.fullName, 'Sara Ali');
      expect(rows.single.isOverdue, isTrue);
      expect(rows.single.desiredSection?.code, 'SP26DM-EVE-A');
    });

    test('detail parses every submitted field and the slip documents', () async {
      final adapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': {
                'id': 'r1',
                'trackingRef': 'LMS-2026-000007',
                'status': 'PENDING_REVIEW',
                'fullName': 'Sara Ali',
                'fatherName': 'Imran Ali',
                'dateOfBirth': '2005-02-14T00:00:00.000Z',
                'gender': 'FEMALE',
                'nationalId': '3520212345671',
                'phone': '+923001234567',
                'phoneIsWhatsapp': true,
                'email': 'sara@example.com',
                'address': 'Street 3, F-8',
                'city': 'Islamabad',
                'educationLevel': 'BACHELORS',
                'qualification': 'BSc, 2024',
                'occupation': null,
                'acquisitionSource': 'REFERRAL',
                'acquisitionDetail': 'My sister studied here.',
                'claimedAmount': 25000,
                'claimedPaymentDate': '2026-08-01T00:00:00.000Z',
                'claimedBankRef': 'TRX-8899',
                'createdAt': '2026-08-10T10:00:00.000Z',
                'desiredProgramme': {'id': 'p1', 'name': 'DM', 'code': 'DM'},
                'desiredSection': {'id': 'sec-1', 'name': 'A', 'code': 'SP26DM-EVE-A'},
                'documents': [
                  {
                    'id': 'd1',
                    'documentType': 'PAYMENT_SLIP',
                    'originalFilename': 'slip.jpg',
                    'contentType': 'image/jpeg',
                    'sizeBytes': 204800,
                    'scanStatus': 'PENDING',
                    'createdAt': '2026-08-10T10:05:00.000Z',
                  },
                ],
              },
              'meta': {},
            })),
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final detail = await repository.detail('r1');

      expect(detail.fullName, 'Sara Ali');
      expect(detail.acquisitionDetail, 'My sister studied here.');
      expect(detail.claimedAmount, 25000);
      expect(detail.documents.single.originalFilename, 'slip.jpg');
      expect(detail.documents.single.isPdf, isFalse);
    });

    test('slipBytes streams the document with the session', () async {
      final adapter = FakeAdapter([
        (o) {
          expect(o.path, '/registration-requests/r1/documents/d1');
          expect(o.headers['Authorization'], 'Bearer access-1');
          return Future.value(bytesResponse([137, 80, 78, 71]));
        },
      ]);
      store.accessToken = 'access-1';
      final repository = AdmissionRepository(api: client(adapter));

      final bytes = await repository.slipBytes('r1', 'd1');

      expect(bytes, [137, 80, 78, 71]);
    });

    test('approve sends verified payment, section, override and variance reason', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/registration-requests/r1/approve');
          final payment = body['payment'] as Map<String, dynamic>;
          expect(payment['verifiedAmount'], 24500);
          expect(payment['currency'], 'PKR');
          expect(payment['paymentDate'], '2026-08-11');
          expect(payment['method'], 'BANK_TRANSFER');
          expect(payment['bankReference'], 'TRX-9999');
          expect(payment['varianceReason'], 'First instalment only.');
          expect(body['sectionId'], 'sec-2');
          expect(body['capacityOverride'], true);
          return Future.value(jsonResponse(201, {
                'data': {
                  'student': {
                    'id': 'st1',
                    'registrationNo': 'CIIT/SP26-BAI-034/ISB',
                    'rollNo': 7,
                    'sectionName': 'SP26-BAI-034 (Male)',
                    'returningStudent': false,
                  },
                  'account': {
                    'temporaryPassword': 'Temp!2026x',
                    'mustChangePassword': true,
                  },
                  'enrolments': {'count': 5},
                  'whatsappLinks': {'channel': 'https://whatsapp.com/chan', 'group': 'https://whatsapp.com/grp'},
                  'notificationsSent': ['Sign-in details emailed to sara@example.com.'],
                },
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final result = await repository.approve(
        id: 'r1',
        verifiedAmount: 24500,
        paymentDate: DateTime(2026, 8, 11),
        method: 'BANK_TRANSFER',
        bankReference: 'TRX-9999',
        varianceReason: 'First instalment only.',
        sectionId: 'sec-2',
        capacityOverride: true,
      );

      expect(result.registrationNo, 'CIIT/SP26-BAI-034/ISB');
      expect(result.rollNo, 7);
      expect(result.temporaryPassword, 'Temp!2026x');
      expect(result.whatsappGroup, 'https://whatsapp.com/grp');
      expect(result.notificationsSent, hasLength(1));
    });

    test('reject sends the reason code', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          expect(o.path, '/registration-requests/r1/reject');
          expect(body['reasonCode'], 'SLIP_ILLEGIBLE');
          return Future.value(jsonResponse(200, {'data': null, 'meta': {}}));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      await repository.reject(id: 'r1', reasonCode: 'SLIP_ILLEGIBLE');

      expect(adapter.calls, hasLength(1));
    });

    test('approve omits empty variance and bank reference when not needed', () async {
      final adapter = FakeAdapter([
        (o) {
          final body = (o.data as Map).cast<String, dynamic>();
          final payment = body['payment'] as Map<String, dynamic>;
          expect(payment.containsKey('varianceReason'), isFalse);
          expect(payment.containsKey('bankReference'), isFalse);
          return Future.value(jsonResponse(201, {
                'data': {
                  'student': {
                    'registrationNo': 'N-1',
                    'rollNo': 1,
                    'sectionName': 'A',
                    'returningStudent': true,
                  },
                  'account': {'temporaryPassword': null, 'note': 'Already has an account.'},
                  'enrolments': {'count': 0},
                  'whatsappLinks': {'channel': null, 'group': null},
                  'notificationsSent': [],
                },
                'meta': {},
              }));
        },
      ]);
      final repository = AdmissionRepository(api: client(adapter));

      final result = await repository.approve(
        id: 'r1',
        verifiedAmount: 25000,
        paymentDate: DateTime(2026, 8, 11),
        method: 'CASH_DEPOSIT',
        sectionId: 'sec-2',
      );

      expect(result.registrationNo, 'N-1');
      expect(result.temporaryPassword, isNull);
      expect(result.returningStudent, isTrue);
      expect(result.accountNote, 'Already has an account.');
    });
  });
}