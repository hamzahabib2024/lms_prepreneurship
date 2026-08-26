/// Payment verification page — SRS §5.11, FR-FEE-013..020.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/fees_cubit.dart';
import '../data/fees_repository.dart';
import '../data/models/fees_models.dart';

class PaymentVerificationPage extends StatefulWidget {
  const PaymentVerificationPage({super.key});

  @override
  State<PaymentVerificationPage> createState() => _PaymentVerificationPageState();
}

class _PaymentVerificationPageState extends State<PaymentVerificationPage> {
  late final VerificationQueueCubit _cubit;
  String _selectedStatus = '';

  @override
  void initState() {
    super.initState();
    _cubit = VerificationQueueCubit(context.read<FeesRepository>())..load();
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
          title: const Text('Payment Verification'),
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

            return Column(
              children: [
                // Stats
                if (state.stats != null)
                  _StatsBar(stats: state.stats!, dark: dark),

                // Filters
                _FilterBar(
                  selectedStatus: _selectedStatus,
                  dark: dark,
                  onStatusChanged: (v) {
                    setState(() => _selectedStatus = v);
                    _cubit.updateFilterStatus(v);
                  },
                ),

                // Queue list
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () => _cubit.load(),
                    child: state.rows.isEmpty
                        ? Center(
                            child: Text(
                              'No submissions match filters',
                              style: TextStyle(
                                color: dark ? AppColorsDark.muted : AppColors.muted,
                              ),
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: state.rows.length,
                            itemBuilder: (context, index) {
                              final row = state.rows[index];
                              return _VerificationTile(
                                row: row,
                                dark: dark,
                                onReview: () => _openReview(row),
                              );
                            },
                          ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  void _openReview(VerificationQueueRow row) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => RepositoryProvider.value(
        value: context.read<FeesRepository>(),
        child: BlocProvider.value(
          value: _cubit,
          child: _ReviewSheet(row: row),
        ),
      ),
    );
  }
}

// ── Stats Bar ──

class _StatsBar extends StatelessWidget {
  const _StatsBar({required this.stats, required this.dark});
  final VerificationStats stats;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          _StatItem(label: 'Pending', value: '${stats.pendingCount}', color: AppColors.warn, dark: dark),
          _StatItem(label: 'Today', value: '${stats.verifiedTodayCount}', color: AppColors.ok, dark: dark),
          _StatItem(label: 'Owing', value: '${stats.studentsOwing}', dark: dark),
        ],
      ),
    );
  }
}

// ── Stat Item ──

class _StatItem extends StatelessWidget {
  const _StatItem({required this.label, required this.value, this.color, required this.dark});
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

// ── Filter Bar ──

class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.selectedStatus,
    required this.dark,
    required this.onStatusChanged,
  });

  final String selectedStatus;
  final bool dark;
  final ValueChanged<String> onStatusChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          _FilterChip(
            label: 'All',
            selected: selectedStatus.isEmpty,
            dark: dark,
            onTap: () => onStatusChanged(''),
          ),
          _FilterChip(
            label: 'Pending',
            selected: selectedStatus == 'PENDING',
            dark: dark,
            onTap: () => onStatusChanged('PENDING'),
          ),
          _FilterChip(
            label: 'Verified',
            selected: selectedStatus == 'VERIFIED',
            dark: dark,
            onTap: () => onStatusChanged('VERIFIED'),
          ),
          _FilterChip(
            label: 'Rejected',
            selected: selectedStatus == 'REJECTED',
            dark: dark,
            onTap: () => onStatusChanged('REJECTED'),
          ),
        ],
      ),
    );
  }
}

// ── Filter Chip ──

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.dark,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final bool dark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: selected
                ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                : (dark ? AppColorsDark.surface : Colors.white),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected
                  ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                  : (dark ? AppColorsDark.line : AppColors.line),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: selected
                  ? Colors.white
                  : (dark ? AppColorsDark.ink : AppColors.ink),
              fontWeight: FontWeight.w500,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Verification Tile ──

class _VerificationTile extends StatelessWidget {
  const _VerificationTile({
    required this.row,
    required this.dark,
    required this.onReview,
  });

  final VerificationQueueRow row;
  final bool dark;
  final VoidCallback onReview;

  @override
  Widget build(BuildContext context) {
    final statusColor = {
      'PENDING': AppColors.warn,
      'VERIFIED': AppColors.ok,
      'REJECTED': AppColors.error,
    }[row.status] ?? AppColors.muted;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: statusColor,
          child: Text(
            row.studentName.isNotEmpty ? row.studentName[0].toUpperCase() : '?',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
          ),
        ),
        title: Text(
          row.studentName,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${row.registrationNo} • ${row.methodLabel}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            Row(
              children: [
                Text(
                  '${row.currency} ${row.amount}',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    row.status,
                    style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w600),
                  ),
                ),
                if (row.proofCount > 0) ...[
                  const SizedBox(width: 8),
                  Icon(Icons.attach_file, size: 14, color: AppColors.brand600),
                  Text(
                    '${row.proofCount}',
                    style: TextStyle(color: AppColors.brand600, fontSize: 11),
                  ),
                ],
              ],
            ),
          ],
        ),
        trailing: row.status == 'PENDING'
            ? FilledButton(
                onPressed: onReview,
                child: const Text('Review'),
              )
            : null,
      ),
    );
  }
}

// ── Review Sheet ──

class _ReviewSheet extends StatefulWidget {
  const _ReviewSheet({required this.row});
  final VerificationQueueRow row;

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  late final TextEditingController _amountController;
  late final TextEditingController _reasonController;
  bool _isVerifying = true;

  @override
  void initState() {
    super.initState();
    _amountController = TextEditingController(
      text: widget.row.amount.toString(),
    );
    _reasonController = TextEditingController();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final cubit = context.read<VerificationQueueCubit>();

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
        left: 16,
        right: 16,
        top: 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Review Payment',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.row.studentName} — ${widget.row.currency} ${widget.row.amount}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
            ),
            Text(
              '${widget.row.methodLabel} • ${_formatDate(widget.row.paidOn)}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 16),

            // Verify/Reject toggle
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _isVerifying = true),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: _isVerifying ? AppColors.ok : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.ok),
                      ),
                      child: Text(
                        'Verify',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _isVerifying ? Colors.white : AppColors.ok,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _isVerifying = false),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: !_isVerifying ? AppColors.error : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.error),
                      ),
                      child: Text(
                        'Reject',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: !_isVerifying ? Colors.white : AppColors.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            if (_isVerifying) ...[
              Text(
                'Verified Amount',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _amountController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  filled: true,
                  fillColor: dark ? AppColorsDark.surface : Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                style: TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink),
              ),
            ] else ...[
              Text(
                'Rejection Reason',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _reasonController,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'Enter reason for rejection...',
                  filled: true,
                  fillColor: dark ? AppColorsDark.surface : Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                style: TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink),
              ),
            ],
            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      if (_isVerifying) {
                        final amount = num.tryParse(_amountController.text) ?? widget.row.amount;
                        cubit.verify(
                          submissionId: widget.row.id,
                          verifiedAmount: amount,
                        );
                      } else {
                        cubit.reject(
                          submissionId: widget.row.id,
                          reason: _reasonController.text,
                        );
                      }
                      Navigator.of(context).pop();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _isVerifying ? AppColors.ok : AppColors.error,
                    ),
                    child: Text(_isVerifying ? 'Verify' : 'Reject'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
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
