import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/academic/staffing/staffing_page.dart';
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

  /// Pumps the staffing screen and opens the assign sheet for one teacher.
  Future<void> openAssignSheet(WidgetTester tester) async {
    final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
      ..httpClientAdapter = FakeAdapter([
        // /teachers/workload
        (_) => Future.value(jsonResponse(200, {
              'data': [
                {
                  'teacherId': 't1',
                  'name': 'Ayesha Khan',
                  'status': 'ACTIVE',
                  'subjectSections': 2,
                  'students': 34,
                },
              ],
              'meta': const {},
            })),
        // /teachers/t1/assignments
        (_) => Future.value(jsonResponse(200, {
              'data': <Object>[],
              'meta': const {},
            })),
        // /sections — the offering catalogue, page 1 of 1.
        (_) => Future.value(jsonResponse(200, {
              'data': <Object>[],
              'pagination': {
                'page': 1,
                'pageSize': 100,
                'totalItems': 0,
                'totalPages': 0,
                'hasNext': false,
                'hasPrevious': false,
              },
              'meta': const {},
            })),
      ]);
    await tester.pumpWidget(MaterialApp(
      home: StaffingPage(api: ApiClient(tokenStore: store, dio: dio)),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ayesha Khan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Assign a subject'));
    await tester.pumpAndSettle();
  }

  testWidgets('an end date can be picked beyond today', (tester) async {
    await openAssignSheet(tester);

    final now = DateTime.now();
    await tester.tap(find.text('No end date'));
    await tester.pumpAndSettle();

    final picker = tester
        .widget<CalendarDatePicker>(find.byType(CalendarDatePicker));
    expect(picker.lastDate.isAfter(now.add(const Duration(days: 700))), isTrue,
        reason: 'the end date must reach beyond today');
    expect(picker.firstDate.isAfter(now), isTrue,
        reason: 'an end date may not sit behind the start date');
    expect(picker.initialDate!.isBefore(now.add(const Duration(days: 2))),
        isTrue,
        reason: 'the calendar must open on today, not on the far end '
            'of the range');

    // Confirm the picker: the faint field now carries the picked date.
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('No end date'), findsNothing,
        reason: 'the end date must be accepted and shown');
  });

  testWidgets('the start picker opens on today, not two years out',
      (tester) async {
    await openAssignSheet(tester);

    final now = DateTime.now();
    await tester.tap(find.text('Today'));
    await tester.pumpAndSettle();

    final picker = tester
        .widget<CalendarDatePicker>(find.byType(CalendarDatePicker));
    expect(picker.initialDate!.year, now.year,
        reason: 'the calendar must open on the current year');
    expect(picker.initialDate!.month, now.month,
        reason: 'the calendar must open on the current month');
    expect(picker.firstDate.isBefore(now.subtract(const Duration(days: 1))),
        isFalse,
        reason: 'a new assignment cannot start in the past');
  });
}