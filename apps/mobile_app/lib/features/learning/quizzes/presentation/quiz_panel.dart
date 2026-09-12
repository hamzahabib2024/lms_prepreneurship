import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../cubit/student_quiz_cubit.dart';
import '../data/models/student_quiz_models.dart';
import '../data/student_quiz_repository.dart';
import 'quiz_attempt_page.dart';

/// The quizzes set for one subject — FR-QIZ-023.
///
/// The mobile counterpart of the web's QuizPanel. Every state is spelled out
/// in words rather than carried by colour alone (NFR-ACC-003): "Being marked"
/// is a sentence, not an amber dot.
class QuizPanel extends StatelessWidget {
  const QuizPanel({
    super.key,
    required this.api,
    required this.sectionSubjectId,
  });

  final ApiClient api;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          StudentQuizCubit(StudentQuizRepository(api), sectionSubjectId)..load(),
      child: _QuizPanelView(api: api),
    );
  }
}

class _QuizPanelView extends StatelessWidget {
  const _QuizPanelView({required this.api});

  final ApiClient api;

  Future<void> _start(BuildContext context, StudentQuiz quiz) async {
    final cubit = context.read<StudentQuizCubit>();
    final attempt = await cubit.start(quiz.id);
    if (attempt == null || !context.mounted) return;

    final outcome = await Navigator.of(context).push<AttemptOutcome>(
      MaterialPageRoute(
        builder: (_) => QuizAttemptPage(
          api: api,
          attempt: attempt,
          quizTitle: quiz.title,
        ),
      ),
    );

    // Whatever happened — submitted, or backed out of — the row's standing has
    // moved, so ask the server rather than guessing at it.
    await cubit.load();
    if (outcome != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            outcome.awaitingMarking
                ? 'Submitted. Some answers need marking by your teacher.'
                : 'Submitted.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocBuilder<StudentQuizCubit, StudentQuizState>(
      builder: (context, state) {
        // Nothing at all until the first load resolves: an empty "Quizzes"
        // heading on a subject that has none is a heading about nothing.
        if (state.status == StudentQuizStatus.initial ||
            state.status == StudentQuizStatus.loading) {
          return const SizedBox.shrink();
        }
        if (state.status == StudentQuizStatus.failure && state.quizzes.isEmpty) {
          return Padding(
            padding: const EdgeInsets.only(top: 16),
            child: AppAlert(
              title: 'Quizzes could not be loaded',
              message: state.error?.message ?? 'Please try again.',
              reference: state.error?.reference,
            ),
          );
        }
        if (state.quizzes.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Container(
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
                  'Quizzes',
                  style: TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (state.error != null) ...[
                  const SizedBox(height: 10),
                  AppAlert(
                    title: 'That quiz could not be started',
                    message: state.error!.message,
                    reference: state.error!.reference,
                  ),
                ],
                const SizedBox(height: 6),
                for (final quiz in state.quizzes)
                  _QuizRow(
                    quiz: quiz,
                    busy: state.starting == quiz.id,
                    muted: muted,
                    onStart: () => _start(context, quiz),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _QuizRow extends StatelessWidget {
  const _QuizRow({
    required this.quiz,
    required this.busy,
    required this.muted,
    required this.onStart,
  });

  final StudentQuiz quiz;
  final bool busy;
  final Color muted;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return ListRow(
      title: quiz.title,
      subtitle: '${_facts()}\n${_deadline()}',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (quiz.recordedScore != null)
            Text(
              '${_marks(quiz.recordedScore!)}/${_marks(quiz.totalMarks)}',
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
            )
          else if (quiz.awaitingMarking)
            const Pill(text: 'Being marked')
          else if (quiz.attemptsUsed > 0 && !quiz.canAttempt)
            const Pill(text: 'Submitted'),
          if (quiz.canAttempt) ...[
            const SizedBox(width: 8),
            busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : FilledButton(
                    onPressed: onStart,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(quiz.inProgress ? 'Resume' : 'Start'),
                  ),
          ],
        ],
      ),
    );
  }

  String _facts() {
    final parts = <String>['${_marks(quiz.totalMarks)} marks'];
    if (quiz.timeLimitMinutes != null) parts.add('${quiz.timeLimitMinutes} min');
    if (quiz.maxAttempts > 1) {
      parts.add('${quiz.attemptsUsed}/${quiz.maxAttempts} attempts');
    }
    return parts.join(' · ');
  }

  /// FR-QIZ-013 — the penalty is stated with the deadline, so a student
  /// deciding whether to guess reads it before they start rather than when
  /// they see the mark.
  String _deadline() {
    if (quiz.opensLater) return 'Opens ${_date(quiz.opensAt)}';
    if (quiz.hasClosed) return 'Closed ${_date(quiz.closesAt)}';
    final days = quiz.closesAt.difference(DateTime.now()).inHours / 24;
    final rounded = days.round();
    final closing = rounded <= 0
        ? 'Closes today'
        : 'Closes in $rounded day${rounded == 1 ? '' : 's'}';
    return quiz.penalisesWrongAnswers
        ? '$closing · wrong answers lose marks'
        : closing;
  }

  static String _date(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/'
      '${value.month.toString().padLeft(2, '0')}/${value.year}';

  static String _marks(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();
}
