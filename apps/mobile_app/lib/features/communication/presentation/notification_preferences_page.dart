import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/preferences_cubit.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class NotificationPreferencesPage extends StatelessWidget {
  const NotificationPreferencesPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PreferencesCubit(
        repository: CommunicationRepository(api: api),
      )..load(),
      child: const _PreferencesView(),
    );
  }
}

class _PreferencesView extends StatelessWidget {
  const _PreferencesView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<PreferencesCubit, PreferencesState>(
        builder: (context, state) {
          switch (state.status) {
            case PreferencesStatus.loading:
              return const Center(child: CircularProgressIndicator());
            case PreferencesStatus.failure:
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  AppAlert(
                    title: 'Could not load preferences',
                    message: state.error?.message ?? 'Something went wrong.',
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<PreferencesCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case PreferencesStatus.loaded:
              final pref = state.preference;
              if (pref == null) return const SizedBox.shrink();
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                children: [
                  if (state.savedMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppAlert(
                        title: 'Saved',
                        message: state.savedMessage!,
                        warn: true,
                      ),
                    ),
                  if (state.error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppAlert(
                        title: 'Could not save',
                        message: state.error!.message,
                      ),
                    ),

                  // Channels section
                  _SectionHeader(title: 'Delivery channels'),
                  const SizedBox(height: 8),
                  _ChannelSwitch(
                    label: 'WhatsApp',
                    subtitle: 'Receive notifications via WhatsApp',
                    value: pref.isWhatsAppEnabled,
                    onChanged: (v) => context
                        .read<PreferencesCubit>()
                        .toggleChannel('WHATSAPP', v),
                  ),
                  _ChannelSwitch(
                    label: 'Email',
                    subtitle: 'Receive notifications via email',
                    value: pref.isEmailEnabled,
                    onChanged: (v) => context
                        .read<PreferencesCubit>()
                        .toggleChannel('EMAIL', v),
                  ),
                  _ChannelSwitch(
                    label: 'SMS',
                    subtitle: 'Receive notifications via text message',
                    value: pref.isSmsEnabled,
                    onChanged: (v) => context
                        .read<PreferencesCubit>()
                        .toggleChannel('SMS', v),
                  ),

                  const SizedBox(height: 24),

                  // Quiet hours
                  _SectionHeader(title: 'Quiet hours'),
                  const SizedBox(height: 8),
                  Text(
                    'Notifications are held and delivered after quiet hours end. '
                    'Urgent announcements still reach you immediately.',
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _QuietHoursPicker(pref: pref),

                  const SizedBox(height: 24),

                  // Info box
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline,
                          size: 18,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'In-app notifications are always delivered. '
                            'These settings control WhatsApp, email and SMS only.',
                            style: TextStyle(
                              fontSize: 13,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
          }
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall,
    );
  }
}

class _ChannelSwitch extends StatelessWidget {
  const _ChannelSwitch({
    required this.label,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label, style: const TextStyle(fontSize: 15)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12.5)),
      value: value,
      onChanged: onChanged,
    );
  }
}

class _QuietHoursPicker extends StatelessWidget {
  const _QuietHoursPicker({required this.pref});

  final NotificationPreference pref;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<PreferencesCubit>();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (pref.hasQuietHours)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  Icon(Icons.bedtime_outlined, size: 18, color: AppColors.brand600),
                  const SizedBox(width: 8),
                  Text(
                    '${_hourLabel(pref.quietHoursStart!)} — ${_hourLabel(pref.quietHoursEnd!)}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => cubit.clearQuietHours(),
                    child: const Text('Clear'),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<int>(
                  value: pref.quietHoursStart,
                  decoration: const InputDecoration(
                    labelText: 'Start',
                    isDense: true,
                  ),
                  items: [
                    for (var h = 0; h < 24; h++)
                      DropdownMenuItem(value: h, child: Text(_hourLabel(h))),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      cubit.setQuietHours(v, pref.quietHoursEnd ?? v);
                    }
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<int>(
                  value: pref.quietHoursEnd,
                  decoration: const InputDecoration(
                    labelText: 'End',
                    isDense: true,
                  ),
                  items: [
                    for (var h = 0; h < 24; h++)
                      DropdownMenuItem(value: h, child: Text(_hourLabel(h))),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      cubit.setQuietHours(pref.quietHoursStart ?? v, v);
                    }
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _hourLabel(int h) {
    if (h == 0) return '12:00 AM';
    if (h < 12) return '$h:00 AM';
    if (h == 12) return '12:00 PM';
    return '${h - 12}:00 PM';
  }
}
