/// The Institute's public front — SRS §13.2, FR-REG-002, FR-PUB.
///
/// WHAT MAKES THIS DIFFERENT FROM A BROCHURE is that everything on it is
/// REAL. The programmes come from the prospectus, so one the Institute closes
/// stops being advertised the same afternoon; the news is the Institute's own
/// announcements rather than a second list somebody must remember to update.
///
/// AND THE WORDS ARE NOT IN THIS FILE. Headline, body, section headings and
/// buttons all arrive from /public/showcase, edited on the Public page screen
/// by an Admin. A front page whose copy can only be changed by shipping a new
/// build is a front page that describes the Institute as it was two years
/// ago.
library;

class Showcase {
  const Showcase({
    required this.instituteName,
    required this.tagline,
    required this.videos,
    required this.images,
    required this.news,
    required this.copy,
    required this.social,
  });

  final String instituteName;
  final String? tagline;
  final List<ShowcaseVideo> videos;
  final List<ShowcaseImage> images;
  final List<NewsItem> news;
  final ShowcaseCopy copy;

  /// Only the ones actually set. An icon linking nowhere is worse than no
  /// icon, and a row of dead social buttons is the mark of a template.
  final List<SocialLink> social;

  factory Showcase.fromJson(Map<String, dynamic> json) {
    return Showcase(
      instituteName: json['instituteName'] as String? ?? 'Prepreneurship',
      tagline: (json['tagline'] as String?)?.trim(),
      videos: (json['videos'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ShowcaseVideo.fromJson)
          .toList(),
      images: (json['images'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ShowcaseImage.fromJson)
          .toList(),
      news: (json['news'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(NewsItem.fromJson)
          .toList(),
      copy: ShowcaseCopy.fromJson(
        (json['copy'] as Map<String, dynamic>?) ?? const {},
      ),
      social: (json['social'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(SocialLink.fromJson)
          .toList(),
    );
  }
}

/// The Institute's own words for its front page.
///
/// Every field falls back to the sentence that used to be compiled into the
/// web client, so an Institute that has changed nothing sees exactly the page
/// it always had.
class ShowcaseCopy {
  const ShowcaseCopy({
    required this.heroPill,
    required this.heroHeadline,
    required this.heroBody,
    required this.heroPrimaryCta,
    required this.heroSecondaryCta,
    required this.showFeatures,
    required this.features,
    required this.videosHeading,
    required this.videosBlurb,
    required this.newsHeading,
    required this.newsBlurb,
    required this.programmesHeading,
    required this.programmesBlurb,
    required this.showVerify,
    required this.verifyHeading,
    required this.verifyBody,
    required this.verifyCta,
    required this.closingHeading,
    required this.closingBody,
    required this.closingCta,
  });

  final String heroPill;
  final String heroHeadline;
  final String heroBody;
  final String heroPrimaryCta;
  final String heroSecondaryCta;
  final bool showFeatures;
  final List<ShowcaseFeature> features;
  final String videosHeading;
  final String videosBlurb;
  final String newsHeading;
  final String newsBlurb;
  final String programmesHeading;
  final String programmesBlurb;
  final bool showVerify;
  final String verifyHeading;
  final String verifyBody;
  final String verifyCta;
  final String closingHeading;
  final String closingBody;
  final String closingCta;

  factory ShowcaseCopy.fromJson(Map<String, dynamic> json) {
    String str(String key, String fallback) {
      final value = json[key];
      final text = value is String ? value.trim() : '';
      return text.isEmpty ? fallback : text;
    }

    bool flag(String key, bool fallback) =>
        json[key] is bool ? json[key] as bool : fallback;

    return ShowcaseCopy(
      heroPill: str('heroPill', 'Admissions open'),
      heroHeadline: str('heroHeadline', 'Learn a trade you can live on.'),
      heroBody: str(
        'heroBody',
        'Short, practical courses taught by people who do the work.',
      ),
      heroPrimaryCta: str('heroPrimaryCta', 'Apply for admission'),
      heroSecondaryCta: str('heroSecondaryCta', 'Track your application'),
      showFeatures: flag('showFeatures', true),
      features: (json['features'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ShowcaseFeature.fromJson)
          .toList(),
      videosHeading: str('videosHeading', 'See the work'),
      videosBlurb: str('videosBlurb', ''),
      newsHeading: str('newsHeading', 'News'),
      newsBlurb: str('newsBlurb', ''),
      programmesHeading: str('programmesHeading', 'What we teach'),
      programmesBlurb: str('programmesBlurb', ''),
      showVerify: flag('showVerify', true),
      verifyHeading: str('verifyHeading', 'Check a certificate'),
      verifyBody: str(
        'verifyBody',
        'Employers can confirm a certificate is genuine with its code.',
      ),
      verifyCta: str('verifyCta', 'Verify a certificate'),
      closingHeading: str('closingHeading', 'Ready to start?'),
      closingBody: str('closingBody', ''),
      closingCta: str('closingCta', 'Apply for admission'),
    );
  }
}

class ShowcaseFeature {
  const ShowcaseFeature({required this.title, required this.body});

  final String title;
  final String body;

  factory ShowcaseFeature.fromJson(Map<String, dynamic> json) {
    return ShowcaseFeature(
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? json['text'] as String? ?? '',
    );
  }
}

class ShowcaseVideo {
  const ShowcaseVideo({
    required this.url,
    required this.title,
    required this.thumbnailUrl,
  });

  final String url;
  final String? title;
  final String? thumbnailUrl;

  factory ShowcaseVideo.fromJson(Map<String, dynamic> json) {
    return ShowcaseVideo(
      url: json['url'] as String? ?? '',
      title: json['title'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String? ?? json['thumb'] as String?,
    );
  }
}

class ShowcaseImage {
  const ShowcaseImage({required this.url, required this.caption});

  final String url;
  final String? caption;

  factory ShowcaseImage.fromJson(Map<String, dynamic> json) {
    return ShowcaseImage(
      url: json['url'] as String? ?? '',
      caption: json['caption'] as String? ?? json['title'] as String?,
    );
  }
}

/// A public announcement. Deliberately narrow — a stranger gets the notice
/// and the date it was posted, not the author or the audience.
class NewsItem {
  const NewsItem({
    required this.title,
    required this.body,
    required this.publishedAt,
    required this.isPinned,
  });

  final String title;
  final String? body;
  final DateTime? publishedAt;
  final bool isPinned;

  factory NewsItem.fromJson(Map<String, dynamic> json) {
    final published = json['publishedAt'] as String?;
    return NewsItem(
      title: json['title'] as String? ?? '',
      body: json['body'] as String?,
      publishedAt:
          published == null ? null : DateTime.tryParse(published)?.toLocal(),
      isPinned: json['isPinned'] as bool? ?? false,
    );
  }
}

class SocialLink {
  const SocialLink({required this.platform, required this.url});

  final String platform;
  final String url;

  factory SocialLink.fromJson(Map<String, dynamic> json) {
    return SocialLink(
      platform: json['platform'] as String? ?? '',
      url: json['url'] as String? ?? '',
    );
  }
}
