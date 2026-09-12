import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';

/// THE CLASS'S MEETING ROOM — FR-LIV.
///
/// One link per class, used every week. Google Meet, Zoom, Teams: the System
/// does not care which, deliberately — an Institute that changes provider next
/// term changes a string, not a feature.
///
/// IT BELONGS TO THE SUBJECT INSIDE THE SECTION, not to the subject. Two
/// sections of the same course are two different classes meeting in two
/// different rooms at two different times, and a link on the course would send
/// both to the same one.
///
/// WHAT THIS REPLACES is the link pasted into a group chat every week, which
/// every student has to scroll back to find and which the student who joined
/// in week three never received at all.
class ClassRoomWidget extends StatefulWidget {
  const ClassRoomWidget({
    super.key,
    required this.api,
    required this.sectionSubjectId,
    required this.meetingUrl,
    required this.meetingNote,
    required this.canManage,
    required this.onSaved,
  });

  final ApiClient api;
  final String sectionSubjectId;
  final String? meetingUrl;
  final String? meetingNote;

  /// Teacher on their own class, or the office on any. Shows the editor.
  final bool canManage;
  final Future<void> Function() onSaved;

  @override
  State<ClassRoomWidget> createState() => _ClassRoomWidgetState();
}

class _ClassRoomWidgetState extends State<ClassRoomWidget> {
  bool _editing = false;

  @override
  Widget build(BuildContext context) {
    final url = widget.meetingUrl;
    final hasLink = url != null && url.isNotEmpty;

    // Nothing set and nobody who can set it: say nothing at all. A permanent
    // "no meeting link" line on every class in a room-taught Institute is a
    // sentence on every screen that never becomes true.
    if (!hasLink && !widget.canManage) return const SizedBox.shrink();

    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
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
          if (hasLink) ...[
            Row(
              children: [
                Icon(Icons.videocam_outlined,
                    size: 19, color: dark ? AppColorsDark.brand600 : AppColors.brand600),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: () => _open(url),
                    child: const Text('Join the class'),
                  ),
                ),
              ],
            ),
            if (widget.meetingNote != null && widget.meetingNote!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(widget.meetingNote!, style: const TextStyle(fontSize: 13)),
            ],
            if (widget.canManage) ...[
              const SizedBox(height: 6),
              // Enough of the link to recognise at a glance, so staff can
              // confirm the class points at this term's room and not last
              // term's — not enough to fill the line.
              Text(
                'Everyone in this class sees this button. ${_short(url)}',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ],
          ] else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.videocam_off_outlined, size: 18, color: muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'No meeting link for this class yet. Set one and every '
                    'student sees it here, every week, without being sent it '
                    'again.',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ),
              ],
            ),

          if (widget.canManage) ...[
            const SizedBox(height: 10),
            if (_editing)
              _RoomEditor(
                api: widget.api,
                sectionSubjectId: widget.sectionSubjectId,
                meetingUrl: widget.meetingUrl,
                meetingNote: widget.meetingNote,
                onDone: (changed) async {
                  setState(() => _editing = false);
                  if (changed) await widget.onSaved();
                },
              )
            else
              OutlinedButton(
                onPressed: () => setState(() => _editing = true),
                child: Text(hasLink ? 'Change the link' : 'Set the meeting link'),
              ),
          ],
        ],
      ),
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    // externalApplication, not an in-app view: the room is somebody else's
    // site and it belongs in the provider's own app where the camera and
    // microphone permissions already are.
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('That link could not be opened.')),
      );
    }
  }

  static String _short(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.host.isEmpty) return url;
    final path = uri.path.endsWith('/')
        ? uri.path.substring(0, uri.path.length - 1)
        : uri.path;
    return '${uri.host}$path';
  }
}

class _RoomEditor extends StatefulWidget {
  const _RoomEditor({
    required this.api,
    required this.sectionSubjectId,
    required this.meetingUrl,
    required this.meetingNote,
    required this.onDone,
  });

  final ApiClient api;
  final String sectionSubjectId;
  final String? meetingUrl;
  final String? meetingNote;
  final void Function(bool changed) onDone;

  @override
  State<_RoomEditor> createState() => _RoomEditorState();
}

class _RoomEditorState extends State<_RoomEditor> {
  late final TextEditingController _url =
      TextEditingController(text: widget.meetingUrl ?? '');
  late final TextEditingController _note =
      TextEditingController(text: widget.meetingNote ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.put<dynamic>(
        '/section-subjects/${widget.sectionSubjectId}/meeting-link',
        {
          'meetingUrl': _url.text.trim(),
          'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        },
      );
      widget.onDone(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        // THE DETAILS, NOT THE TOP-LINE MESSAGE.
        //
        // The server refuses an http:// link and says why — the address of a
        // room handed over an unencrypted connection is the address of a room
        // anybody on the same café wifi can read. That sentence is in the
        // envelope's details; the top-level message on a validation failure is
        // the generic "The submitted data could not be accepted", which tells
        // a teacher staring at a pasted link precisely nothing (NFR-USE-007).
        final lines = serverDetailLines(error);
        _error = lines.isEmpty ? error.message : lines.join(' ');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _url,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'The meeting link',
            hintText: 'https://meet.google.com/abc-defg-hij',
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 6),
        // Said before it is refused rather than after. A teacher who pastes
        // what their browser shows them — which often omits the scheme —
        // should not have to learn the rule from an error.
        Text(
          'Paste the whole address, including the https:// at the front. Any '
          'provider works. Clearing the box removes the link.',
          style: TextStyle(fontSize: 12, color: muted),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _note,
          decoration: const InputDecoration(
            labelText: 'Anything they should know (optional)',
            hintText: 'Join five minutes early — the passcode is in the notice.',
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          AppAlert(title: 'That link could not be saved', message: _error!),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? 'Saving…' : 'Save'),
            ),
            const SizedBox(width: 10),
            TextButton(
              onPressed: _busy ? null : () => widget.onDone(false),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ],
    );
  }
}
