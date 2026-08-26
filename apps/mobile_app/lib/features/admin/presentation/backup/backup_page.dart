import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/backup_item.dart';

class BackupPage extends StatelessWidget {
  const BackupPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))..loadBackups(),
      child: const _BackupView(),
    );
  }
}

class _BackupView extends StatelessWidget {
  const _BackupView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Backup & restore'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _confirmCreateBackup(context),
        icon: const Icon(Icons.backup_outlined, size: 20),
        label: const Text('New backup'),
      ),
      body: BlocConsumer<AdminCubit, AdminState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionSuccess!)),
            );
            context.read<AdminCubit>().dismissResult();
          }
          if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionError!.message)),
            );
            context.read<AdminCubit>().dismissResult();
          }
        },
        builder: (context, state) {
          if (state.loadingBackups) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          }

          if (state.backupsError != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load backups',
                    message: state.backupsError!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<AdminCubit>().loadBackups(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          if (state.backups.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  'No backups yet. Tap "New backup" to create one.',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<AdminCubit>().loadBackups(),
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
              itemCount: state.backups.length,
              itemBuilder: (context, index) {
                final backup = state.backups[index];
                return _BackupCard(backup: backup);
              },
            ),
          );
        },
      ),
    );
  }

  void _confirmCreateBackup(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Create backup'),
        content: const Text(
          'This captures a snapshot of all data. The backup is immediately verified.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().createBackup();
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}

class _BackupCard extends StatelessWidget {
  const _BackupCard({required this.backup});

  final BackupItem backup;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: backup.broken
              ? (dark ? AppColorsDark.error : AppColors.error).withValues(alpha: 0.5)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  backup.age ?? backup.id,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              if (backup.broken)
                Pill(text: 'Broken', kind: PillKind.warn)
              else
                Pill(text: '${backup.totalRows} rows'),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${backup.sizeLabel} · ${backup.takenAt.substring(0, 19).replaceAll('T', ' ')}',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          if (backup.schemaVersion != null) ...[
            const SizedBox(height: 4),
            Text(
              'Schema: ${backup.schemaVersion}',
              style: TextStyle(fontSize: 11, color: muted),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: () => _confirmRestore(context, backup),
                icon: const Icon(Icons.restore, size: 16),
                label: const Text('Restore'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: () => _confirmVerify(context, backup),
                icon: const Icon(Icons.verified_outlined, size: 16),
                label: const Text('Verify'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: () => context.read<AdminCubit>().downloadBackup(id: backup.id),
                icon: const Icon(Icons.download_outlined, size: 16),
                label: const Text('Download'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _confirmVerify(BuildContext context, BackupItem backup) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Verify backup'),
        content: Text(
          'This checks the integrity of the backup from ${backup.age ?? backup.id}.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().verifyBackup(id: backup.id);
            },
            child: const Text('Verify'),
          ),
        ],
      ),
    );
  }

  void _confirmRestore(BuildContext context, BackupItem backup) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Restore backup'),
        content: Text(
          'This will REPLACE ALL DATA with the backup from ${backup.age ?? backup.id}. '
          'Maintenance mode must be enabled first. This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().restoreBackup(id: backup.id);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Restore'),
          ),
        ],
      ),
    );
  }
}
