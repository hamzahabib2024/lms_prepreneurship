import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/announcements_cubit.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class AnnouncementsPage extends StatelessWidget {
  const AnnouncementsPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AnnouncementsCubit(
        repository: CommunicationRepository(api: api),
      )..load(),
      child: _AnnouncementsView(user: user),
    );
  }
}

class _AnnouncementsView extends StatelessWidget {
  const _AnnouncementsView({required this.user});

  final AuthUser user;

  bool get _mayPost => user.isAdmin || user.isSuperAdmin || user.isTeacher;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<AnnouncementsCubit, AnnouncementsState>(
        builder: (context, state) {
          switch (state.status) {
            case AnnouncementsStatus.loading:
              return const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 3),
              );
            case AnnouncementsStatus.failure:
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  AppAlert(
                    title: 'Could not load announcements',
                    message: state.error?.message ?? 'Something went wrong.',
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<AnnouncementsCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case AnnouncementsStatus.loaded:
              return RefreshIndicator(
                onRefresh: () => context.read<AnnouncementsCubit>().load(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    if (_mayPost) ...[
                      _Composer(api: context.read<AnnouncementsCubit>().repository.api),
                      const SizedBox(height: 16),
                    ],
                    if (state.postResult != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: AppAlert(
                          title: 'Posted',
                          message: state.postResult!,
                          warn: true,
                        ),
                      ),
                    if (state.items.isEmpty)
                      const _EmptyState()
                    else
                      for (final a in state.items)
                        _AnnouncementCard(announcement: a, mayPost: _mayPost),
                  ],
                ),
              );
          }
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.only(top: 60),
      child: Column(
        children: [
          Icon(Icons.campaign_outlined, size: 48, color: muted),
          const SizedBox(height: 16),
          Text(
            'No announcements yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Notices from the Institute appear here.',
            style: TextStyle(color: muted, fontSize: 13.5),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  const _AnnouncementCard({required this.announcement, required this.mayPost});

  final Announcement announcement;
  final bool mayPost;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    final priority = announcement.priority ??
        (announcement.isUrgent ? 'URGENT' : 'NORMAL');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (priority != 'NORMAL')
            _PriorityBand(priority: priority),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (announcement.isPinned) ...[
                      const Pill(text: 'Pinned'),
                      const SizedBox(width: 8),
                    ],
                    Expanded(
                      child: Text(
                        announcement.title,
                        style: theme.textTheme.titleSmall,
                      ),
                    ),
                    Text(
                      _formatDate(announcement.publishedAt),
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  '${announcement.authorName} \u00b7 ${announcement.about}',
                  style: TextStyle(fontSize: 12.5, color: muted),
                ),
                const SizedBox(height: 10),
                Text(
                  announcement.body,
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    if (d.year == now.year && d.month == now.month && d.day == now.day) {
      return 'Today';
    }
    final yesterday = now.subtract(const Duration(days: 1));
    if (d.year == yesterday.year &&
        d.month == yesterday.month &&
        d.day == yesterday.day) {
      return 'Yesterday';
    }
    return '${d.day} ${_month(d.month)}';
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _month(int m) => _months[m - 1];
}

class _PriorityBand extends StatelessWidget {
  const _PriorityBand({required this.priority});

  final String priority;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label, icon) = switch (priority) {
      'URGENT' => (
          AppColors.errorBg,
          AppColors.error,
          'Urgent \u2014 Needs attention now',
          Icons.warning_amber_rounded,
        ),
      'IMPORTANT' => (
          AppColors.warnBg,
          AppColors.warn,
          'Important \u2014 Please read this one',
          Icons.info_outline,
        ),
      _ => (Colors.transparent, Colors.black, '', Icons.campaign_outlined),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
      decoration: BoxDecoration(color: bg),
      child: Row(
        children: [
          Icon(icon, size: 18, color: fg),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({required this.api});

  final ApiClient api;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  bool _expanded = false;
  String _audience = 'INSTITUTE';
  String _sectionSubjectId = '';
  String _title = '';
  String _body = '';
  String _priority = 'NORMAL';
  bool _isPinned = false;
  List<SectionSubject> _sections = [];

  @override
  void initState() {
    super.initState();
    _loadSections();
  }

  Future<void> _loadSections() async {
    try {
      final repo = CommunicationRepository(api: widget.api);
      final sections = await repo.mySections();
      final uniqueSections = <String, SectionSubject>{
        for (final section in sections)
          if (section.sectionSubjectId.isNotEmpty)
            section.sectionSubjectId: section,
      }.values.toList();
      if (mounted) setState(() => _sections = uniqueSections);
    } catch (e) {
      // Sections unavailable — the composer still works for institute-wide.
      debugPrint('Failed to load sections: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_expanded) {
      return SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: () => setState(() => _expanded = true),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Post an announcement'),
        ),
      );
    }

    final targetChosen =
        _audience == 'INSTITUTE' || _sectionSubjectId.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Post an announcement',
              style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 14),

          // Audience
          DropdownButtonFormField<String>(
            initialValue: _audience,
            decoration: const InputDecoration(labelText: 'Audience'),
            items: [
              if (_sections.isNotEmpty)
                const DropdownMenuItem(
                  value: 'SECTION_SUBJECT',
                  child: Text('One of my subjects'),
                ),
              const DropdownMenuItem(
                value: 'INSTITUTE',
                child: Text('Everyone at the Institute'),
              ),
            ],
            onChanged: (v) => setState(() => _audience = v ?? 'INSTITUTE'),
          ),

          if (_audience == 'SECTION_SUBJECT') ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _sectionSubjectId.isEmpty ? null : _sectionSubjectId,
              decoration: const InputDecoration(labelText: 'Subject'),
              items: _sections
                  .map((s) => DropdownMenuItem(
                        value: s.sectionSubjectId,
                        child: Text(s.label),
                      ))
                  .toList(),
              onChanged: (v) =>
                  setState(() => _sectionSubjectId = v ?? ''),
            ),
          ],

          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(labelText: 'Title'),
            maxLength: 200,
            onChanged: (v) => _title = v,
          ),

          TextField(
            decoration: const InputDecoration(labelText: 'Message'),
            maxLines: 4,
            onChanged: (v) => _body = v,
          ),

          const SizedBox(height: 12),
          // Priority
          Text('How much does this matter?',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final p in ['NORMAL', 'IMPORTANT', 'URGENT']) ...[
                if (p != 'NORMAL') const SizedBox(width: 8),
                ChoiceChip(
                  label: Text(p[0] + p.substring(1).toLowerCase()),
                  selected: _priority == p,
                  onSelected: (_) => setState(() => _priority = p),
                ),
              ],
            ],
          ),

          if (_priority == 'URGENT') ...[
            const SizedBox(height: 8),
            AppAlert(
              title: 'This will reach people during their quiet hours.',
              message:
                  'An urgent announcement ignores muted topics and night-time suppression.',
              warn: true,
            ),
          ],

          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Keep at the top', style: TextStyle(fontSize: 14)),
                  value: _isPinned,
                  onChanged: (v) => setState(() => _isPinned = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: (targetChosen &&
                          _title.trim().isNotEmpty &&
                          _body.trim().isNotEmpty)
                      ? () {
                          context.read<AnnouncementsCubit>().post(
                                audience: _audience,
                                sectionSubjectId: _sectionSubjectId.isEmpty
                                    ? null
                                    : _sectionSubjectId,
                                title: _title.trim(),
                                body: _body.trim(),
                                priority: _priority,
                                isPinned: _isPinned,
                              );
                          setState(() {
                            _expanded = false;
                            _title = '';
                            _body = '';
                            _priority = 'NORMAL';
                            _isPinned = false;
                          });
                        }
                      : null,
                  child: const Text('Post'),
                ),
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
