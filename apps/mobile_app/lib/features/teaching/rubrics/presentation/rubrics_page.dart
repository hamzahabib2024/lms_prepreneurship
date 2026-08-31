/// Rubrics page — SRS §13.6, FR-TCH-021.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/rubrics_cubit.dart';
import '../data/rubrics_repository.dart';
import '../data/models/rubric_models.dart';

class RubricsPage extends StatefulWidget {
  const RubricsPage({super.key});

  @override
  State<RubricsPage> createState() => _RubricsPageState();
}

class _RubricsPageState extends State<RubricsPage> {
  late final RubricsCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = RubricsCubit(context.read<RubricsRepository>())..loadRubrics();
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
          title: const Text('Rubrics'),
          actions: [
            IconButton(
              icon: const Icon(Icons.add),
              onPressed: () => _showCreateDialog(context),
            ),
          ],
        ),
        body: BlocConsumer<RubricsCubit, RubricsState>(
          listener: (context, state) {
            if (state.status == RubricsStatus.failure && state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == RubricsStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final rubrics = state.rubrics;
            if (rubrics.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.rule_outlined,
                      size: 64,
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No rubrics yet',
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Create a rubric to use for grading',
                      style: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              );
            }

            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: rubrics.length,
              itemBuilder: (context, index) {
                final rubric = rubrics[index];
                return _RubricTile(
                  rubric: rubric,
                  dark: dark,
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => RepositoryProvider.value(
                          value: context.read<RubricsRepository>(),
                          child: RubricDetailPage(rubricId: rubric.id),
                        ),
                      ),
                    );
                  },
                  onDelete: () {
                    _cubit.deleteRubric(rubric.id);
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }

  void _showCreateDialog(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => RepositoryProvider.value(
        value: context.read<RubricsRepository>(),
        child: BlocProvider.value(
          value: _cubit,
          child: const CreateRubricSheet(),
        ),
      ),
    );
  }
}

// ── Rubric Tile ──

class _RubricTile extends StatelessWidget {
  const _RubricTile({
    required this.rubric,
    required this.dark,
    required this.onTap,
    required this.onDelete,
  });

  final Rubric rubric;
  final bool dark;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final count = rubric.criteriaCount > 0 ? rubric.criteriaCount : rubric.criteria.length;
    final marks = rubric.totalMarks > 0 ? rubric.totalMarks : rubric.criteria.fold<num>(0, (s, c) => s + c.weight);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: dark ? AppColorsDark.brand050 : AppColors.brand050,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Icon(
            Icons.rule,
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
          ),
        ),
        title: Text(
          rubric.title,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$count ${count == 1 ? 'criterion' : 'criteria'} • $marks marks'
              '${rubric.usedByAssignments > 0 ? ' • used by ${rubric.usedByAssignments} ${rubric.usedByAssignments == 1 ? 'assignment' : 'assignments'}' : ''}',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            if (rubric.description != null && rubric.description!.isNotEmpty)
              Text(
                rubric.description!,
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 11,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (rubric.isShared)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  'Shared',
                  style: TextStyle(
                    color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'delete') onDelete();
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
          ],
        ),
        onTap: onTap,
      ),
    );
  }
}

// ── Create Rubric Sheet ──

class CreateRubricSheet extends StatefulWidget {
  const CreateRubricSheet({super.key});

  @override
  State<CreateRubricSheet> createState() => _CreateRubricSheetState();
}

