import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/inbox_cubit.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class InboxPage extends StatelessWidget {
  const InboxPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => InboxCubit(
        repository: CommunicationRepository(api: api),
      )..load(),
      child: const _InboxView(),
    );
  }
}

class _InboxView extends StatelessWidget {
  const _InboxView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<InboxCubit, InboxState>(
        builder: (context, state) {
          switch (state.status) {
            case InboxStatus.loading:
              return const Center(child: CircularProgressIndicator());
            case InboxStatus.failure:
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  AppAlert(
                    title: 'Could not load notifications',
                    message: state.error?.message ?? 'Something went wrong.',
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () => context.read<InboxCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case InboxStatus.loaded:
              if (state.items.isEmpty) return const _EmptyInbox();
              return RefreshIndicator(
                onRefresh: () => context.read<InboxCubit>().load(),
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: state.items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final item = state.items[i];
                    return _InboxTile(
                      item: item,
                      onTap: () => _openItem(context, item),
                    );
                  },
                ),
              );
          }
        },
      ),
    );
  }

  void _openItem(BuildContext context, NotificationItem item) {
    if (!item.isRead) {
      context.read<InboxCubit>().markRead([item.id]);
    }
    if (item.linkPath != null) {
      // The linkPath is a relative route like /announcements or /discussions/:id.
      // Try to navigate; if the route doesn't exist, show a helpful message.
      final routeName = item.linkPath!;
      try {
        Navigator.of(context, rootNavigator: true).pushNamed(routeName);
      } on FlutterError {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Open the ${_tabLabel(routeName)} tab to view this.'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  String _tabLabel(String path) {
    if (path.contains('announcement')) return 'Announcements';
    if (path.contains('discussion')) return 'Discussions';
    if (path.contains('inbox') || path.contains('notification')) return 'Inbox';
    return 'relevant';
  }
}

class _InboxTile extends StatelessWidget {
  const _InboxTile({required this.item, required this.onTap});

  final NotificationItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        color: item.isRead
            ? null
            : (theme.brightness == Brightness.dark
                ? AppColorsDark.brand050.withValues(alpha: 0.3)
                : AppColors.brand050.withValues(alpha: 0.5)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Unread dot
            Container(
              width: 8,
              height: 8,
              margin: const EdgeInsets.only(top: 6, right: 12),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: item.isRead
                    ? Colors.transparent
                    : AppColors.brand600,
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight:
                          item.isRead ? FontWeight.w500 : FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    item.body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 13, color: muted),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _formatTime(item.createdAt),
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${d.day}/${d.month}/${d.year}';
  }
}

class _EmptyInbox extends StatelessWidget {
  const _EmptyInbox();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.notifications_none_outlined, size: 48, color: muted),
          const SizedBox(height: 16),
          Text(
            'Nothing yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'When something needs your attention, it will appear here.',
            style: TextStyle(color: muted, fontSize: 13.5),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
