import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../data/models/partner_invoice.dart';
import '../../data/partner_repository.dart';

/// BILLING A PARTNER INSTITUTE — FR-PTR.
///
/// The preview comes first and cannot be skipped, because the three lists it
/// returns are the whole point. A total on its own is a number the partner
/// has to take on trust; these say who is in it, who was left off because
/// they are already billed, and who could not be priced at all — and that
/// last list is rows to fix BEFORE an invoice goes out, not after it is
/// queried.
class PartnerBillingPage extends StatefulWidget {
  const PartnerBillingPage({
    super.key,
    required this.api,
    required this.partnerId,
    required this.partnerName,
  });

  final ApiClient api;
  final String partnerId;
  final String partnerName;

  @override
  State<PartnerBillingPage> createState() => _PartnerBillingPageState();
}

class _PartnerBillingPageState extends State<PartnerBillingPage> {
  late final PartnerRepository _repo = PartnerRepository(api: widget.api);
  final _period = TextEditingController();
  final _notes = TextEditingController();

  BillingPreview? _preview;
  DateTime? _dueDate;
  bool _loading = true;
  bool _raising = false;
  ApiException? _error;
  PartnerInvoice? _raised;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _period.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final preview = await _repo.billingPreview(widget.partnerId);
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _raise() async {
    setState(() {
      _raising = true;
      _error = null;
    });
    try {
      final invoice = await _repo.createInvoice(
        partnerId: widget.partnerId,
        periodLabel: _period.text,
        dueDate: _dueDate,
        notes: _notes.text,
      );
      if (!mounted) return;
      setState(() {
        _raising = false;
        _raised = invoice;
      });
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _raising = false;
        _error = error;
      });
    }
  }

  Future<void> _pickDueDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate ?? now.add(const Duration(days: 30)),
      firstDate: now,
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _dueDate = picked);
  }

  Future<void> _confirmRaise() async {
    final preview = _preview!;
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Raise this invoice?'),
        content: Text(
          '${preview.billable.length} student'
          '${preview.billable.length == 1 ? '' : 's'}, '
          '${preview.currency} ${_money(preview.total)}, to '
          '${preview.partnerName}.\n\n'
          'This is a claim for money against another organisation, so you may '
          'be asked to sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not yet'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Raise it'),
          ),
        ],
      ),
    );
    if (go == true) await _raise();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final preview = _preview;

    return Scaffold(
      appBar: AppBar(
        title: Text('Bill ${widget.partnerName}'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(20), child: SkeletonCards())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                children: [
                  if (_error != null) ...[
                    AppAlert(
                      title: _error!.status == 401
                          ? 'Sign in again to raise this'
                          : 'That did not work',
                      message: _error!.message,
                      details: serverDetailLines(_error!),
                      reference: _error!.reference,
                    ),
                    const SizedBox(height: 14),
                  ],
                  if (_raised != null) ...[
                    AppAlert(
                      title: 'Invoice ${_raised!.number} raised',
                      message: '${_raised!.periodLabel} — '
                          '${_raised!.currency} ${_money(_raised!.total)} for '
                          '${_raised!.studentCount} student'
                          '${_raised!.studentCount == 1 ? '' : 's'}.',
                      warn: true,
                    ),
                    const SizedBox(height: 14),
                  ],
                  if (preview == null)
                    Text(
                      'The billing preview could not be read.',
                      style: TextStyle(fontSize: 13, color: muted),
                    )
                  else ...[
                    _Total(preview: preview),
                    const SizedBox(height: 16),

                    _Group(
                      title: 'On this invoice',
                      count: preview.billable.length,
                      emptyText: 'Nobody is billable right now.',
                      children: [
                        for (final student in preview.billable)
                          ListRow(
                            title: student.name,
                            subtitle:
                                '${student.registrationNo}${student.programme == null ? '' : ' · ${student.programme}'}',
                            trailing: Text(
                              _money(student.amount),
                              style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                      ],
                    ),

                    // Not an error, just an explanation: nothing is billed
                    // twice, and the invoice number says where to look.
                    if (preview.alreadyBilled.isNotEmpty)
                      _Group(
                        title: 'Already billed',
                        count: preview.alreadyBilled.length,
                        emptyText: '',
                        children: [
                          for (final student in preview.alreadyBilled)
                            ListRow(
                              title: student.name,
                              subtitle:
                                  '${student.registrationNo} · on ${student.onInvoice}',
                            ),
                        ],
                      ),

                    // THE LIST THAT MATTERS. These students will silently be
                    // left off unless somebody acts, so the reason is given
                    // per person rather than as one summary line.
                    if (preview.unpriced.isNotEmpty)
                      _Group(
                        title: 'Cannot be priced',
                        count: preview.unpriced.length,
                        emptyText: '',
                        warn: true,
                        children: [
                          for (final student in preview.unpriced)
                            ListRow(
                              title: student.name,
                              subtitle:
                                  '${student.registrationNo} · ${student.why}',
                              warn: true,
                            ),
                        ],
                      ),

                    const SizedBox(height: 18),
                    TextField(
                      controller: _period,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'What this invoice covers',
                        hintText: 'Spring 2026, Graphic Designing',
                        // A date range alone tells the reader nothing they can
                        // check against their own records.
                        helperText: 'In your own words — the partner reads this.',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _pickDueDate,
                      icon: const Icon(Icons.event_outlined, size: 18),
                      label: Text(
                        _dueDate == null
                            ? 'Due date (optional)'
                            : 'Due ${_date(_dueDate!)}',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _notes,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'Notes (optional)',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: !preview.canRaise ||
                              _period.text.trim().length < 3 ||
                              _raising
                          ? null
                          : _confirmRaise,
                      child: Text(_raising ? 'Raising…' : 'Raise the invoice'),
                    ),
                    if (!preview.canRaise) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Nothing to bill: every partner-paid student is either '
                        'already on an invoice or cannot be priced.',
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                    ],
                  ],
                ],
              ),
            ),
    );
  }

  static String _money(double value) => value
      .toStringAsFixed(0)
      .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

  static String _date(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/'
      '${value.month.toString().padLeft(2, '0')}/${value.year}';
}

class _Total extends StatelessWidget {
  const _Total({required this.preview});

  final BillingPreview preview;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${preview.currency} ${_PartnerBillingPageState._money(preview.total)}',
            style: const TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 24,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${preview.billable.length} student'
            '${preview.billable.length == 1 ? '' : 's'} would be invoiced',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
        ],
      ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({
    required this.title,
    required this.count,
    required this.emptyText,
    required this.children,
    this.warn = false,
  });

  final String title;
  final int count;
  final String emptyText;
  final List<Widget> children;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$title ($count)',
            style: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: warn ? warnColor : null,
            ),
          ),
          const SizedBox(height: 2),
          if (children.isEmpty && emptyText.isNotEmpty)
            Text(emptyText, style: TextStyle(fontSize: 13, color: muted))
          else
            ...children,
        ],
      ),
    );
  }
}
