import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';

class FeePlanBuilderPage extends StatefulWidget {
  const FeePlanBuilderPage({
    super.key,
    required this.api,
    required this.studentId,
    required this.studentName,
    required this.registrationNo,
    required this.totalFee,
    required this.currency,
  });

  final ApiClient api;
  final String studentId;
  final String studentName;
  final String registrationNo;
  final num totalFee;
  final String currency;

  @override
  State<FeePlanBuilderPage> createState() => _FeePlanBuilderPageState();
}

class _FeePlanBuilderPageState extends State<FeePlanBuilderPage> {
  List<_Instalment> _instalments = [];
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    if (widget.totalFee > 0) {
      _instalments.add(_Instalment(
        label: 'Instalment 1',
        amount: widget.totalFee,
      ));
    }
  }

  num get _totalAssigned => _instalments.fold(0, (sum, i) => sum + i.amount);
  num get _remaining => widget.totalFee - _totalAssigned;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fee plan'),
        backgroundColor: theme.colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.studentName, style: theme.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    Text('Reg: ${widget.registrationNo}', style: TextStyle(fontSize: 13, color: muted)),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Total fee', style: TextStyle(fontSize: 13, color: muted)),
                        Text('${widget.currency} ${widget.totalFee}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Assigned', style: TextStyle(fontSize: 13, color: muted)),
                        Text('${widget.currency} $_totalAssigned', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Remaining', style: TextStyle(fontSize: 13, color: muted)),
                        Text(
                          '${widget.currency} $_remaining',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: _remaining < 0 ? AppColors.error : AppColors.ok,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Text('Instalments', style: theme.textTheme.titleSmall),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _instalments.add(_Instalment(
                          label: 'Instalment ${_instalments.length + 1}',
                          amount: 0,
                        ));
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              for (int i = 0; i < _instalments.length; i++)
                _InstalmentTile(
                  instalment: _instalments[i],
                  index: i,
                  currency: widget.currency,
                  onChanged: (updated) {
                    setState(() => _instalments[i] = updated);
                  },
                  onRemove: _instalments.length > 1
                      ? () => setState(() => _instalments.removeAt(i))
                      : null,
                ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _remaining == 0 && _totalAssigned > 0 ? _save : null,
                  child: const Text('Save fee plan'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _save() async {
    try {
      final instalments = _instalments.map((i) => {
        'label': i.label,
        'amount': i.amount,
        if (i.dueDate != null) 'dueDate': i.dueDate!.toIso8601String(),
      }).toList();

      await widget.api.post<dynamic>(
        '/students/${widget.studentId}/fee-plan',
        {
          'totalFee': widget.totalFee,
          'currency': widget.currency,
          'instalments': instalments,
        },
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Fee plan saved')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save: $e')),
        );
      }
    }
  }
}

class _Instalment {
  _Instalment({
    required this.label,
    required this.amount,
    this.dueDate,
  });

  String label;
  num amount;
  DateTime? dueDate;
}

class _InstalmentTile extends StatefulWidget {
  const _InstalmentTile({
    required this.instalment,
    required this.index,
    required this.currency,
    required this.onChanged,
    this.onRemove,
  });

  final _Instalment instalment;
  final int index;
  final String currency;
  final ValueChanged<_Instalment> onChanged;
  final VoidCallback? onRemove;

  @override
  State<_InstalmentTile> createState() => _InstalmentTileState();
}

class _InstalmentTileState extends State<_InstalmentTile> {
  late TextEditingController _labelCtrl;
  late TextEditingController _amountCtrl;

  @override
  void initState() {
    super.initState();
    _labelCtrl = TextEditingController(text: widget.instalment.label);
    _amountCtrl = TextEditingController(text: widget.instalment.amount > 0 ? '${widget.instalment.amount}' : '');
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _amountCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _labelCtrl,
                  decoration: const InputDecoration(labelText: 'Label', isDense: true),
                  onChanged: (v) {
                    widget.instalment.label = v;
                    widget.onChanged(widget.instalment);
                  },
                ),
              ),
              if (widget.onRemove != null) ...[
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: widget.onRemove,
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _amountCtrl,
                  decoration: InputDecoration(
                    labelText: 'Amount',
                    prefixText: '${widget.currency} ',
                    isDense: true,
                  ),
                  keyboardType: TextInputType.number,
                  onChanged: (v) {
                    widget.instalment.amount = num.tryParse(v) ?? 0;
                    widget.onChanged(widget.instalment);
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InkWell(
                  onTap: _pickDate,
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Due date',
                      isDense: true,
                      suffixIcon: Icon(Icons.calendar_today, size: 16),
                    ),
                    child: Text(
                      widget.instalment.dueDate != null
                          ? '${widget.instalment.dueDate!.day}/${widget.instalment.dueDate!.month}/${widget.instalment.dueDate!.year}'
                          : 'Select',
                      style: TextStyle(
                        fontSize: 13,
                        color: widget.instalment.dueDate != null
                            ? null
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: widget.instalment.dueDate ?? DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => widget.instalment.dueDate = picked);
      widget.onChanged(widget.instalment);
    }
  }
}
