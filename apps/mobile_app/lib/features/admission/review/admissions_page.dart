import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/admission_repository.dart';
import '../data/models/application_detail.dart';
import '../data/models/approval_result.dart';
import '../data/models/queue_item.dart';
import '../data/models/section_summary.dart';
import '../data/models/submission_result.dart';
import '../widgets/form_controls.dart';
import 'admissions_cubit.dart';

/// Admission queue and review — SRS UC-02, §13.5.
///
/// The Institute's highest-value workflow: one screen shows the queue and the
/// selected application together, so a reviewer never loses their place; on a
/// phone the review opens as its own screen; and after a decision the receipt
/// is shown before the queue refreshes, because admissions are processed in
/// batches at intake (FR-REG-037).
class AdmissionsPage extends StatelessWidget {
  const AdmissionsPage({super.key, required this.api});

  final ApiClient api;

  static const pageColor = Color(0xFF7C3AED);

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdmissionsCubit(repository: AdmissionRepository(api: api))..loadQueue(),
      child: const _AdmissionsScreen(),
    );
  }
}

class _AdmissionsScreen extends StatelessWidget {
  const _AdmissionsScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admissions'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: BlocBuilder<AdmissionsCubit, AdmissionsState>(
          builder: (context, state) {
            if (state.receipt != null) return _ReceiptView(result: state.receipt!);

            return LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= 900;
                if (wide) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(width: 320, child: _QueuePanel()),
                      const Expanded(child: _ReviewSide()),
                    ],
                  );
                }
                return _QueuePanel();
              },
            );
          },
        ),
      ),
    );
  }
}

/// The queue, oldest first — FR-REG-022/038. On a phone, tapping a row opens
/// the review; on a wide screen the review sits beside it.
class _QueuePanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocBuilder<AdmissionsCubit, AdmissionsState>(
      builder: (context, state) {
        if (state.loadingQueue && state.queue.isEmpty) {
          return const Padding(
            padding: EdgeInsets.all(20),
            child: SkeletonCards(count: 5),
          );
        }

        if (state.queueError != null && state.queue.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                AppAlert(
                  title: 'Could not load the admission queue',
                  message: state.queueError!.message,
                  reference: state.queueError!.reference,
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => context.read<AdmissionsCubit>().loadQueue(),
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Try again'),
                ),
              ],
            ),
          );
        }

        final overdue = state.queue.where((r) => r.isOverdue).length;

        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Row(
              children: [
                Text(
                  '${state.queue.length} waiting',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (overdue > 0) ...[
                  const SizedBox(width: 8),
                  // FR-REG-038 — an application nobody has looked at is
                  // surfaced, not left to be discovered.
                  Pill(text: '$overdue over 48 hours', kind: PillKind.warn),
                ],
              ],
            ),
            if (state.queue.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(
                  'No applications are waiting for review. New applications appear here as soon '
                  'as they are submitted.',
                  style: TextStyle(color: muted, fontSize: 14),
                ),
              )
            else
              for (final item in state.queue)
                _QueueRow(
                  item: item,
                  selected: item.id == state.selectedId,
                  onTap: () {
                    context.read<AdmissionsCubit>().select(item.id);
                    // On a phone the review is its own screen.
                    final wide = MediaQuery.sizeOf(context).width >= 900;
                    if (!wide) {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => BlocProvider.value(
                            value: context.read<AdmissionsCubit>(),
                            child: const _ReviewScreen(),
                          ),
                        ),
                      );
                    }
                  },
                ),
          ],
        );
      },
    );
  }
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.item, required this.selected, required this.onTap});

  final QueueItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Container(
      margin: const EdgeInsets.only(top: 10),
      decoration: BoxDecoration(
        color: selected ? brand.withValues(alpha: 0.08) : Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: selected ? brand.withValues(alpha: 0.5) : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      item.fullName,
                      style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (item.isOverdue)
                    const Pill(text: 'waiting', kind: PillKind.warn),
                  if (item.isClaimed) ...[
                    const SizedBox(width: 6),
                    const Pill(text: 'claimed', kind: PillKind.neutral),
                  ],
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '${item.trackingRef} · ${item.desiredSection?.code ?? 'no section'} · '
                '${Formats.daysAgo(item.createdAt)}',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// On a phone, the review is a screen pushed over the queue.
class _ReviewScreen extends StatelessWidget {
  const _ReviewScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          context.select<AdmissionsCubit, String>(
            (c) => c.state.detail?.fullName ?? 'Review application',
          ),
        ),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: const _ReviewSide(standalone: true),
    );
  }
}

