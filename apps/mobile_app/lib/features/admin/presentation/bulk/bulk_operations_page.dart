import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/bulk_report.dart';

class BulkOperationsPage extends StatelessWidget {
  const BulkOperationsPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api)),
      child: const _BulkOperationsView(),
    );
  }
}

class _BulkOperationsView extends StatelessWidget {
  const _BulkOperationsView();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bulk operations'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          Text(
            'Student management',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            'Transfer students between sections or withdraw them in bulk. '
            'Maximum 200 students per operation.',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 16),
          _OperationCard(
            icon: Icons.swap_horiz_outlined,
            title: 'Section transfer',
            subtitle: 'Move students from one section to another',
            builder: (_) => const _TransferPage(),
          ),
          const SizedBox(height: 10),
          _OperationCard(
            icon: Icons.person_remove_outlined,
            title: 'Bulk withdrawal',
            subtitle: 'Withdraw multiple students with a recorded reason',
            builder: (_) => const _WithdrawPage(),
          ),
        ],
      ),
    );
  }
}

class _OperationCard extends StatelessWidget {
  const _OperationCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.builder,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder builder;

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
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: builder),
          ),
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
                  child: Icon(icon, size: 20, color: dark ? AppColorsDark.brand600 : AppColors.brand600),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text(subtitle, style: TextStyle(fontSize: 12, color: muted)),
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

class _TransferPage extends StatefulWidget {
  const _TransferPage();

  @override
  State<_TransferPage> createState() => _TransferPageState();
}

class _TransferPageState extends State<_TransferPage> {
  final _sectionController = TextEditingController();
  final _studentIdsController = TextEditingController();
  final _reasonController = TextEditingController();
  BulkReport? _preview;

  @override
  void dispose() {
    _sectionController.dispose();
    _studentIdsController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Section transfer'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
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
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            children: [
              Text('Target section', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              TextField(
                controller: _sectionController,
                decoration: const InputDecoration(
                  labelText: 'Section ID',
                  hintText: 'The destination section UUID',
                ),
              ),
              const SizedBox(height: 14),
              Text('Student IDs', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              TextField(
                controller: _studentIdsController,
                decoration: const InputDecoration(
                  labelText: 'Comma-separated UUIDs',
                  hintText: 'uuid1, uuid2, uuid3',
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 14),
              if (_preview != null) ...[
                _PreviewReport(report: _preview!),
                const SizedBox(height: 14),
                Text('Reason', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                TextField(
                  controller: _reasonController,
                  decoration: const InputDecoration(
                    labelText: 'Reason (min 10 characters)',
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: state.busy || _reasonController.text.trim().length < 10
                        ? null
                        : () {
                            final ids = _studentIdsController.text
                                .split(',')
                                .map((s) => s.trim())
                                .where((s) => s.isNotEmpty)
                                .toList();
                            context.read<AdminCubit>().repository
                                .bulkTransfer(
                                  studentIds: ids,
                                  toSectionId: _sectionController.text.trim(),
                                  reason: _reasonController.text.trim(),
                                )
                                .then((_) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Transfer complete')),
                                );
                              }
                            });
                          },
                    child: state.busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Execute transfer'),
                  ),
                ),
              ] else ...[
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: state.busy
                        ? null
                        : () {
                            final ids = _studentIdsController.text
                                .split(',')
                                .map((s) => s.trim())
                                .where((s) => s.isNotEmpty)
                                .toList();
                            if (ids.isEmpty || _sectionController.text.trim().isEmpty) return;
                            context.read<AdminCubit>().repository
                                .bulkTransferPreview(
                                  studentIds: ids,
                                  toSectionId: _sectionController.text.trim(),
                                )
                                .then((report) {
                              if (mounted) setState(() => _preview = report);
                            });
                          },
                    child: state.busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Preview'),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _WithdrawPage extends StatefulWidget {
  const _WithdrawPage();

  @override
  State<_WithdrawPage> createState() => _WithdrawPageState();
}

class _WithdrawPageState extends State<_WithdrawPage> {
  final _studentIdsController = TextEditingController();
  final _reasonController = TextEditingController();

  @override
  void dispose() {
    _studentIdsController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bulk withdrawal'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
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
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            children: [
              Text('Student IDs', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              TextField(
                controller: _studentIdsController,
                decoration: const InputDecoration(
                  labelText: 'Comma-separated UUIDs',
                  hintText: 'uuid1, uuid2, uuid3',
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 14),
              Text('Reason', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              TextField(
                controller: _reasonController,
                decoration: const InputDecoration(
                  labelText: 'Reason for withdrawal (min 10 characters)',
                ),
                maxLines: 2,
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: state.busy || _reasonController.text.trim().length < 10
                      ? null
                      : () {
                          final ids = _studentIdsController.text
                              .split(',')
                              .map((s) => s.trim())
                              .where((s) => s.isNotEmpty)
                              .toList();
                          if (ids.isEmpty) return;
                          _confirmWithdraw(context, ids);
                        },
                  child: state.busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Withdraw students'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _confirmWithdraw(BuildContext context, List<String> ids) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm withdrawal'),
        content: Text(
          'This will withdraw ${ids.length} student${ids.length == 1 ? '' : 's'}. '
          'This action cannot be easily undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().repository
                  .bulkWithdraw(
                    studentIds: ids,
                    reason: _reasonController.text.trim(),
                  )
                  .then((_) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Withdrawal complete')),
                  );
                }
              });
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
  }
}

class _PreviewReport extends StatelessWidget {
  const _PreviewReport({required this.report});

  final BulkReport report;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ok = dark ? AppColorsDark.ok : AppColors.ok;
    final error = dark ? AppColorsDark.error : AppColors.error;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Preview', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          Text(report.summary ?? '${report.succeeded} would succeed, ${report.failed} would fail'),
          const SizedBox(height: 8),
          Row(
            children: [
              Pill(text: '${report.succeeded} would succeed'),
              if (report.failed > 0) ...[
                const SizedBox(width: 6),
                Pill(text: '${report.failed} would fail', kind: PillKind.warn),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
