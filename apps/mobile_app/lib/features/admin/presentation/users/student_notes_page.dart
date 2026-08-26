import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/models/student_notes.dart';
import '../data/student_notes_repository.dart';

/// Staff-only page for managing pastoral/internal notes about a student.
class StudentNotesPage extends StatelessWidget {
  const StudentNotesPage({
    super.key,
    required this.api,
    required this.studentId,
    required this.studentName,
  });

  final ApiClient api;
  final String studentId;
  final String studentName;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => StudentNotesCubit(
        StudentNotesRepository(api),
        studentId: studentId,
      )..load(),
      child: _StudentNotesView(studentName: studentName),
    );
  }
}

class _StudentNotesView extends StatefulWidget {
  const _StudentNotesView({required this.studentName});
  final String studentName;

  @override
  State<_StudentNotesView> createState() => _StudentNotesViewState();
}

class _StudentNotesViewState extends State<_StudentNotesView> {
  final _addController = TextEditingController();
  bool _composerExpanded = false;

  @override
  void dispose() {
    _addController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.studentName} — Notes'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocConsumer<StudentNotesCubit, StudentNotesState>(
        listener: (context, state) {
          if (state.error != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.error!.message)),
            );
            context.read<StudentNotesCubit>().copyWith(clearError: true);
          }
        },
        builder: (context, state) {
          return Column(
            children: [
              // Add note composer
              Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.surface : AppColors.surface,
                  border: Border(
                    bottom: BorderSide(
                      color: dark ? AppColorsDark.line : AppColors.line,
                    ),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!_composerExpanded)
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              setState(() => _composerExpanded = true),
                          icon: const Icon(Icons.add, size: 18),
                          label: const Text('Add a note'),
                        ),
                      )
                    else ...[
                      Text(
                        'New note (visible to staff only)',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: muted,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _addController,
                        maxLines: 3,
                        decoration: InputDecoration(
                          hintText: 'Pastoral observation, follow-up needed\u2026',
                          hintStyle: TextStyle(color: muted),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          FilledButton(
                            onPressed: _addController.text.trim().length >= 2
                                ? () {
                                    context.read<StudentNotesCubit>().addNote(
                                          body: _addController.text.trim(),
                                        );
                                    _addController.clear();
                                    setState(
                                        () => _composerExpanded = false);
                                  }
                                : null,
                            child: const Text('Save'),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton(
                            onPressed: () => setState(() {
                              _composerExpanded = false;
                              _addController.clear();
                            }),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              // Notes list
              Expanded(
                child: _buildBody(context, state, dark, muted),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    StudentNotesState state,
    bool dark,
    Color muted,
  ) {
    if (state.status == StudentNotesStatus.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.notes.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.notes_outlined, size: 48, color: muted),
              const SizedBox(height: 12),
              Text(
                'No notes yet',
                style: TextStyle(color: muted, fontSize: 14),
              ),
              const SizedBox(height: 4),
              Text(
                'Add a pastoral note about this student.',
                style: TextStyle(color: muted, fontSize: 12.5),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => context.read<StudentNotesCubit>().load(),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: state.notes.length,
        itemBuilder: (context, index) {
          final note = state.notes[index];
          return _NoteCard(note: note);
        },
      ),
    );
  }
}

class _NoteCard extends StatefulWidget {
  const _NoteCard({required this.note});
  final StudentNote note;

  @override
  State<_NoteCard> createState() => _NoteCardState();
}

class _NoteCardState extends State<_NoteCard> {
  bool _editing = false;
  late final TextEditingController _editController;

  @override
  void initState() {
    super.initState();
    _editController = TextEditingController(text: widget.note.body);
  }

  @override
  void dispose() {
    _editController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 12,
                backgroundColor: dark ? AppColorsDark.brand050 : AppColors.brand050,
                child: Text(
                  widget.note.authorName.isNotEmpty
                      ? widget.note.authorName[0].toUpperCase()
                      : '?',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.note.authorName,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      _formatDate(widget.note.createdAt),
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                  ],
                ),
              ),
              PopupMenuButton<String>(
                padding: EdgeInsets.zero,
                icon: Icon(Icons.more_vert, size: 18, color: muted),
                onSelected: (value) {
                  if (value == 'edit') {
                    setState(() => _editing = true);
                  } else if (value == 'delete') {
                    _confirmDelete(context);
                  }
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'edit', child: Text('Edit')),
                  const PopupMenuItem(
                    value: 'delete',
                    child: Text('Delete', style: TextStyle(color: AppColors.error)),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_editing)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _editController,
                  maxLines: null,
                  decoration: const InputDecoration(isDense: true),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    TextButton(
                      onPressed: () {
                        context.read<StudentNotesCubit>().updateNote(
                              noteId: widget.note.id,
                              body: _editController.text.trim(),
                            );
                        setState(() => _editing = false);
                      },
                      child: const Text('Save'),
                    ),
                    TextButton(
                      onPressed: () {
                        _editController.text = widget.note.body;
                        setState(() => _editing = false);
                      },
                      child: Text('Cancel', style: TextStyle(color: muted)),
                    ),
                  ],
                ),
              ],
            )
          else
            Text(
              widget.note.body,
              style: const TextStyle(fontSize: 14, height: 1.5),
            ),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete note?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              context.read<StudentNotesCubit>().deleteNote(
                    noteId: widget.note.id,
                  );
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    if (d.year == now.year && d.month == now.month && d.day == now.day) {
      return 'Today ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    }
    return '${d.day}/${d.month}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
