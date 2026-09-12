import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/partners_cubit.dart';
import '../../data/models/partner.dart';
import '../../data/partner_repository.dart';
import 'partner_billing_page.dart';

class PartnersPage extends StatelessWidget {
  const PartnersPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PartnersCubit(
        repository: PartnerRepository(api: api),
      )..load(),
      child: _PartnersView(api: api),
    );
  }
}

class _PartnersView extends StatelessWidget {
  const _PartnersView({required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner institutes'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocConsumer<PartnersCubit, PartnersState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError ||
            prev.createdAccount != curr.createdAccount,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionSuccess!)),
            );
            context.read<PartnersCubit>().dismissResult();
          }
          if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionError!.message)),
            );
            context.read<PartnersCubit>().dismissResult();
          }
          if (state.createdAccount != null) {
            _showAccountCreated(context, state.createdAccount!);
            context.read<PartnersCubit>().dismissResult();
          }
        },
        builder: (context, state) {
          if (state.loading && state.partners.isEmpty) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          }

          if (state.error != null && state.partners.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load partners',
                    message: state.error!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<PartnersCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<PartnersCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                Text(
                  'Other institutes whose students we teach. Their staff can be given an account to see their own students\' results.',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => _showAddPartner(context),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add an institute'),
                  ),
                ),
                const SizedBox(height: 16),
                if (state.partners.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Column(
                      children: [
                        Icon(Icons.business_outlined,
                            size: 48,
                            color: Theme.of(context).colorScheme.onSurfaceVariant),
                        const SizedBox(height: 16),
                        Text(
                          'No partner institutes yet',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'When another institute sends us students, record it here first.',
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
                  for (final p in state.partners)
                    _PartnerCard(partner: p, api: api),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showAddPartner(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _AddPartnerSheet(),
    );
  }

  void _showAccountCreated(BuildContext context, PartnerAccount account) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${account.fullName} can now sign in'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (account.temporaryPassword != null) ...[
              const Text('Temporary password:'),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: SelectableText(
                  account.temporaryPassword!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'They must change it when they first sign in.',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            if (account.emailSent == false) ...[
              const SizedBox(height: 8),
              AppAlert(
                title: 'Email could not be sent',
                message: account.emailDetail ?? 'Pass the password on yourself.',
                warn: true,
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'This is shown once. If lost, reset the account from Users.',
              style: TextStyle(
                fontSize: 11.5,
                color: Theme.of(ctx).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}

class _PartnerCard extends StatelessWidget {
  const _PartnerCard({required this.partner, required this.api});

  final Partner partner;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: !partner.isActive
              ? (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.5)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
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
                      partner.name,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '(${partner.code})${partner.city != null ? ' · ${partner.city}' : ''}',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ),
              ),
              Pill(
                text: partner.billingLabel,
                kind: partner.billingMode == 'PARTNER_PAYS'
                    ? PillKind.ok
                    : PillKind.neutral,
              ),
              if (!partner.isActive) ...[
                const SizedBox(width: 6),
                const Pill(text: 'Inactive', kind: PillKind.warn),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${partner.studentCount == 0 ? 'No students imported yet' : '${partner.studentCount} student${partner.studentCount == 1 ? '' : 's'}'}'
            '${partner.contactName != null ? ' · ${partner.contactName}' : ''}'
            '${partner.contactEmail != null ? ' · ${partner.contactEmail}' : ''}'
            '${partner.contactPhone != null ? ' · ${partner.contactPhone}' : ''}',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              OutlinedButton(
                onPressed: () => _showGiveAccount(context, partner),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
                child: const Text('Give account'),
              ),
              // Only for the partners who actually pay. Offering to bill an
              // institute whose students pay for themselves is offering to
              // raise an invoice with nothing on it.
              if (partner.billingMode == 'PARTNER_PAYS') ...[
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => PartnerBillingPage(
                        api: api,
                        partnerId: partner.id,
                        partnerName: partner.name,
                      ),
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                  child: const Text('Billing'),
                ),
              ],
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: () {
                  context.read<PartnersCubit>().toggleActive(
                        id: partner.id,
                        isActive: partner.isActive,
                      );
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
                child: Text(partner.isActive ? 'Mark inactive' : 'Reactivate'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showGiveAccount(BuildContext context, Partner partner) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _GiveAccountSheet(partner: partner),
    );
  }
}

class _AddPartnerSheet extends StatefulWidget {
  const _AddPartnerSheet();

  @override
  State<_AddPartnerSheet> createState() => _AddPartnerSheetState();
}

class _AddPartnerSheetState extends State<_AddPartnerSheet> {
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();
  final _cityController = TextEditingController();
  final _contactNameController = TextEditingController();
  final _contactEmailController = TextEditingController();
  final _contactPhoneController = TextEditingController();
  String _billingMode = 'PARTNER_PAYS';

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    _cityController.dispose();
    _contactNameController.dispose();
    _contactEmailController.dispose();
    _contactPhoneController.dispose();
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
              'A new partner institute',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Name of the institute'),
              maxLength: 200,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _codeController,
              decoration: const InputDecoration(
                labelText: 'Short code',
                hintText: 'Letters, digits and hyphens',
              ),
              maxLength: 20,
            ),
            const SizedBox(height: 12),
            Text(
              'Who pays us for these students?',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Text('Institute pays'),
                    selected: _billingMode == 'PARTNER_PAYS',
                    onSelected: (_) => setState(() => _billingMode = 'PARTNER_PAYS'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ChoiceChip(
                    label: const Text('Students pay us'),
                    selected: _billingMode == 'STUDENT_PAYS',
                    onSelected: (_) => setState(() => _billingMode = 'STUDENT_PAYS'),
                  ),
                ),
              ],
            ),
            if (_billingMode == 'PARTNER_PAYS')
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'We invoice the institute. No charge is raised against these students.',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Students pay us directly — charges, instalments and receipts behave normally.',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _cityController,
              decoration: const InputDecoration(labelText: 'City'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contactNameController,
              decoration: const InputDecoration(labelText: 'Contact name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contactEmailController,
              decoration: const InputDecoration(labelText: 'Contact email'),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contactPhoneController,
              decoration: const InputDecoration(labelText: 'Contact phone'),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: (_nameController.text.trim().length >= 2 &&
                            _codeController.text.trim().length >= 2)
                        ? () {
                            context.read<PartnersCubit>().createPartner(
                                  name: _nameController.text.trim(),
                                  code: _codeController.text.trim(),
                                  billingMode: _billingMode,
                                  city: _cityController.text,
                                  contactName: _contactNameController.text,
                                  contactEmail: _contactEmailController.text,
                                  contactPhone: _contactPhoneController.text,
                                );
                            Navigator.of(context).pop();
                          }
                        : null,
                    child: const Text('Add institute'),
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

class _GiveAccountSheet extends StatefulWidget {
  const _GiveAccountSheet({required this.partner});

  final Partner partner;

  @override
  State<_GiveAccountSheet> createState() => _GiveAccountSheetState();
}

class _GiveAccountSheetState extends State<_GiveAccountSheet> {
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
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
            AppAlert(
              title: 'This person does not work here.',
              message:
                  'They will be able to read the records of every student imported against ${widget.partner.name}, and nothing else.',
              warn: true,
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _fullNameController,
              decoration: const InputDecoration(labelText: 'Full name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _emailController,
              decoration: const InputDecoration(labelText: 'Email address'),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phoneController,
              decoration: const InputDecoration(labelText: 'Phone (optional)'),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: (_fullNameController.text.trim().length >= 2 &&
                            _emailController.text.trim().isNotEmpty)
                        ? () {
                            context.read<PartnersCubit>().createAccount(
                                  partnerId: widget.partner.id,
                                  partnerName: widget.partner.name,
                                  fullName: _fullNameController.text.trim(),
                                  email: _emailController.text.trim(),
                                  phone: _phoneController.text,
                                );
                            Navigator.of(context).pop();
                          }
                        : null,
                    child: const Text('Create account'),
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
