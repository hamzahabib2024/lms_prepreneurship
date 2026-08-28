import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
      create: (_) => AdminCubit(repository: AdminRepository(api: api))
        ..loadSettings(),
      child: const _SettingsView(),
    );
  }
}

class _SettingsView extends StatefulWidget {
  const _SettingsView();

  @override
  State<_SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<_SettingsView> {
  bool _showHelp = false;
  final _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final cubit = context.read<AdminCubit>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('System settings'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            onPressed: () => setState(() => _showHelp = !_showHelp),
            icon: Icon(
              _showHelp ? Icons.help_outline : Icons.help_outline,
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
            ),
          ),
        ],
      ),
      body: BlocConsumer<AdminCubit, AdminState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.actionSuccess!),
                backgroundColor: AppColors.ok,
              ),
            );
            cubit.dismissResult();
          } else if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.actionError!.message),
                backgroundColor: AppColors.error,
              ),
            );
            cubit.dismissResult();
          }
        },
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
                    onPressed: () => cubit.loadSettings(),
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

          final q = state.settingsSearch.toLowerCase();
          final filtered = q.isEmpty
              ? state.settingGroups
              : state.settingGroups
                  .map((g) => SettingGroup(
                        group: g.group,
                        settings: g.settings.where((s) {
                          return s.key.toLowerCase().contains(q) ||
                              (s.description ?? '').toLowerCase().contains(q) ||
                              g.group.toLowerCase().contains(q);
                        }).toList(),
                      ))
                  .where((g) => g.settings.isNotEmpty)
                  .toList();

          return Column(
            children: [
              if (_showHelp) _HowItWorksHelp(dark: dark),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                child: TextField(
                  controller: _searchCtrl,
                  onChanged: cubit.setSettingsSearch,
                  decoration: InputDecoration(
                    hintText: 'Search settings...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: state.settingsSearch.isNotEmpty
                        ? IconButton(
                            onPressed: () {
                              _searchCtrl.clear();
                              cubit.setSettingsSearch('');
                            },
                            icon: const Icon(Icons.clear, size: 18),
                          )
                        : null,
                    filled: true,
                    fillColor: dark ? AppColorsDark.surface : AppColors.surface,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      borderSide: BorderSide(
                        color: dark ? AppColorsDark.line : AppColors.line,
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      borderSide: BorderSide(
                        color: dark ? AppColorsDark.line : AppColors.line,
                      ),
                    ),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ),
              if (filtered.isEmpty)
                const Expanded(
                  child: Center(child: Text('No settings match your search.')),
                )
              else
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () => cubit.loadSettings(),
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                      itemCount: filtered.length,
                      itemBuilder: (context, index) =>
                          _SettingGroupTile(group: filtered[index]),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

// ── How It Works Panel ──

class _HowItWorksHelp extends StatelessWidget {
  const _HowItWorksHelp({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'How settings work',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: ink,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          _HelpStep(
            number: 1,
            text: 'Find the setting — search matches name and description.',
            dark: dark,
          ),
          _HelpStep(
            number: 2,
            text: 'Read what it changes — every setting has a description.',
            dark: dark,
          ),
          _HelpStep(
            number: 3,
            text: 'Change it — nothing saves until you press Save.',
            dark: dark,
          ),
          _HelpStep(
            number: 4,
            text: 'It applies from now on — past decisions are unchanged.',
            dark: dark,
          ),
          const SizedBox(height: 6),
          Text(
            'A change applies from now on — decisions already made are unchanged.',
            style: TextStyle(fontSize: 11, color: muted, fontStyle: FontStyle.italic),
          ),
        ],
      ),
    );
  }
}

class _HelpStep extends StatelessWidget {
  const _HelpStep({
    required this.number,
    required this.text,
    required this.dark,
  });
  final int number;
  final String text;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$number.',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              fontSize: 13,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 12, color: muted)),
          ),
        ],
      ),
    );
  }
}

// ── Group Tile ──

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
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.group.group,
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                            ),
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
            Divider(
              height: 1,
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
            for (final setting in widget.group.settings)
              _SettingRow(setting: setting),
          ],
        ],
      ),
    );
  }
}

// ── Setting Row ──

class _SettingRow extends StatefulWidget {
  const _SettingRow({required this.setting});
  final SettingItem setting;

  @override
  State<_SettingRow> createState() => _SettingRowState();
}

class _SettingRowState extends State<_SettingRow> {
  late dynamic _draft;
  late bool _dirty;
  late TextEditingController _textCtrl;

  @override
  void initState() {
    super.initState();
    _draft = widget.setting.value ?? widget.setting.defaultValue;
    _dirty = false;
    _textCtrl = TextEditingController(text: _draft?.toString() ?? '');
  }

