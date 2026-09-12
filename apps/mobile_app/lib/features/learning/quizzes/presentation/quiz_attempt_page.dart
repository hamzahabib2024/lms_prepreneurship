import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../cubit/student_quiz_cubit.dart';
import '../data/models/student_quiz_models.dart';
import '../data/student_quiz_repository.dart';

/// Sitting a quiz — FR-QIZ-024..028.
///
/// A full screen rather than the web's modal, because a phone has no room for
/// a dialog over a page and because a student answering questions should not
/// be one stray tap outside the sheet from losing the paper.
///
/// THE CLOCK SHOWN HERE IS A DISPLAY. It counts a number the server gave us
/// (BR-QIZ-04); reaching zero submits the attempt as a courtesy, and the
/// server would have finalised it anyway.
class QuizAttemptPage extends StatelessWidget {
  const QuizAttemptPage({
    super.key,
    required this.api,
    required this.attempt,
    required this.quizTitle,
  });

  final ApiClient api;
  final QuizAttempt attempt;
  final String quizTitle;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => QuizAttemptCubit(StudentQuizRepository(api), attempt),
      child: _AttemptView(quizTitle: quizTitle),
    );
  }
}

class _AttemptView extends StatelessWidget {
  const _AttemptView({required this.quizTitle});

  final String quizTitle;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocConsumer<QuizAttemptCubit, QuizAttemptState>(
      listenWhen: (a, b) => a.outcome != b.outcome && b.outcome != null,
      listener: (context, state) => Navigator.of(context).pop(state.outcome),
      builder: (context, state) {
        final cubit = context.read<QuizAttemptCubit>();
        final total = state.attempt.questions.length;

        return PopScope(
          // Leaving does not discard anything — every answer is already on the
          // server — but a student who taps back by accident should be told
          // that the clock keeps running without them.
          canPop: false,
          onPopInvokedWithResult: (didPop, _) async {
            if (didPop) return;
            final leave = await _confirmLeave(context, state);
            if (leave == true && context.mounted) Navigator.of(context).pop();
          },
          child: Scaffold(
            appBar: AppBar(
              title: Text('Attempt ${state.attempt.attemptNumber}'),
              backgroundColor: Theme.of(context).colorScheme.surface,
              surfaceTintColor: Colors.transparent,
              actions: [
                if (state.isTimed)
                  Center(child: _Clock(seconds: state.remainingSeconds!)),
                const SizedBox(width: 14),
              ],
            ),
            body: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                Text(
                  quizTitle,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${state.answeredCount} of $total answered · answers save as you go',
                  style: TextStyle(fontSize: 12.5, color: muted),
                ),
                if (state.saveFailed) ...[
                  const SizedBox(height: 12),
                  const AppAlert(
                    title: 'An answer was not saved',
                    message:
                        'Check your connection and tap the answer again. Anything already saved is safe.',
                    warn: true,
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: 12),
                  AppAlert(
                    title: 'That could not be submitted',
                    message: state.error!.message,
                    reference: state.error!.reference,
                  ),
                ],
                const SizedBox(height: 16),
                for (final question in state.attempt.questions)
                  _QuestionCard(
                    question: question,
                    response: state.answers[question.questionId],
                    saving: state.savingQuestionId == question.questionId,
                    onAnswer: (r) => cubit.answer(question.questionId, r),
                  ),
                const SizedBox(height: 8),
                if (state.answeredCount < total)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(
                      '${total - state.answeredCount} question'
                      '${total - state.answeredCount == 1 ? '' : 's'} unanswered.',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: dark ? AppColorsDark.warn : AppColors.warn,
                      ),
                    ),
                  ),
                FilledButton(
                  onPressed: state.submitting
                      ? null
                      : () async {
                          final go = await _confirmSubmit(context, state);
                          if (go == true) await cubit.submit();
                        },
                  child: Text(state.submitting ? 'Submitting…' : 'Submit quiz'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<bool?> _confirmLeave(BuildContext context, QuizAttemptState state) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Leave this attempt?'),
        content: Text(
          state.isTimed
              ? 'Your answers are saved, but the clock keeps running while you '
                  'are away and the attempt is submitted when it reaches zero.'
              : 'Your answers are saved. The attempt stays open until you '
                  'submit it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Stay'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
  }

  Future<bool?> _confirmSubmit(BuildContext context, QuizAttemptState state) {
    final unanswered = state.attempt.questions.length - state.answeredCount;
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Submit this quiz?'),
        content: Text(
          unanswered == 0
              ? 'You cannot change your answers afterwards.'
              : '$unanswered question${unanswered == 1 ? ' is' : 's are'} '
                  'unanswered. You cannot change your answers afterwards.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep working'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Submit'),
          ),
        ],
      ),
    );
  }
}

/// The countdown. Under a minute it turns and stays turned — a colour change
/// alone would not reach a student who cannot see it (NFR-ACC-003), so the
/// word "left" is joined by an icon and the figure itself.
class _Clock extends StatelessWidget {
  const _Clock({required this.seconds});

  final int seconds;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final urgent = seconds < 60;
    final color = urgent
        ? (dark ? AppColorsDark.error : AppColors.error)
        : (dark ? AppColorsDark.muted : AppColors.muted);
    final minutes = seconds ~/ 60;
    final rest = (seconds % 60).toString().padLeft(2, '0');

