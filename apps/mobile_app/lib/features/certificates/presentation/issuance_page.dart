import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../academic/data/academic_repository.dart';
import '../../academic/data/models/section.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/issuance_cubit.dart';
import '../data/certificates_repository.dart';
import '../data/models/batch_issue_result.dart';
import '../data/models/certificate_candidate.dart';
import 'certificate_register_page.dart';

/// The admin certificate issuance page — FR-CRT-006.
///
/// Select a section, then a subject. Shows all students with their
/// eligibility status. Issue buttons for eligible students. Revoke
/// buttons for issued certificates (super_admin only).
class IssuancePage extends StatelessWidget {
  const IssuancePage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => IssuanceCubit(
        repository: CertificatesRepository(api: api),
      ),
      child: _IssuanceView(user: user, api: api),
    );
  }
}

class _IssuanceView extends StatefulWidget {
  const _IssuanceView({required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  State<_IssuanceView> createState() => _IssuanceViewState();
}

class _IssuanceViewState extends State<_IssuanceView> {
  String _selectedSectionSubjectId = '';
  List<Section> _sections = [];
  List<Offering> _offerings = [];
  bool _loadingSections = false;
  bool _loadingOfferings = false;

  @override
  void initState() {
    super.initState();
    _loadSections();
  }

  Future<void> _loadSections() async {
    setState(() => _loadingSections = true);
    try {
      final repo = AcademicRepository(api: widget.api);
      final sections = await repo.listSections();
      if (mounted) {
        setState(() {
          _sections = sections;
          _loadingSections = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingSections = false);
    }
  }

  Future<void> _loadOfferings(String sectionId) async {
    setState(() {
      _loadingOfferings = true;
      _offerings = [];
      _selectedSectionSubjectId = '';
    });
    try {
      final repo = AcademicRepository(api: widget.api);
      final offerings = await repo.listOfferings(sectionId);
      if (mounted) {
        setState(() {
          _offerings = offerings;
          _loadingOfferings = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingOfferings = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Issue Certificates'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            tooltip: 'The register',
            icon: const Icon(Icons.list_alt_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => CertificateRegisterPage(api: widget.api),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Section selector
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
              child: _loadingSections
                  ? const SkeletonCards(count: 1)
                  : DropdownButtonFormField<String>(
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: 'Section',
                        filled: true,
                        fillColor: dark
                            ? AppColorsDark.surface2
                            : AppColors.surface2,
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(AppRadius.md),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 10),
                      ),
                      initialValue: null,
                      hint: Text('Choose a section…',
                          style: TextStyle(fontSize: 14, color: muted)),
                      items: _sections
                          .map((s) => DropdownMenuItem(
                                value: s.id,
                                child: Text('${s.code} — ${s.name}',
                                    overflow: TextOverflow.ellipsis,
                                    style:
                                        const TextStyle(fontSize: 14)),
                              ))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) _loadOfferings(v);
                      },
                    ),
            ),

            // Subject selector
            if (_offerings.isNotEmpty || _loadingOfferings)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                child: _loadingOfferings
                    ? const SkeletonCards(count: 1)
                    : DropdownButtonFormField<String>(
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Subject',
                          filled: true,
                          fillColor: dark
                              ? AppColorsDark.surface2
                              : AppColors.surface2,
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(AppRadius.md),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 10),
                        ),
                        initialValue: null,
                        hint: Text('Choose a subject…',
                            style:
                                TextStyle(fontSize: 14, color: muted)),
                        items: _offerings
                            .where((o) => o.hasTeacher)
                            .map((o) => DropdownMenuItem(
                                  value: o.id,
                                  child: Text(
                                      '${o.subjectCode} — ${o.subjectName}',
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 14)),
                                ))
                            .toList(),
                        onChanged: (v) {
                          if (v != null) {
                            setState(
                                () => _selectedSectionSubjectId = v);
                            context
                                .read<IssuanceCubit>()
                                .load(v);
                          }
                        },
                      ),
              ),

            // Divider
            if (_selectedSectionSubjectId.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Container(
                  height: 1,
                  color: dark ? AppColorsDark.line : AppColors.line,
                ),
              ),

            // Content
            Expanded(
              child: BlocConsumer<IssuanceCubit, IssuanceState>(
                listener: (context, state) {
                  if (state.successMessage != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(state.successMessage!),
                        backgroundColor: AppColors.ok,
                      ),
                    );
                  }
                },
                builder: (context, state) {
                  if (_selectedSectionSubjectId.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.emoji_events_outlined,
                                size: 48, color: muted),
                            const SizedBox(height: 12),
                            Text(
                              'Choose a section and subject to begin.',
                              style:
                                  TextStyle(color: muted, fontSize: 14),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  switch (state.status) {
                    case IssuanceStatus.loading:
                      return const SingleChildScrollView(
                        padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
                        child: SkeletonCards(count: 3),
                      );
                    case IssuanceStatus.failure:
                      return ListView(
                        padding:
                            const EdgeInsets.fromLTRB(20, 16, 20, 24),
                        children: [
                          AppAlert(
                            title: 'Could not load worklist',
                            message: state.error?.message ??
                                'Something went wrong.',
                            reference: state.error?.reference,
                          ),
                          const SizedBox(height: 14),
                          FilledButton.icon(
                            onPressed: () => context
                                .read<IssuanceCubit>()
                                .load(_selectedSectionSubjectId),
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Try again'),
                          ),
                        ],
                      );
                    case IssuanceStatus.loaded:
                      return _WorklistBody(
                        state: state,
                        user: widget.user,
                        sectionSubjectId: _selectedSectionSubjectId,
                        onIssue: (studentId) => context
                            .read<IssuanceCubit>()
                            .issueSubject(studentId),
                        onRevoke: (certId) =>
                            _showRevokeDialog(context, certId),
                      );
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showRevokeDialog(BuildContext context, String certificateId) {
    final reasonController = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Revoke Certificate'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'This action cannot be undone. The certificate will be '
              'permanently marked as revoked.',
              style: TextStyle(fontSize: 13.5),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: 'Reason for revocation',
                hintText: 'Required, 10-1000 characters',
              ),
              maxLines: 3,
              maxLength: 1000,
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
              if (reason.length < 10) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                        'Reason must be at least 10 characters.'),
                    backgroundColor: AppColors.error,
                  ),
                );
                return;
              }
              Navigator.of(ctx).pop();
              context.read<IssuanceCubit>().revoke(
                    certificateId: certificateId,
                    reason: reason,
                  );
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
            ),
            child: const Text('Revoke'),
          ),
        ],
      ),
    );
  }
}

