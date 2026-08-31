/// Fees page — SRS §5.11, FR-FEE-001..028.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/formats.dart';
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
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  if (state.summary != null)
                    _FeeSummaryPanel(summary: state.summary!, dark: dark),
                  const SizedBox(height: 16),
                  Text(
                    'Payment History',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.w600,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (state.submissions.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : AppColors.surface,
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

// ── Staff Fees View (Debtor List + Verification Queue) ──

class _StaffFeesView extends StatefulWidget {
  const _StaffFeesView({required this.api});
  final ApiClient api;

  @override
  State<_StaffFeesView> createState() => _StaffFeesViewState();
}

class _StaffFeesViewState extends State<_StaffFeesView> {
  late final StaffFeesCubit _debtorsCubit;
  late final VerificationQueueCubit _queueCubit;
  int _selectedTab = 0;

  @override
  void initState() {
    super.initState();
    final repo = FeesRepository(widget.api);
    _debtorsCubit = StaffFeesCubit(repo)..load();
    _queueCubit = VerificationQueueCubit(repo)..load();
  }

  @override
  void dispose() {
    _debtorsCubit.close();
    _queueCubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return MultiBlocProvider(
      providers: [
        BlocProvider.value(value: _debtorsCubit),
        BlocProvider.value(value: _queueCubit),
      ],
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Fees'),
          actions: [
            IconButton(
              icon: const Icon(Icons.verified),
              tooltip: 'Payment verification',
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
        body: Column(
          children: [
            // Tab bar
            Container(
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface : AppColors.surface,
                border: Border(
                  bottom: BorderSide(
                    color: dark ? AppColorsDark.line : AppColors.line,
                  ),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _TabButton(
                      label: 'Debtors',
                      selected: _selectedTab == 0,
                      dark: dark,
                      onTap: () => setState(() => _selectedTab = 0),
                    ),
                  ),
                  Expanded(
                    child: _TabButton(
                      label: 'Queue',
                      selected: _selectedTab == 1,
                      dark: dark,
                      onTap: () => setState(() => _selectedTab = 1),
                    ),
                  ),
                ],
              ),
            ),
            // Tab content
            Expanded(
              child: _selectedTab == 0
                  ? _DebtorListView(api: widget.api, dark: dark)
                  : _VerificationQueueView(dark: dark),
            ),
          ],
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
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
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? AppColors.brand600 : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: selected
                ? AppColors.brand600
                : (dark ? AppColorsDark.muted : AppColors.muted),
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

// ── Debtor List View ──

class _DebtorListView extends StatelessWidget {
  const _DebtorListView({required this.api, required this.dark});
  final ApiClient api;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<StaffFeesCubit, StaffFeesState>(
      listener: (context, state) {
        if (state.error != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.error!)),
          );
        }
      },
      builder: (context, state) {
        if (state.status == StaffFeesStatus.loading) {
          return const Center(child: CircularProgressIndicator());
        }

        return RefreshIndicator(
          onRefresh: () => context.read<StaffFeesCubit>().load(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              if (state.debtors.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface : AppColors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(
                      color: dark ? AppColorsDark.line : AppColors.line,
                    ),
                  ),
                  child: Text(
                    'Nobody owes anything',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                  ),
                )
              else ...[
                Text(
                  '${state.debtors.length} ${state.debtors.length == 1 ? 'student owes' : 'students owe'} money',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 8),
                ...state.debtors.map((d) => _DebtorTile(
                      debtor: d,
                      dark: dark,
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => MultiBlocProvider(
                              providers: [
                                RepositoryProvider(
                                  create: (_) => FeesRepository(api),
                                ),
                              ],
                              child: _StudentStatementPage(
                                studentId: d.studentId,
                                studentName: d.name,
                                api: api,
                              ),
                            ),
                          ),
                        );
                      },
                    )),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _DebtorTile extends StatelessWidget {
  const _DebtorTile({
    required this.debtor,
    required this.dark,
    required this.onTap,
  });

  final DebtorRow debtor;
  final bool dark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hasOverdue = debtor.outstanding > 0;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        onTap: onTap,
        title: Text(
          debtor.name,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${debtor.registrationNo} • ${debtor.programme}',
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 12,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (hasOverdue)
              Text(
                '${debtor.currency} ${debtor.outstanding}',
                style: TextStyle(
                  color: AppColors.error,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            const SizedBox(width: 8),
            Icon(
              Icons.chevron_right,
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Verification Queue View ──

class _VerificationQueueView extends StatelessWidget {
  const _VerificationQueueView({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<VerificationQueueCubit, VerificationQueueState>(
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
          onRefresh: () => context.read<VerificationQueueCubit>().load(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              if (state.stats != null)
                _StatsBand(stats: state.stats!, dark: dark),
              const SizedBox(height: 16),
              Text(
                'Verification Queue',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 8),
              if (state.rows.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface : AppColors.surface,
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
    );
  }
}

// ── Student Statement Page ──

class _StudentStatementPage extends StatefulWidget {
  const _StudentStatementPage({
    required this.studentId,
    required this.studentName,
    required this.api,
  });

  final String studentId;
  final String studentName;
  final ApiClient api;

  @override
  State<_StudentStatementPage> createState() => _StudentStatementPageState();
}

class _StudentStatementPageState extends State<_StudentStatementPage> {
  late final StaffStatementCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = StaffStatementCubit(FeesRepository(widget.api))
      ..load(widget.studentId);
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
          title: Text(widget.studentName),
          actions: [
            PopupMenuButton<String>(
              onSelected: (action) => _handleAction(context, action),
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'add_charge',
                  child: Text('Add Charge'),
                ),
                const PopupMenuItem(
                  value: 'record_payment',
                  child: Text('Record Payment'),
                ),
              ],
            ),
          ],
        ),
        body: BlocConsumer<StaffStatementCubit, StaffStatementState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == StaffStatementStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final s = state.statement;
            if (s == null) {
              return const Center(child: Text('No statement data'));
            }

            final inCredit = s.balance.outstanding < 0;

            return RefreshIndicator(
              onRefresh: () => _cubit.load(widget.studentId),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  // Balance card
                  _StatementBalanceCard(
                    statement: s,
                    inCredit: inCredit,
                    dark: dark,
                  ),
                  const SizedBox(height: 16),

                  // Statement lines
                  Text(
                    'Statement',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.w600,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (s.lines.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : AppColors.surface,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                      ),
                      child: Text(
                        'No charges yet',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    )
                  else
                    ...s.lines.map((line) => _StatementLineTile(
                          line: line,
                          dark: dark,
                        )),

                  // Charges section
                  if (s.charges.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Charges',
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...s.charges.map((c) => _ChargeTile(
                          charge: c,
                          dark: dark,
                          onWaive: c.waived
                              ? null
                              : () => _showWaiveDialog(context, c),
                        )),
                  ],

                  // Payments section
                  if (s.payments.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Payments',
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...s.payments.map((p) => _PaymentTile(
                          payment: p,
                          dark: dark,
                          onReverse: p.isReversed
                              ? null
                              : () => _showReverseDialog(context, p),
                        )),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  void _handleAction(BuildContext context, String action) {
    switch (action) {
      case 'add_charge':
        _showAddChargeDialog(context);
        break;
      case 'record_payment':
        _showRecordPaymentDialog(context);
        break;
    }
  }

  void _showAddChargeDialog(BuildContext context) {
    final descController = TextEditingController();
    final amountController = TextEditingController();
    DateTime? dueDate;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add a Charge'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    hintText: 'e.g. Tuition — Spring 2026',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: amountController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Amount',
                    hintText: '90000',
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    dueDate != null
                        ? 'Due: ${dueDate!.toLocal().toString().split(' ')[0]}'
                        : 'Select due date',
                  ),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: ctx,
                      initialDate: DateTime.now().add(const Duration(days: 30)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (picked != null) {
                      setDialogState(() => dueDate = picked);
                    }
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final desc = descController.text.trim();
                final amount = num.tryParse(amountController.text) ?? 0;
                if (desc.isEmpty || amount <= 0 || dueDate == null) return;
                Navigator.of(ctx).pop();
                _cubit.addCharge(
                  description: desc,
                  amount: amount,
                  dueDate: dueDate!.toUtc().toIso8601String(),
                );
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }

  void _showRecordPaymentDialog(BuildContext context) {
    final amountController = TextEditingController();
    final refController = TextEditingController();
    String method = 'CASH_DEPOSIT';
    DateTime paymentDate = DateTime.now();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Record a Payment'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: amountController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Amount',
                    hintText: '30000',
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('Date: ${paymentDate.toLocal().toString().split(' ')[0]}'),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: ctx,
                      initialDate: paymentDate,
                      firstDate: DateTime.now().subtract(const Duration(days: 365)),
                      lastDate: DateTime.now(),
                    );
                    if (picked != null) setDialogState(() => paymentDate = picked);
                  },
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: method,
                  decoration: const InputDecoration(labelText: 'Method'),
                  items: const [
                    DropdownMenuItem(value: 'CASH_DEPOSIT', child: Text('Cash deposit')),
                    DropdownMenuItem(value: 'BANK_TRANSFER', child: Text('Bank transfer')),
                    DropdownMenuItem(value: 'CHEQUE', child: Text('Cheque')),
                    DropdownMenuItem(value: 'OTHER', child: Text('Other')),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => method = v);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: refController,
                  decoration: const InputDecoration(
                    labelText: 'Reference (optional)',
                    hintText: 'Slip or transaction number',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final amount = num.tryParse(amountController.text) ?? 0;
                if (amount <= 0) return;
                Navigator.of(ctx).pop();
                _cubit.recordPayment(
                  amount: amount,
                  paymentDate: paymentDate.toUtc().toIso8601String(),
                  method: method,
                  bankReference: refController.text.trim().isNotEmpty
                      ? refController.text.trim()
                      : null,
                );
              },
              child: const Text('Record'),
            ),
          ],
        ),
      ),
    );
  }

  void _showWaiveDialog(BuildContext context, StatementCharge charge) {
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Write off: ${charge.description}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Amount: ${charge.amount}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: 'Reason (required)',
                hintText: 'Why — this stays on the statement',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final reason = reasonController.text.trim();
              if (reason.length < 10) return;
              Navigator.of(ctx).pop();
              _cubit.waiveCharge(chargeId: charge.id, reason: reason);
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  void _showReverseDialog(BuildContext context, StatementPayment payment) {
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reverse Payment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Amount: ${payment.amount}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: 'Reason (required)',
                hintText: 'e.g. Recorded against the wrong student',
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'The payment stays on the statement, marked as reversed.',
              style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final reason = reasonController.text.trim();
              if (reason.length < 10) return;
              Navigator.of(ctx).pop();
              _cubit.reversePayment(paymentId: payment.id, reason: reason);
            },
            child: const Text('Reverse'),
          ),
        ],
      ),
    );
  }
}

// ── Statement Balance Card ──

class _StatementBalanceCard extends StatelessWidget {
  const _StatementBalanceCard({
    required this.statement,
    required this.inCredit,
    required this.dark,
  });

  final StudentStatement statement;
  final bool inCredit;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                statement.student.registrationNo,
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 13,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: (inCredit ? AppColors.ok : AppColors.error)
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  inCredit ? 'In credit' : 'Outstanding',
                  style: TextStyle(
                    color: inCredit ? AppColors.ok : AppColors.error,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${statement.balance.outstanding.abs()}',
            style: TextStyle(
              color: inCredit ? AppColors.ok : AppColors.error,
              fontWeight: FontWeight.w700,
              fontSize: 24,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _BalanceItem(
                label: 'Charged',
                value: '${statement.balance.charged}',
                dark: dark,
              ),
              _BalanceItem(
                label: 'Paid',
                value: '${statement.balance.paid}',
                color: AppColors.ok,
                dark: dark,
              ),
              if (statement.balance.waived > 0)
                _BalanceItem(
                  label: 'Waived',
                  value: '${statement.balance.waived}',
                  dark: dark,
                ),
              if (statement.balance.reversed > 0)
                _BalanceItem(
                  label: 'Reversed',
                  value: '${statement.balance.reversed}',
                  color: AppColors.error,
                  dark: dark,
                ),
            ],
          ),
          if (statement.aging.oldestOverdueDays != null) ...[
            const SizedBox(height: 8),
            Text(
              'Oldest overdue: ${statement.aging.oldestOverdueDays} days',
              style: TextStyle(
                color: AppColors.warn,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _BalanceItem extends StatelessWidget {
  const _BalanceItem({
    required this.label,
    required this.value,
    this.color,
    required this.dark,
  });

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
              fontWeight: FontWeight.w700,
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

// ── Statement Line Tile ──

class _StatementLineTile extends StatelessWidget {
  const _StatementLineTile({required this.line, required this.dark});
  final StatementLine line;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final isReversal = line.kind == 'REVERSAL';
    final dateStr = line.date.isNotEmpty
        ? Formats.shortDate(DateTime.parse(line.date))
        : '';

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.description,
                  style: TextStyle(
                    color: isReversal
                        ? AppColors.warn
                        : (dark ? AppColorsDark.ink : AppColors.ink),
                    fontWeight: FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
                Text(
                  dateStr,
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Text(
              line.debit != null ? '${line.debit}' : '',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              line.credit != null ? '${line.credit}' : '',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: AppColors.ok,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              '${line.balance}',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Charge Tile ──

class _ChargeTile extends StatelessWidget {
  const _ChargeTile({
    required this.charge,
    required this.dark,
    this.onWaive,
  });

  final StatementCharge charge;
  final bool dark;
  final VoidCallback? onWaive;

  @override
  Widget build(BuildContext context) {
    final dueDate = charge.dueDate.isNotEmpty
        ? Formats.shortDate(DateTime.parse(charge.dueDate))
        : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        title: Text(
          charge.description,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${charge.amount} • due $dueDate',
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 12,
          ),
        ),
        trailing: charge.waived
            ? Text(
                'Written off',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                ),
              )
            : onWaive != null
                ? TextButton(
                    onPressed: onWaive,
                    child: const Text('Write off'),
                  )
                : null,
      ),
    );
  }
}

// ── Payment Tile ──

class _PaymentTile extends StatelessWidget {
  const _PaymentTile({
    required this.payment,
    required this.dark,
    this.onReverse,
  });

  final StatementPayment payment;
  final bool dark;
  final VoidCallback? onReverse;

  @override
  Widget build(BuildContext context) {
    final methodName = {
      'BANK_TRANSFER': 'Bank transfer',
      'CASH_DEPOSIT': 'Cash deposit',
      'CHEQUE': 'Cheque',
    }[payment.method] ?? payment.method;

    final paidDate = payment.paidOn.isNotEmpty
        ? Formats.shortDate(DateTime.parse(payment.paidOn))
        : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        title: Row(
          children: [
            Expanded(
              child: Text(
                '${payment.amount}',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (payment.isReversed)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.warn.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'Reversed',
                  style: TextStyle(
                    color: AppColors.warn,
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
              '$methodName • $paidDate${payment.reference != null ? ' • ref. ${payment.reference}' : ''}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            if (payment.isReversed && payment.reversalReason != null)
              Text(
                'Reversed: ${payment.reversalReason}',
                style: TextStyle(
                  color: AppColors.warn,
                  fontSize: 11,
                ),
              ),
          ],
        ),
        trailing: onReverse != null
            ? TextButton(
                onPressed: onReverse,
                child: const Text('Reverse'),
              )
            : null,
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
        color: dark ? AppColorsDark.surface : AppColors.surface,
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
              fontWeight: FontWeight.w700,
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
      return Formats.shortDate(dt);
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
        color: dark ? AppColorsDark.surface : AppColors.surface,
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
              fontWeight: FontWeight.w700,
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
      return Formats.shortDate(dt);
    } catch (_) {
      return dateStr;
    }
  }
}
