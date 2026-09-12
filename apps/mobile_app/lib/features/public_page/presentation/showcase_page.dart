import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/application/application_page.dart';
import '../../admission/application/track_application_page.dart';
import '../../admission/data/admission_repository.dart';
import '../../admission/data/models/prospectus.dart';
import '../../certificates/presentation/verify_page.dart';
import '../data/models/showcase.dart';
import '../data/public_page_repository.dart';

/// THE PUBLIC FRONT OF THE INSTITUTE — SRS §13.2, FR-REG-002.
///
/// The mobile counterpart of the web's LandingPage, reachable from the sign-in
/// screen. Somebody who has downloaded the app but has no account had nothing
/// to look at: they were asked for a password and offered a form.
///
/// WHAT MAKES THIS DIFFERENT FROM A BROCHURE is that everything on it is real.
/// The programmes come from /public/prospectus, so one the Institute closes
/// stops being advertised the same afternoon. The news is the Institute's own
/// announcements, filtered to the public ones, rather than a second list that
/// would drift from what students were actually told.
///
/// WHAT IT DOES NOT CLAIM is the other half. No invented student numbers, no
/// "trusted by thousands", no testimonials from people who do not exist —
/// partly because that is a lie the Institute then has to keep, and partly
/// because a page that overclaims makes a reader doubt the parts that are
/// true.
class ShowcasePage extends StatefulWidget {
  const ShowcasePage({super.key, required this.api});

  final ApiClient api;

  @override
  State<ShowcasePage> createState() => _ShowcasePageState();
}

class _ShowcasePageState extends State<ShowcasePage> {
  Showcase? _showcase;
  List<ProspectusProgramme> _programmes = const [];
  ApiException? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    // The two halves are independent: a prospectus that fails should not cost
    // the visitor the whole page, and copy that fails should not hide the
    // programmes. So each is caught on its own.
    Showcase? showcase;
    ApiException? error;
    try {
      showcase = await PublicPageRepository(widget.api).getShowcase();
    } on ApiException catch (e) {
      error = e;
    }

    var programmes = const <ProspectusProgramme>[];
    try {
      programmes = await AdmissionRepository(api: widget.api).prospectus();
    } on ApiException {
      // Nothing to say: the page simply has no programmes section.
    }

    if (!mounted) return;
    setState(() {
      _showcase = showcase;
      _programmes = programmes;
      _error = error;
      _loading = false;
    });
  }

  void _apply() => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const ApplicationPage()),
      );

  void _track() => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const TrackApplicationPage()),
      );

  void _verify() => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => VerifyPage(api: widget.api)),
      );

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final showcase = _showcase;

    return Scaffold(
      appBar: AppBar(
        title: Text(showcase?.instituteName ?? 'Prepreneurship'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(20), child: SkeletonCards())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 36),
                children: [
                  // A headline is better than a blank screen: if the showcase
                  // request failed outright the page still offers the two
                  // things a visitor came for.
                  if (showcase == null) ...[
                    AppAlert(
                      title: 'The Institute’s page could not be loaded',
                      message: _error?.message ??
                          'Check your connection and pull to refresh.',
                      reference: _error?.reference,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _apply,
                      child: const Text('Apply for admission'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: _track,
                      child: const Text('Track your application'),
                    ),
                  ] else ...[
                    _Hero(
                      showcase: showcase,
                      onApply: _apply,
                      onTrack: _track,
                    ),

                    if (showcase.copy.showFeatures &&
                        showcase.copy.features.isNotEmpty)
                      _Features(features: showcase.copy.features),

                    if (showcase.videos.isNotEmpty)
                      _Section(
                        heading: showcase.copy.videosHeading,
                        blurb: showcase.copy.videosBlurb,
                        child: Column(
                          children: [
                            for (final video in showcase.videos)
                              ListRow(
                                leading: Icon(Icons.play_circle_outline,
                                    size: 22, color: muted),
                                title: video.title ?? video.url,
                                trailing: IconButton(
                                  icon: const Icon(Icons.open_in_new, size: 18),
                                  onPressed: () => _open(video.url),
                                ),
                              ),
                          ],
                        ),
                      ),

                    if (showcase.news.isNotEmpty)
                      _Section(
                        heading: showcase.copy.newsHeading,
                        blurb: showcase.copy.newsBlurb,
                        child: Column(
                          children: [
                            for (final item in showcase.news)
                              ListRow(
                                title: item.title,
                                subtitle: [
                                  if (item.publishedAt != null)
                                    _date(item.publishedAt!),
                                  if (item.body != null && item.body!.isNotEmpty)
                                    item.body!,
                                ].join('\n'),
                                trailing: item.isPinned
                                    ? const Pill(text: 'Pinned')
                                    : null,
                              ),
                          ],
                        ),
                      ),

                    if (_programmes.isNotEmpty)
                      _Section(
                        heading: showcase.copy.programmesHeading,
                        blurb: showcase.copy.programmesBlurb,
                        child: Column(
                          children: [
                            for (final programme in _programmes)
                              _ProgrammeCard(programme: programme),
                          ],
                        ),
                      ),

                    if (showcase.copy.showVerify)
                      _Band(
                        heading: showcase.copy.verifyHeading,
                        body: showcase.copy.verifyBody,
                        cta: showcase.copy.verifyCta,
                        onPressed: _verify,
                        primary: false,
                      ),

                    _Band(
                      heading: showcase.copy.closingHeading,
                      body: showcase.copy.closingBody,
                      cta: showcase.copy.closingCta,
                      onPressed: _apply,
                      primary: true,
                    ),

                    if (showcase.social.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        children: [
                          for (final link in showcase.social)
                            IconButton(
                              tooltip: link.platform,
                              icon: Icon(_socialIcon(link.platform), size: 22),
                              onPressed: () => _open(link.url),
                            ),
                        ],
                      ),
                    ],
                  ],
                ],
              ),
            ),
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('That link could not be opened.')),
      );
    }
  }

  static IconData _socialIcon(String platform) => switch (platform) {
        'youtube' => Icons.smart_display_outlined,
        'facebook' => Icons.thumb_up_alt_outlined,
        'instagram' => Icons.camera_alt_outlined,
        'tiktok' => Icons.music_note_outlined,
        _ => Icons.link,
      };

  static String _date(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/'
      '${value.month.toString().padLeft(2, '0')}/${value.year}';
}