/// The right-hand side of the wide layout, or the whole screen on a phone.
class _ReviewSide extends StatelessWidget {
  const _ReviewSide({this.standalone = false});

  final bool standalone;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<AdmissionsCubit, AdmissionsState>(
      builder: (context, state) {
        final detail = state.detail;
        if (detail == null) {
          if (state.detailError != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: AppAlert(
                title: 'Could not open this application',
                message: state.detailError!.message,
                reference: state.detailError!.reference,
              ),
            );
          }
          if (standalone) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }
          return Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              'Choose an application from the queue to review it.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          );
        }

        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            _ReviewPanel(
              key: ValueKey(detail.id),
              detail: detail,
              sections: state.sections,
            ),
          ],
        );
      },
    );
  }
}

/// FR-REG-024/027..036 — everything the reviewer needs, and the two decisions.
class _ReviewPanel extends StatefulWidget {
  const _ReviewPanel({super.key, required this.detail, required this.sections});

  final ApplicationDetail detail;
  final List<SectionSummary> sections;

  @override
  State<_ReviewPanel> createState() => _ReviewPanelState();
}

class _ReviewPanelState extends State<_ReviewPanel> {
  late String _sectionId = widget.detail.desiredSection?.id ?? '';
  late String _verifiedAmount = widget.detail.claimedAmount.toString();
  late DateTime _paymentDate = DateTime.now();
  String _method = 'BANK_TRANSFER';
  String _bankReference = '';
  String _varianceReason = '';
  String _rejectReason = 'PAYMENT_NOT_RECEIVED';
  String _note = '';
  bool _capacityOverride = false;

  SectionSummary? get _section =>
      widget.sections.where((s) => s.id == _sectionId).firstOrNull;

  bool get _genderBlocked =>
      _section != null &&
      _section!.genderRestriction != 'MIXED' &&
      _section!.genderRestriction != widget.detail.gender;

  bool get _atCapacity => _section?.isFull ?? false;

  // FR-REG-028 — a variance between claim and verification needs a reason.
  num get _claimed => widget.detail.claimedAmount;
  num get _verified => num.tryParse(_verifiedAmount) ?? 0;
  bool get _hasVariance => _verified != _claimed;
  bool get _varianceMissing => _hasVariance && _varianceReason.trim().isEmpty;

  bool get _canApprove =>
      _sectionId.isNotEmpty &&
      _verified > 0 &&
      !_genderBlocked &&
      (!_atCapacity || _capacityOverride) &&
      !_varianceMissing;

