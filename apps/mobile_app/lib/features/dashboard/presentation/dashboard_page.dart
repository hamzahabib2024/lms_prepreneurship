import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../academic/academic_panel.dart';
import '../../admission/review/admissions_page.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../auth/data/models/auth_session.dart';
import '../../auth/presentation/change_password_page.dart';
import '../bloc/dashboard_bloc.dart';
import '../data/dashboard_repository.dart';
import 'widgets/dashboard_widgets.dart';

/// The dashboard — SRS §5.18.
///
/// The server decides which widgets this user gets (FR-DSH-002), so the
/// screen renders whatever it is given rather than branching on role. A
/// widget that failed server-side arrives as `{ unavailable: true }` and is
/// rendered as an unavailable panel rather than omitted — a silently missing
/// panel looks like data that does not exist (FR-DSH-010).
class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          DashboardBloc(repository: DashboardRepository(api: api))
            ..add(const DashboardLoadRequested()),
      child: DashboardScreen(user: user, api: api),
    );
  }
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  /// The accent under the page heading. It was cyan #0891B2; the web's
  /// twelve page hues are gone and so are these — §3.2 and §10.02.
  static const pageColor = AppColors.amber;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: BlocBuilder<DashboardBloc, DashboardState>(
          builder: (context, state) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Header(user: user, api: api, state: state),
                Expanded(child: _DashboardBody(state: state)),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Greeting + date + staleness pill (ARC-048 — anything that may be stale
/// carries when it was computed), with the admissions entry and the account
/// entry on the far end.
class _Header extends StatelessWidget {
  const _Header({required this.user, required this.api, required this.state});

  final AuthUser user;
  final ApiClient api;
  final DashboardState state;

  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';

    final isAdmin = user.isAdmin || user.isSuperAdmin;
    final isStaff = isAdmin || user.isTeacher;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The greeting row never competes for width, so the words can
          // never be squeezed into a vertical smear by the buttons.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(greeting, style: Theme.of(context).textTheme.headlineMedium),
                    const SizedBox(height: 2),
                    Text(
                      _longDate(DateTime.now()),
                      style: TextStyle(
                        fontSize: 12.5,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              _ProfileButton(user: user),
            ],
          ),
          // The actions live on their own line, wrapping only among
          // themselves — an "Academic" pill is never allowed to push
          // "Good morning" sideways.
          Wrap(
            spacing: 12,
            runSpacing: 8,
            alignment: WrapAlignment.end,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (state.data != null)
                Pill(text: 'as at ${_time(state.data!.generatedAt)}'),
              // The web gates Admissions behind the admin role; the server
              // still enforces the permission on every request (FR-REG-022).
              if (isAdmin) _AdmissionsButton(api: api),
              if (isStaff) _AcademicButton(user: user, api: api),
            ],
          ),
        ],
      ),
    );
  }

  static const _weekdays = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ];
  static const _months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  String _longDate(DateTime d) =>
      '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';

  String _time(DateTime d) {
    final h = d.hour.toString().padLeft(2, '0');
    final m = d.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}

