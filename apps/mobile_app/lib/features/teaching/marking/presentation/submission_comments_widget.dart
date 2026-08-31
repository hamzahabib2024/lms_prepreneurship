import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../data/marking_repository.dart';
import '../data/models/marking_models.dart';

class SubmissionCommentsWidget extends StatefulWidget {
  const SubmissionCommentsWidget({
    super.key,
    required this.submissionId,
    this.fileId,
    this.filename,
  });

  final String submissionId;
  final String? fileId;
  final String? filename;

  @override
  State<SubmissionCommentsWidget> createState() =>
      _SubmissionCommentsWidgetState();
}

class _SubmissionCommentsWidgetState extends State<SubmissionCommentsWidget> {
  late final MarkingRepository _repo;
  List<SubmissionComment> _comments = [];
  bool _loading = true;
  String? _error;
  final _draftController = TextEditingController();
  String? _editingId;
  bool _posting = false;

  @override
  void initState() {
    super.initState();
    _repo = context.read<MarkingRepository>();
    _loadComments();
  }

  @override
  void dispose() {
    _draftController.dispose();
    super.dispose();
  }

  Future<void> _loadComments() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final comments = await _repo.getSubmissionComments(
        submissionId: widget.submissionId,
        fileId: widget.fileId,
      );
      if (mounted) setState(() => _comments = comments);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _postComment() async {
    final text = _draftController.text.trim();
    if (text.isEmpty) return;

    setState(() => _posting = true);
    try {
      final comment = await _repo.postComment(
        submissionId: widget.submissionId,
        body: text,
        fileId: widget.fileId,
      );
      _draftController.clear();
      if (mounted) setState(() => _comments = [..._comments, comment]);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to post comment: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _editComment(SubmissionComment comment) async {
    final text = _draftController.text.trim();
    if (text.isEmpty) return;

    setState(() => _posting = true);
    try {
      final updated = await _repo.editComment(
        submissionId: widget.submissionId,
        commentId: comment.id,
        body: text,
      );
      _draftController.clear();
      if (mounted) {
        setState(() {
          _editingId = null;
          _comments = _comments.map((c) => c.id == comment.id ? updated : c).toList();
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to edit comment: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _withdrawComment(SubmissionComment comment) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Withdraw Comment'),
        content: const Text('This comment will be marked as withdrawn.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await _repo.withdrawComment(
        submissionId: widget.submissionId,
        commentId: comment.id,
      );
      if (mounted) {
        setState(() {
          _comments = _comments.where((c) => c.id != comment.id).toList();
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to withdraw comment: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;

    return Container(
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.chat_bubble_outline,
                size: 16,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
              const SizedBox(width: 6),
              Text(
                'Comments',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (widget.filename != null) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        .withAlpha(25),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    widget.filename!,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),

          if (_loading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: CircularProgressIndicator(),
              ),
            )
          else if (_error != null)
            Center(
              child: Column(
                children: [
                  Text(
                    _error!,
                    style: TextStyle(color: AppColors.error),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _loadComments,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          else ...[
            if (_comments.isEmpty)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'No comments yet',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                  ),
                ),
              )
            else
              ...(_comments.map((c) => _buildComment(c, dark))),

            const SizedBox(height: 10),

            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: _draftController,
                    maxLines: null,
                    minLines: 2,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                    ),
                    decoration: InputDecoration(
                      hintText: _editingId != null ? 'Edit comment...' : 'Add a comment...',
                      hintStyle: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(6),
                        borderSide: BorderSide(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(6),
                        borderSide: BorderSide(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(6),
                        borderSide: BorderSide(
                          color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                        ),
                      ),
                      filled: true,
                      fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      height: 36,
                      child: ElevatedButton(
                        onPressed: _posting
                            ? null
                            : (_editingId != null
                                ? () {
                                    final comment = _comments.firstWhere(
                                      (c) => c.id == _editingId,
                                    );
                                    _editComment(comment);
                                  }
                                : _postComment),
                        style: ElevatedButton.styleFrom(
                          backgroundColor:
                              dark ? AppColorsDark.brand600 : AppColors.brand600,
                          foregroundColor: dark ? AppColorsDark.navy : Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                        child: _posting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Icon(
                                _editingId != null ? Icons.check : Icons.send,
                                size: 16,
                              ),
                      ),
                    ),
                    if (_editingId != null) ...[
                      const SizedBox(height: 4),
                      SizedBox(
                        height: 28,
                        child: TextButton(
                          onPressed: () {
                            setState(() => _editingId = null);
                            _draftController.clear();
                          },
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.zero,
                          ),
                          child: Text(
                            'Cancel',
                            style: TextStyle(
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildComment(SubmissionComment comment, bool dark) {
    final theme = Theme.of(context);
    final canEdit = comment.isMine;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                comment.authorRole == 'TEACHER'
                    ? Icons.school
                    : Icons.person,
                size: 12,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
              const SizedBox(width: 4),
              Text(
                comment.authorName,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: (comment.authorRole == 'TEACHER'
                          ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                          : AppColors.muted)
                      .withAlpha(25),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: Text(
                  comment.authorRole,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: comment.authorRole == 'TEACHER'
                        ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        : (dark ? AppColorsDark.muted : AppColors.muted),
                    fontSize: 9,
                  ),
                ),
              ),
              const Spacer(),
              if (comment.editedAt != null)
                Text(
                  'edited',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontStyle: FontStyle.italic,
                    fontSize: 10,
                  ),
                ),
              if (canEdit)
                PopupMenuButton<String>(
                  padding: EdgeInsets.zero,
                  itemBuilder: (ctx) => [
                    const PopupMenuItem(
                      value: 'edit',
                      child: Row(
                        children: [
                          Icon(Icons.edit, size: 14),
                          SizedBox(width: 6),
                          Text('Edit'),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'withdraw',
                      child: Row(
                        children: [
                          Icon(Icons.delete_outline, size: 14),
                          SizedBox(width: 6),
                          Text('Withdraw'),
                        ],
                      ),
                    ),
                  ],
                  onSelected: (action) {
                    if (action == 'edit') {
                      setState(() => _editingId = comment.id);
                      _draftController.text = comment.body;
                    } else if (action == 'withdraw') {
                      _withdrawComment(comment);
                    }
                  },
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            comment.body,
            style: theme.textTheme.bodySmall?.copyWith(
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            _formatTimeAgo(comment.createdAt),
            style: theme.textTheme.labelSmall?.copyWith(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTimeAgo(String isoDate) {
    try {
      final date = DateTime.parse(isoDate);
      final diff = DateTime.now().difference(date);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${date.day}/${date.month}/${date.year}';
    } catch (_) {
      return isoDate;
    }
  }
}
