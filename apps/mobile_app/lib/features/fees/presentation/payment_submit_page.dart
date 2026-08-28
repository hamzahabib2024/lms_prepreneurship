/// Payment submit page — SRS §5.11, FR-FEE-006..012.
library;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/formats.dart';
import '../../../../core/theme/app_theme.dart';
import '../cubit/fees_cubit.dart';
import '../data/fees_repository.dart';
import '../data/models/fees_models.dart';

class PaymentSubmitPage extends StatefulWidget {
  const PaymentSubmitPage({super.key});

  @override
  State<PaymentSubmitPage> createState() => _PaymentSubmitPageState();
}

class _PaymentSubmitPageState extends State<PaymentSubmitPage> {
  late final PaymentSubmitCubit _cubit;
  late final TextEditingController _amountController;
  late final TextEditingController _refController;
  late final TextEditingController _noteController;
  List<PlatformFile> _slipFiles = [];

  @override
  void initState() {
    super.initState();
    _cubit = PaymentSubmitCubit(context.read<FeesRepository>())
      ..loadBankDetails()
      ..loadFeeSummary();
    _amountController = TextEditingController();
    _refController = TextEditingController();
    _noteController = TextEditingController();
  }

  @override
  void dispose() {
    _cubit.close();
    _amountController.dispose();
    _refController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _pickSlip() async {
    final result = await FilePicker.pickFiles();
    if (result.isNotEmpty) {
      setState(() => _slipFiles = result);
    }
  }

  void _removeSlip(int index) {
    setState(() => _slipFiles.removeAt(index));
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Submit Payment'),
        ),
        body: BlocConsumer<PaymentSubmitCubit, PaymentSubmitState>(
          listener: (context, state) {
            if (state.status == PaymentSubmitStatus.submitted) {
              showDialog(
                context: context,
                barrierDismissible: false,
                builder: (_) => AlertDialog(
                  title: const Text('Submitted'),
                  content: const Text(
                    'Your payment submission has been received. '
                    'It will be reviewed by the finance team.',
                  ),
                  actions: [
                    FilledButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        Navigator.of(context).pop();
                      },
                      child: const Text('OK'),
                    ),
                  ],
                ),
              );
            }
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == PaymentSubmitStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Fee summary
                  if (state.feeSummary != null) ...[
                    _FeeSummaryCard(summary: state.feeSummary!, dark: dark),
                    const SizedBox(height: 24),
                  ],

                  // Bank details
                  if (state.bankDetails != null && state.bankDetails!.configured) ...[
                    _SectionTitle(title: 'Bank Details', dark: dark),
                    const SizedBox(height: 8),
                    _BankDetailsCard(bankDetails: state.bankDetails!, dark: dark),
                    const SizedBox(height: 24),
                  ],

                  _SectionTitle(title: 'Payment Information', dark: dark),
                  const SizedBox(height: 12),

                  // Amount
                  _FormField(
                    label: 'Amount',
                    child: TextField(
                      controller: _amountController,
                      keyboardType: TextInputType.number,
                      onChanged: (v) {
                        final amount = num.tryParse(v) ?? 0;
                        _cubit.updateAmount(amount);
                      },
                      decoration: _inputDecoration(dark, 'Enter amount'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Method
                  _FormField(
                    label: 'Payment Method',
                    child: DropdownButtonFormField<String>(
                      initialValue: state.method,
                      decoration: _inputDecoration(dark, 'Select method'),
                      items: const [
                        DropdownMenuItem(value: 'BANK_TRANSFER', child: Text('Bank Transfer')),
                        DropdownMenuItem(value: 'EASYPAISA', child: Text('EasyPaisa')),
                        DropdownMenuItem(value: 'JAZZCASH', child: Text('JazzCash')),
                        DropdownMenuItem(value: 'CASH_DEPOSIT', child: Text('Cash Deposit')),
                        DropdownMenuItem(value: 'CHEQUE', child: Text('Cheque')),
                        DropdownMenuItem(value: 'OTHER', child: Text('Other')),
                      ],
                      onChanged: (v) {
                        if (v != null) _cubit.updateMethod(v);
                      },
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Payment Date
                  _FormField(
                    label: 'Payment Date',
                    child: InkWell(
                      onTap: () async {
                        final date = await showDatePicker(
                          context: context,
                          initialDate: DateTime.now(),
                          firstDate: DateTime.now().subtract(const Duration(days: 365)),
                          lastDate: DateTime.now(),
                        );
                        if (date != null) {
                          _cubit.updatePaidOn(date.toIso8601String());
                        }
                      },
                      child: InputDecorator(
                        decoration: _inputDecoration(dark, 'Select date'),
                        child: Text(
                          state.paidOn.isNotEmpty ? _formatDate(state.paidOn) : 'Tap to select',
                          style: _textStyle(dark),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Bank Reference
                  _FormField(
                    label: 'Transaction Reference (optional)',
                    child: TextField(
                      controller: _refController,
                      onChanged: (v) => _cubit.updateBankReference(v),
                      decoration: _inputDecoration(dark, 'Transaction ID / reference'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Note
                  _FormField(
                    label: 'Note (optional)',
                    child: TextField(
                      controller: _noteController,
                      onChanged: (v) => _cubit.updateStudentNote(v),
                      maxLines: 2,
                      decoration: _inputDecoration(dark, 'Any additional notes...'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Slip upload
                  _SectionTitle(title: 'Payment Slip (optional)', dark: dark),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _pickSlip,
                    icon: const Icon(Icons.upload_file, size: 18),
                    label: const Text('Attach payment slip'),
                  ),
                  if (_slipFiles.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    for (int i = 0; i < _slipFiles.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(
                          children: [
                            const Icon(Icons.description, size: 16),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _slipFiles[i].name,
                                style: const TextStyle(fontSize: 13),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            IconButton(
                              onPressed: () => _removeSlip(i),
                              icon: const Icon(Icons.close, size: 16),
                              visualDensity: VisualDensity.compact,
                            ),
                          ],
                        ),
                      ),
                  ],
                  const SizedBox(height: 16),

                  // Overpay warning
                  if (state.feeSummary != null && state.amount > 0 && state.amount > state.feeSummary!.remaining)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.warnBg : AppColors.warnBg,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(
                          color: (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.warning_amber, color: dark ? AppColorsDark.warn : AppColors.warn, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Amount exceeds remaining balance of ${state.feeSummary!.remaining} ${state.feeSummary!.currency}. '
                              'The excess may be held as credit.',
                              style: TextStyle(
                                fontSize: 13,
                                color: dark ? AppColorsDark.warn : AppColors.warn,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 24),

                  // Submit
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: state.submitting == true ? null : () => _cubit.submit(),
                      child: state.submitting == true
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Submit Payment'),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  TextStyle _textStyle(bool dark) {
    return TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink);
  }

  InputDecoration _inputDecoration(bool dark, String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
      filled: true,
      fillColor: dark ? AppColorsDark.surface : AppColors.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
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

// ── Section Title ──

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.dark});
  final String title;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: dark ? AppColorsDark.ink : AppColors.ink,
        fontWeight: FontWeight.w600,
        fontSize: 16,
      ),
    );
  }
}

// ── Form Field ──

class _FormField extends StatelessWidget {
  const _FormField({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

// ── Bank Details Card ──

class _BankDetailsCard extends StatelessWidget {
  const _BankDetailsCard({required this.bankDetails, required this.dark});
  final BankDetails bankDetails;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (bankDetails.bankName != null)
            _DetailRow(label: 'Bank', value: bankDetails.bankName!, dark: dark),
          if (bankDetails.accountName != null)
            _DetailRow(label: 'Account Name', value: bankDetails.accountName!, dark: dark),
          if (bankDetails.accountNumber != null)
            _DetailRow(label: 'Account Number', value: bankDetails.accountNumber!, dark: dark),
          if (bankDetails.iban != null)
            _DetailRow(label: 'IBAN', value: bankDetails.iban!, dark: dark),
          if (bankDetails.instructions != null) ...[
            const SizedBox(height: 8),
            Text(
              bankDetails.instructions!,
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Detail Row ──

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value, required this.dark});
  final String label;
  final String value;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Fee Summary Card ──

class _FeeSummaryCard extends StatelessWidget {
  const _FeeSummaryCard({required this.summary, required this.dark});
  final FeeSummary summary;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.account_balance_wallet,
                size: 18,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
              const SizedBox(width: 8),
              Text(
                'Fee Summary',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _SummaryRow(
            label: 'Total Fee',
            value: '${summary.totalFee} ${summary.currency}',
            dark: dark,
          ),
          _SummaryRow(
            label: 'Verified Payments',
            value: '${summary.verified} ${summary.currency}',
            dark: dark,
            color: AppColors.ok,
          ),
          if (summary.pending > 0)
            _SummaryRow(
              label: 'Pending Review',
              value: '${summary.pending} ${summary.currency}',
              dark: dark,
              color: AppColors.warn,
            ),
          const Divider(height: 16),
          _SummaryRow(
            label: 'Remaining',
            value: '${summary.remaining} ${summary.currency}',
            dark: dark,
            bold: true,
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: _standingColor(summary.standing, dark).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              _standingLabel(summary.standing),
              style: TextStyle(
                color: _standingColor(summary.standing, dark),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _standingColor(String standing, bool dark) {
    switch (standing) {
      case 'PAID_UP':
        return AppColors.ok;
      case 'OVERDUE':
        return AppColors.error;
      case 'PARTIAL':
        return AppColors.warn;
      default:
        return dark ? AppColorsDark.muted : AppColors.muted;
    }
  }

  String _standingLabel(String standing) {
    switch (standing) {
      case 'PAID_UP':
        return 'Paid up';
      case 'OVERDUE':
        return 'Overdue';
      case 'PARTIAL':
        return 'Partial payment';
      case 'NOTHING_DUE':
        return 'Nothing due';
      default:
        return standing;
    }
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.value,
    required this.dark,
    this.color,
    this.bold = false,
  });

  final String label;
  final String value;
  final bool dark;
  final Color? color;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 13,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: color ?? (dark ? AppColorsDark.ink : AppColors.ink),
              fontWeight: bold ? FontWeight.w700 : FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}
