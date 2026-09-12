import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../constants.dart';
import '../network/api_client.dart';
import '../network/api_exception.dart';
import '../theme/app_theme.dart';

/// Choose a picture, and see it immediately — FR-CRS.
///
/// THE PREVIEW IS THE POINT. An upload field that reports "uploaded" and
/// shows nothing leaves an administrator to save, walk to the public page and
/// look — three steps to find out they picked the wrong file. This uploads on
/// selection and draws the result at the size it will actually appear.
///
/// The picture itself is served from the PUBLIC route. A course cover is
/// shown to visitors with no account, so an authenticated URL would be a
/// picture nobody outside the Institute could see.
class ThumbnailUploadWidget extends StatefulWidget {
  const ThumbnailUploadWidget({
    super.key,
    required this.api,
    required this.assetId,
    required this.onChanged,
    this.label = 'Picture',
    this.hint,
  });

  final ApiClient api;

  /// The course-media asset currently set, or null for none.
  final String? assetId;

  /// Called with the new asset id, or null when the picture is removed. The
  /// CALLER saves it — this widget owns the upload, not the record it belongs
  /// to.
  final ValueChanged<String?> onChanged;

  final String label;
  final String? hint;

  @override
  State<ThumbnailUploadWidget> createState() => _ThumbnailUploadWidgetState();
}

class _ThumbnailUploadWidgetState extends State<ThumbnailUploadWidget> {
  bool _uploading = false;
  String? _problem;

  /// The bytes just chosen, drawn while the upload is in flight and until the
  /// public URL has something to serve. Without it the preview goes blank for
  /// the second after a successful upload, which reads as a failure.
  Uint8List? _justPicked;

  Future<void> _pick() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
    );
    if (result.isEmpty) return;
    final picked = result.first;

    // Bytes rather than a path: the server takes multipart, and reading them
    // here is also what lets the preview appear before the upload finishes.
    final Uint8List bytes;
    try {
      bytes = await picked.readAsBytes();
    } catch (_) {
      if (!mounted) return;
      setState(() => _problem = 'That file could not be read.');
      return;
    }

    setState(() {
      _uploading = true;
      _problem = null;
      _justPicked = bytes;
    });

    try {
      final form = FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: picked.name),
      });
      final response =
          await widget.api.uploadForm<Map<String, dynamic>>('/course-media', form);
      final id = response['id'] as String?;
      if (id == null) throw const ApiException(status: 0, message: 'No id returned.');
      if (!mounted) return;
      setState(() => _uploading = false);
      widget.onChanged(id);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _justPicked = null;
        // THE SERVER'S OWN WORDS. It knows why — too large, not an image, an
        // SVG — and each of those has a different thing to do about it.
        _problem = error.details.isNotEmpty
            ? (error.details.first['message'] as String? ?? error.message)
            : error.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final assetId = widget.assetId;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: muted,
          ),
        ),
        const SizedBox(height: 6),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 132,
              height: 88,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: _preview(assetId, muted),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  OutlinedButton.icon(
                    onPressed: _uploading ? null : _pick,
                    icon: const Icon(Icons.upload_outlined, size: 18),
                    label: Text(
                      _uploading
                          ? 'Uploading…'
                          : assetId == null
                              ? 'Choose a picture'
                              : 'Replace',
                    ),
                  ),
                  if (assetId != null)
                    TextButton(
                      onPressed: _uploading
                          ? null
                          : () {
                              setState(() => _justPicked = null);
                              widget.onChanged(null);
                            },
                      child: const Text('Remove'),
                    ),
                  if (widget.hint != null)
                    Text(
                      widget.hint!,
                      style: TextStyle(fontSize: 11.5, color: muted),
                    ),
                  Text(
                    'JPEG, PNG or WebP, up to 3 MB.',
                    style: TextStyle(fontSize: 11.5, color: muted),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (_problem != null) ...[
          const SizedBox(height: 6),
          Text(
            _problem!,
            style: TextStyle(
              fontSize: 12,
              color: dark ? AppColorsDark.error : AppColors.error,
            ),
          ),
        ],
      ],
    );
  }

  Widget _preview(String? assetId, Color muted) {
    if (_justPicked != null) {
      return Stack(
        fit: StackFit.expand,
        children: [
          Image.memory(_justPicked!, fit: BoxFit.cover),
          if (_uploading)
            Container(
              color: Colors.black38,
              child: const Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
        ],
      );
    }

    if (assetId != null) {
      return Image.network(
        publicMediaUrl(assetId),
        fit: BoxFit.cover,
        errorBuilder: (context, error, stack) => Center(
          child: Icon(Icons.broken_image_outlined, size: 26, color: muted),
        ),
      );
    }

    return Center(
      child: Text(
        'No picture',
        style: TextStyle(fontSize: 11.5, color: muted),
      ),
    );
  }
}

/// Where a course picture is served from.
///
/// The PUBLIC route, deliberately: these appear on the Institute's front page
/// to people with no account, so an authenticated address would be a picture
/// only signed-in users could see.
String publicMediaUrl(String assetId) =>
    '${AppConstants.apiBaseUrl}/public/course-media/$assetId';
