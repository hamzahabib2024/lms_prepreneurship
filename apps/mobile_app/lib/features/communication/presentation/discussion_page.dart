import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/discussion_cubit.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class DiscussionPage extends StatelessWidget {
  const DiscussionPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => DiscussionCubit(
        repository: CommunicationRepository(api: api),
      )..loadOfferings(),
      child: _DiscussionView(user: user),
    );
  }
}

class _DiscussionView extends StatelessWidget {
  const _DiscussionView({required this.user});

  final AuthUser user;

  bool get _isTeacher => user.isAdmin || user.isSuperAdmin || user.isTeacher;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<DiscussionCubit, DiscussionState>(
        builder: (context, state) {
          if (state.openThread != null) {
            return Column(
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () =>
                        context.read<DiscussionCubit>().closeThread(),
                    icon: const Icon(Icons.arrow_back, size: 18),
                    label: const Text('Back to discussions'),
                  ),
                ),
                Expanded(
                  child: _ThreadView(
                    thread: state.openThread!,
                    myUserId: user.id,
                    isTeacher: _isTeacher,
                    replyBusy: state.replyBusy,
                  ),
                ),
              ],
            );
          }

          return Column(
            children: [
              if (state.offerings.length > 1)
                _OfferingPicker(
                  offerings: state.offerings,
                  selectedId: state.selectedOfferingId,
                  onChanged: (id) =>
                      context.read<DiscussionCubit>().selectOffering(id),
                ),
              Expanded(child: _ThreadList(isTeacher: _isTeacher)),
            ],
          );
        },
      ),
    );
  }
}

class _OfferingPicker extends StatelessWidget {
  const _OfferingPicker({
    required this.offerings,
    required this.selectedId,
    required this.onChanged,
  });

  final List<Offering> offerings;
  final String? selectedId;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
        child: DropdownButtonFormField<String>(
          initialValue: selectedId,
          isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Which class',
          isDense: true,
        ),
        items: offerings
            .map((o) => DropdownMenuItem(value: o.id, child: Text(o.label)))
            .toList(),
        onChanged: (v) {
          if (v != null) onChanged(v);
        },
      ),
    );
  }
}

class _ThreadList extends StatelessWidget {
  const _ThreadList({required this.isTeacher});