class _WorklistBody extends StatelessWidget {
  const _WorklistBody({
    required this.state,
    required this.user,
    required this.sectionSubjectId,
    required this.onIssue,
    required this.onRevoke,
  });

  final IssuanceState state;
  final AuthUser user;
  final String sectionSubjectId;
  final void Function(String studentId) onIssue;
  final void Function(String certificateId) onRevoke;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final students = state.students;
    final canRevoke = user.isSuperAdmin;

    if (students.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'No students found for this class.',
            style: TextStyle(color: muted, fontSize: 14),
          ),
        ),
      );
    }

    // Sort: eligible first, then by name.
    final sorted = List<CertificateCandidate>.from(students)
      ..sort((a, b) {
        if (a.canIssue && !b.canIssue) return -1;
        if (!a.canIssue && b.canIssue) return 1;
        return a.name.compareTo(b.name);
      });

    return RefreshIndicator(
      onRefresh: () async {},
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          // Summary
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                _SummaryPill(
                  label: '${state.eligible} eligible',
                  color: AppColors.ok,
                  bgColor: AppColors.okBg,
                ),
                const SizedBox(width: 8),
                _SummaryPill(
                  label: '${state.issued} issued',
                  color: AppColors.brand600,
                  bgColor: AppColors.brand050,
                ),
              ],
            ),
          ),
          // Issuing to the whole batch, above the list rather than at the
          // bottom of it: it is the thing an administrator came to do at the
          // end of a term, and it should not be found by scrolling past forty
          // rows to reach.
          _BatchIssue(
            sectionSubjectId: sectionSubjectId,
            eligible: state.eligible,
            total: students.length,
            busy: state.batchBusy,
            result: state.batchResult,
          ),

          // Student list
          for (final student in sorted)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _CandidateRow(
                candidate: student,
                canRevoke: canRevoke,
                busy: state.busyStudentId == student.studentId,
                onIssue: () => onIssue(student.studentId),
                onRevoke: student.hasIssuedCertificate
                    ? () => onRevoke(student.certificate!.id)
                    : null,
              ),
            ),
        ],
      ),
    );
  }
}

class _CandidateRow extends StatelessWidget {
  const _CandidateRow({
    required this.candidate,
    required this.canRevoke,
    required this.busy,
    required this.onIssue,
    this.onRevoke,
  });

