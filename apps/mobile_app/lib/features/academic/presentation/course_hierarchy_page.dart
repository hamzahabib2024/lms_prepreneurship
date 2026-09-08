import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/course_hierarchy_cubit.dart';

class CourseHierarchyPage extends StatelessWidget {
  const CourseHierarchyPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => CourseHierarchyCubit(api: api)..load(),
      child: const _CourseHierarchyView(),
    );
  }
}

class _CourseHierarchyView extends StatelessWidget {
  const _CourseHierarchyView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Academic structure'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<CourseHierarchyCubit, CourseHierarchyState>(
        builder: (context, state) {
          if (state.loading) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }

          if (state.error != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load structure',
                    message: state.error!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<CourseHierarchyCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          if (state.programmes.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.account_tree_outlined,
                        size: 48,
                        color: Theme.of(context).colorScheme.onSurfaceVariant),
                    const SizedBox(height: 16),
                    Text(
                      'No programmes yet',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Programmes appear here once created.',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<CourseHierarchyCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                Text(
                  'Programme \u2192 Sessions \u2192 Batches \u2192 Sections',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 14),
                for (final programme in state.programmes)
                  _HierarchyNode(item: programme, depth: 0),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _HierarchyNode extends StatelessWidget {
  const _HierarchyNode({required this.item, required this.depth});

  final CourseHierarchyItem item;
  final int depth;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final hasChildren = item.children.isNotEmpty;

    return BlocBuilder<CourseHierarchyCubit, CourseHierarchyState>(
      builder: (context, state) {
        final isExpanded = state.expandedIds.contains(item.id);

        return Container(
          margin: const EdgeInsets.only(bottom: 6),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: hasChildren
                    ? () => context.read<CourseHierarchyCubit>().toggleExpanded(item.id)
                    : null,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      SizedBox(width: depth * 20.0),
                      if (hasChildren)
                        Icon(
                          isExpanded
                              ? Icons.keyboard_arrow_down
                              : Icons.keyboard_arrow_right,
                          size: 20,
                          color: muted,
                        )
                      else
                        const SizedBox(width: 20),
                      const SizedBox(width: 8),
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _colorForDepth(depth),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.name,
                              style: TextStyle(
                                fontSize: 14 - depth * 0.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if (item.code.isNotEmpty)
                              Text(
                                item.code,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: muted,
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (hasChildren)
                        Pill(text: '${item.children.length}'),
                    ],
                  ),
                ),
              ),
              if (isExpanded && hasChildren)
                Padding(
                  padding: const EdgeInsets.only(left: 20, bottom: 8),
                  child: Column(
                    children: [
                      for (final child in item.children)
                        _HierarchyNode(item: child, depth: depth + 1),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Color _colorForDepth(int depth) {
    switch (depth) {
      case 0:
        return AppColors.brand600;
      case 1:
        return AppColors.ok;
      case 2:
        return AppColors.warn;
      default:
        return AppColors.muted;
    }
  }
}
