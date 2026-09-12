import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../question_bank/data/models/question_bank_models.dart';
import '../../question_bank/presentation/question_bank_page.dart';
import '../cubit/quiz_paper_cubit.dart';
import '../data/models/quiz_paper_models.dart';
import '../data/quiz_paper_repository.dart';

/// The paper — SRS §13.6, FR-QIZ-014..020.
///
/// Phase two of building a quiz. Phase one is the settings (the window, the
/// time limit, whether wrong answers lose marks); this is what is on it.
/// Keeping them apart matters: mixed together, "does a wrong answer cost
/// you" sits beside "add another option" and neither decision reads clearly.
///
/// A PUBLISHED QUIZ IS READ-ONLY HERE. Somebody may be sitting it, the server
/// refuses the edit anyway, and a button that will be refused wastes the
/// teacher's time and teaches them to ignore errors.
class QuizPaperPage extends StatelessWidget {
  const QuizPaperPage({
    super.key,
    required this.api,
    required this.quizId,
    this.subjectId,
  });

  final ApiClient api;
  final String quizId;

  /// Narrows the banks offered when picking questions.
  final String? subjectId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => QuizPaperCubit(QuizPaperRepository(api), quizId)..load(),
      child: _QuizPaperView(api: api, subjectId: subjectId),
    );
  }
}

class _QuizPaperView extends StatelessWidget {
  const _QuizPaperView({required this.api, required this.subjectId});

  final ApiClient api;
  final String? subjectId;

  Future<void> _pickFromBank(BuildContext context, QuizPaper paper) async {
    final cubit = context.read<QuizPaperCubit>();
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => QuestionBankPage(
          api: api,
          subjectId: subjectId,
          alreadyOnPaper: paper.questionIds,
          onPick: (BankQuestion question) => cubit.addQuestion(question.id),
        ),
      ),
    );
    // The bank screen adds through the same cubit, so the paper is already
    // current; reload anyway in case a question was retired while over there.
    await cubit.load();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocBuilder<QuizPaperCubit, QuizPaperState>(
      builder: (context, state) {
        final cubit = context.read<QuizPaperCubit>();
        final paper = state.paper;

        return Scaffold(
          appBar: AppBar(
            title: Text(paper?.title ?? 'The paper'),
            backgroundColor: Theme.of(context).colorScheme.surface,
            surfaceTintColor: Colors.transparent,
          ),
          body: switch (state.status) {
            QuizPaperStatus.initial ||
            QuizPaperStatus.loading =>
              const Padding(padding: EdgeInsets.all(20), child: SkeletonCards()),
            QuizPaperStatus.failure when paper == null => Padding(
                padding: const EdgeInsets.all(20),
                child: AppAlert(
                  title: 'This quiz could not be loaded',
                  message: state.error?.message ?? 'Please try again.',
                  reference: state.error?.reference,
                ),
              ),
            _ => RefreshIndicator(
                onRefresh: cubit.load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                  children: [
                    _Summary(paper: paper!, muted: muted),
                    const SizedBox(height: 14),

                    if (state.problems.isNotEmpty) ...[
                      AppAlert(
                        title: 'That did not work',
                        message: state.problems.length == 1
                            ? state.problems.first
                            : 'The server raised these:',
                        details: state.problems.length == 1
                            ? const []
                            : state.problems,
                      ),
                      const SizedBox(height: 14),
                    ],
                    if (state.justPublished) ...[
                      const AppAlert(
                        title: 'Published',
                        message: 'Students can sit this now.',
                        warn: true,
                      ),
                      const SizedBox(height: 14),
                    ],

                    if (paper.questions.isEmpty)
                      Text(
                        'Nothing on the paper yet. Add questions from a bank.',
                        style: TextStyle(fontSize: 13, color: muted),
                      )
                    else
                      for (final question in paper.questions)
                        ListRow(
                          title: '${question.displayOrder}. ${question.stem}',
                          subtitle:
                              '${question.typeLabel} · ${_marks(question.marks)} marks',
                          trailing: paper.isLocked
                              ? null
                              : IconButton(
                                  onPressed: state.busy
                                      ? null
                                      : () => cubit
                                          .removeQuestion(question.questionId),
                                  icon: const Icon(Icons.remove_circle_outline,
                                      size: 20),
                                  tooltip: 'Remove from the paper',
                                  visualDensity: VisualDensity.compact,
                                ),
                        ),

                    const SizedBox(height: 20),

                    if (!paper.isLocked) ...[
                      OutlinedButton.icon(
                        onPressed: state.busy
                            ? null
                            : () => _pickFromBank(context, paper),
                        icon: const Icon(Icons.playlist_add, size: 19),
                        label: const Text('Add questions from a bank'),
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: paper.questions.isEmpty || state.busy
                            ? null
                            : () => _confirmPublish(context, paper),
                        child: Text(state.busy ? 'Working…' : 'Publish'),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Once published the paper cannot be changed — somebody '
                        'may be sitting it.',
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                    ] else if (paper.attemptCount > 0)
                      Text(
                        '${paper.attemptCount} attempt'
                        '${paper.attemptCount == 1 ? '' : 's'} so far.',
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                  ],
                ),
              ),
          },
        );
      },
    );
  }

  Future<void> _confirmPublish(BuildContext context, QuizPaper paper) async {
    final cubit = context.read<QuizPaperCubit>();
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Publish this quiz?'),
        content: Text(
          'Students will be able to sit it from '
          '${_dateTime(paper.opensAt)}, and the paper cannot be changed '
          'afterwards.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not yet'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Publish'),
          ),
        ],
      ),
    );
    if (go == true) await cubit.publish();
  }

  static String _marks(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();

  static String _dateTime(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/'
      '${value.month.toString().padLeft(2, '0')}/${value.year} '
      '${value.hour.toString().padLeft(2, '0')}:'
      '${value.minute.toString().padLeft(2, '0')}';
}

class _Summary extends StatelessWidget {
  const _Summary({required this.paper, required this.muted});

  final QuizPaper paper;
  final Color muted;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final count = paper.questions.length;

    return Container(
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
          Row(
            children: [
              Expanded(
                child: Text(
                  paper.title,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              // Never colour alone (NFR-ACC-003) — the state is a word.
              Pill(
                text: paper.isLocked ? 'Published' : 'Draft',
                kind: paper.isLocked ? PillKind.ok : PillKind.neutral,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '$count question${count == 1 ? '' : 's'} · '
            '${QuizPaperPageMarks.format(paper.totalMarks)} marks'
            '${paper.isLocked ? '' : ' · not visible to students'}',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          if (paper.timeLimitMinutes != null || paper.maxAttempts > 1) ...[
            const SizedBox(height: 3),
            Text(
              [
                if (paper.timeLimitMinutes != null)
                  '${paper.timeLimitMinutes} min',
                if (paper.maxAttempts > 1) '${paper.maxAttempts} attempts',
                if (paper.negativeMarking != 'NONE') 'wrong answers lose marks',
              ].join(' · '),
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],
        ],
      ),
    );
  }
}

/// Shared with the rows above, so a total and a per-question mark are
/// formatted the same way.
abstract final class QuizPaperPageMarks {
  static String format(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();
}
