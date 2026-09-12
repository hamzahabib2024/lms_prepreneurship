import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../data/models/partner_invoice.dart';
import '../../data/partner_portal_repository.dart';

/// A PARTNER'S OWN INVOICES — FR-PTR.
///
/// The partner side of the billing the office does. It is the second thing a
/// partner_admin has any reason to open — the first being their students —
/// and until now the portal showed only the students, so an invoice arrived
/// by email and could not be checked against anything.
///
/// Drafts never appear: the server filters them out, and an invoice nobody
/// has issued is not a claim against the partner yet.
class PartnerInvoicesPage extends StatefulWidget {
  const PartnerInvoicesPage({super.key, required this.api});

  final ApiClient api;

  @override
  State<PartnerInvoicesPage> createState() => _PartnerInvoicesPageState();
}

class _PartnerInvoicesPageState extends State<PartnerInvoicesPage> {
  late final PartnerPortalRepository _repo =
      PartnerPortalRepository(api: widget.api);

  List<PartnerInvoice>? _invoices;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final invoices = await _repo.getInvoices();
      if (!mounted) return;
      setState(() {
        _invoices = invoices;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final invoices = _invoices;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoices'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: invoices == null && _error == null
          ? const Padding(padding: EdgeInsets.all(20), child: SkeletonCards())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                children: [
                  if (_error != null)
                    AppAlert(
                      title: 'Your invoices could not be loaded',
                      message: _error!.message,
                      reference: _error!.reference,
                    )
                  else if (invoices!.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 28),
                      child: Text(
                        'No invoices have been raised against your institute '
                        'yet.',
                        style: TextStyle(fontSize: 13, color: muted),
                      ),
                    )
                  else ...[
                    _Outstanding(invoices: invoices),
                    const SizedBox(height: 14),
                    for (final invoice in invoices)
                      _InvoiceRow(
                        invoice: invoice,
                        onOpen: () => _open(invoice),
                      ),
                  ],
                ],
              ),
            ),
    );
  }

  Future<void> _open(PartnerInvoice invoice) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final detail = await _repo.getInvoice(invoice.id);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => _InvoiceSheet(detail: detail),
      );
    } on ApiException catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }
}

class _Outstanding extends StatelessWidget {
  const _Outstanding({required this.invoices});

  final List<PartnerInvoice> invoices;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;

    final owed = invoices.fold<double>(0, (sum, i) => sum + i.outstanding);
    final overdue = invoices.where((i) => i.isOverdue).length;
    final currency = invoices.first.currency;

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
            '$currency ${money(owed)}',
            style: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: owed > 0 ? null : (dark ? AppColorsDark.ok : AppColors.ok),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            owed <= 0 ? 'Nothing outstanding' : 'Outstanding',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          // Overdue is worth naming; simply unpaid is not — an invoice raised
          // yesterday is unpaid and perfectly fine.
          if (overdue > 0) ...[
            const SizedBox(height: 6),
            Text(
              '$overdue invoice${overdue == 1 ? ' is' : 's are'} past the due '
              'date.',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: warnColor,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InvoiceRow extends StatelessWidget {
  const _InvoiceRow({required this.invoice, required this.onOpen});

  final PartnerInvoice invoice;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onOpen,
      child: ListRow(
        title: '${invoice.number} — ${invoice.periodLabel}',
        subtitle: [
          '${invoice.studentCount} student${invoice.studentCount == 1 ? '' : 's'}',
          '${invoice.currency} ${money(invoice.total)}',
          if (invoice.dueDate != null) 'due ${date(invoice.dueDate!)}',
        ].join(' · '),
        warn: invoice.isOverdue,
        trailing: Pill(
          text: invoice.isSettled
              ? 'Paid'
              : invoice.isOverdue
                  ? 'Overdue'
                  : 'Outstanding',
          kind: invoice.isSettled
              ? PillKind.ok
              : invoice.isOverdue
                  ? PillKind.warn
                  : PillKind.neutral,
        ),
      ),
    );
  }
}

class _InvoiceSheet extends StatelessWidget {
  const _InvoiceSheet({required this.detail});

  final PartnerInvoiceDetail detail;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final invoice = detail.invoice;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
        children: [
          Text(
            invoice.number,
            style: const TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 19,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            invoice.periodLabel,
            style: TextStyle(fontSize: 13, color: muted),
          ),
          const SizedBox(height: 10),
          Text(
            '${invoice.currency} ${money(invoice.total)} · '
            '${money(invoice.paid)} paid · '
            '${money(invoice.outstanding)} outstanding',
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
          ),
          if (invoice.dueDate != null)
            Text(
              'Due ${date(invoice.dueDate!)}',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          if (detail.notes != null && detail.notes!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(detail.notes!, style: const TextStyle(fontSize: 13)),
          ],
          const SizedBox(height: 16),
          Text(
            'Students on this invoice',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: muted,
            ),
          ),
          // The names are as they were AT ISSUE. A student who later changes
          // programme does not change an invoice already sent (BR-DAT-02), so
          // these are the figures the partner can check their records against.
          for (final line in detail.lines)
            ListRow(
              title: line.studentName,
              subtitle: [
                if (line.registrationNo != null) line.registrationNo!,
                if (line.programme != null) line.programme!,
                if (line.description != null) line.description!,
              ].join(' · '),
              trailing: Text(
                money(line.amount),
                style: const TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String money(double value) => value
    .toStringAsFixed(0)
    .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

String date(DateTime value) =>
    '${value.day.toString().padLeft(2, '0')}/'
    '${value.month.toString().padLeft(2, '0')}/${value.year}';
