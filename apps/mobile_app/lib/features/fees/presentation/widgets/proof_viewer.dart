import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../data/models/fees_models.dart';

/// THE PROOF OF PAYMENT — FR-REG-024.
///
/// THIS IS THE DECISION. A clerk verifying a payment is saying "the money
/// arrived", and the slip is the evidence. The verification queue showed only
/// a COUNT of attached files — "2 proofs" — so the one thing the decision
/// rests on was the one thing nobody could see.
///
/// FETCHED, NOT LINKED. The object is somebody's bank record and the endpoint
/// needs a bearer token (SEC-FIL-009), so there is no URL to hand an Image
/// widget: the bytes come through the client and are drawn from memory.
class ProofViewer extends StatelessWidget {
  const ProofViewer({
    super.key,
    required this.proofs,
    required this.load,
  });

  final List<ProofFile> proofs;

  /// Fetches one document's bytes. Passed in rather than taken as a
  /// repository and an id, because an applicant's admission slip and a
  /// student's payment proof are the same kind of object reached through
  /// different doors, and this widget has no business knowing which.
  final Future<List<int>> Function(ProofFile) load;

  @override
  Widget build(BuildContext context) {
    if (proofs.isEmpty) {
      // Said as a warning rather than left as an empty space: a clerk must
      // not verify a payment they have no evidence of.
      return const AppAlert(
        title: 'No proof is attached',
        message:
            'Do not verify this on the strength of the claimed amount alone — '
            'check the bank record yourself, or ask the student to send the '
            'receipt.',
        warn: true,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final proof in proofs)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _ProofCard(proof: proof, load: load),
          ),
      ],
    );
  }
}

class _ProofCard extends StatefulWidget {
  const _ProofCard({required this.proof, required this.load});

  final ProofFile proof;
  final Future<List<int>> Function(ProofFile) load;

  @override
  State<_ProofCard> createState() => _ProofCardState();
}

class _ProofCardState extends State<_ProofCard> {
  Uint8List? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final bytes = await widget.load(widget.proof);
      if (!mounted) return;
      setState(() => _bytes = Uint8List.fromList(bytes));
    } on ApiException {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final proof = widget.proof;

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    proof.sizeBytes == null
                        ? proof.filename
                        : '${proof.filename} · '
                            '${math.max(1, (proof.sizeBytes! / 1024).round())} KB',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ),
                // SEC-FIL-004 — said plainly. No scanner is wired up yet, and
                // somebody opening an attachment from a stranger should know
                // that rather than assume the System checked it.
                if (proof.scanStatus != null && proof.scanStatus != 'CLEAN')
                  const Pill(text: 'Not virus-scanned', kind: PillKind.warn),
              ],
            ),
          ),
          if (_failed)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Text(
                'The file could not be loaded. It may have been removed from '
                'storage — the record of it remains.',
                style: TextStyle(
                  fontSize: 12.5,
                  color: dark ? AppColorsDark.error : AppColors.error,
                ),
              ),
            )
          else if (_bytes == null)
            const SizedBox(
              height: 180,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (proof.isPdf)
            // A PDF cannot be drawn here without a renderer the app does not
            // carry. Saying so beats an empty frame — and the filename plus
            // the bank reference on the submission is usually what the clerk
            // is checking anyway.
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                children: [
                  Icon(Icons.picture_as_pdf_outlined, size: 20, color: muted),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'This receipt is a PDF and cannot be shown on the phone. '
                      'Open it on the web client to read it.',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ),
                ],
              ),
            )
          else
            // Full size on tap, because a bank reference printed small on a
            // phone photograph is exactly the thing that has to be read.
            GestureDetector(
              onTap: () => _openFullScreen(context, _bytes!),
              child: Image.memory(
                _bytes!,
                fit: BoxFit.fitWidth,
                errorBuilder: (context, error, stack) => Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    'This file is not an image the phone can draw.',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _openFullScreen(BuildContext context, Uint8List bytes) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(widget.proof.filename)),
          backgroundColor: Colors.black,
          body: Center(
            child: InteractiveViewer(
              maxScale: 6,
              child: Image.memory(bytes),
            ),
          ),
        ),
      ),
    );
  }
}