class _Hero extends StatelessWidget {
  const _Hero({
    required this.showcase,
    required this.onApply,
    required this.onTrack,
  });

  final Showcase showcase;
  final VoidCallback onApply;
  final VoidCallback onTrack;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final copy = showcase.copy;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (copy.heroPill.isNotEmpty) ...[
          Pill(text: copy.heroPill, kind: PillKind.ok),
          const SizedBox(height: 10),
        ],
        Text(
          copy.heroHeadline,
          style: const TextStyle(
            fontFamily: AppFonts.display,
            fontSize: 27,
            height: 1.2,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (showcase.tagline != null) ...[
          const SizedBox(height: 4),
          Text(
            showcase.tagline!,
            style: TextStyle(fontSize: 14, color: muted),
          ),
        ],
        if (copy.heroBody.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(
            copy.heroBody,
            style: TextStyle(fontSize: 14, height: 1.5, color: muted),
          ),
        ],
        const SizedBox(height: 18),
        FilledButton(onPressed: onApply, child: Text(copy.heroPrimaryCta)),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: onTrack, child: Text(copy.heroSecondaryCta)),
      ],
    );
  }
}

class _Features extends StatelessWidget {
  const _Features({required this.features});

  final List<ShowcaseFeature> features;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Padding(
      padding: const EdgeInsets.only(top: 26),
      child: Column(
        children: [
          for (final feature in features)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: dark ? AppColorsDark.line : AppColors.line,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    feature.title,
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (feature.body.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      feature.body,
                      style: TextStyle(fontSize: 13, height: 1.45, color: muted),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.heading,
    required this.blurb,
    required this.child,
  });

  final String heading;
  final String blurb;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Padding(
      padding: const EdgeInsets.only(top: 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            heading,
            style: const TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 19,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (blurb.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(blurb, style: TextStyle(fontSize: 13, color: muted)),
          ],
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

class _ProgrammeCard extends StatelessWidget {
  const _ProgrammeCard({required this.programme});

  final ProspectusProgramme programme;

  static const _shift = <String, String>{
    'MORNING': 'Morning',
    'EVENING': 'Evening',
    'WEEKEND': 'Weekend',
  };

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
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
            programme.name,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          Text(
            [
              programme.code,
              if (programme.durationWeeks != null)
                '${programme.durationWeeks} weeks',
            ].join(' · '),
            style: TextStyle(fontSize: 12, color: muted),
          ),
          if (programme.description != null &&
              programme.description!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              programme.description!,
              style: TextStyle(fontSize: 13, height: 1.45, color: muted),
            ),
          ],
          if (programme.sections.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                // The sections currently taking students — the difference
                // between "we teach this" and "you can start in January".
                for (final section in programme.sections)
                  Pill(
                    text: [
                      _shift[section.shift] ?? section.shift,
                      section.session,
                    ].join(' · '),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Band extends StatelessWidget {
  const _Band({
    required this.heading,
    required this.body,
    required this.cta,
    required this.onPressed,
    required this.primary,
  });

  final String heading;
  final String body;
  final String cta;
  final VoidCallback onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 26),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: primary
            ? (dark ? AppColorsDark.brand050 : AppColors.brand050)
            : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            heading,
            style: const TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              body,
              style: TextStyle(fontSize: 13, height: 1.45, color: muted),
            ),
          ],
          const SizedBox(height: 12),
          if (primary)
            FilledButton(onPressed: onPressed, child: Text(cta))
          else
            OutlinedButton(onPressed: onPressed, child: Text(cta)),
        ],
      ),
    );
  }
}
