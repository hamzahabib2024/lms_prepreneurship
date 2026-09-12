import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/course_admin_repository.dart';
import '../data/models/course_admin_models.dart';

/// What a course costs, and which of those prices is live — FR-FEE.
///
/// The course list showed "Fee: Published" as a chip with nothing behind it,
/// so an administrator could see that a price existed and could not read it,
/// publish a draft, or take a live one down.
///
/// PUBLISHED IS WITHDRAWN, DRAFT IS DELETED, and they are different acts. A
/// published structure has been quoted to applicants and may already have
/// been charged against; withdrawing stops it being offered from now on and
/// leaves everything it priced alone. Deleting is for a draft nobody has
/// seen. Offering one verb for both would eventually erase a price somebody
/// had already paid.
class FeeStructuresSheet extends StatefulWidget {
  const FeeStructuresSheet({
    super.key,
    required this.api,
    required this.programmeId,
    required this.programmeName,
  });

  final ApiClient api;
  final String programmeId;
  final String programmeName;

  @override
  State<FeeStructuresSheet> createState() => _FeeStructuresSheetState();
}

class _FeeStructuresSheetState extends State<FeeStructuresSheet> {
  late final CourseAdminRepository _repo = CourseAdminRepository(widget.api);

  List<FeeStructure>? _structures;
  ApiException? _error;
  String? _busyId;

  /// True once anything has changed, so the caller knows to reload the list
  /// behind the sheet rather than reloading it on every open.
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final structures = await _repo.getFeeStructures(widget.programmeId);
      if (!mounted) return;
      setState(() {
        _structures = structures;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<void> _act(String id, Future<void> Function() action) async {
    setState(() {
      _busyId = id;
      _error = null;
    });
    try {
      await action();
      _changed = true;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _confirmWithdraw(FeeStructure structure) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Withdraw ${structure.name}?'),
        content: const Text(
          'Applicants stop being quoted it from now on. Fees already charged '
          'against it are untouched.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (go == true) {
      await _act(structure.id, () => _repo.archiveFeeStructure(structure.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final structures = _structures;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (context, controller) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) Navigator.of(context).pop(_changed);
        },
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: [
            Text(
              'Fees for ${widget.programmeName}',
              style: const TextStyle(
                fontFamily: AppFonts.display,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),

            if (_error != null) ...[
              AppAlert(
                title: 'That did not work',
                message: _error!.message,
                details: serverDetailLines(_error!),
                reference: _error!.reference,
              ),
              const SizedBox(height: 12),
            ],

            if (structures == null)
              const SkeletonCards(count: 2)
            else if (structures.isEmpty)
              Text(
                'No fee structure has been written for this course yet, so '
                'applicants are quoted nothing.',
                style: TextStyle(fontSize: 13, color: muted),
              )
            else
              for (final structure in structures)
                _StructureRow(
                  structure: structure,
                  busy: _busyId == structure.id,
                  onPublish: () => _act(
                    structure.id,
                    () => _repo.publishFeeStructure(structure.id),
                  ),
                  onWithdraw: () => _confirmWithdraw(structure),
                  onDelete: () => _act(
                    structure.id,
                    () => _repo.deleteFeeStructure(structure.id),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _StructureRow extends StatelessWidget {
  const _StructureRow({
    required this.structure,
    required this.busy,
    required this.onPublish,
    required this.onWithdraw,
    required this.onDelete,
  });

  final FeeStructure structure;
  final bool busy;
  final VoidCallback onPublish;
  final VoidCallback onWithdraw;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final published = structure.status == 'PUBLISHED';
    final archived = structure.status == 'ARCHIVED';

    return ListRow(
      title: structure.name,
      subtitle: '${structure.currency} '
          '${structure.totalAmount.toStringAsFixed(0)}'
          '${structure.dueAtApplication > 0 ? ' · ${structure.dueAtApplication.toStringAsFixed(0)} due on applying' : ''}',
      trailing: busy
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // Never colour alone: the state is a word (NFR-ACC-003).
                Pill(
                  text: published
                      ? 'Published'
                      : archived
                          ? 'Withdrawn'
                          : 'Draft',
                  kind: published
                      ? PillKind.ok
                      : archived
                          ? PillKind.warn
                          : PillKind.neutral,
                ),
                if (published)
                  TextButton(
                    onPressed: onWithdraw,
                    style: _tight,
                    child: const Text('Withdraw'),
                  )
                else if (!archived) ...[
                  TextButton(
                    onPressed: onPublish,
                    style: _tight,
                    child: const Text('Publish'),
                  ),
                  TextButton(
                    onPressed: onDelete,
                    style: _tight,
                    child: const Text('Delete'),
                  ),
                ],
              ],
            ),
    );
  }

  static final _tight = TextButton.styleFrom(
    padding: const EdgeInsets.symmetric(horizontal: 6),
    minimumSize: Size.zero,
    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
  );
}
