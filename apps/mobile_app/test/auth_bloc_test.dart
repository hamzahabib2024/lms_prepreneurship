import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/api_exception.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:mobile_app/features/auth/bloc/auth_bloc.dart';
import 'package:mobile_app/features/auth/data/models/auth_session.dart';
import 'package:mobile_app/features/auth/data/repositories/auth_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeRepository extends AuthRepository {
  _FakeRepository({required super.api});

  AuthSession? loginResult;
  MeResult? meResult;
  Object? loginError;
  Object? meError;
  bool changedPassword = false;

  @override
  Future<AuthSession> login({required String email, required String password}) async {
    if (loginError != null) throw loginError!;
    return loginResult!;
  }

  @override
  Future<MeResult> me() async {
    if (meError != null) throw meError!;
    return meResult!;
  }

  @override
  Future<void> logout() async {}

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    changedPassword = true;
  }
}

const _userJson = {
  'id': 'u1',
  'fullName': 'Jane Student',
  'email': 'jane@institute.local',
  'roles': ['student'],
  'photoUrl': null,
  'student': {
    'registrationNo': 'CIIT-2026-001',
    'rollNo': 5,
    'sectionId': 's1',
    'sectionName': null,
  },
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late ApiClient api;
  late TokenStore store;
  late _FakeRepository repository;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = TokenStore.instance;
    await store.init();
    api = ApiClient(tokenStore: store);
    repository = _FakeRepository(api: api);
  });

  AuthBloc bloc() =>
      AuthBloc(repository: repository, api: api, tokenStore: store);

  group('AuthBloc app start', () {
    test('with no stored refresh token lands on the login screen', () async {
      final states = <AuthStatus>[];
      final b = bloc();
      b.stream.listen((s) => states.add(s.status));

      b.add(const AppStarted());
      await b.stream.firstWhere((s) => s.status != AuthStatus.initial);

      expect(states.last, AuthStatus.unauthenticated);
      await b.close();
    });

    test('with a stored refresh token restores via /auth/me', () async {
      store.setRefreshToken('family.token');
      repository.meResult = MeResult(
        user: AuthUser.fromJson(_userJson),
        mustChangePassword: false,
      );

      final b = bloc();
      b.add(const AppStarted());
      final user = await b.stream
          .firstWhere((s) => s.status == AuthStatus.authenticated)
          .then((s) => s.user);

      expect(user?.fullName, 'Jane Student');
      expect(user?.roleLabel, 'Student');
      expect(user?.student?.registrationNo, 'CIIT-2026-001');
      await b.close();
    });

    test('a revoked session ends on the login screen', () async {
      store.setRefreshToken('family.token');
      repository.meError = const ApiException(
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Session revoked.',
      );

      final b = bloc();
      b.add(const AppStarted());
      await b.stream.firstWhere((s) => s.status == AuthStatus.unauthenticated);

      expect(store.refreshToken, isNull);
      await b.close();
    });
  });

  group('AuthBloc login', () {
    test('stores the tokens and authenticates', () async {
      repository.loginResult = const AuthSession(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresIn: 900,
        user: AuthUser(id: 'u1', fullName: 'Jane Student', email: 'j@i.local', roles: ['student']),
        mustChangePassword: false,
      );

      final b = bloc();
      b.add(LoginRequested(email: 'j@i.local', password: 'secret'));
      final state = await b.stream.firstWhere((s) => s.status == AuthStatus.authenticated);

      expect(state.user?.id, 'u1');
      expect(store.accessToken, 'access-1');
      expect(store.refreshToken, 'refresh-1');
      await b.close();
    });

    test('a provisioned account is held at the password gate', () async {
      repository.loginResult = const AuthSession(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresIn: 900,
        user: AuthUser(id: 'u1', fullName: 'Jane Student', email: 'j@i.local', roles: ['student']),
        mustChangePassword: true,
      );

      final b = bloc();
      b.add(LoginRequested(email: 'j@i.local', password: 'ChangeMe!'));
      final state = await b.stream.firstWhere((s) => s.status == AuthStatus.authenticated);

      expect(state.mustChangePassword, true);
      await b.close();
    });

    test('failed credentials surface the server message', () async {
      repository.loginError = const ApiException(
        status: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'The email address or password is incorrect.',
      );

      final b = bloc();
      b.add(LoginRequested(email: 'j@i.local', password: 'wrong'));
      final state = await b.stream.firstWhere((s) => s.status == AuthStatus.failure);

      expect(state.error?.code, 'AUTH_INVALID_CREDENTIALS');
      expect(state.error?.message, 'The email address or password is incorrect.');
      await b.close();
    });
  });

  group('AuthBloc password change', () {
    test('lifted the forced-password gate', () async {
      repository.loginResult = const AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        user: AuthUser(id: 'u1', fullName: 'Jane', email: 'j@i.local', roles: ['student']),
        mustChangePassword: true,
      );

      final b = bloc();
      b.add(LoginRequested(email: 'j@i.local', password: 'temp'));
      var state = await b.stream.firstWhere((s) => s.status == AuthStatus.authenticated);
      expect(state.mustChangePassword, true);

      final ok = await b.changePassword(
        currentPassword: 'temp',
        newPassword: 'LongEnough!1',
      );

      expect(ok, true);
      expect(b.state.mustChangePassword, false);
      expect(repository.changedPassword, true);
      await b.close();
    });
  });
}