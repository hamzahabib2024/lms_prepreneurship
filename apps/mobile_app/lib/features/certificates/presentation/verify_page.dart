import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/verify_cubit.dart';
import '../data/certificates_repository.dart';

/// Public certificate verification — FR-CRT-015.
///
/// No authentication required. An employer or any third party can enter
/// a verification code to check if a certificate is valid.
class VerifyPage extends StatelessWidget {
  const VerifyPage({super.key, required this.api, this.initialCode});

  final ApiClient api;
  final String? initialCode;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => VerifyCubit(
        repository: CertificatesRepository(api: api),
      ),
      child: _VerifyView(initialCode: initialCode),
    );
  }
}

class _VerifyView extends StatefulWidget {
  const _VerifyView({this.initialCode});

  final String? initialCode;

  @override
  State<_VerifyView> createState() => _VerifyViewState();
}

class _VerifyViewState extends State<_VerifyView> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialCode ?? '');
    if (widget.initialCode != null && widget.initialCode!.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        context.read<VerifyCubit>().verify(widget.initialCode!);
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Verify Certificate'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Header
            Icon(
              Icons.verified_outlined,
              size: 48,
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
            ),
            const SizedBox(height: 12),
            Text(
              'Verify a certificate',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            Text(
              'Enter the verification code from the certificate to check '
              'its validity.',
              style: TextStyle(fontSize: 13, color: muted),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),

            // Input field
            TextField(
              controller: _controller,
              decoration: InputDecoration(
                hintText: 'Verification code',
                hintStyle: TextStyle(color: muted),
                filled: true,
                fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 12),
              ),
              style: const TextStyle(fontSize: 14),
              onSubmitted: (v) => context.read<VerifyCubit>().verify(v),
            ),
            const SizedBox(height: 12),

            // Verify button
            SizedBox(
              width: double.infinity,
              child: BlocBuilder<VerifyCubit, VerifyState>(
                builder: (context, state) {
                  return FilledButton(
                    onPressed: state.status == VerifyStatus.loading
                        ? null
                        : () => context
                            .read<VerifyCubit>()
                            .verify(_controller.text),
                    child: state.status == VerifyStatus.loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : const Text('Verify'),
                  );
                },
              ),
            ),
            const SizedBox(height: 24),

            // Result
            BlocBuilder<VerifyCubit, VerifyState>(
              builder: (context, state) {
                switch (state.status) {
                  case VerifyStatus.initial:
                    return const SizedBox.shrink();
                  case VerifyStatus.loading:
                    return const Center(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: CircularProgressIndicator(),
                      ),
                    );
                  case VerifyStatus.notFound:
                    return _NotFoundResult(
                      code: _controller.text.trim(),
                    );
                  case VerifyStatus.failure:
                    return AppAlert(
                      title: 'Verification failed',
                      message: state.error?.message ??
                          'Could not check this certificate.',
                      reference: state.error?.reference,
                    );
                  case VerifyStatus.found:
                    final result = state.result;
                    if (result == null) return const SizedBox.shrink();
                    return _VerifyResultCard(result: result);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _NotFoundResult extends StatelessWidget {
  const _NotFoundResult({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.warnBg,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          const Icon(Icons.search_off, size: 24, color: AppColors.warn),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'No certificate found',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'No certificate matches the code "${code.length > 20 ? code.substring(0, 20) : code}..."',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VerifyResultCard extends StatelessWidget {
  const _VerifyResultCard({required this.result});

  final VerifyResult result;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final valid = result.valid;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: valid ? AppColors.okBg : AppColors.errorBg,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: valid ? AppColors.ok : AppColors.error,
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Status
          Row(
            children: [
              Icon(
                valid ? Icons.verified : Icons.cancel_outlined,
                size: 24,
                color: valid ? AppColors.ok : AppColors.error,
              ),
              const SizedBox(width: 8),
              Text(
                valid ? 'Certificate Valid' : 'Certificate Revoked',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: valid ? AppColors.ok : AppColors.error,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Details
          _ResultRow(label: 'Certificate No.', value: result.certificateNo),
          const SizedBox(height: 8),
          _ResultRow(label: 'Holder', value: result.holderName),
          const SizedBox(height: 8),
          _ResultRow(label: 'Awarded for', value: result.awardedFor),
          const SizedBox(height: 8),
          _ResultRow(label: 'Type', value: result.type),
          const SizedBox(height: 8),
          _ResultRow(label: 'Issued on', value: _formatDate(result.issuedAt)),

          if (!valid && result.revokedAt != null) ...[
            const SizedBox(height: 8),
            _ResultRow(
              label: 'Revoked on',
              value: _formatDate(result.revokedAt!),
            ),
          ],

          if (result.message.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              result.message,
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],
        ],
      ),
    );
  }

  String _formatDate(String iso) {
    final date = DateTime.tryParse(iso);
    if (date == null) return iso;
    return Formats.shortDate(date);
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 100,
          child: Text(label, style: TextStyle(fontSize: 12.5, color: muted)),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}