  @override
  Widget build(BuildContext context) {
    final d = widget.detail;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocBuilder<AdmissionsCubit, AdmissionsState>(
      builder: (context, state) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(d.fullName, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text(
              '${d.trackingRef} · applied ${Formats.daysAgo(d.createdAt)} · via '
              '${AdmissionLabels.source(d.acquisitionSource)}',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
            const SizedBox(height: 14),
            if (state.actionError != null) ...[
              AppAlert(
                title: 'Could not complete that',
                message: state.actionError!.message,
                reference: state.actionError!.reference,
              ),
              const SizedBox(height: 14),
            ],
            _FactsGrid(detail: d),
            const SizedBox(height: 16),
            _SlipGallery(
              detail: d,
              repository: context.read<AdmissionsCubit>().repository,
            ),
            const SizedBox(height: 20),
            Text('Verify payment', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            AdmissionFormField(
              label: 'Amount received',
              hint: 'In rupees',
              keyboardType: TextInputType.number,
              value: _verifiedAmount,
              onChanged: (v) => setState(() => _verifiedAmount = v),
            ),
            const SizedBox(height: 12),
            AdmissionDateField(
              label: 'Date received',
              hint: 'Choose…',
              value: _paymentDate,
              firstDate: DateTime.now().subtract(const Duration(days: 365 * 2)),
              lastDate: DateTime.now(),
              onChanged: (v) => setState(() => _paymentDate = v ?? _paymentDate),
            ),
            const SizedBox(height: 12),
            AdmissionSelectField(
              label: 'Method',
              hint: 'Choose…',
              value: _method,
              options: AdmissionLabels.paymentMethods.toList(),
              onChanged: (v) => setState(() => _method = v),
            ),
            const SizedBox(height: 12),
            AdmissionFormField(
              label: 'Bank reference',
              hint: 'The transaction number on the slip',
              value: _bankReference,
              onChanged: (v) => setState(() => _bankReference = v),
            ),
            if (_hasVariance) ...[
              const SizedBox(height: 12),
              AdmissionFormField(
                label:
                    'Why does this differ from the ${Formats.rupees(_claimed)} claimed? (required)',
                hint: 'e.g. first instalment only',
                value: _varianceReason,
                onChanged: (v) => setState(() => _varianceReason = v),
              ),
            ],
            const SizedBox(height: 20),
            Text('Section', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            AdmissionSelectField(
              label: 'Assign to',
              value: _sectionId,
              hint: 'Choose a section…',
              options: [
                for (final s in widget.sections)
                  (
                    s.id,
                    '${s.code} — ${s.enrolledCount}/${s.capacity}'
                        '${s.isFull ? ' (full)' : ''}',
                  ),
              ],
              onChanged: (v) => setState(() => _sectionId = v),
            ),
            // FR-CRS-009 / BR-ENR-05 — absolute. No override exists, so none
            // is offered; approve simply cannot be used.
            if (_genderBlocked) ...[
              const SizedBox(height: 12),
              AppAlert(
                title:
                    '${_section!.name} admits ${_section!.genderRestriction.toLowerCase()} students only',
                message: 'Choose a different section. This restriction cannot be overridden.',
              ),
            ],
            // FR-REG-031 — capacity CAN be exceeded, but only deliberately,
            // and the override is recorded in the audit entry.
            if (_atCapacity && !_genderBlocked) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.warnBg : AppColors.warnBg,
                  border: Border.all(
                    color: (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.25),
                  ),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_section!.code} is full (${_section!.enrolledCount} of ${_section!.capacity})',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13.5,
                        color: dark ? AppColorsDark.warn : AppColors.warn,
                      ),
                    ),
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: () => setState(() => _capacityOverride = !_capacityOverride),
                      child: Row(
                        children: [
                          Icon(
                            _capacityOverride
                                ? Icons.check_box
                                : Icons.check_box_outline_blank,
                            size: 19,
                            color: _capacityOverride
                                ? (dark ? AppColorsDark.warn : AppColors.warn)
                                : muted,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Admit anyway, exceeding capacity. This is recorded against your '
                              'name.',
                              style: TextStyle(fontSize: 12.5, color: muted, height: 1.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            AdmissionFormField(
              label: 'Note to the applicant (optional)',
              hint: 'Shown on their tracking page',
              value: _note,
              maxLines: 2,
              onChanged: (v) => setState(() => _note = v),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _canApprove && !state.busy
                        ? () => _approve(context)
                        : null,
                    child: state.busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : const Text('Approve and create account'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: AdmissionSelectField(
                    label: '',
                    hint: 'Reject for…',
                    value: _rejectReason,
                    options: AdmissionLabels.rejectionReasons.toList(),
                    onChanged: (v) => setState(() => _rejectReason = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: state.busy
                  ? null
                  : () => context.read<AdmissionsCubit>().reject(
                        id: widget.detail.id,
                        reasonCode: _rejectReason,
                        note: _note,
                      ),
              child: Text(state.busy ? 'Working…' : 'Reject'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _approve(BuildContext context) async {
    final navigator = Navigator.of(context);
    await context.read<AdmissionsCubit>().approve(
          id: widget.detail.id,
          verifiedAmount: _verified,
          paymentDate: _paymentDate,
          method: _method,
          bankReference: _bankReference,
          varianceReason: _varianceReason,
          sectionId: _sectionId,
          capacityOverride: _capacityOverride,
          note: _note,
        );
    if (!context.mounted) return;
    // On a phone the review was its own screen — come back to the queue so
    // the receipt is visible under it.
    final wide = MediaQuery.sizeOf(context).width >= 900;
    if (!wide && navigator.canPop()) {
      navigator.pop();
    }
  }
}

/// The submitted fields a reviewer needs to see — FR-REG-024.
class _FactsGrid extends StatelessWidget {
  const _FactsGrid({required this.detail});

  final ApplicationDetail detail;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    final facts = <(String, String)>[
      ('Gender', detail.gender.toLowerCase()),
      ('Phone', detail.phone),
      ('Email', detail.email),
      ('Claimed', Formats.rupees(detail.claimedAmount)),
      ('Father / guardian', detail.fatherName),
      ('Date of birth',
          detail.dateOfBirth == null ? '—' : Formats.shortDate(detail.dateOfBirth!)),
      ('CNIC', detail.nationalId),
      ('Address', '${detail.address}, ${detail.city}'),
      ('Education', detail.qualification),
      ('Programme', detail.desiredProgramme?.name ?? '—'),
      ('Section', detail.desiredSection?.name ?? '—'),
    ];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        children: [
          for (final (label, value) in facts)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 120,
                    child: Text(label, style: TextStyle(fontSize: 12.5, color: muted)),
                  ),
                  Expanded(
                    child: Text(
                      value,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
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

/// FR-REG-024 — the slips, rendered from bytes fetched with the session.
/// Tapping an image opens it full-screen with zoom (FR-REG-025).
class _SlipGallery extends StatelessWidget {
  const _SlipGallery({required this.detail, required this.repository});

  final ApplicationDetail detail;
  final AdmissionRepository repository;

  @override
  Widget build(BuildContext context) {
    if (detail.documents.isEmpty) {
      // FR-REG-008 requires at least one, so none means something went wrong
      // on the way in. A reviewer must not approve a payment with no evidence.
      return AppAlert(
        title: 'No payment slip is attached',
        message:
            'Do not approve this on the strength of the claimed amount alone — ask the '
            'applicant to send the slip, or check the bank record yourself.',
        warn: true,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Payment ${detail.documents.length == 1 ? 'slip' : 'slips'}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 10),
        for (final doc in detail.documents)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _SlipCard(detail: detail, document: doc, repository: repository),
          ),
      ],
    );
  }
}

class _SlipCard extends StatefulWidget {
  const _SlipCard({required this.detail, required this.document, required this.repository});

  final ApplicationDetail detail;
  final RegistrationDocument document;
  final AdmissionRepository repository;

  @override
  State<_SlipCard> createState() => _SlipCardState();
}

class _SlipCardState extends State<_SlipCard> {
  List<int>? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final bytes = await widget.repository
          .slipBytes(widget.detail.id, widget.document.id);
      if (!mounted) return;
      setState(() => _bytes = bytes);
    } on ApiException {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final doc = widget.document;

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${doc.originalFilename} · ${math.max(1, (doc.sizeBytes / 1024).round())} KB',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ),
                // SEC-FIL-004 — said plainly: no scanner is wired up, and a
                // reviewer opening an attachment from a stranger should know.
                if (doc.scanStatus != 'CLEAN')
                  const Pill(text: 'Not virus-scanned', kind: PillKind.warn),
              ],
            ),
          ),
          if (_failed)
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'The file could not be loaded. It may have been removed from storage — the '
                'record of it remains.',
                style: TextStyle(fontSize: 12.5),
              ),
            )
          else if (_bytes == null)
            const Padding(
              padding: EdgeInsets.all(12),
              child: Skeleton(lines: 2),
            )
          else if (doc.isPdf)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.picture_as_pdf_outlined, color: muted),
                  const SizedBox(width: 8),
                  const Text('PDF slip — review the bank record beside it.'),
                ],
              ),
            )
          else
            GestureDetector(
              onTap: () => _openFullScreen(context, _bytes!),
              child: Image.memory(
                Uint8List.fromList(_bytes!),
                height: 190,
                fit: BoxFit.cover,
                gaplessPlayback: true,
                errorBuilder: (_, _, _) => const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('The image could not be displayed.'),
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _openFullScreen(BuildContext context, List<int> bytes) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: Stack(
          children: [
            Positioned.fill(
              child: InteractiveViewer(
                maxScale: 5,
                child: Center(
                  child: Image.memory(Uint8List.fromList(bytes), fit: BoxFit.contain),
                ),
              ),
            ),
            SafeArea(
              child: Align(
                alignment: Alignment.topRight,
                child: IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, color: Colors.white),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// FR-REG-042 — the credentials are shown ONCE, on screen, in a form the
/// administrator can read out or paste into WhatsApp.
class _ReceiptView extends StatelessWidget {
  const _ReceiptView({required this.result});

  final ApprovalResult result;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final cubit = context.read<AdmissionsCubit>();

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border.all(
              color: (dark ? AppColorsDark.ok : AppColors.ok).withValues(alpha: 0.4),
            ),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Pill(text: 'Admitted', kind: PillKind.ok),
                  const Spacer(),
                  Text(
                    'reg: ${result.registrationNo}',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _ReceiptRow('Registration no.', result.registrationNo, monospace: true),
              _ReceiptRow('Roll no.', '${result.rollNo}'),
              _ReceiptRow('Section', result.sectionName),
              _ReceiptRow('Subjects', '${result.subjectCount} enrolled'),
              const SizedBox(height: 8),
              // A returning student has no new password — their existing
              // sign-in is unchanged. Printing an empty box here read as "the
              // password failed to generate".
              if (result.temporaryPassword != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.warnBg : AppColors.warnBg,
                    border: Border.all(
                      color: (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.25),
                    ),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Temporary password — shown once',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13.5,
                          color: dark ? AppColorsDark.warn : AppColors.warn,
                        ),
                      ),
                      const SizedBox(height: 6),
                      SelectableText(
                        result.temporaryPassword!,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1,
                          color: dark ? AppColorsDark.warn : AppColors.warn,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'They will be asked to set their own password when they first sign in.',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
              ] else if (result.accountNote != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(result.accountNote!, style: TextStyle(fontSize: 13, color: muted)),
                ),
              // Whether the email actually left. This is why the password is
              // still printed above: the office needs to know when to read it
              // out instead.
              for (final line in result.notificationsSent)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    line,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: line.startsWith('Could NOT')
                          ? (dark ? AppColorsDark.warn : AppColors.warn)
                          : muted,
                    ),
                  ),
                ),
              if (result.notificationsSent.any((l) => l.startsWith('Could NOT')))
                Text(
                  'Send the password above to the student yourself.',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: dark ? AppColorsDark.warn : AppColors.warn,
                  ),
                ),
              // FR-REG-044 — the community links, so onboarding finishes here.
              if (result.whatsappGroup != null || result.whatsappChannel != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'WhatsApp: ${[
                      if (result.whatsappGroup != null) 'class group: ${result.whatsappGroup}',
                      if (result.whatsappChannel != null) 'channel: ${result.whatsappChannel}',
                    ].join(' · ')}',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => cubit.dismissReceipt(),
                child: const Text('Done — next application'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  const _ReceiptRow(this.label, this.value, {this.monospace = false});

  final String label;
  final String value;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 130,
            child: Text(label, style: TextStyle(fontSize: 12.5, color: muted)),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                fontFamily: monospace ? 'monospace' : null,
                letterSpacing: monospace ? 0.6 : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

