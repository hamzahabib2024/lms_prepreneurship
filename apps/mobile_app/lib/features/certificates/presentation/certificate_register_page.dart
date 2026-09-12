import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/register_cubit.dart';
import '../data/certificates_repository.dart';
import '../data/models/certificate_register.dart';

/// THE INSTITUTE'S CERTIFICATE REGISTER — FR-CRT.
///
/// Not the same screen as "My certificates", and deliberately two things: this
/// lists every holder in the Institute and is guarded by the issuing
/// permission, while a student's own copies are `certificate:read` at OWN
/// scope. Two addresses because they are two different things, not one thing
/// with a filter.
///
/// Every row reads the SNAPSHOT the certificate was issued with rather than a
/// live join. Renaming a subject must never rewrite a document somebody was
/// handed last year.
class CertificateRegisterPage extends StatelessWidget {
  const CertificateRegisterPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          RegisterCubit(CertificatesRepository(api: api))..load(),
      child: const _RegisterView(),
    );
  }
}

class _RegisterView extends StatefulWidget {
  const _RegisterView();

  @override
  State<_RegisterView> createState() => _RegisterViewState();
}

class _RegisterViewState extends State<_RegisterView> {
  final _search = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 400) {
      context.read<RegisterCubit>().loadMore();
    }
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Certificate register'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<RegisterCubit, RegisterState>(
        builder: (context, state) {
          final cubit = context.read<RegisterCubit>();

          if (state.status == RegisterStatus.loading && state.entries.isEmpty) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }

          if (state.status == RegisterStatus.failure && state.entries.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: AppAlert(
                title: 'The register could not be loaded',
                message: state.error?.status == 403
                    ? 'Your account is not allowed to see the Institute’s '
                        'certificate register.'
                    : state.error?.message ?? 'Please try again.',
                reference: state.error?.reference,
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: cubit.load,
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                if (state.summary != null) _SummaryRow(summary: state.summary!),
                const SizedBox(height: 14),

                TextField(
                  controller: _search,
                  textInputAction: TextInputAction.search,
                  onSubmitted: cubit.search,
                  decoration: InputDecoration(
                    labelText: 'Search by name, roll or certificate number',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _search.clear();
                              cubit.search('');
                            },
                          ),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 10),

                _Filters(state: state),
                const SizedBox(height: 10),

                Text(
                  '${state.totalItems} certificate'
                  '${state.totalItems == 1 ? '' : 's'}'
                  '${state.query.isEmpty ? '' : ' matching “${state.query}”'}',
                  style: TextStyle(fontSize: 12.5, color: muted),
                ),

                if (state.error != null) ...[
                  const SizedBox(height: 10),
                  AppAlert(
                    title: 'That did not work',
                    message: state.error!.message,
                    reference: state.error!.reference,
                  ),
                ],

                const SizedBox(height: 4),
                if (state.entries.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 28),
                    child: Text(
                      'No certificate matches those filters.',
                      style: TextStyle(fontSize: 13, color: muted),
                    ),
                  )
                else
                  for (final entry in state.entries)
                    _RegisterRow(
                      entry: entry,
                      onRevoke: entry.isRevoked
                          ? null
                          : () => _confirmRevoke(context, entry),
                    ),

                if (state.loadingMore)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Center(child: CircularProgressIndicator()),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _confirmRevoke(BuildContext context, RegisterEntry entry) async {
    final cubit = context.read<RegisterCubit>();
    final reason = TextEditingController();

    final given = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke this certificate?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${entry.studentName} — ${entry.awardTitle}.\n\n'
              'Verification will report it as revoked from now on, and the '
              'reason is what an employer checking the code will be told.',
            ),
            const SizedBox(height: 14),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Why',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          // A reason is required, because "revoked, no reason given" answers
          // nothing for the person who checked the code.
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: reason,
            builder: (context, value, _) => FilledButton(
              onPressed: value.text.trim().length < 3
                  ? null
                  : () => Navigator.of(context).pop(value.text.trim()),
              child: const Text('Revoke'),
            ),
          ),
        ],
      ),
    );
    reason.dispose();

    if (given == null) return;
    final done = await cubit.revoke(entry.id, given);
    if (done && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Certificate revoked.')),
      );
    }
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.summary});

  final RegisterSummary summary;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _Figure(label: 'Issued', value: summary.valid),
        _Figure(label: 'This month', value: summary.thisMonth),
        _Figure(label: 'Revoked', value: summary.revoked, warn: true),
        _Figure(label: 'Archived', value: summary.archived),
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.warn = false});

  final String label;
  final int value;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;

    return Expanded(
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$value',
              style: TextStyle(
                fontFamily: AppFonts.display,
                fontSize: 19,
                fontWeight: FontWeight.w700,
                // A revoked count above zero is worth noticing; zero is not,
                // and shouting about no problems teaches people to ignore it.
                color: warn && value > 0 ? warnColor : null,
              ),
            ),
            Text(label, style: TextStyle(fontSize: 11.5, color: muted)),
          ],
        ),
      ),
    );
  }
}

class _Filters extends StatelessWidget {
  const _Filters({required this.state});

  final RegisterState state;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<RegisterCubit>();

    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        for (final option in const [
          (null, 'All'),
          ('ISSUED', 'Issued'),
          ('REVOKED', 'Revoked'),
          ('ARCHIVED', 'Archived'),
        ])
          ChoiceChip(
            label: Text(option.$2),
            selected: state.filterStatus == option.$1,
            onSelected: (_) => cubit.filterByStatus(option.$1),
          ),
        for (final option in const [
          ('SUBJECT', 'Subject'),
          ('PROGRAMME', 'Programme'),
        ])
          FilterChip(
            label: Text(option.$2),
            selected: state.filterType == option.$1,
            onSelected: (on) => cubit.filterByType(on ? option.$1 : null),
          ),
      ],
    );
  }
}

class _RegisterRow extends StatelessWidget {
  const _RegisterRow({required this.entry, required this.onRevoke});

  final RegisterEntry entry;
  final VoidCallback? onRevoke;

  @override
  Widget build(BuildContext context) {
    final identity = entry.studentIdentity;
    final subtitle = [
      entry.awardTitle,
      if (identity.isNotEmpty) identity,
      '${entry.certificateNo} · ${_date(entry.issuedAt)}',
      if (entry.isRevoked && entry.revocationReason != null)
        'Revoked: ${entry.revocationReason}',
    ].join('\n');

    return ListRow(
      title: entry.studentName,
      subtitle: subtitle,
      warn: entry.isRevoked,
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // The state is a word, never colour alone (NFR-ACC-003).
          Pill(
            text: entry.isRevoked ? 'Revoked' : 'Valid',
            kind: entry.isRevoked ? PillKind.warn : PillKind.ok,
          ),
          if (entry.issuedManually)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Pill(text: 'By hand'),
            ),
          if (onRevoke != null)
            TextButton(
              onPressed: onRevoke,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Revoke'),
            ),
        ],
      ),
    );
  }

  static String _date(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/'
      '${value.month.toString().padLeft(2, '0')}/${value.year}';
}