  @override
  void didUpdateWidget(covariant _SettingRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.setting.value != widget.setting.value) {
      _draft = widget.setting.value ?? widget.setting.defaultValue;
      _dirty = false;
      _textCtrl.text = _draft?.toString() ?? '';
    }
  }

  @override
  void dispose() {
    _textCtrl.dispose();
    super.dispose();
  }

  void _markDirty(dynamic value) {
    setState(() {
      _draft = value;
      _dirty = value != (widget.setting.value ?? widget.setting.defaultValue);
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final s = widget.setting;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(
            color: (dark ? AppColorsDark.line : AppColors.line).withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      s.label,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      s.key,
                      style: TextStyle(
                        fontSize: 11,
                        color: muted,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
              ),
              if (s.isOverridden)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: brand.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    s.source.isNotEmpty ? 'set at ${s.source.toLowerCase()}' : 'overridden',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: brand,
                    ),
                  ),
                )
              else
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: muted.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'default',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: muted,
                    ),
                  ),
                ),
            ],
          ),
          if (s.description != null) ...[
            const SizedBox(height: 4),
            Text(
              s.description!,
              style: TextStyle(fontSize: 11.5, color: muted),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _buildInput(dark, muted, ink)),
              const SizedBox(width: 8),
              if (_dirty)
                SizedBox(
                  height: 32,
                  child: FilledButton(
                    onPressed: _saving ? null : _save,
                    style: FilledButton.styleFrom(
                      backgroundColor: brand,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: _saving
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save', style: TextStyle(fontSize: 12)),
                  ),
                ),
              if (s.isOverridden)
                SizedBox(
                  height: 32,
                  child: IconButton(
                    onPressed: _restoring ? null : _restore,
                    icon: _restoring
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            Icons.restart_alt,
                            size: 18,
                            color: muted,
                          ),
                    tooltip: 'Restore default',
                    padding: const EdgeInsets.all(4),
                    constraints: const BoxConstraints(),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Text(
                'default: ${s.defaultValue ?? "—"}',
                style: TextStyle(fontSize: 10, color: muted),
              ),
              if (s.min != null || s.max != null) ...[
                const SizedBox(width: 8),
                Text(
                  'range: ${s.min ?? "—"}–${s.max ?? "—"}',
                  style: TextStyle(fontSize: 10, color: muted),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  bool _saving = false;
  bool _restoring = false;

  Future<void> _save() async {
    setState(() => _saving = true);
    await context.read<AdminCubit>().updateSetting(
          key: widget.setting.key,
          value: _draft,
        );
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _restore() async {
    setState(() => _restoring = true);
    await context.read<AdminCubit>().restoreSetting(
          key: widget.setting.key,
        );
    if (mounted) setState(() => _restoring = false);
  }

  Widget _buildInput(bool dark, Color muted, Color ink) {
    final s = widget.setting;

    if (s.isSecret) {
      return Text(
        s.isSet ? 'A value is set (hidden)' : 'Not set',
        style: TextStyle(fontSize: 13, color: muted, fontStyle: FontStyle.italic),
      );
    }

    switch (s.type) {
      case 'boolean':
        return _buildBooleanInput(dark, muted, ink);
      case 'number':
      case 'percent':
        return _buildNumberInput(dark, muted, ink);
      case 'string':
        if (s.allowed != null) return _buildSelectInput(dark, muted, ink);
        if (s.multiline) return _buildMultilineInput(dark, muted, ink);
        return _buildTextInput(dark, muted, ink);
      case 'weights':
        return _buildTextInput(dark, muted, ink);
      default:
        return _buildTextInput(dark, muted, ink);
    }
  }

  Widget _buildBooleanInput(bool dark, Color muted, Color ink) {
    final boolVal = _draft == true;
    return Container(
      height: 36,
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () => _markDirty(false),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: !boolVal
                      ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                          .withValues(alpha: 0.15)
                      : null,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(AppRadius.sm),
                    bottomLeft: Radius.circular(AppRadius.sm),
                  ),
                ),
                child: Text(
                  'No',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: !boolVal
                        ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        : muted,
                  ),
                ),
              ),
            ),
          ),
          Container(width: 1, color: dark ? AppColorsDark.line : AppColors.line),
          Expanded(
            child: GestureDetector(
              onTap: () => _markDirty(true),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: boolVal
                      ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                          .withValues(alpha: 0.15)
                      : null,
                  borderRadius: const BorderRadius.only(
                    topRight: Radius.circular(AppRadius.sm),
                    bottomRight: Radius.circular(AppRadius.sm),
                  ),
                ),
                child: Text(
                  'Yes',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: boolVal
                        ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        : muted,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNumberInput(bool dark, Color muted, Color ink) {
    return SizedBox(
      height: 36,
      child: TextField(
        controller: _textCtrl,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[\d.\-]')),
        ],
        onChanged: (v) {
          final parsed = num.tryParse(v);
          _markDirty(parsed ?? v);
        },
        style: TextStyle(fontSize: 13, color: ink),
        decoration: InputDecoration(
          suffixText: widget.setting.type == 'percent' ? '%' : null,
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTextInput(bool dark, Color muted, Color ink) {
    return SizedBox(
      height: 36,
      child: TextField(
        controller: _textCtrl,
        onChanged: (v) => _markDirty(v),
        style: TextStyle(fontSize: 13, color: ink),
        decoration: InputDecoration(
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            borderSide: BorderSide(
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMultilineInput(bool dark, Color muted, Color ink) {
    return TextField(
      controller: _textCtrl,
      maxLines: 3,
      onChanged: (v) => _markDirty(v),
      style: TextStyle(fontSize: 13, color: ink),
      decoration: InputDecoration(
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
      ),
    );
  }

  Widget _buildSelectInput(bool dark, Color muted, Color ink) {
    final current = _draft?.toString() ?? '';
    final allowed = widget.setting.allowed ?? [];
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: allowed.contains(current) ? current : null,
          isExpanded: true,
          isDense: true,
          style: TextStyle(fontSize: 13, color: ink),
          items: allowed
              .map((v) => DropdownMenuItem(value: v, child: Text(v)))
              .toList(),
          onChanged: (v) => _markDirty(v),
        ),
      ),
    );
  }
}