/// The avatar — the web's `.avatar` initials tile. Opens the profile sheet,
/// the mobile equivalent of the sidebar foot (avatar, name, role, sign-out).
class _AdmissionsButton extends StatelessWidget {
  const _AdmissionsButton({required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => AdmissionsPage(api: api)),
          );
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.how_to_reg_outlined, size: 16),
              const SizedBox(width: 6),
              Text(
                'Admissions',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The mobile equivalent of the web sidebar's Institute block — staff land
/// here to manage programmes, sections, subjects, content, timetables and
/// teacher assignments.
class _AcademicButton extends StatelessWidget {
  const _AcademicButton({required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => AcademicPanel(user: user, api: api),
            ),
          );
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.school_outlined, size: 16),
              const SizedBox(width: 6),
              Text(
                'Academic',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The avatar — the web's `.avatar` initials tile. Opens the profile sheet,
/// the mobile equivalent of the sidebar foot (avatar, name, role, sign-out).
class _ProfileButton extends StatelessWidget {
  const _ProfileButton({required this.user});

  final AuthUser user;

  String get _initials {
    final parts = user.fullName.trim().split(RegExp(r'\s+'));
    return parts.take(2).map((p) => p.isNotEmpty ? p[0] : '').join().toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () {
          // The sheet is a route ABOVE this screen, so the AuthBloc provided
          // by the app shell is not an ancestor of it — pass the instance
          // explicitly instead of reading it from the sheet's context.
          final bloc = context.read<AuthBloc>();
          showModalBottomSheet<void>(
            context: context,
            showDragHandle: true,
            builder: (_) => _ProfileSheet(user: user, bloc: bloc),
          );
        },
        child: Container(
          width: 38,
          height: 38,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            // The web's avatar: the brand gradient, not a photo.
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.brand600, AppColors.brand800],
            ),
            shape: BoxShape.circle,
            boxShadow: AppShadow.soft,
          ),
          child: Text(
            _initials.isEmpty ? 'U' : _initials,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileSheet extends StatelessWidget {
  const _ProfileSheet({required this.user, required this.bloc});

  final AuthUser user;
  final AuthBloc bloc;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.brand600, AppColors.brand800],
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    user.fullName.isNotEmpty
                        ? user.fullName
                            .trim()
                            .split(RegExp(r'\s+'))
                            .take(2)
                            .map((p) => p.isNotEmpty ? p[0] : '')
                            .join()
                            .toUpperCase()
                        : 'U',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.fullName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        user.roleLabel,
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                      if (user.student?.registrationNo.isNotEmpty ?? false)
                        Text(
                          user.student!.registrationNo,
                          style: TextStyle(fontSize: 12.5, color: muted),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(user.email, style: TextStyle(color: muted, fontSize: 13.5)),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
                // The pushed page needs the same bloc, and like the sheet it
                // lives outside the shell's provider — hand it over.
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => BlocProvider.value(
                      value: bloc,
                      child: const ChangePasswordPage(forced: false),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.password, size: 18),
              label: const Text('Change password'),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
                bloc.add(const LogoutRequested());
              },
              style: FilledButton.styleFrom(
                backgroundColor: dark ? AppColorsDark.error : AppColors.error,
                foregroundColor: Colors.white,
                disabledBackgroundColor:
                    (dark ? AppColorsDark.error : AppColors.error).withValues(alpha: 0.5),
              ),
              icon: const Icon(Icons.logout, size: 18),
              label: const Text('Sign out'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardBody extends StatelessWidget {
  const _DashboardBody({required this.state});

  final DashboardState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case DashboardStatus.loading:
        return const SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: SkeletonCards(count: 4),
        );

      case DashboardStatus.failure:
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            AppAlert(
              title: 'Could not load your dashboard',
              message: state.error?.message ?? 'Something went wrong.',
              reference: state.error?.reference,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () =>
                  context.read<DashboardBloc>().add(const DashboardLoadRequested()),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Try again'),
            ),
          ],
        );

      case DashboardStatus.loaded:
        final data = state.data!;
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            for (final entry in data.widgets.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _buildWidget(context, entry.key, entry.value),
              ),
          ],
        );
    }
  }

  Widget _buildWidget(BuildContext context, String name, dynamic value) {
    final title = widgetTitles[name] ?? name;
    final v = value is Map<String, dynamic> ? value : const <String, dynamic>{};

    if (v['unavailable'] == true) {
      return WidgetCard(
        title: title,
        pageColor: DashboardScreen.pageColor,
        unavailable: true,
        child: Text(
          v['message'] as String? ?? 'Temporarily unavailable.',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            fontSize: 14,
          ),
        ),
      );
    }

    return WidgetCard(
      title: title,
      pageColor: DashboardScreen.pageColor,
      child: DashboardWidgetBody(name: name, value: value),
    );
  }
}