    return Semantics(
      liveRegion: true,
      label: '$minutes minutes $rest seconds left',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(urgent ? Icons.timer : Icons.timer_outlined, size: 16, color: color),
          const SizedBox(width: 5),
          Text(
            '$minutes:$rest left',
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.question,
    required this.response,
    required this.saving,
    required this.onAnswer,
  });

  final StudentQuestion question;
  final dynamic response;
  final bool saving;
  final void Function(Map<String, dynamic>?) onAnswer;

  List<String> get _selected {
    final ids = (response as Map<String, dynamic>?)?['selectedOptionIds'];
    return ids is List ? ids.whereType<String>().toList() : const [];
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

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
          Text(
            '${question.displayOrder}. ${question.stem}',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, height: 1.4),
          ),
          const SizedBox(height: 3),
          Text(
            '${_marks(question.marks)} mark${question.marks == 1 ? '' : 's'}',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          const SizedBox(height: 10),
          if (question.isChoice)
            _Options(
              question: question,
              selected: _selected,
              onAnswer: onAnswer,
            )
          else
            _WrittenAnswer(
              key: ValueKey(question.questionId),
              numeric: question.isNumeric,
              initial: _initialText(),
              onChanged: (value) {
                if (value.trim().isEmpty) {
                  onAnswer(null);
                } else if (question.isNumeric) {
                  final parsed = num.tryParse(value.trim());
                  onAnswer(parsed == null ? null : {'value': parsed});
                } else {
                  onAnswer({'text': value});
                }
              },
            ),
          if (saving)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('Saving…', style: TextStyle(fontSize: 12, color: muted)),
            ),
        ],
      ),
    );
  }

  String _initialText() {
    final map = response as Map<String, dynamic>?;
    if (map == null) return '';
    return (map['text'] ?? map['value'] ?? '').toString();
  }

  static String _marks(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();
}

/// The choice types.
///
/// Single-select goes through a RadioGroup so the framework owns which one is
/// on; multi-select is a list of checkboxes. Both send the same shape —
/// `{selectedOptionIds: [...]}` — because that is the one the server's
/// response schema accepts for either.
class _Options extends StatelessWidget {
  const _Options({
    required this.question,
    required this.selected,
    required this.onAnswer,
  });

  final StudentQuestion question;
  final List<String> selected;
  final void Function(Map<String, dynamic>?) onAnswer;

  @override
  Widget build(BuildContext context) {
    if (question.isMultiSelect) {
      return Column(
        children: [
          for (final option in question.options)
            CheckboxListTile(
              value: selected.contains(option.optionId),
              onChanged: (on) {
                final next = [...selected];
                if (on == true) {
                  if (!next.contains(option.optionId)) next.add(option.optionId);
                } else {
                  next.remove(option.optionId);
                }
                onAnswer(next.isEmpty ? null : {'selectedOptionIds': next});
              },
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              dense: true,
              title: Text(option.text, style: const TextStyle(fontSize: 14)),
            ),
        ],
      );
    }

    return RadioGroup<String>(
      groupValue: selected.isEmpty ? null : selected.first,
      onChanged: (value) {
        if (value != null) onAnswer({'selectedOptionIds': [value]});
      },
      child: Column(
        children: [
          for (final option in question.options)
            RadioListTile<String>(
              value: option.optionId,
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(option.text, style: const TextStyle(fontSize: 14)),
            ),
        ],
      ),
    );
  }
}

/// A written or numeric answer.
///
/// Saved on blur rather than on every keystroke: a PATCH per character would
/// be unkind to a phone connection, and the field keeps what was typed until
/// the request lands either way.
class _WrittenAnswer extends StatefulWidget {
  const _WrittenAnswer({
    super.key,
    required this.numeric,
    required this.initial,
    required this.onChanged,
  });

  final bool numeric;
  final String initial;
  final void Function(String) onChanged;

  @override
  State<_WrittenAnswer> createState() => _WrittenAnswerState();
}

class _WrittenAnswerState extends State<_WrittenAnswer> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);
  late final FocusNode _focus = FocusNode()..addListener(_onFocusChange);
  String _lastSent = '';

  @override
  void initState() {
    super.initState();
    _lastSent = widget.initial;
  }

  void _onFocusChange() {
    if (_focus.hasFocus) return;
    if (_controller.text == _lastSent) return;
    _lastSent = _controller.text;
    widget.onChanged(_controller.text);
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocusChange);
    _focus.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      focusNode: _focus,
      keyboardType: widget.numeric
          ? const TextInputType.numberWithOptions(decimal: true, signed: true)
          : TextInputType.multiline,
      minLines: widget.numeric ? 1 : 3,
      maxLines: widget.numeric ? 1 : 8,
      textInputAction:
          widget.numeric ? TextInputAction.done : TextInputAction.newline,
      onSubmitted: (_) => _focus.unfocus(),
      decoration: InputDecoration(
        hintText: widget.numeric ? 'Your answer' : 'Write your answer',
        border: const OutlineInputBorder(),
        isDense: true,
      ),
    );
  }
}
