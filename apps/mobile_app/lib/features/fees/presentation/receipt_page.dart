import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/fees_cubit.dart';
import '../data/fees_models.dart';
import '../data/fees_repository.dart';

class ReceiptPage extends StatelessWidget {
  const ReceiptPage({
    super.key,
    required this.api,
    required this.paymentId,
    required this.receiptNo,
  });

  final ApiClient api;
  final String paymentId;
  final String receiptNo;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => FeesCubit(
        repository: FeesRepository(api),
      )..loadReceipt(paymentId),
      child: _ReceiptView(receiptNo: receiptNo),
    );
  }
}

class _ReceiptView extends StatelessWidget {
  const _ReceiptView({required this.receiptNo});

  final String receiptNo;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return Scaffold(
      appBar: AppBar(
        title: Text('Receipt $receiptNo'),
        backgroundColor: theme.colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<FeesCubit, FeesState>(
        builder: (context, state) {
          if (state.loadingReceipt) {
            return const Center(child: CircularProgressIndicator());
          }

          final receipt = state.receipt;
          if (receipt == null) {
            return const Center(child: Text('Receipt not found'));
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                border: Border.all(color: theme.colorScheme.outlineVariant),
                borderRadius: BorderRadius.circular(AppRadius.md),
                boxShadow: AppShadow.soft,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Text(
                      receipt.institute?.name ?? 'Institute',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  if (receipt.institute?.campus != null)
                    Center(
                      child: Text(
                        receipt.institute!.campus!,
                        style: TextStyle(fontSize: 13, color: muted),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  const SizedBox(height: 8),
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(
                        color: receipt.status == 'VERIFIED'
                            ? AppColors.successBg
                            : receipt.status == 'REVERSED'
                                ? AppColors.errorBg
                                : AppColors.warnBg,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Text(
                        receipt.status,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: receipt.status == 'VERIFIED'
                              ? AppColors.success
                              : receipt.status == 'REVERSED'
                                  ? AppColors.error
                                  : AppColors.warn,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 12),
                  _infoRow('Receipt No', receipt.receiptNo),
                  _infoRow('Issued', receipt.issuedAt.isNotEmpty ? receipt.issuedAt.substring(0, 10) : '-'),
                  const SizedBox(height: 16),
                  if (receipt.student != null) ...[
                    Text('Student', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    _infoRow('Name', receipt.student!.fullName ?? '-'),
                    _infoRow('Reg No', receipt.student!.registrationNo ?? '-'),
                    _infoRow('Programme', receipt.student!.programme ?? '-'),
                    _infoRow('Section', receipt.student!.section ?? '-'),
                    const SizedBox(height: 16),
                  ],
                  if (receipt.payment != null) ...[
                    Text('Payment', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    _infoRow('Amount', '${receipt.payment!.currency} ${receipt.payment!.amount}'),
                    _infoRow('Method', receipt.payment!.methodLabel ?? receipt.payment!.method ?? '-'),
                    _infoRow('Paid On', receipt.payment!.paidOn?.substring(0, 10) ?? '-'),
                    if (receipt.payment!.bankReference != null)
                      _infoRow('Bank Ref', receipt.payment!.bankReference!),
                    if (receipt.payment!.submissionReference != null)
                      _infoRow('Submission Ref', receipt.payment!.submissionReference!),
                    const SizedBox(height: 16),
                  ],
                  if (receipt.verification != null) ...[
                    Text('Verification', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    _infoRow('Verified By', receipt.verification!.verifiedBy ?? '-'),
                    _infoRow('At', receipt.verification!.verifiedAt?.substring(0, 19).replaceAll('T', ' ') ?? '-'),
                    if (receipt.verification!.note != null)
                      _infoRow('Note', receipt.verification!.note!),
                  ],
                  if (receipt.reversal != null) ...[
                    const SizedBox(height: 16),
                    Text('Reversal', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    _infoRow('At', receipt.reversal!.reversedAt?.substring(0, 19).replaceAll('T', ' ') ?? '-'),
                    _infoRow('Reason', receipt.reversal!.reason ?? '-'),
                  ],
                  const SizedBox(height: 24),
                  Center(
                    child: OutlinedButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.download_outlined, size: 18),
                      label: const Text('Download PDF'),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
