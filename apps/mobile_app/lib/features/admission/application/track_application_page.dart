import 'package:flutter/material.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/admission_repository.dart';
import '../data/models/submission_result.dart';

/// FR-REG-020 — unauthenticated status lookup by tracking reference.
///
/// Deliberately thin: discloses only the state, the date of last change and
/// any message directed at the applicant (SEC-PRV-012).
class TrackApplicationPage extends StatefulWidget {
  const TrackApplicationPage({super.key, this.initialReference});

  final String? initialReference;

  @override
  State<TrackApplicationPage> createState() => _TrackApplicationPageState();
}

class _TrackApplicationPageState extends State<TrackApplicationPage> {
  final _controller = TextEditingController();
  final _repository = AdmissionRepository(api: ApiClient());

  ApplicationStatusResult? _status;
  ApiException? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialReference != null && widget.initialReference!.isNotEmpty) {
      _controller.text = widget.initialReference!;
      _lookup();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    final reference = _controller.text.trim();
    if (reference.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = await _repository.publicStatus(reference);
      if (!mounted) return;
      setState(() {
        _status = status;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppBar(
        title: const Text('Track your application'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Text(
            'Enter the reference you were given when you applied.',
            style: TextStyle(color: muted, fontSize: 13.5),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(hintText: 'e.g. LMS-2026-000001'),
            onSubmitted: (_) => _lookup(),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 44,
            child: FilledButton.icon(
              onPressed: _loading ? null : _lookup,
              icon: _loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Icon(Icons.manage_search, size: 18),
              label: const Text('Check status'),
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null)
            AppAlert(
              title: 'Could not check that reference',
              message: _error!.message,
              reference: _error!.reference,
            ),
          if (_status != null) _StatusCard(status: _status!),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});

  final ApplicationStatusResult status;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ok = status.status == 'APPROVED';
    final rejected = status.status == 'REJECTED';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Pill(
                text: AdmissionLabels.status(status.status),
                kind: ok ? PillKind.ok : rejected ? PillKind.warn : PillKind.neutral,
              ),
              const Spacer(),
              Text(
                'updated ${Formats.shortDate(status.lastUpdatedAt)}',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            switch (status.status) {
              'PENDING_REVIEW' => 'Your application is waiting for the office to review it.',
              'UNDER_REVIEW' => 'Your application is being reviewed right now.',
              'NEEDS_INFO' => 'The office needs something from you — please see the message below.',
              'APPROVED' =>
                'Congratulations — you have been admitted! An account and a temporary password are on their way to you.',
              'REJECTED' => 'Your application was not successful this time.',
              _ => 'Your application is on file.',
            },
            style: const TextStyle(fontSize: 14.5, height: 1.5),
          ),
          if (status.message != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Text(
                status.message!,
                style: TextStyle(fontSize: 13.5, color: dark ? AppColorsDark.ink : AppColors.ink),
              ),
            ),
          ],
          if (status.reasonCode != null) ...[
            const SizedBox(height: 10),
            Text(
              'Reason: ${_reasonLabel(status.reasonCode!)}',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: dark ? AppColorsDark.warn : AppColors.warn,
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _reasonLabel(String code) {
    for (final (value, label) in AdmissionLabels.rejectionReasons) {
      if (value == code) return label;
    }
    return code.replaceAll('_', ' ').toLowerCase();
  }
}