class _CreateRubricSheetState extends State<CreateRubricSheet> {
  late final TextEditingController _titleController;
  String _type = 'CUSTOM';
  final List<_CriterionEntry> _criteria = [];

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController();
    _addCriterion();
  }

  @override
  void dispose() {
    _titleController.dispose();
    for (final entry in _criteria) {
      entry.descriptionController.dispose();
      for (final level in entry.levels) {
        level.labelController.dispose();
        level.descriptionController.dispose();
        level.marksController.dispose();
      }
    }
    super.dispose();
  }

  void _addCriterion() {
    final entry = _CriterionEntry();
    entry.levels.add(_LevelEntry());
    _criteria.add(entry);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
        left: 16,
        right: 16,
        top: 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Create Rubric',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleController,
              decoration: InputDecoration(
                labelText: 'Title',
                labelStyle: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
                filled: true,
                fillColor: dark ? AppColorsDark.surface : AppColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: InputDecoration(
                labelText: 'Type',
                labelStyle: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
                filled: true,
                fillColor: dark ? AppColorsDark.surface : AppColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              items: const [
                DropdownMenuItem(value: 'CUSTOM', child: Text('Custom')),
                DropdownMenuItem(value: 'ANALYTIC', child: Text('Analytic')),
                DropdownMenuItem(value: 'HOLISTIC', child: Text('Holistic')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _type = v);
              },
            ),
            const SizedBox(height: 16),
            Text(
              'Criteria',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            ...List.generate(_criteria.length, (i) {
              return _CriterionCard(
                index: i,
                entry: _criteria[i],
                dark: dark,
                onRemove: () {
                  setState(() => _criteria.removeAt(i));
                },
                onAddLevel: () {
                  setState(() => _criteria[i].levels.add(_LevelEntry()));
                },
                onRemoveLevel: (li) {
                  setState(() => _criteria[i].levels.removeAt(li));
                },
              );
            }),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _addCriterion,
              icon: const Icon(Icons.add),
              label: const Text('Add Criterion'),
            ),
            const SizedBox(height: 12),
            // Running total
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Row(
                children: [
                  Text(
                    'Total marks: ',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    '${_criteria.fold<num>(0, (s, c) => s + (num.tryParse(c.weightController.text) ?? 0))}',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _submit,
                    child: const Text('Create'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  void _submit() {
    if (_titleController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a title')),
      );
      return;
    }
    if (_criteria.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one criterion')),
      );
      return;
    }

    final criteria = _criteria.map((e) {
      return RubricCriterion(
        id: '',
        description: e.descriptionController.text,
        weight: num.tryParse(e.weightController.text) ?? 0,
        levels: e.levels.map((l) {
          return RubricLevel(
            id: '',
            label: l.labelController.text,
            description: l.descriptionController.text,
            marks: num.tryParse(l.marksController.text) ?? 0,
          );
        }).toList(),
      );
    }).toList();

    context.read<RubricsCubit>().createRubric(
          title: _titleController.text,
          type: _type,
          criteria: criteria,
        );
    Navigator.of(context).pop();
  }
}

// ── Criterion Entry ──

class _CriterionEntry {
  final descriptionController = TextEditingController();
  final weightController = TextEditingController(text: '1');
  final levels = <_LevelEntry>[];
}

// ── Level Entry ──

class _LevelEntry {
  final labelController = TextEditingController();
  final descriptionController = TextEditingController();
  final marksController = TextEditingController();
}

// ── Criterion Card ──

class _CriterionCard extends StatelessWidget {
  const _CriterionCard({
    required this.index,
    required this.entry,
    required this.dark,
    required this.onRemove,
    required this.onAddLevel,
    required this.onRemoveLevel,
  });

  final int index;
  final _CriterionEntry entry;
  final bool dark;
  final VoidCallback onRemove;
  final VoidCallback onAddLevel;
  final ValueChanged<int> onRemoveLevel;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Criterion ${index + 1}',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: onRemove,
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: entry.descriptionController,
              decoration: InputDecoration(
                labelText: 'Description',
                labelStyle: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
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
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: entry.weightController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Weight',
                labelStyle: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
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
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Levels',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 8),
            ...List.generate(entry.levels.length, (li) {
              final level = entry.levels[li];
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: level.labelController,
                        decoration: InputDecoration(
                          labelText: 'Label',
                          labelStyle: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                            fontSize: 12,
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
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: level.descriptionController,
                        decoration: InputDecoration(
                          labelText: 'Description',
                          labelStyle: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                            fontSize: 12,
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
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 50,
                      child: TextField(
                        controller: level.marksController,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: 'Marks',
                          labelStyle: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                            fontSize: 12,
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
                    if (entry.levels.length > 1)
                      IconButton(
                        icon: const Icon(Icons.close, size: 16),
                        onPressed: () => onRemoveLevel(li),
                      ),
                  ],
                ),
              );
            }),
            OutlinedButton.icon(
              onPressed: onAddLevel,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add Level', style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Rubric Detail Page ──

class RubricDetailPage extends StatefulWidget {
  const RubricDetailPage({super.key, required this.rubricId});
  final String rubricId;

  @override
  State<RubricDetailPage> createState() => _RubricDetailPageState();
}

class _RubricDetailPageState extends State<RubricDetailPage> {
  late final RubricsCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = RubricsCubit(context.read<RubricsRepository>())
      ..loadRubric(widget.rubricId);
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
          title: const Text('Rubric Detail'),
        ),
        body: BlocBuilder<RubricsCubit, RubricsState>(
          builder: (context, state) {
            if (state.status == RubricsStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final rubric = state.selectedRubric;
            if (rubric == null) {
              return const Center(child: Text('Rubric not found'));
            }

            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rubric.title,
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.w600,
                      fontSize: 20,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${rubric.criteria.length} criteria • ${rubric.type}',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...rubric.criteria.map((criterion) {
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
                                Expanded(
                                  child: Text(
                                    criterion.description,
                                    style: TextStyle(
                                      color: dark ? AppColorsDark.ink : AppColors.ink,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: dark
                                        ? AppColorsDark.brand050
                                        : AppColors.brand050,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Weight: ${criterion.weight}',
                                    style: TextStyle(
                                      color: dark
                                          ? AppColorsDark.brand600
                                          : AppColors.brand600,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            ...criterion.levels.map((level) {
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 4),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 60,
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: AppColors.okBg,
                                        borderRadius: BorderRadius.circular(3),
                                      ),
                                      child: Text(
                                        '${level.marks}',
                                        style: const TextStyle(
                                          color: AppColors.ok,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                        textAlign: TextAlign.center,
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            level.label,
                                            style: TextStyle(
                                              color: dark
                                                  ? AppColorsDark.ink
                                                  : AppColors.ink,
                                              fontWeight: FontWeight.w500,
                                              fontSize: 13,
                                            ),
                                          ),
                                          if (level.description.isNotEmpty)
                                            Text(
                                              level.description,
                                              style: TextStyle(
                                                color: dark
                                                    ? AppColorsDark.muted
                                                    : AppColors.muted,
                                                fontSize: 12,
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
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
}
