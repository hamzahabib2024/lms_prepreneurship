/// Quiz builder page — SRS §13.6, FR-TCH-022.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/quiz_builder_cubit.dart';
import '../data/quiz_builder_repository.dart';
import '../data/models/quiz_builder_models.dart';

class QuizBuilderPage extends StatefulWidget {
  const QuizBuilderPage({super.key, this.quizId, this.sectionSubjectId});
  final String? quizId;
  final String? sectionSubjectId;

  @override
  State<QuizBuilderPage> createState() => _QuizBuilderPageState();
}

class _QuizBuilderPageState extends State<QuizBuilderPage> {
  late final QuizBuilderCubit _cubit;
  late final TextEditingController _titleController;

  @override
  void initState() {
    super.initState();
    _cubit = QuizBuilderCubit(
      context.read<QuizBuilderRepository>(),
      quizId: widget.quizId,
    );
    _titleController = TextEditingController();
    if (widget.sectionSubjectId != null) {
      _cubit.loadQuizzes(widget.sectionSubjectId!);
    }
  }

  @override
  void dispose() {
    _cubit.close();
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.quizId != null ? 'Edit Quiz' : 'New Quiz'),
          actions: [
            BlocConsumer<QuizBuilderCubit, QuizBuilderState>(
              listener: (context, state) {
                if (state.status == QuizBuilderStatus.saved) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Quiz saved')),
                  );
                  Navigator.of(context).pop(true);
                }
                if (state.error != null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(state.error!)),
                  );
                }
              },
              builder: (context, state) {
                return Row(
                  children: [
                    if (state.publicationStatus != 'PUBLISHED')
                      TextButton(
                        onPressed: state.saving == true ? null : () => _cubit.publish(),
                        child: const Text('Publish'),
                      ),
                    IconButton(
                      icon: state.saving == true
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save),
                      onPressed: state.saving == true ? null : () => _cubit.save(),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
        body: BlocBuilder<QuizBuilderCubit, QuizBuilderState>(
          builder: (context, state) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title
                  _FormField(
                    label: 'Title',
                    child: TextField(
                      controller: _titleController,
                      onChanged: (v) => _cubit.updateTitle(v),
                      decoration: _inputDecoration(dark, 'Quiz title'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Timing
                  Row(
                    children: [
                      Expanded(
                        child: _FormField(
                          label: 'Duration (min)',
                          child: TextField(
                            keyboardType: TextInputType.number,
                            onChanged: (v) {
                              final mins = int.tryParse(v) ?? 60;
                              _cubit.updateDurationMinutes(mins);
                            },
                            decoration: _inputDecoration(dark, '60'),
                            style: _textStyle(dark),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: _FormField(
                          label: 'Total Marks',
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                            decoration: BoxDecoration(
                              color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                            ),
                            child: Text(
                              '${state.totalMarks}',
                              style: TextStyle(
                                color: dark ? AppColorsDark.ink : AppColors.ink,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Opens/Closes
                  Row(
                    children: [
                      Expanded(
                        child: _FormField(
                          label: 'Opens At',
                          child: _DateTimePicker(
                            dark: dark,
                            value: state.opensAt,
                            onChanged: (v) => _cubit.updateOpensAt(v),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: _FormField(
                          label: 'Closes At',
                          child: _DateTimePicker(
                            dark: dark,
                            value: state.closesAt,
                            onChanged: (v) => _cubit.updateClosesAt(v),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Publication Status
                  _FormField(
                    label: 'Status',
                    child: DropdownButtonFormField<String>(
                      initialValue: state.publicationStatus,
                      decoration: _inputDecoration(dark, 'Select status'),
                      items: const [
                        DropdownMenuItem(value: 'DRAFT', child: Text('Draft')),
                        DropdownMenuItem(value: 'PUBLISHED', child: Text('Published')),
                      ],
                      onChanged: (v) {
                        if (v != null) _cubit.updatePublicationStatus(v);
                      },
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Questions
                  Row(
                    children: [
                      Text(
                        'Questions',
                        style: TextStyle(
                          color: dark ? AppColorsDark.ink : AppColors.ink,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      const Spacer(),
                      PopupMenuButton<String>(
                        onSelected: (type) => _cubit.addQuestion(type),
                        itemBuilder: (_) => [
                          const PopupMenuItem(value: 'MCQ', child: Text('Multiple Choice')),
                          const PopupMenuItem(value: 'TRUE_FALSE', child: Text('True/False')),
                          const PopupMenuItem(value: 'SHORT_ANSWER', child: Text('Short Answer')),
                          const PopupMenuItem(value: 'ESSAY', child: Text('Essay')),
                        ],
                        child: Chip(
                          avatar: const Icon(Icons.add, size: 18),
                          label: const Text('Add Question'),
                          backgroundColor: dark ? AppColorsDark.brand050 : AppColors.brand050,
                          labelStyle: TextStyle(
                            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),

                  if (state.questions.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                      ),
                      child: Text(
                        'No questions yet. Tap "Add Question" to start.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    ),

                  ...state.questions.asMap().entries.map((entry) {
                    final index = entry.key;
                    final question = entry.value;
                    return _QuestionCard(
                      index: index,
                      question: question,
                      dark: dark,
                      onStemChanged: (v) => _cubit.updateQuestionStem(question.id, v),
                      onMarksChanged: (v) {
                        final marks = int.tryParse(v) ?? 1;
                        _cubit.updateQuestionMarks(question.id, marks);
                      },
                      onOptionChanged: (optionId, text) =>
                          _cubit.updateOptionText(question.id, optionId, text),
                      onCorrectChanged: (optionId) =>
                          _cubit.setCorrectAnswer(question.id, optionId),
                      onAddOption: () => _cubit.addOption(question.id),
                      onRemove: () => _cubit.removeQuestion(question.id),
                    );
                  }),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  TextStyle _textStyle(bool dark) {
    return TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink);
  }

  InputDecoration _inputDecoration(bool dark, String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
      filled: true,
      fillColor: dark ? AppColorsDark.surface : Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
      ),
    );
  }
}

// ── Form Field ──

class _FormField extends StatelessWidget {
  const _FormField({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

// ── Date Time Picker ──

class _DateTimePicker extends StatelessWidget {
  const _DateTimePicker({
    required this.dark,
    required this.value,
    required this.onChanged,
  });

  final bool dark;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final date = await showDatePicker(
          context: context,
          initialDate: DateTime.now().add(const Duration(days: 7)),
          firstDate: DateTime.now().subtract(const Duration(days: 365)),
          lastDate: DateTime.now().add(const Duration(days: 365)),
        );
        if (date != null && context.mounted) {
          final time = await showTimePicker(
            context: context,
            initialTime: const TimeOfDay(hour: 9, minute: 0),
          );
          final dt = DateTime(
            date.year,
            date.month,
            date.day,
            time?.hour ?? 9,
            time?.minute ?? 0,
          );
          onChanged(dt.toIso8601String());
        }
      },
      child: InputDecorator(
        decoration: InputDecoration(
          filled: true,
          fillColor: dark ? AppColorsDark.surface : Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
          ),
        ),
        child: Text(
          value.isNotEmpty ? _formatDate(value) : 'Tap to select',
          style: TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink),
        ),
      ),
    );
  }

  String _formatDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateStr;
    }
  }
}

// ── Question Card ──

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.index,
    required this.question,
    required this.dark,
    required this.onStemChanged,
    required this.onMarksChanged,
    required this.onOptionChanged,
    required this.onCorrectChanged,
    required this.onAddOption,
    required this.onRemove,
  });

  final int index;
  final QuizQuestion question;
  final bool dark;
  final ValueChanged<String> onStemChanged;
  final ValueChanged<String> onMarksChanged;
  final Function(String optionId, String text) onOptionChanged;
  final ValueChanged<String> onCorrectChanged;
  final VoidCallback onAddOption;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final typeLabel = {
      'MCQ': 'Multiple Choice',
      'TRUE_FALSE': 'True/False',
      'SHORT_ANSWER': 'Short Answer',
      'ESSAY': 'Essay',
    }[question.type] ?? question.type;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: dark ? AppColorsDark.surface : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    'Q${index + 1}',
                    style: TextStyle(
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.okBg,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    typeLabel,
                    style: const TextStyle(
                      color: AppColors.ok,
                      fontSize: 11,
                    ),
                  ),
                ),
                const Spacer(),
                SizedBox(
                  width: 60,
                  child: TextField(
                    keyboardType: TextInputType.number,
                    onChanged: onMarksChanged,
                    decoration: InputDecoration(
                      labelText: 'Marks',
                      labelStyle: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                        fontSize: 11,
                      ),
                      isDense: true,
                      filled: true,
                      fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                    ),
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontSize: 12,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 18),
                  onPressed: onRemove,
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              onChanged: onStemChanged,
              maxLines: 2,
              decoration: InputDecoration(
                hintText: 'Enter question stem...',
                hintStyle: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
                filled: true,
                fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
              ),
            ),
            if (question.type == 'MCQ' || question.type == 'TRUE_FALSE') ...[
              const SizedBox(height: 12),
              Text(
                'Options',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w500,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 8),
              ...question.options.map((option) {
                final isCorrect = option.id == question.correctAnswer;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Radio<String>(
                        value: option.id,
                        groupValue: question.correctAnswer,
                        onChanged: (v) {
                          if (v != null) onCorrectChanged(v);
                        },
                        activeColor: AppColors.ok,
                      ),
                      Expanded(
                        child: TextField(
                          onChanged: (v) => onOptionChanged(option.id, v),
                          decoration: InputDecoration(
                            hintText: 'Option text...',
                            hintStyle: TextStyle(
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                              fontSize: 12,
                            ),
                            isDense: true,
                            filled: true,
                            fillColor: dark ? AppColorsDark.surface : Colors.white,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                              borderSide: isCorrect
                                  ? const BorderSide(color: AppColors.ok, width: 2)
                                  : BorderSide(
                                      color: dark ? AppColorsDark.line : AppColors.line),
                            ),
                          ),
                          style: TextStyle(
                            color: dark ? AppColorsDark.ink : AppColors.ink,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }),
              OutlinedButton.icon(
                onPressed: onAddOption,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add Option', style: TextStyle(fontSize: 12)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
