import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/signatories_cubit.dart';
import '../../data/signatories_repository.dart';

class SignatoriesPage extends StatelessWidget {
  const SignatoriesPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => SignatoriesCubit(
        repository: SignatoriesRepository(api: api),
      )..load(),
      child: const _SignatoriesView(),
    );
  }
}

class _SignatoriesView extends StatelessWidget {
  const _SignatoriesView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Certificate signatories'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocConsumer<SignatoriesCubit, SignatoriesState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionSuccess!)),
            );
            context.read<SignatoriesCubit>().dismissResult();
          }
          if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionError!.message)),
            );
            context.read<SignatoriesCubit>().dismissResult();
          }
        },
        builder: (context, state) {
          if (state.loading) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          }

          if (state.error != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load signatories',
                    message: state.error!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<SignatoriesCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<SignatoriesCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                Text(
                  'Their names print across the foot of every certificate. Changing anything here leaves certificates already issued exactly as they were signed.',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => _showAddSignatory(context),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add somebody'),
                  ),
                ),
                const SizedBox(height: 16),
                if (state.signatories.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Column(
                      children: [
                        Icon(Icons.badge_outlined,
                            size: 48,
                            color: Theme.of(context).colorScheme.onSurfaceVariant),
                        const SizedBox(height: 16),
                        Text(
                          'No signatories yet',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Certificates print with the Institute\'s name until somebody is added here.',
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
                  for (var i = 0; i < state.signatories.length; i++)
                    _SignatoryCard(
                      signatory: state.signatories[i],
                      isFirst: i == 0,
                      isLast: i == state.signatories.length - 1,
                    ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showAddSignatory(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _AddSignatorySheet(),
    );
  }
}

class _SignatoryCard extends StatelessWidget {
  const _SignatoryCard({
    required this.signatory,
    required this.isFirst,
    required this.isLast,
  });

  final Signatory signatory;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: !signatory.isActive
              ? (dark ? AppColorsDark.muted : AppColors.muted).withValues(alpha: 0.3)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                alignment: Alignment.center,
                child: signatory.signatureAssetId != null
                    ? const Icon(Icons.image, size: 20)
                    : Text(
                        signatory.name.trim().isNotEmpty
                            ? signatory.name.trim()[0].toUpperCase()
                            : '?',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                          color: muted,
                        ),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      signatory.name,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      signatory.designation,
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ),
              ),
              if (!signatory.isActive)
                const Pill(text: 'Not in use', kind: PillKind.neutral),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              if (!isFirst)
                _ActionChip(
                  label: 'Earlier',
                  onPressed: () {
                    context.read<SignatoriesCubit>().reorder(
                          id: signatory.id,
                          sortOrder: signatory.sortOrder - 1,
                        );
                  },
                ),
              if (!isFirst) const SizedBox(width: 6),
              if (!isLast)
                _ActionChip(
                  label: 'Later',
                  onPressed: () {
                    context.read<SignatoriesCubit>().reorder(
                          id: signatory.id,
                          sortOrder: signatory.sortOrder + 1,
                        );
                  },
                ),
              if (!isLast) const SizedBox(width: 6),
              _ActionChip(
                label: signatory.isActive ? 'Deactivate' : 'Reactivate',
                onPressed: () {
                  context.read<SignatoriesCubit>().toggleActive(
                        id: signatory.id,
                        isActive: signatory.isActive,
                      );
                },
              ),
              const SizedBox(width: 6),
              _ActionChip(
                label: 'Remove',
                isDestructive: true,
                onPressed: () => _confirmRemove(context),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _confirmRemove(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove ${signatory.name}?'),
        content: Text(
          'Certificates they have already signed keep their name and signature exactly as they were issued. This only stops them appearing on new ones.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<SignatoriesCubit>().remove(
                    id: signatory.id,
                    name: signatory.name,
                  );
            },
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.label,
    required this.onPressed,
    this.isDestructive = false,
  });

  final String label;
  final VoidCallback onPressed;
  final bool isDestructive;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return GestureDetector(
      onTap: onPressed,
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          color: isDestructive
              ? (dark ? AppColorsDark.error : AppColors.error)
              : AppColors.brand600,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _AddSignatorySheet extends StatefulWidget {
  const _AddSignatorySheet();

  @override
  State<_AddSignatorySheet> createState() => _AddSignatorySheetState();
}

class _AddSignatorySheetState extends State<_AddSignatorySheet> {
  final _nameController = TextEditingController();
  final _designationController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _designationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Add a signatory',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'Dr Ayesha Rahman',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _designationController,
              decoration: const InputDecoration(
                labelText: 'Designation',
                hintText: 'Principal',
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: (_nameController.text.trim().isNotEmpty &&
                            _designationController.text.trim().isNotEmpty)
                        ? () {
                            context.read<SignatoriesCubit>().add(
                                  name: _nameController.text.trim(),
                                  designation: _designationController.text.trim(),
                                );
                            Navigator.of(context).pop();
                          }
                        : null,
                    child: const Text('Add'),
                  ),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