  final CertificateCandidate candidate;
  final bool canRevoke;
  final bool busy;
  final VoidCallback onIssue;
  final VoidCallback? onRevoke;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          // Student info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (candidate.rollNo != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Text(
                          '#${candidate.rollNo}',
                          style: TextStyle(
                            fontSize: 12,
                            color: muted,
                            fontFeatures: const [
                              FontFeature.tabularFigures(),
                            ],
                          ),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        candidate.name,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Text(
                      '${candidate.progressPercent.toStringAsFixed(0)}% progress',
                      style: TextStyle(fontSize: 11.5, color: muted),
                    ),
                    if (candidate.attendancePercent != null) ...[
                      Text(' · ', style: TextStyle(color: muted)),
                      Text(
                        '${candidate.attendancePercent!.toStringAsFixed(0)}% attendance',
                        style:
                            TextStyle(fontSize: 11.5, color: muted),
                      ),
                    ],
                  ],
                ),
                // Outstanding items
                if (candidate.outstanding.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      candidate.outstanding.join('; '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: AppColors.warn,
                      ),
                    ),
                  ),
                // Existing certificate
                if (candidate.hasIssuedCertificate)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Certificate: ${candidate.certificate!.certificateNo}',
                      style: TextStyle(
                        fontSize: 11,
                        color: muted,
                        fontFeatures: const [
                          FontFeature.tabularFigures(),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),

          // Action button
          const SizedBox(width: 8),
          if (busy)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else if (candidate.canIssue)
            Flexible(
              child: FilledButton(
                onPressed: onIssue,
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                ),
                child: const Text('Issue'),
              ),
            )
          else if (candidate.hasIssuedCertificate &&
              canRevoke &&
              onRevoke != null)
            Flexible(
              child: OutlinedButton(
                onPressed: onRevoke,
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: AppColors.error,
                ),
                child: const Text('Revoke'),
              ),
            )
          else
            Flexible(
              child: Pill(
                text: candidate.hasRevokedCertificate
                    ? 'Revoked'
                    : 'Not eligible',
                kind: candidate.hasRevokedCertificate
                    ? PillKind.warn
                    : PillKind.neutral,
              ),
            ),
        ],
      ),
    );
  }
}

class _SummaryPill extends StatelessWidget {
  const _SummaryPill({
    required this.label,
    required this.color,
    required this.bgColor,
  });

  final String label;
  final Color color;
  final Color bgColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

/// Issuing to everybody on the batch — FR-CRT.
///
/// TWO BUTTONS, NOT ONE WITH A CHECKBOX. "Issue to the ones who qualify" and
/// "issue to all of them regardless" are different decisions with different
/// consequences, and a checkbox makes the second one reachable by accident.
/// The second is confirmed, and the confirmation says how many people have
/// not met the requirements — because that number is the decision.
class _BatchIssue extends StatefulWidget {
  const _BatchIssue({
    required this.sectionSubjectId,
    required this.eligible,
    required this.total,
    required this.busy,
    required this.result,
  });

  final String sectionSubjectId;
  final int eligible;
  final int total;
  final String? busy;
  final BatchIssueResult? result;

  @override
  State<_BatchIssue> createState() => _BatchIssueState();
}

class _BatchIssueState extends State<_BatchIssue> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _run(bool everyone) async {
    final cubit = context.read<IssuanceCubit>();
    final shortfall = widget.total - widget.eligible;

    if (everyone) {
      final go = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Issue to all ${widget.total} students?'),
          content: Text(
            shortfall == 0
                ? 'Everybody on this batch has met the requirements.'
                : '$shortfall of them have not met the requirements. They will '
                    'be issued anyway, and each certificate will record that it '
                    'was issued over the requirements and by whom.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Issue to all'),
            ),
          ],
        ),
      );
      if (go != true) return;
    }

    await cubit.issueAll(
      widget.sectionSubjectId,
      everyone: everyone,
      reason: _reason.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final busy = widget.busy;
    final result = widget.result;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Issue to the whole batch',
            style: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            'Anybody who already holds one is left alone. Nothing is issued '
            'twice.',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 12),

          OutlinedButton(
            onPressed: busy != null || widget.eligible == 0
                ? null
                : () => _run(false),
            child: Text(
              busy == 'ready'
                  ? 'Issuing…'
                  : 'Issue to the ${widget.eligible} who qualify',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed:
                busy != null || widget.total == 0 ? null : () => _run(true),
            child: Text(
              busy == 'everyone'
                  ? 'Issuing…'
                  : 'Issue to all ${widget.total}, regardless',
            ),
          ),

          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            decoration: const InputDecoration(
              labelText: 'Why, if you are issuing regardless (optional)',
              hintText: 'End of term — assessed by viva.',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),

          if (result != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.okBg : AppColors.okBg,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(
                  color: (dark ? AppColorsDark.ok : AppColors.ok)
                      .withValues(alpha: 0.3),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${result.total} issued',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: dark ? AppColorsDark.ok : AppColors.ok,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    result.describe(),
                    style: TextStyle(
                      fontSize: 12.5,
                      color: dark ? AppColorsDark.ok : AppColors.ok,
                    ),
                  ),
                  // NAMED, NOT COUNTED. "3 skipped" tells the office to go
                  // looking; this tells them where.
                  for (final student in result.skippedStudents)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        '• ${student.name} — ${student.message ?? 'Skipped'}',
                        style: TextStyle(
                          fontSize: 12,
                          color: dark ? AppColorsDark.ok : AppColors.ok,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
