import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/academic/subjects/subjects_page.dart';
import 'package:mobile_app/features/auth/data/models/auth_session.dart';
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

  Future<void> pumpSubjects(WidgetTester tester) async {
    final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
      ..httpClientAdapter = FakeAdapter([
        (_) => Future.value(jsonResponse(200, {
              'data': <Object>[],
              'meta': const {},
            })),
      ]);
    await tester.pumpWidget(MaterialApp(
      home: SubjectsPage(
        api: ApiClient(tokenStore: store, dio: dio),
        user: const AuthUser(
          id: 'u1',
          fullName: 'Test Admin',
          email: 'admin@test.dev',
          roles: ['admin'],
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('New subject'));
    await tester.pumpAndSettle();
  }

  testWidgets('helpers appear once beneath their fields — never as placeholders',
      (tester) async {
    await pumpSubjects(tester);

    expect(find.text('Create a subject'), findsOneWidget);
    expect(find.text('Digital Marketing'), findsOneWidget);
    expect(find.text('DM — letters and digits only'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('What the subject is about'), findsOneWidget);
  });

  testWidgets('spacing contract: 8px label-to-input, 6px input-to-helper, '
      '20px between fields', (tester) async {
    await pumpSubjects(tester);

    // Name label -> its input.
    final labelBottom = tester.getBottomLeft(find.text('Name')).dy;
    final inputTop = tester.getTopLeft(find.byType(TextField).first).dy;
    expect(inputTop - labelBottom, closeTo(8, 0.5));

    // Input -> helper below it.
    final inputBottom = tester.getBottomLeft(find.byType(TextField).first).dy;
    final helperTop = tester.getTopLeft(find.text('Digital Marketing')).dy;
    expect(helperTop - inputBottom, closeTo(6, 0.5));

    // Helper -> next field's label.
    final nextLabelTop = tester.getTopLeft(find.text('Code')).dy;
    final helperBottom =
        tester.getBottomLeft(find.text('Digital Marketing')).dy;
    expect(nextLabelTop - helperBottom, closeTo(20, 0.5));

    // Description expands to three lines, not one.
    final description = find.byType(TextField).at(3);
    expect(tester.getSize(description).height, greaterThan(60));
  });

  testWidgets('submit is disabled until valid, then reachable above the keyboard',
      (tester) async {
    await pumpSubjects(tester);

    final button = find.widgetWithText(FilledButton, 'Create subject');
    expect(tester.widget<FilledButton>(button).onPressed, isNull,
        reason: 'empty form must be un-submittable');

    await tester.enterText(find.byType(TextField).at(0), 'Digital Marketing');
    await tester.enterText(find.byType(TextField).at(1), 'dm');
    await tester.enterText(find.byType(TextField).at(2), '3');
    await tester.pump();

    expect(tester.widget<FilledButton>(button).onPressed, isNotNull,
        reason: 'a valid subject must enable submit');

    // Keyboard open: viewInsets are physical pixels, so scale to logical.
    final keyboardLogicalPx = 300.0 * tester.view.devicePixelRatio;
    tester.view.viewInsets = FakeViewPadding(bottom: keyboardLogicalPx);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();

    await tester.ensureVisible(button);
    await tester.pumpAndSettle();

    final height =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    final rect = tester.getRect(button);
    expect(rect.bottom, lessThanOrEqualTo(height - 300),
        reason: 'the button must not hide under the keyboard');
    expect(rect.top, greaterThanOrEqualTo(0));
  });
}