import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../data/course_admin_repository.dart';

class SubjectEditPage extends StatefulWidget {
  const SubjectEditPage({super.key, required this.api, this.subjectId});
  final ApiClient api;
  final String? subjectId;

  bool get isEditing => subjectId != null;

  @override
  State<SubjectEditPage> createState() => _SubjectEditPageState();
}

class _SubjectEditPageState extends State<SubjectEditPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _codeCtrl;
  late final TextEditingController _descCtrl;
  late final TextEditingController _creditsCtrl;
  bool _isActive = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController();
    _codeCtrl = TextEditingController();
    _descCtrl = TextEditingController();
    _creditsCtrl = TextEditingController();

    if (widget.isEditing) {
      _loadSubject();
    }
  }

  Future<void> _loadSubject() async {
    try {
      final list = await CourseAdminRepository(widget.api).getSubjects();
      final s = list.where((s) => s.id == widget.subjectId).firstOrNull;
      if (s != null) {
        setState(() {
          _nameCtrl.text = s.name;
          _codeCtrl.text = s.code;
          _descCtrl.text = s.description ?? '';
          _creditsCtrl.text = s.credits?.toString() ?? '';
          _isActive = s.isActive;
        });
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _codeCtrl.dispose();
    _descCtrl.dispose();
    _creditsCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);

    try {
      final repo = CourseAdminRepository(widget.api);
      if (widget.isEditing) {
        await repo.updateSubject(
          id: widget.subjectId!,
          name: _nameCtrl.text.trim(),
          description: _descCtrl.text.trim().isEmpty
              ? null
              : _descCtrl.text.trim(),
          credits: _creditsCtrl.text.trim().isEmpty
              ? null
              : int.tryParse(_creditsCtrl.text.trim()),
          isActive: _isActive,
        );
      } else {
        await repo.createSubject(
          name: _nameCtrl.text.trim(),
          code: _codeCtrl.text.trim().toUpperCase(),
          description: _descCtrl.text.trim().isEmpty
              ? null
              : _descCtrl.text.trim(),
          credits: _creditsCtrl.text.trim().isEmpty
              ? null
              : int.tryParse(_creditsCtrl.text.trim()),
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
        title: Text(widget.isEditing ? 'Edit Subject' : 'New Subject'),
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
              _SectionHeader(title: 'What it is called', dark: dark),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nameCtrl,
                decoration: InputDecoration(
                  hintText: 'Subject name',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                validator: (v) =>
                    (v == null || v.trim().length < 2) ? 'Min 2 characters' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _codeCtrl,
                enabled: !widget.isEditing,
                decoration: InputDecoration(
                  hintText: 'Code (e.g. MATH101)',
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
                controller: _creditsCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  hintText: 'Credits (optional, 1-20)',
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
