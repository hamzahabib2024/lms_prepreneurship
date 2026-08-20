import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/academic/structure/structure_page.dart';
import 'package:mobile_app/features/auth/data/models/auth_session.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'helpers/fake_adapter.dart';

Map<String, dynamic> _programme(String id, String code, String name) => {
      'id': id,
      'code': code,
      'name': name,
      'description': '$name programme description.',
      'durationWeeks': 12,
      '_count': {'sessions': 2},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late TokenStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = TokenStore.instance;
    await store.init();
  });

  testWidgets('programme names share one left edge whatever the code length',
      (tester) async {
    // A narrow phone — 320 logical px wide — and tall enough that every
    // card is mounted by the ListView.
    tester.view.physicalSize = const Size(320, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
      ..httpClientAdapter = FakeAdapter([
        (o) => Future.value(jsonResponse(200, {
              'data': [
                _programme('p1', 'DM', 'Digital Marketing'),
                _programme('p2', 'GD', 'Graphic Design'),
                _programme('p3', 'FLUTTER26', 'Flutter Development'),
                _programme('p4', 'MZ', 'Music Production'),
                _programme('p5', 'PREP', 'Preparatory Programme'),
              ],
              'meta': const {},
            })),
        (o) =>
            Future.value(jsonResponse(200, {'data': <Object>[], 'meta': const {}})),
        (o) =>
            Future.value(jsonResponse(200, {'data': <Object>[], 'meta': const {}})),
      ]);

    await tester.pumpWidget(MaterialApp(
      home: StructurePage(
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

    const codes = ['DM', 'GD', 'FLUTTER26', 'MZ', 'PREP'];
    const names = [
      'Digital Marketing',
      'Graphic Design',
      'Flutter Development',
      'Music Production',
      'Preparatory Programme',
    ];

    // The code column is fixed-width: every code starts at the same x.
    final codeLefts = {for (final c in codes) tester.getTopLeft(find.text(c)).dx};
    expect(codeLefts.length, 1, reason: 'all codes must share one left edge');

    // Codes never wrap, so a card's height never changes with its code.
    final codeHeights = {
      for (final c in codes) tester.getSize(find.text(c)).height,
    };
    expect(codeHeights.length, 1, reason: 'all codes must render on one line');

    // The programme name starts at the same x on every card, however long
    // the code to its left is.
    final nameLefts = {for (final n in names) tester.getTopLeft(find.text(n)).dx};
    expect(nameLefts.length, 1,
        reason: 'names must not shift with the code length');

    // The longest code fully clears the name column — no overlap.
    final codeRight = tester.getTopRight(find.text('FLUTTER26')).dx;
    final nameLeft = tester.getTopLeft(find.text('Flutter Development')).dx;
    expect(codeRight, lessThanOrEqualTo(nameLeft),
        reason: 'the longest code must not overlap its name');
  });
}