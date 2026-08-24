import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/setting_group.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))..loadSettings(),
      child: const _SettingsView(),
    );
  }
}

class _SettingsView extends StatelessWidget {
  const _SettingsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('System settings'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<AdminCubit, AdminState>(
        builder: (context, state) {
          if (state.loadingSettings) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }

          if (state.settingsError != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load settings',
                    message: state.settingsError!.message,
                    reference: state.settingsError!.reference,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<AdminCubit>().loadSettings(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          if (state.settingGroups.isEmpty) {
            return const Center(child: Text('No settings found.'));
          }

          return RefreshIndicator(
            onRefresh: () => context.read<AdminCubit>().loadSettings(),
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              itemCount: state.settingGroups.length,
              itemBuilder: (context, index) {
                final group = state.settingGroups[index];
                return _SettingGroupTile(group: group);
              },
            ),
          );
        },
      ),
    );
  }
}

class _SettingGroupTile extends StatefulWidget {
  const _SettingGroupTile({required this.group});

  final SettingGroup group;

  @override
  State<_SettingGroupTile> createState() => _SettingGroupTileState();
}

class _SettingGroupTileState extends State<_SettingGroupTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.group.group,
                            style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${widget.group.settings.length} setting${widget.group.settings.length == 1 ? '' : 's'}',
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      color: muted,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_expanded) ...[
            Divider(height: 1, color: dark ? AppColorsDark.line : AppColors.line),
            for (final setting in widget.group.settings)
              _SettingRow(setting: setting),
          ],
        ],
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({required this.setting});

  final SettingItem setting;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return InkWell(
      onTap: setting.type == 'boolean' ? () => _toggleSetting(context) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    setting.key.split('.').last,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                  ),
                  if (setting.description != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      setting.description!,
                      style: TextStyle(fontSize: 11.5, color: muted),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 12),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (setting.isOverridden)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: (dark ? AppColorsDark.brand600 : AppColors.brand600).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        'overridden',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                        ),
                      ),
                    ),
                  const SizedBox(height: 3),
                  Text(
                    setting.displayText,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _toggleSetting(BuildContext context) {
    final newValue = !(setting.displayValue == true);
    context.read<AdminCubit>().updateSetting(key: setting.key, value: newValue);
  }
}
