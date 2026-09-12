import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../cubit/question_bank_cubit.dart';
import '../data/models/question_bank_models.dart';
import '../data/question_bank_repository.dart';
import 'question_composer.dart';

/// Question banks — SRS §13.6, FR-QIZ-004..012.
///
/// The web keeps this inside the quiz builder's right-hand column. A phone
/// has no right-hand column, so it is a screen of its own that the builder
/// opens; [onPick] is what the builder passes to turn each row into "add this
/// to the paper".
class QuestionBankPage extends StatelessWidget {
  const QuestionBankPage({
    super.key,
    required this.api,
    this.subjectId,
    this.onPick,
    this.alreadyOnPaper = const {},
  });

  final ApiClient api;

  /// Narrows the banks offered. The quiz builder knows which subject it is
  /// writing for; opened on its own, this is null and every bank is listed.
  final String? subjectId;

  /// When present each question gets an Add button. Null in browse mode.
  final void Function(BankQuestion)? onPick;

  /// Question ids already on the paper, so they read "On the paper" rather
  /// than offering to be added twice.
  final Set<String> alreadyOnPaper;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => QuestionBankCubit(
        QuestionBankRepository(api),
        subjectId: subjectId,
      )..loadBanks(),
      child: _QuestionBankView(
        onPick: onPick,
        alreadyOnPaper: alreadyOnPaper,
      ),
    );
  }
}

class _QuestionBankView extends StatelessWidget {
  const _QuestionBankView({required this.onPick, required this.alreadyOnPaper});

  final void Function(BankQuestion)? onPick;
  final Set<String> alreadyOnPaper;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Question banks'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<QuestionBankCubit, QuestionBankState>(
        builder: (context, state) {
          final cubit = context.read<QuestionBankCubit>();

          if (state.status == QuestionBankStatus.loading) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(),
            );
          }

          return RefreshIndicator(
            onRefresh: cubit.loadBanks,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                if (state.error != null) ...[
                  AppAlert(
                    title: 'Something went wrong',
                    message: state.error!.message,
                    reference: state.error!.reference,
                  ),
                  const SizedBox(height: 14),
                ],

                _BankChooser(state: state, muted: muted),
                const SizedBox(height: 16),

                if (state.selectedBankId == null)
                  Text(
                    'Choose a bank to see its questions, or start a new one.',
                    style: TextStyle(fontSize: 13, color: muted),
                  )
                else ...[
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${state.questions.length} question'
                          '${state.questions.length == 1 ? '' : 's'}',
                          style: const TextStyle(
                            fontFamily: AppFonts.display,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      TextButton.icon(
                        onPressed: cubit.toggleRetired,
                        icon: Icon(
                          state.includeRetired
                              ? Icons.visibility_off_outlined
                              : Icons.history,
                          size: 17,
                        ),
                        label: Text(
                          state.includeRetired ? 'Hide retired' : 'Show retired',
                        ),
                      ),
                    ],
                  ),
                  if (state.loadingQuestions)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Skeleton(),
                    )
                  else if (state.questions.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        'This bank is empty. Write the first question below.',
                        style: TextStyle(fontSize: 13, color: muted),
                      ),
                    )
                  else
                    for (final question in state.questions)
                      _QuestionRow(
                        question: question,
                        onPaper: alreadyOnPaper.contains(question.id),
                        onPick: onPick,
                        onRetire: () => _confirmRetire(context, question),
                      ),

                  const SizedBox(height: 22),
                  const Text(
                    'Write a new question',
                    style: TextStyle(
                      fontFamily: AppFonts.display,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  QuestionComposer(
                    saving: state.saving,
                    problems: state.problems,
                    onSave: cubit.addQuestion,
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _confirmRetire(BuildContext context, BankQuestion q) async {
    final cubit = context.read<QuestionBankCubit>();
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Retire this question?'),
        content: const Text(
          'It stops being offered for new quizzes. Attempts that already used '
          'it keep it, so nothing marked in the past changes.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Retire'),
          ),
        ],
      ),
    );
    if (go == true) await cubit.retire(q.id);
  }
}

class _BankChooser extends StatefulWidget {
  const _BankChooser({required this.state, required this.muted});

  final QuestionBankState state;
  final Color muted;

  @override
  State<_BankChooser> createState() => _BankChooserState();
}

class _BankChooserState extends State<_BankChooser> {
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final cubit = context.read<QuestionBankCubit>();
    final state = widget.state;

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
          DropdownButtonFormField<String>(
            initialValue: state.selectedBankId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Bank',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              for (final bank in state.banks)
                DropdownMenuItem(
                  value: bank.id,
                  child: Text(
                    '${bank.name} (${bank.questionCount})',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (value) {
              if (value != null) cubit.selectBank(value);
            },
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _name,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Or start a new one',
                    hintText: 'Graphic Designing — core',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: OutlinedButton(
                  onPressed: _name.text.trim().length < 2 || state.saving
                      ? null
                      : () async {
                          final created = await cubit.createBank(_name.text);
                          if (created) _name.clear();
                          if (mounted) setState(() {});
                        },
                  child: const Text('Create'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuestionRow extends StatelessWidget {
  const _QuestionRow({
    required this.question,
    required this.onPaper,
    required this.onPick,
    required this.onRetire,
  });

  final BankQuestion question;
  final bool onPaper;
  final void Function(BankQuestion)? onPick;
  final VoidCallback onRetire;

  @override
  Widget build(BuildContext context) {
    final marks = question.defaultMarks == question.defaultMarks.roundToDouble()
        ? question.defaultMarks.toStringAsFixed(0)
        : question.defaultMarks.toString();

    return ListRow(
      title: question.stem,
      subtitle: '${question.type.label} · $marks marks'
          '${question.difficulty == null ? '' : ' · ${question.difficulty!.toLowerCase()}'}',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (question.isRetired)
            const Pill(text: 'Retired')
          else if (onPick == null)
            IconButton(
              onPressed: onRetire,
              icon: const Icon(Icons.archive_outlined, size: 19),
              tooltip: 'Retire',
              visualDensity: VisualDensity.compact,
            )
          else if (onPaper)
            const Pill(text: 'On the paper', kind: PillKind.ok)
          else
            OutlinedButton(
              onPressed: () => onPick!(question),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Add'),
            ),
        ],
      ),
    );
  }
}
