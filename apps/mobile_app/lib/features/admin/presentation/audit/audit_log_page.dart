import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/audit_entry.dart';

class AuditLogPage extends StatelessWidget {
  const AuditLogPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))..loadAuditLog(),
      child: const _AuditLogView(),
    );
  }
}

class _AuditLogView extends StatelessWidget {
  const _AuditLogView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Audit log'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<AdminCubit, AdminState>(
        builder: (context, state) {
          if (state.loadingAudit) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 5),
            );
          }

          if (state.auditError != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load audit log',
                    message: state.auditError!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<AdminCubit>().loadAuditLog(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          if (state.auditEntries.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text('No audit entries found.'),
              ),
            );
          }

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                child: Row(
                  children: [
                    Text(
                      '${state.auditEntries.length} entries',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => context.read<AdminCubit>().loadAuditLog(),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                    itemCount: state.auditEntries.length,
                    itemBuilder: (context, index) {
                      final entry = state.auditEntries[index];
                      return _AuditEntryTile(entry: entry);
                    },
                  ),
                ),
              ),
              if (state.auditTotalPages > 1)
                _PaginationControls(
                  currentPage: state.auditPage,
                  totalPages: state.auditTotalPages,
                  onPageChanged: (page) => context.read<AdminCubit>().loadAuditLog(page: page),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _AuditEntryTile extends StatelessWidget {
  const _AuditEntryTile({required this.entry});

  final AuditEntry entry;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: brand.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  entry.action,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: brand),
                ),
              ),
              const SizedBox(width: 8),
              if (entry.entityType != null)
                Text(
                  entry.entityType!,
                  style: TextStyle(fontSize: 11.5, color: muted),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (entry.actor != null)
            Text(
              entry.actor!,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          const SizedBox(height: 2),
          Text(
            _formatDate(entry.occurredAt),
            style: TextStyle(fontSize: 11.5, color: muted),
          ),
          if (entry.ipAddress != null) ...[
            const SizedBox(height: 2),
            Text(
              'IP: ${entry.ipAddress}',
              style: TextStyle(fontSize: 11, color: muted),
            ),
          ],
        ],
      ),
    );
  }

  static String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}

class _PaginationControls extends StatelessWidget {
  const _PaginationControls({
    required this.currentPage,
    required this.totalPages,
    required this.onPageChanged,
  });

  final int currentPage;
  final int totalPages;
  final ValueChanged<int> onPageChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: dark ? AppColorsDark.line : AppColors.line)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: currentPage > 1 ? () => onPageChanged(currentPage - 1) : null,
            icon: const Icon(Icons.chevron_left, size: 20),
          ),
          Text(
            '$currentPage / $totalPages',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: brand),
          ),
          IconButton(
            onPressed: currentPage < totalPages ? () => onPageChanged(currentPage + 1) : null,
            icon: const Icon(Icons.chevron_right, size: 20),
          ),
        ],
      ),
    );
  }
}