  final bool isTeacher;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<DiscussionCubit, DiscussionState>(
      builder: (context, state) {
        switch (state.status) {
          case DiscussionStatus.loading:
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          case DiscussionStatus.failure:
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                AppAlert(
                  title: 'Could not load discussions',
                  message: state.error?.message ?? 'Something went wrong.',
                ),
              ],
            );
          case DiscussionStatus.loaded:
            return RefreshIndicator(
              onRefresh: () {
                final id = state.selectedOfferingId;
                if (id != null) {
                  return context.read<DiscussionCubit>().loadThreads(id);
                }
                return Future.value();
              },
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                children: [
                  _AskComposer(
                    onAsked: () {
                      final id = state.selectedOfferingId;
                      if (id != null) {
                        context.read<DiscussionCubit>().loadThreads(id);
                      }
                    },
                  ),
                  if (state.threads.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 40),
                      child: Column(
                        children: [
                          Icon(Icons.forum_outlined,
                              size: 48,
                              color: Theme.of(context).colorScheme.onSurfaceVariant),
                          const SizedBox(height: 16),
                          Text(
                            'No questions yet',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Asking one is how the rest of the class finds out they had the same problem.',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                              fontSize: 13.5,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    )
                  else
                    for (final t in state.threads)
                      _ThreadTile(
                        thread: t,
                        isTeacher: isTeacher,
                        onTap: () =>
                            context.read<DiscussionCubit>().openThread(t.id),
                      ),
                ],
              ),
            );
        }
      },
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({
    required this.thread,
    required this.isTeacher,
    required this.onTap,
  });

  final DiscussionPost thread;
  final bool isTeacher;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Avatar circle with initial
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  thread.removed
                      ? '?'
                      : (thread.author ?? '?').trim().isNotEmpty
                          ? (thread.author ?? '?').trim()[0].toUpperCase()
                          : '?',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: muted,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (thread.isPinned) ...[
                          const Icon(Icons.push_pin_outlined, size: 14),
                          const SizedBox(width: 4),
                        ],
                        Expanded(
                          child: Text(
                            thread.removed
                                ? 'Question removed'
                                : (thread.title ?? 'Untitled'),
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      thread.removed
                          ? '\u2014'
                          : '${thread.isAnonymous ? "Anonymous" : (thread.author ?? "Unknown")} \u00b7 ${_formatDate(thread.createdAt)}${thread.isLocked ? " \u00b7 Closed" : ""}${thread.resolvedAt != null ? " \u00b7 Answered" : ""}',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: thread.replyCount > 0
                      ? AppColors.brand050
                      : theme.colorScheme.surfaceContainerHighest,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  thread.replyCount > 0 ? '${thread.replyCount}' : '\u2014',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: thread.replyCount > 0
                        ? AppColors.brand600
                        : muted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    if (d.year == now.year && d.month == now.month && d.day == now.day) {
      return 'Today';
    }
    return '${d.day} ${_month(d.month)}';
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _month(int m) => _months[m - 1];
}

class _AskComposer extends StatefulWidget {
  const _AskComposer({required this.onAsked});

  final VoidCallback onAsked;

  @override
  State<_AskComposer> createState() => _AskComposerState();
}

class _AskComposerState extends State<_AskComposer> {
  bool _expanded = false;
  String _title = '';
  String _body = '';
  bool _isAnonymous = false;

  @override
  Widget build(BuildContext context) {
    if (!_expanded) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: () => setState(() => _expanded = true),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Ask a question'),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            decoration: const InputDecoration(
              labelText: 'Question',
              hintText: 'How do I export at 300dpi?',
            ),
            onChanged: (v) => _title = v,
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(
              labelText: 'Details',
              hintText: 'What you have tried, and what happened.',
            ),
            maxLines: 3,
            onChanged: (v) => _body = v,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(Icons.visibility_off_outlined,
                  size: 16,
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                'Hide my name',
                style: TextStyle(
                  fontSize: 12.5,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const Spacer(),
              Switch(
                value: _isAnonymous,
                onChanged: (v) => setState(() => _isAnonymous = v),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              FilledButton(
                onPressed: (_body.trim().length >= 2)
                    ? () async {
                        await context.read<DiscussionCubit>().createDiscussion(
                              title: _title.trim(),
                              body: _body.trim(),
                              isAnonymous: _isAnonymous,
                            );
                        if (!mounted) return;
                        setState(() {
                          _expanded = false;
                          _title = '';
                          _body = '';
                          _isAnonymous = false;
                        });
                        widget.onAsked();
                      }
                    : null,
                child: const Text('Post'),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: () => setState(() => _expanded = false),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// --------------------------------------------------------------- Thread view --

class _ThreadView extends StatefulWidget {
  const _ThreadView({
    required this.thread,
    required this.myUserId,
    required this.isTeacher,
    required this.replyBusy,
  });

  final DiscussionThread thread;
  final String myUserId;
  final bool isTeacher;
  final bool replyBusy;

  @override
  State<_ThreadView> createState() => _ThreadViewState();
}

class _ThreadViewState extends State<_ThreadView> {
  final _replyController = TextEditingController();
  final _scrollController = ScrollController();
  bool _replyAnonymous = false;

  @override
  void dispose() {
    _replyController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = [widget.thread, ...widget.thread.threadReplies];

    return Column(
      children: [
        // Thread header
        Container(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.thread.removed
                    ? 'Question removed'
                    : (widget.thread.title ?? 'Untitled'),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Text(
                    '${widget.thread.threadReplies.length} ${widget.thread.threadReplies.length == 1 ? 'answer' : 'answers'}',
                    style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (widget.thread.isPinned) ...[
                    const SizedBox(width: 8),
                    const Pill(text: 'Pinned'),
                  ],
                  if (widget.thread.isLocked) ...[
                    const SizedBox(width: 8),
                    const Pill(text: 'Closed'),
                  ],
                  if (widget.thread.resolvedAt != null) ...[
                    const SizedBox(width: 8),
                    const Pill(text: 'Answered'),
                  ],
                ],
              ),
              // Moderation buttons
              if (widget.isTeacher && !widget.thread.removed) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    _ModerationButton(
                      label: widget.thread.isPinned ? 'Unpin' : 'Pin',
                      onPressed: () {
                        context.read<DiscussionCubit>().moderate(
                              postId: widget.thread.id,
                              isPinned: !widget.thread.isPinned,
                            );
                      },
                    ),
                    const SizedBox(width: 8),
                    _ModerationButton(
                      label: widget.thread.isLocked ? 'Reopen' : 'Close',
                      onPressed: () {
                        context.read<DiscussionCubit>().moderate(
                              postId: widget.thread.id,
                              isLocked: !widget.thread.isLocked,
                            );
                      },
                    ),
                    const SizedBox(width: 8),
                    _ModerationButton(
                      label: widget.thread.resolvedAt != null
                          ? 'Reopen'
                          : 'Mark answered',
                      onPressed: () {
                        context.read<DiscussionCubit>().resolvePost(
                              postId: widget.thread.id,
                            );
                      },
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const Divider(height: 1),

        // Messages
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            itemCount: messages.length,
            itemBuilder: (context, i) {
              final msg = messages[i];
              final mine = msg.authorUserId == widget.myUserId;
              return _Bubble(
                post: msg,
                isQuestion: i == 0,
                mine: mine,
                isTeacher: widget.isTeacher,
                myUserId: widget.myUserId,
              );
            },
          ),
        ),

        // Reply composer
        if (widget.thread.isLocked)
          Container(
            padding: const EdgeInsets.all(14),
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Row(
              children: [
                Icon(Icons.lock_outline,
                    size: 16, color: Theme.of(context).colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'This thread is closed. Start a new question if yours is still open.',
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          )
        else
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border(
                top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
              ),
            ),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Icon(Icons.visibility_off_outlined,
                          size: 14,
                          color: Theme.of(context).colorScheme.onSurfaceVariant),
                      const SizedBox(width: 4),
                      Text(
                        'Hide name',
                        style: TextStyle(
                          fontSize: 11,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const Spacer(),
                      Switch(
                        value: _replyAnonymous,
                        onChanged: (v) => setState(() => _replyAnonymous = v),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _replyController,
                          decoration: const InputDecoration(
                            hintText: 'Write an answer\u2026',
                            border: InputBorder.none,
                            isDense: true,
                          ),
                          maxLines: null,
                          textInputAction: TextInputAction.newline,
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: (_replyController.text.trim().length >= 2 &&
                                !widget.replyBusy)
                            ? () {
                                context.read<DiscussionCubit>().reply(
                                      postId: widget.thread.id,
                                      body: _replyController.text.trim(),
                                      isAnonymous: _replyAnonymous,
                                    );
                                _replyController.clear();
                              }
                            : null,
                        icon: widget.replyBusy
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                        color: AppColors.brand600,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _ModerationButton extends StatelessWidget {
  const _ModerationButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 32),
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12.5)),
    );
  }
}

class _Bubble extends StatefulWidget {
  const _Bubble({
    required this.post,
    required this.isQuestion,
    required this.mine,
    required this.isTeacher,
    required this.myUserId,
  });

  final DiscussionPost post;
  final bool isQuestion;
  final bool mine;
  final bool isTeacher;
  final String myUserId;

  @override
  State<_Bubble> createState() => _BubbleState();
}

class _BubbleState extends State<_Bubble> {
  bool _editing = false;
  String _editBody = '';

  @override
  Widget build(BuildContext context) {
    final p = widget.post;
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    if (p.removed) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          mainAxisAlignment:
              widget.mine ? MainAxisAlignment.end : MainAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Text(
                p.removedByModerator
                    ? 'Removed by a teacher.'
                    : 'Removed by the person who wrote it.',
                style: TextStyle(fontSize: 13, color: muted, fontStyle: FontStyle.italic),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment:
            widget.mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!widget.mine) ...[
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                (p.author ?? '?').trim().isNotEmpty
                    ? (p.author ?? '?').trim()[0].toUpperCase()
                    : '?',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: muted,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: widget.mine
                    ? AppColors.brand600.withValues(alpha: 0.1)
                    : theme.colorScheme.surface,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(AppRadius.md),
                  topRight: const Radius.circular(AppRadius.md),
                  bottomLeft: Radius.circular(
                      widget.mine ? AppRadius.md : AppRadius.sm),
                  bottomRight: Radius.circular(
                      widget.mine ? AppRadius.sm : AppRadius.md),
                ),
                border: Border.all(color: theme.colorScheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!widget.mine)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Text(
                        p.isAnonymous ? 'Anonymous' : (p.author ?? 'Unknown'),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.brand600,
                        ),
                      ),
                    ),
                  if (_editing)
                    TextField(
                      controller: TextEditingController(text: _editBody),
                      maxLines: null,
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                      onChanged: (v) => _editBody = v,
                    )
                  else
                    Text(p.body ?? '', style: const TextStyle(fontSize: 14.5)),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _timeOf(p.createdAt),
                        style: TextStyle(fontSize: 11, color: muted),
                      ),
                      if (p.editedAt != null) ...[
                        const SizedBox(width: 4),
                        Text(
                          '\u00b7 edited',
                          style: TextStyle(fontSize: 11, color: muted),
                        ),
                      ],
                      if (p.endorsedAt != null) ...[
                        const SizedBox(width: 4),
                        Text(
                          '\u2713 Endorsed',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.ok,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      if (_editing) ...[
                        const SizedBox(width: 8),
                        GestureDetector(
                          onTap: () {
                            context.read<DiscussionCubit>().editPost(
                                  postId: p.id,
                                  body: _editBody.trim(),
                                );
                            setState(() => _editing = false);
                          },
                          child: Text(
                            'Save',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.brand600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        GestureDetector(
                          onTap: () => setState(() => _editing = false),
                          child: Text(
                            'Cancel',
                            style: TextStyle(
                              fontSize: 11,
                              color: muted,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  // Action buttons
                  if (!_editing && (widget.mine || widget.isTeacher))
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (widget.mine)
                            GestureDetector(
                              onTap: () => setState(() {
                                _editing = true;
                                _editBody = p.body ?? '';
                              }),
                              child: Text(
                                'Edit',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: muted,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                          if (widget.mine && widget.isTeacher)
                            const SizedBox(width: 12),
                          if (widget.isTeacher && !widget.isQuestion)
                            GestureDetector(
                              onTap: () {
                                context.read<DiscussionCubit>().endorsePost(
                                      postId: p.id,
                                    );
                              },
                              child: Text(
                                p.endorsedAt != null ? 'Unendorse' : 'Endorse',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: p.endorsedAt != null
                                      ? AppColors.ok
                                      : AppColors.brand600,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          if (widget.isTeacher) const SizedBox(width: 12),
                          GestureDetector(
                            onTap: () => _confirmRemove(context),
                            child: Text(
                              widget.mine ? 'Remove' : 'Remove as moderator',
                              style: TextStyle(
                                fontSize: 11.5,
                                color: AppColors.error,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _confirmRemove(BuildContext context) {
    if (!widget.mine && widget.isTeacher) {
      final cubit = context.read<DiscussionCubit>();
      showDialog<String>(
        context: context,
        builder: (ctx) {
          String? reason;
          return AlertDialog(
            title: const Text('Remove this post?'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('The author will be told why.'),
                const SizedBox(height: 12),
                TextField(
                  decoration: const InputDecoration(
                    labelText: 'Reason (optional)',
                  ),
                  maxLines: 2,
                  onChanged: (v) => reason = v,
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, reason),
                child: const Text('Remove'),
              ),
            ],
          );
        },
      ).then((reason) {
        if (reason != null || widget.mine) {
          cubit.removePost(
                postId: widget.post.id,
                reason: reason,
              );
        }
      });
    } else {
      context.read<DiscussionCubit>().removePost(postId: widget.post.id);
    }
  }

  String _timeOf(DateTime d) {
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
