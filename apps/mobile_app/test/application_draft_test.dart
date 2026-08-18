import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/admission/data/models/application_draft.dart';

void main() {
  group('ApplicationDraft contact validation', () {
    test('a spaced email fails locally, exactly like the server rejects it', () {
      final draft = ApplicationDraft()
        ..phone = '03001234567'
        ..email = 'ali @gmail.com'
        ..address = 'House 4, Street 9'
        ..city = 'Islamabad'
        ..acquisitionSource = 'FACEBOOK';

      expect(draft.emailInvalid, isTrue);
      expect(draft.contactComplete, isFalse);
    });

    test('an address without a dot fails locally too', () {
      final draft = ApplicationDraft()
        ..phone = '03001234567'
        ..email = 'ali@example'
        ..address = 'House 4, Street 9'
        ..city = 'Islamabad'
        ..acquisitionSource = 'FACEBOOK';

      expect(draft.emailInvalid, isTrue);
      expect(draft.contactComplete, isFalse);
    });

    test('a proper address passes, including multi-label domains', () {
      final draft = ApplicationDraft()
        ..phone = '03001234567'
        ..email = 'first.last@example.co.uk'
        ..address = 'House 4, Street 9'
        ..city = 'Islamabad'
        ..acquisitionSource = 'FACEBOOK';

      expect(draft.emailInvalid, isFalse);
      expect(draft.contactComplete, isTrue);
    });
  });

  group('ApplicationDraft payment completion', () {
    test('a slip id plus amount, date and consent completes the payment step', () {
      final draft = ApplicationDraft()
        ..claimedAmount = '45000'
        ..claimedPaymentDate = DateTime(2026, 8, 10)
        ..consentAccepted = true
        ..documentIds.add('doc-1');

      expect(draft.paymentComplete, isTrue);
    });

    test('a slip id alone does not complete it', () {
      final draft = ApplicationDraft()..documentIds.add('doc-1');

      expect(draft.paymentComplete, isFalse);
    });
  });
}