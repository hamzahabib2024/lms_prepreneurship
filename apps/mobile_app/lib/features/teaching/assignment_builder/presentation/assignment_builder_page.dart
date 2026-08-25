/// Assignment builder page — SRS §13.6, FR-TCH-020.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/assignment_builder_cubit.dart';
import '../data/assignment_builder_repository.dart';
import '../data/models/assignment_builder_models.dart';

class AssignmentBuilderPage extends StatefulWidget {
  const AssignmentBuilderPage({super.key, this.assignmentId});
  final String? assignmentId;

  @override
  State<AssignmentBuilderPage> createState() => _AssignmentBuilderPageState();
}

class _AssignmentBuilderPageState extends State<AssignmentBuilderPage> {
  late final AssignmentBuilderCubit _cubit;
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _marksController;

  @override
  void initState() {
    super.initState();
    _cubit = AssignmentBuilderCubit(
      context.read<AssignmentBuilderRepository>(),
      assignmentId: widget.assignmentId,
    )..loadSectionSubjects();
    _titleController = TextEditingController();
    _descriptionController = TextEditingController();
    _marksController = TextEditingController(text: '100');
  }

  @override
  void dispose() {
    _cubit.close();
    _titleController.dispose();
    _descriptionController.dispose();
    _marksController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.assignmentId != null ? 'Edit Assignment' : 'New Assignment'),
          actions: [
            BlocConsumer<AssignmentBuilderCubit, AssignmentBuilderState>(
              listener: (context, state) {
                if (state.status == AssignmentBuilderStatus.saved) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Assignment saved')),
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
        body: BlocBuilder<AssignmentBuilderCubit, AssignmentBuilderState>(
          builder: (context, state) {
            if (state.status == AssignmentBuilderStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

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
                      decoration: _inputDecoration(dark, 'Assignment title'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Description
                  _FormField(
                    label: 'Description (optional)',
                    child: TextField(
                      controller: _descriptionController,
                      onChanged: (v) => _cubit.updateDescription(v),
                      maxLines: 3,
                      decoration: _inputDecoration(dark, 'Describe the assignment...'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Section/Subject
                  _FormField(
                    label: 'Section / Subject',
                    child: DropdownButtonFormField<SectionSubject>(
                      initialValue: state.selectedSectionSubject,
                      decoration: _inputDecoration(dark, 'Select section/subject'),
                      items: state.sectionSubjects.map((s) {
                        return DropdownMenuItem(
                          value: s,
                          child: Text(
                            '${s.subjectCode} - ${s.sectionCode}',
                            style: _textStyle(dark),
                          ),
                        );
                      }).toList(),
                      onChanged: (v) => _cubit.updateSelectedSectionSubject(v),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Marks
                  _FormField(
                    label: 'Marks Available',
                    child: TextField(
                      controller: _marksController,
                      keyboardType: TextInputType.number,
                      onChanged: (v) {
                        final marks = int.tryParse(v) ?? 0;
                        _cubit.updateMarksAvailable(marks);
                      },
                      decoration: _inputDecoration(dark, '100'),
                      style: _textStyle(dark),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Due Date
                  _FormField(
                    label: 'Due Date',
                    child: InkWell(
                      onTap: () async {
                        final date = await showDatePicker(
                          context: context,
                          initialDate: DateTime.now().add(const Duration(days: 7)),
                          firstDate: DateTime.now(),
                          lastDate: DateTime.now().add(const Duration(days: 365)),
                        );
                        if (date != null) {
                          final time = await showTimePicker(
                            context: context,
                            initialTime: const TimeOfDay(hour: 23, minute: 59),
                          );
                          final dueAt = DateTime(
                            date.year,
                            date.month,
                            date.day,
                            time?.hour ?? 23,
                            time?.minute ?? 59,
                          );
                          _cubit.updateDueAt(dueAt.toIso8601String());
                        }
                      },
                      child: InputDecorator(
                        decoration: _inputDecoration(dark, 'Select due date'),
                        child: Text(
                          state.dueAt.isNotEmpty
                              ? _formatDate(state.dueAt)
                              : 'Tap to select',
                          style: _textStyle(dark),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Late Policy
                  _FormField(
                    label: 'Late Submission Policy',
                    child: DropdownButtonFormField<String>(
                      initialValue: state.latePolicy,
                      decoration: _inputDecoration(dark, 'Select policy'),
                      items: const [
                        DropdownMenuItem(value: 'FLAG_ONLY', child: Text('Flag Only')),
                        DropdownMenuItem(value: 'DEDUCTION', child: Text('Point Deduction')),
                        DropdownMenuItem(value: 'REJECT', child: Text('Reject Late')),
                      ],
                      onChanged: (v) {
                        if (v != null) _cubit.updateLatePolicy(v);
                      },
                    ),
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

  String _formatDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateStr;
    }
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
