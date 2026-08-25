import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/admin_cubit.dart';
import '../data/admin_repository.dart';
import 'audit/audit_log_page.dart';
import 'backup/backup_page.dart';
import 'bulk/bulk_operations_page.dart';
import 'settings/settings_page.dart';
import 'security/security_page.dart';
import 'users/users_page.dart';
import '../../cohort_import/data/cohort_import_repository.dart';
import '../../cohort_import/cubit/cohort_import_cubit.dart';
import '../../cohort_import/presentation/cohort_import_page.dart';

class AdminPanel extends StatelessWidget {
  const AdminPanel({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api)),
      child: _AdminPanelView(user: user, api: api),
    );
  }
}

class _AdminPanelView extends StatelessWidget {
  const _AdminPanelView({required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final entries = <_AdminEntry>[
      _AdminEntry(
        icon: Icons.manage_accounts_outlined,
        title: 'Users & roles',
        subtitle: 'Staff accounts, roles, and access permissions',
        builder: (_) => UsersPage(api: api),
      ),
      _AdminEntry(
        icon: Icons.tune_outlined,
        title: 'System settings',
        subtitle: 'Attendance, progress, maintenance, institute configuration',
        builder: (_) => SettingsPage(api: api),
      ),
      _AdminEntry(
        icon: Icons.swap_horiz_outlined,
        title: 'Bulk operations',
        subtitle: 'Section transfers and student withdrawals',
        builder: (_) => BulkOperationsPage(api: api),
      ),
      _AdminEntry(
        icon: Icons.history_outlined,
        title: 'Audit log',
        subtitle: 'Immutable record of every change in the system',
        builder: (_) => AuditLogPage(api: api),
      ),
      _AdminEntry(
        icon: Icons.shield_outlined,
        title: 'Security log',
        subtitle: 'Sign-in attempts, lockouts, and threat detection',
        builder: (_) => SecurityPage(api: api),
        superAdminOnly: true,
      ),
      _AdminEntry(
        icon: Icons.backup_outlined,
        title: 'Backup & restore',
        subtitle: 'Data snapshots, verification, and point-in-time recovery',
        builder: (_) => BackupPage(api: api),
        superAdminOnly: true,
      ),
      _AdminEntry(
        icon: Icons.file_upload_outlined,
        title: 'Cohort import',
        subtitle: 'Import student cohorts via CSV upload',
        builder: (_) => const _CohortImportEntry(),
        superAdminOnly: true,
      ),
    ];

    final visible = entries.where((e) => e.visibleFor(user)).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Administration'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              'System governance',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'User management, settings, audit trails, backups and security monitoring.',
              style: TextStyle(
                fontSize: 12.5,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 14),
            for (final entry in visible)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _AdminEntryTile(entry: entry),
              ),
          ],
        ),
      ),
    );
  }
}

class _AdminEntry {
  const _AdminEntry({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.builder,
    this.superAdminOnly = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder builder;
  final bool superAdminOnly;

  bool visibleFor(AuthUser user) {
    if (superAdminOnly) return user.isSuperAdmin;
    return user.isAdmin || user.isSuperAdmin;
  }
}

class _AdminEntryTile extends StatelessWidget {
  const _AdminEntryTile({required this.entry});

  final _AdminEntry entry;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(builder: entry.builder),
            );
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Icon(entry.icon, size: 20, color: dark ? AppColorsDark.brand600 : AppColors.brand600),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.title,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        entry.subtitle,
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CohortImportEntry extends StatelessWidget {
  const _CohortImportEntry();

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return BlocProvider(
      create: (_) => CohortImportCubit(CohortImportRepository(api)),
      child: const CohortImportPage(),
    );
  }
}
