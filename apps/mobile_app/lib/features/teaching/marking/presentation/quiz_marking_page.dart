/// Quiz marking page — SRS §13.6, FR-TCH-019.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/marking_cubit.dart';
import '../data/marking_repository.dart';
import '../data/models/marking_models.dart';

class QuizMarkingPage extends StatefulWidget {
  const QuizMarkingPage({
    super.key,
    required this.quizId,
    required this.title,
  });

  final String quizId;
  final String title;

  @override
  State<QuizMarkingPage> createState() => _QuizMarkingPageState();
}

class _QuizMarkingPageState extends State<QuizMarkingPage> {
  late final QuizMarkingCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = QuizMarkingCubit(context.read<MarkingRepository>())
      ..loadQueue(widget.quizId);
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: Text('Mark: ${widget.title}'),
          actions: [
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'release') {
                  _cubit.releaseQuizGrades(widget.quizId);
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'release',
                  child: Text('Release All Grades'),
                ),
              ],
            ),
          ],
        ),
        body: BlocConsumer<QuizMarkingCubit, QuizMarkingState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == QuizMarkingStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final queue = state.queue;
            if (queue == null || queue.answers.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.check_circle, size: 64, color: AppColors.ok),
                    const SizedBox(height: 16),
                    Text(
                      'All answers have been marked!',
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Total marks: ${queue?.quiz.totalMarks ?? 0}',
                      style: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              );
            }

            return _MarkingBody(
              state: state,
              dark: dark,
              cubit: _cubit,
              quizId: widget.quizId,
            );
          },
        ),
      ),
    );
  }
}

// ── Marking Body ──

class _MarkingBody extends StatefulWidget {
  const _MarkingBody({
    required this.state,
    required this.dark,
    required this.cubit,
    required this.quizId,
  });

  final QuizMarkingState state;
  final bool dark;
  final QuizMarkingCubit cubit;
  final String quizId;

  @override
  State<_MarkingBody> createState() => _MarkingBodyState();
}

class _MarkingBodyState extends State<_MarkingBody> {
  late final TextEditingController _marksController;
  late final TextEditingController _commentController;
  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final current = widget.state.currentAnswer;
    if (current != null && !_initialized) {
      _marksController = TextEditingController(
        text: current.marksAwarded?.toString() ?? '',
      );
      _commentController = TextEditingController(
        text: current.graderComment ?? '',
      );
      _initialized = true;
    }
  }

  @override
  void didUpdateWidget(_MarkingBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    final current = widget.state.currentAnswer;
    if (current != null && oldWidget.state.currentIndex != widget.state.currentIndex) {
      _marksController.text = current.marksAwarded?.toString() ?? '';
      _commentController.text = current.graderComment ?? '';
    }
  }

  @override
  void dispose() {
    if (_initialized) {
      _marksController.dispose();
      _commentController.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final current = widget.state.currentAnswer;
    if (current == null) return const SizedBox.shrink();

    final dark = widget.dark;
    final queue = widget.state.queue!;
    final total = queue.answers.length;
    final index = widget.state.currentIndex + 1;

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: dark ? AppColorsDark.surface : Colors.white,
            border: Border(
              bottom: BorderSide(
                color: dark ? AppColorsDark.line : AppColors.line,
              ),
            ),
          ),
          child: Row(
            children: [
              Text(
                '$index / $total',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: LinearProgressIndicator(
                  value: index / total,
                  backgroundColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                  color: AppColors.ok,
                  minHeight: 4,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${queue.remaining} remaining',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),

        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _StudentHeader(student: current, dark: dark),
                const SizedBox(height: 16),

                Text(
                  'Question',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Text(
                    current.stem,
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                Text(
                  'Student Response',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface : Colors.white,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(
                      color: dark ? AppColorsDark.line : AppColors.line,
                    ),
                  ),
                  child: Text(
                    current.responseText,
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                Text(
                  'Marking',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _marksController,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: 'Marks (out of ${current.marksAvailable})',
                          labelStyle: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                          ),
                          filled: true,
                          fillColor: dark ? AppColorsDark.surface : Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                          ),
                        ),
                        style: TextStyle(
                          color: dark ? AppColorsDark.ink : AppColors.ink,
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Text(
                      '/ ${current.marksAvailable}',
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _commentController,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: 'Comment (optional)',
                    labelStyle: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                    filled: true,
                    fillColor: dark ? AppColorsDark.surface : Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                  ),
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: dark ? AppColorsDark.surface : Colors.white,
            border: Border(
              top: BorderSide(
                color: dark ? AppColorsDark.line : AppColors.line,
              ),
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: widget.state.currentIndex > 0
                      ? () {
                          widget.cubit.previousAnswer();
                          _marksController.clear();
                          _commentController.clear();
                        }
                      : null,
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Prev'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: ElevatedButton.icon(
                  onPressed: widget.state.marking
                      ? null
                      : () {
                          final marks = num.tryParse(_marksController.text);
                          if (marks == null) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Enter a valid mark'),
                              ),
                            );
                            return;
                          }
                          widget.cubit.saveMark(
                            answerId: current.answerId,
                            marksAwarded: marks,
                            graderComment: _commentController.text.isNotEmpty
                                ? _commentController.text
                                : null,
                            quizId: widget.quizId,
                          );
                          _marksController.clear();
                          _commentController.clear();
                        },
                  icon: widget.state.marking
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  label: Text(widget.state.marking ? 'Saving...' : 'Mark'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ── Student Header ──

class _StudentHeader extends StatelessWidget {
  const _StudentHeader({required this.student, required this.dark});
  final MarkableAnswer student;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CircleAvatar(
          backgroundColor: student.isMarked ? AppColors.ok : (dark ? AppColorsDark.brand600 : AppColors.brand600),
          child: Text(
            (student.rollNo ?? '?').toString(),
            style: const TextStyle(color: Colors.white),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                student.studentName,
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
              Text(
                'Attempt ${student.attemptNumber}',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        if (student.isMarked)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.okBg,
              borderRadius: BorderRadius.circular(4),
            ),
            child: const Text(
              'Marked',
              style: TextStyle(
                color: AppColors.ok,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
      ],
    );
  }
}
