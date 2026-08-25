import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../data/course_admin_repository.dart';
import '../data/models/course_admin_models.dart';

class CourseEditPage extends StatefulWidget {
  const CourseEditPage({super.key, required this.api, this.programmeId});
  final ApiClient api;
  final String? programmeId;

  bool get isEditing => programmeId != null;

  @override
  State<CourseEditPage> createState() => _CourseEditPageState();
}

class _CourseEditPageState extends State<CourseEditPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _codeCtrl;
  late final TextEditingController _descCtrl;
  late final TextEditingController _weeksCtrl;
  bool _isActive = true;
  bool _busy = false;
  Programme? _programme;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController();
    _codeCtrl = TextEditingController();
    _descCtrl = TextEditingController();
    _weeksCtrl = TextEditingController();

    if (widget.isEditing) {
      _loadProgramme();
    }
  }

  Future<void> _loadProgramme() async {
    try {
      final list = await CourseAdminRepository(widget.api)
          .getCourseTree(programmeId: widget.programmeId);
      if (list.isNotEmpty) {
        final p = list.first;
        setState(() {
          _programme = p;
          _nameCtrl.text = p.name;
          _codeCtrl.text = p.code;
          _descCtrl.text = p.description ?? '';
          _weeksCtrl.text = p.durationWeeks?.toString() ?? '';
          _isActive = p.isActive;
        });
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _codeCtrl.dispose();
    _descCtrl.dispose();
    _weeksCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);

    try {
      final repo = CourseAdminRepository(widget.api);
      if (widget.isEditing) {
        await repo.updateProgramme(
          id: widget.programmeId!,
          name: _nameCtrl.text.trim(),
          description: _descCtrl.text.trim().isEmpty
              ? null
              : _descCtrl.text.trim(),
          durationWeeks: _weeksCtrl.text.trim().isEmpty
              ? null
              : int.tryParse(_weeksCtrl.text.trim()),
          isActive: _isActive,
        );
      } else {
        await repo.createProgramme(
          name: _nameCtrl.text.trim(),
          code: _codeCtrl.text.trim().toUpperCase(),
          description: _descCtrl.text.trim().isEmpty
              ? null
              : _descCtrl.text.trim(),
          durationWeeks: _weeksCtrl.text.trim().isEmpty
              ? null
              : int.tryParse(_weeksCtrl.text.trim()),
        );
      }
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

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEditing ? 'Edit Course' : 'New Course'),
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
              child: const Text('Save'),
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
              // What it is called
              _SectionHeader(title: 'What it is called', dark: dark),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nameCtrl,
                decoration: InputDecoration(
                  hintText: 'Course name',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                validator: (v) =>
                    (v == null || v.trim().length < 3) ? 'Min 3 characters' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _codeCtrl,
                enabled: !widget.isEditing,
                decoration: InputDecoration(
                  hintText: 'Code (e.g. CS, ENG)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                validator: (v) =>
                    (v == null || v.trim().length < 2) ? 'Min 2 characters' : null,
              ),
              if (widget.isEditing)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Code cannot be changed after creation',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                      fontSize: 11,
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _descCtrl,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'Description (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _weeksCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  hintText: 'Duration in weeks (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
              ),

              if (widget.isEditing) ...[
                const SizedBox(height: 16),
                SwitchListTile(
                  title: const Text('Active'),
                  value: _isActive,
                  onChanged: (v) => setState(() => _isActive = v),
                  contentPadding: EdgeInsets.zero,
                ),
              ],

              // Subjects
              if (_programme != null && _programme!.subjects.isNotEmpty) ...[
                const SizedBox(height: 24),
                _SectionHeader(title: 'Syllabus', dark: dark),
                const SizedBox(height: 8),
                ..._programme!.subjects.map((s) => ListTile(
                      dense: true,
                      leading: Icon(Icons.check_circle, color: AppColors.ok),
                      title: Text(s.name),
                      subtitle: Text('${s.batches} batches teach this'),
                      contentPadding: EdgeInsets.zero,
                    )),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ── Section header ──

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
        fontWeight: FontWeight.bold,
        fontSize: 16,
      ),
    );
  }
}
