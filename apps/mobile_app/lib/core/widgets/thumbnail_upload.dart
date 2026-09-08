import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';

class ThumbnailUploadWidget extends StatefulWidget {
  const ThumbnailUploadWidget({
    super.key,
    required this.api,
    required this.entityType,
    required this.entityId,
    this.currentAssetId,
    this.onUploaded,
  });

  final ApiClient api;
  final String entityType;
  final String entityId;
  final String? currentAssetId;
  final ValueChanged<String>? onUploaded;

  @override
  State<ThumbnailUploadWidget> createState() => _ThumbnailUploadWidgetState();
}

class _ThumbnailUploadWidgetState extends State<ThumbnailUploadWidget> {
  bool _uploading = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Thumbnail',
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w500,
            color: muted,
          ),
        ),
        const SizedBox(height: 6),
        Container(
          width: 120,
          height: 80,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          ),
          child: _uploading
              ? const Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : widget.currentAssetId != null
                  ? Stack(
                      alignment: Alignment.center,
                      children: [
                        const Icon(Icons.image_outlined, size: 32),
                        Positioned(
                          top: 4,
                          right: 4,
                          child: GestureDetector(
                            onTap: _pickAndUpload,
                            child: Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Icon(
                                Icons.edit,
                                size: 12,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                  : GestureDetector(
                      onTap: _pickAndUpload,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_photo_alternate_outlined,
                              size: 24, color: muted),
                          const SizedBox(height: 4),
                          Text(
                            'Add',
                            style: TextStyle(fontSize: 11, color: muted),
                          ),
                        ],
                      ),
                    ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 4),
          Text(
            _error!,
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.error,
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _pickAndUpload() async {
    // In a real implementation, this would open image picker
    // For now, simulate with a placeholder
    setState(() {
      _uploading = true;
      _error = null;
    });

    try {
      // Simulated upload
      await Future.delayed(const Duration(seconds: 1));
      final assetId = 'thumb_${widget.entityId}';
      widget.onUploaded?.call(assetId);
    } catch (e) {
      setState(() => _error = 'Upload failed');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }
}
