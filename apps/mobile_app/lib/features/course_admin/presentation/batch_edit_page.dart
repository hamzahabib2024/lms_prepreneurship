import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../data/course_admin_repository.dart';
import '../data/models/course_admin_models.dart';

class BatchEditPage extends StatefulWidget {
  const BatchEditPage({
    super.key,
    required this.api,
    this.programmeId,
  });

  final ApiClient api;
  final String? programmeId;

  @override
  State<BatchEditPage> createState() => _BatchEditPageState();
}

class _BatchEditPageState extends State<BatchEditPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _capacityCtrl;
  late final TextEditingController _channelUrlCtrl;
  late final TextEditingController _groupUrlCtrl;

  String? _selectedProgrammeId;
  String _shift = 'MORNING';
  String _genderRestriction = 'MIXED';
  String _deliveryMode = 'ON_CAMPUS';
  List<String> _selectedSubjectIds = [];
  String? _selectedTeacherId;

  List<Programme> _programmes = [];
  List<Subject> _allSubjects = [];
  List<Subject> _courseSubjects = [];
  List<Teacher> _teachers = [];
  bool _busy = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController();
    _capacityCtrl = TextEditingController(text: '30');
    _channelUrlCtrl = TextEditingController();
    _groupUrlCtrl = TextEditingController();
    _selectedProgrammeId = widget.programmeId;
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final repo = CourseAdminRepository(widget.api);
      final results = await Future.wait([
        repo.getCourseTree(),
        repo.getSubjects(),
        repo.getTeachers(),
      ]);

      final programmes = results[0] as List<Programme>;
      final subjects = results[1] as List<Subject>;
      final teachers = results[2] as List<Teacher>;

      List<Subject> courseSubjects = [];
      if (_selectedProgrammeId != null) {
        final match = programmes.where((p) => p.id == _selectedProgrammeId);
        if (match.isNotEmpty) {
          courseSubjects = subjects
              .where((s) => match.first.subjects.any((ps) => ps.id == s.id))
              .toList();
        }
      }

      setState(() {
        _programmes = programmes;
        _allSubjects = subjects;
        _teachers = teachers;
        _courseSubjects = courseSubjects;
        _selectedSubjectIds = courseSubjects.map((s) => s.id).toList();
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _capacityCtrl.dispose();
    _channelUrlCtrl.dispose();
    _groupUrlCtrl.dispose();
    super.dispose();
  }

  void _onProgrammeChanged(String? id) {
    setState(() {
      _selectedProgrammeId = id;
      final match = _programmes.where((p) => p.id == id);
      if (match.isNotEmpty) {
        _courseSubjects = _allSubjects
            .where((s) => match.first.subjects.any((ps) => ps.id == s.id))
            .toList();
        _selectedSubjectIds = _courseSubjects.map((s) => s.id).toList();
      } else {
        _courseSubjects = [];
        _selectedSubjectIds = [];
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedProgrammeId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a course')),
      );
      return;
    }
    if (_selectedSubjectIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one subject')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      await CourseAdminRepository(widget.api).createBatch(
        programmeId: _selectedProgrammeId!,
        name: _nameCtrl.text.trim(),
        capacity: int.tryParse(_capacityCtrl.text.trim()) ?? 30,
        genderRestriction: _genderRestriction,
        shift: _shift,
        deliveryMode: _deliveryMode,
        subjectIds: _selectedSubjectIds,
        teacherId: _selectedTeacherId,
        whatsappChannelUrl: _channelUrlCtrl.text.trim().isEmpty
            ? null
            : _channelUrlCtrl.text.trim(),
        whatsappGroupUrl: _groupUrlCtrl.text.trim().isEmpty
            ? null
            : _groupUrlCtrl.text.trim(),
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('New Batch')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('New Batch'),
        actions: [
          if (_busy)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            TextButton(
              onPressed: _save,
              child: const Text('Create'),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Which course
              _SectionHeader(title: 'Which course', dark: dark),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _selectedProgrammeId,
                decoration: InputDecoration(
                  hintText: 'Select course',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                items: _programmes
                    .map((p) => DropdownMenuItem(
                          value: p.id,
                          child: Text(p.name),
                        ))
                    .toList(),
                onChanged: _onProgrammeChanged,
              ),

              const SizedBox(height: 24),

              // Who is in it
              _SectionHeader(title: 'Who is in it', dark: dark),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nameCtrl,
                decoration: InputDecoration(
                  hintText: 'Batch name (e.g. "Section A", "Morning Batch")',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                validator: (v) =>
                    (v == null || v.trim().length < 2) ? 'Min 2 characters' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _capacityCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  hintText: 'Capacity',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                validator: (v) {
                  final n = int.tryParse(v ?? '');
                  return (n == null || n < 1) ? 'Enter a valid number' : null;
                },
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _DropdownField(
                      label: 'Shift',
                      value: _shift,
                      items: const ['MORNING', 'EVENING', 'WEEKEND'],
                      dark: dark,
                      onChanged: (v) => setState(() => _shift = v!),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _DropdownField(
                      label: 'Gender',
                      value: _genderRestriction,
                      items: const ['MIXED', 'FEMALE', 'MALE'],
                      dark: dark,
                      onChanged: (v) => setState(() => _genderRestriction = v!),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _DropdownField(
                label: 'Delivery mode',
                value: _deliveryMode,
                items: const ['ON_CAMPUS', 'ONLINE', 'HYBRID'],
                dark: dark,
                onChanged: (v) => setState(() => _deliveryMode = v!),
              ),

              const SizedBox(height: 24),

              // What it teaches
              _SectionHeader(title: 'What it teaches', dark: dark),
              const SizedBox(height: 8),
              if (_courseSubjects.isEmpty)
                Text(
                  'Select a course above to see its subjects',
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 13,
                  ),
                )
              else
                ..._courseSubjects.map((s) => CheckboxListTile(
                      value: _selectedSubjectIds.contains(s.id),
                      onChanged: (v) {
                        setState(() {
                          if (v == true) {
                            _selectedSubjectIds.add(s.id);
                          } else {
                            _selectedSubjectIds.remove(s.id);
                          }
                        });
                      },
                      title: Text(s.name),
                      subtitle: Text(s.code),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    )),

              const SizedBox(height: 24),

              // Who teaches it
              _SectionHeader(title: 'Who teaches it', dark: dark),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _selectedTeacherId,
                decoration: InputDecoration(
                  hintText: 'Select teacher (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                items: _teachers
                    .map((t) => DropdownMenuItem(
                          value: t.id,
                          child: Text(
                            '${t.name} (${t.currentSections} sections, ${t.currentStudents} students)',
                          ),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _selectedTeacherId = v),
              ),

              const SizedBox(height: 24),

              // Where the class talks
              _SectionHeader(title: 'Where the class talks', dark: dark),
              const SizedBox(height: 12),
              TextFormField(
                controller: _channelUrlCtrl,
                decoration: InputDecoration(
                  hintText: 'WhatsApp channel URL (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _groupUrlCtrl,
                decoration: InputDecoration(
                  hintText: 'WhatsApp group URL (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.dark});
  final String title;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: dark ? AppColorsDark.ink : AppColors.ink,
        fontWeight: FontWeight.w600,
        fontSize: 16,
      ),
    );
  }
}

class _DropdownField extends StatelessWidget {
  const _DropdownField({
    required this.label,
    required this.value,
    required this.items,
    required this.dark,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<String> items;
  final bool dark;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 4),
        DropdownButtonFormField<String>(
          initialValue: value,
          decoration: InputDecoration(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 10,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
          ),
          items: items
              .map((e) => DropdownMenuItem(value: e, child: Text(e)))
              .toList(),
          onChanged: onChanged,
        ),
      ],
    );
  }
}
