/// Fees page — SRS §5.11, FR-FEE-001..028.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/fees_cubit.dart';
import '../data/fees_repository.dart';
import '../data/models/fees_models.dart';
import 'payment_submit_page.dart';
import 'payment_verification_page.dart';

class FeesPage extends StatefulWidget {
  const FeesPage({super.key, required this.user, required this.api});
  final AuthUser user;
  final ApiClient api;

  @override
  State<FeesPage> createState() => _FeesPageState();
}

class _FeesPageState extends State<FeesPage> {
  @override
  Widget build(BuildContext context) {
    final isStaff = widget.user.isAdmin || widget.user.isSuperAdmin || widget.user.isTeacher;
    if (isStaff) {
      return _StaffFeesView(api: widget.api);
    }
    return _StudentFeesView(api: widget.api);
  }
}

// ── Student Fees View ──

class _StudentFeesView extends StatefulWidget {
  const _StudentFeesView({required this.api});
  final ApiClient api;

  @override
  State<_StudentFeesView> createState() => _StudentFeesViewState();
}

class _StudentFeesViewState extends State<_StudentFeesView> {
  late final StudentFeesCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = StudentFeesCubit(FeesRepository(widget.api))..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Fees'),
          actions: [
            IconButton(
              icon: const Icon(Icons.payment),
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => RepositoryProvider(
                      create: (_) => FeesRepository(widget.api),
                      child: const PaymentSubmitPage(),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
        body: BlocConsumer<StudentFeesCubit, StudentFeesState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == StudentFeesStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            return RefreshIndicator(
              onRefresh: () => _cubit.load(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (state.summary != null)
                    _FeeSummaryPanel(summary: state.summary!, dark: dark),
                  const SizedBox(height: 16),
                  Text(
                    'Payment History',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (state.submissions.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                      ),
                      child: Text(
                        'No payment submissions yet',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    )
                  else
                    ...state.submissions.map((s) => _SubmissionTile(
                          submission: s,
                          dark: dark,
                          onWithdraw: () => _cubit.withdrawSubmission(s.id),
                        )),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Staff Fees View (Debtor List) ──

class _StaffFeesView extends StatefulWidget {
  const _StaffFeesView({required this.api});
  final ApiClient api;

  @override
  State<_StaffFeesView> createState() => _StaffFeesViewState();
}

class _StaffFeesViewState extends State<_StaffFeesView> {
  late final VerificationQueueCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = VerificationQueueCubit(FeesRepository(widget.api))..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Fees'),
          actions: [
            IconButton(
              icon: const Icon(Icons.verified),
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => RepositoryProvider(
                      create: (_) => FeesRepository(widget.api),
                      child: const PaymentVerificationPage(),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
        body: BlocConsumer<VerificationQueueCubit, VerificationQueueState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == VerificationQueueStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            return RefreshIndicator(
              onRefresh: () => _cubit.load(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (state.stats != null)
                    _StatsBand(stats: state.stats!, dark: dark),
                  const SizedBox(height: 16),
                  Text(
                    'Verification Queue',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (state.rows.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Text(
                        'No pending submissions',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    )
                  else
                    ...state.rows.map((row) => _VerificationRow(row: row, dark: dark)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Summary Panel ──

class _FeeSummaryPanel extends StatelessWidget {
  const _FeeSummaryPanel({required this.summary, required this.dark});
  final FeeSummary summary;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (summary.headline != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: _standingColor(summary.standing).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                summary.headline!,
                style: TextStyle(
                  color: _standingColor(summary.standing),
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              _SummaryItem(label: 'Total', value: '${summary.totalFee}', dark: dark),
              _SummaryItem(label: 'Paid', value: '${summary.verified}', color: AppColors.ok, dark: dark),
              _SummaryItem(label: 'Pending', value: '${summary.pending}', color: AppColors.warn, dark: dark),
              _SummaryItem(label: 'Remaining', value: '${summary.remaining}', color: AppColors.error, dark: dark),
            ],
          ),
        ],
      ),
    );
  }

  Color _standingColor(String standing) {
    switch (standing) {
      case 'FULLY_PAID':
      case 'IN_CREDIT':
        return AppColors.ok;
      case 'NOTHING_DUE':
        return AppColors.muted;
      default:
        return AppColors.warn;
    }
  }
}

// ── Summary Item ──

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({required this.label, required this.value, this.color, required this.dark});
  final String label;
  final String value;
  final Color? color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              color: color ?? (dark ? AppColorsDark.ink : AppColors.ink),
              fontWeight: FontWeight.bold,
              fontSize: 18,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Submission Tile ──

class _SubmissionTile extends StatelessWidget {
  const _SubmissionTile({
    required this.submission,
    required this.dark,
    required this.onWithdraw,
  });

  final PaymentSubmission submission;
  final bool dark;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context) {
    final statusColor = {
      'PENDING': AppColors.warn,
      'VERIFIED': AppColors.ok,
      'REJECTED': AppColors.error,
      'CANCELLED': AppColors.muted,
    }[submission.status] ?? AppColors.muted;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        title: Row(
          children: [
            Expanded(
              child: Text(
                '${submission.currency} ${submission.amount}',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                submission.status,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              '${submission.methodLabel} • ${_formatDate(submission.paidOn)}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            if (submission.receiptNo != null)
              Text(
                'Receipt: ${submission.receiptNo}',
                style: TextStyle(
                  color: AppColors.ok,
                  fontSize: 12,
                ),
              ),
          ],
        ),
        trailing: submission.status == 'PENDING'
            ? TextButton(
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: const Text('Withdraw Submission?'),
                      content: const Text('This action cannot be undone.'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Cancel'),
                        ),
                        TextButton(
                          onPressed: () {
                            Navigator.of(context).pop();
                            onWithdraw();
                          },
                          child: const Text('Withdraw', style: TextStyle(color: AppColors.error)),
                        ),
                      ],
                    ),
                  );
                },
                child: const Text('Withdraw'),
              )
            : null,
      ),
    );
  }

  String _formatDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return dateStr;
    }
  }
}

// ── Stats Band ──

class _StatsBand extends StatelessWidget {
  const _StatsBand({required this.stats, required this.dark});
  final VerificationStats stats;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          _StatsItem(label: 'Pending', value: '${stats.pendingCount}', color: AppColors.warn, dark: dark),
          _StatsItem(label: 'Today', value: '${stats.verifiedTodayCount}', color: AppColors.ok, dark: dark),
          _StatsItem(label: 'Collected', value: '${stats.totalCollected}', dark: dark),
          _StatsItem(label: 'Outstanding', value: '${stats.totalOutstanding}', color: AppColors.error, dark: dark),
        ],
      ),
    );
  }
}

// ── Stats Item ──

class _StatsItem extends StatelessWidget {
  const _StatsItem({required this.label, required this.value, this.color, required this.dark});
  final String label;
  final String value;
  final Color? color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              color: color ?? (dark ? AppColorsDark.ink : AppColors.ink),
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Verification Row ──

class _VerificationRow extends StatelessWidget {
  const _VerificationRow({required this.row, required this.dark});
  final VerificationQueueRow row;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: row.proofCount > 0 ? AppColors.brand600 : AppColors.muted,
          child: Text(
            '${row.proofCount}',
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ),
        title: Text(
          '${row.studentName} — ${row.currency} ${row.amount}',
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${row.methodLabel} • ${_formatDate(row.submittedAt)}',
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 12,
          ),
        ),
        trailing: Icon(
          Icons.chevron_right,
          color: dark ? AppColorsDark.muted : AppColors.muted,
        ),
      ),
    );
  }

  String _formatDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return dateStr;
    }
  }
}
