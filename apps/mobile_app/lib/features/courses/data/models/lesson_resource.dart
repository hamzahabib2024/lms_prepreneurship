/// A downloadable file attached to a lesson — handouts, slides, worksheets.
///
/// Maps `GET /lessons/:id/resources`. The storage key is never exposed
/// to the client (ARC-041); downloading uses a separate authenticated
/// endpoint.
class LessonResource {
  const LessonResource({
    required this.id,
    required this.title,
    this.description,
    required this.originalFilename,
    required this.contentType,
    this.sizeBytes = 0,
    this.displayOrder = 0,
    this.publicationStatus = 'DRAFT',
  });

  final String id;
  final String title;
  final String? description;
  final String originalFilename;
  final String contentType;
  final int sizeBytes;
  final int displayOrder;
  final String publicationStatus;

  String get sizeLabel {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  factory LessonResource.fromJson(Map<String, dynamic> json) =>
      LessonResource(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        description: json['description'] as String?,
        originalFilename: json['originalFilename'] as String? ?? '',
        contentType: json['contentType'] as String? ?? '',
        sizeBytes: json['sizeBytes'] as int? ?? 0,
        displayOrder: json['displayOrder'] as int? ?? 0,
        publicationStatus:
            json['publicationStatus'] as String? ?? 'DRAFT',
      );
}
