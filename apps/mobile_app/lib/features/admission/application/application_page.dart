import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/admission_repository.dart';
import '../data/models/application_draft.dart';
import '../data/models/prospectus.dart';
import '../data/models/submission_result.dart';
import '../widgets/form_controls.dart';
import 'application_cubit.dart';
import 'track_application_page.dart';

/// The public application — SRS §13.2, FR-REG-001..010.
///
/// NO ACCOUNT, and that is the requirement: somebody who has not enrolled
/// cannot have a login, so every field here goes to a public endpoint and the
/// only thing they get back is a tracking reference.
///
/// IN STEPS, because it is nineteen fields and a file — the web form's
/// ordering, with the easiest questions first and the payment last, once the
/// applicant has already invested something.
///
/// NOTHING IS SUBMITTED UNTIL THE LAST STEP: the slip uploads early because
/// they must exist before the application names them, but no application is
/// created until the button is pressed.
class ApplicationPage extends StatefulWidget {
  const ApplicationPage({super.key});

  @override
  State<ApplicationPage> createState() => _ApplicationPageState();
}

class _ApplicationPageState extends State<ApplicationPage> {
  final _draft = ApplicationDraft();
  var _step = 0;

  static const _stepTitles = [
    'What you want to study',
    'About you',
    'How to reach you',
    'Your payment',
  ];

  bool get _currentStepDone {
    return switch (_step) {
      0 => _draft.sectionChosen,
      1 => _draft.aboutComplete,
      2 => _draft.contactComplete,
      _ => _draft.paymentComplete,
    };
  }

  bool get _allStepsDone => _draft.paymentComplete;

  Future<void> _pickSlip(ApplicationCubit cubit) async {
    try {
      // withData must be true for the bytes to come back at all — without it
      // the picker appears to do nothing on every platform.
      final picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['jpg', 'jpeg', 'png', 'pdf'],
        allowMultiple: false,
        withData: true,
      );
      final file = picked?.files.single;
      if (file == null) return;

      final name = file.name.toLowerCase();
      final allowed = ['jpg', 'jpeg', 'png', 'pdf'].any((e) => name.endsWith('.$e'));
      if (!allowed) {
        _showPickError('Choose a photo (JPEG, PNG) or a PDF of the slip.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        _showPickError('That file is larger than 5 MB. Please choose a smaller photo.');
        return;
      }

      var bytes = file.bytes;
      if (bytes == null && file.path != null) {
        bytes = await File(file.path!).readAsBytes();
      }
      if (bytes == null || bytes.isEmpty) {
        _showPickError('That file could not be read. Please try another photo.');
        return;
      }
      await cubit.uploadSlip(filename: file.name, bytes: bytes);
    } on PlatformException catch (error) {
      _showPickError(
        'Your device did not open a file picker (${error.message ?? 'unsupported on this device'}). '
        'Please try again, or send the slip to the office instead.',
      );
    } catch (_) {
      // Picking was cancelled — nothing was selected, nothing was lost.
    }
  }

  void _showPickError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppBar(
        title: const Text('Apply to Prepreneurship'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocProvider(
        create: (_) => ApplicationCubit(
          repository: AdmissionRepository(api: ApiClient()),
        )..start(),
        child: BlocBuilder<ApplicationCubit, ApplicationState>(
          builder: (context, state) {
            switch (state.status) {
              case ApplicationStatus.initial:
              case ApplicationStatus.loading:
                return const SingleChildScrollView(
                  padding: EdgeInsets.all(20),
                  child: SkeletonCards(count: 3),
                );
              case ApplicationStatus.failure:
                return _FailureView(state: state);
              case ApplicationStatus.submitted:
                return _SubmittedView(state: state);
              case ApplicationStatus.ready:
                return _buildForm(context, state);
            }
          },
        ),
      ),
    );
  }

  Widget _buildForm(BuildContext context, ApplicationState state) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    // The slip ids live in the cubit (upload happens before the application
    // exists); the draft is the shape that is posted, so the two must agree
    // for paymentComplete to pass and for documentIds to reach the server.
    _draft.documentIds
      ..clear()
      ..addAll(state.documentIds);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      children: [
        Text(
          'No account needed. It takes about five minutes, and you will need a photo of your payment slip at the end.',
          style: TextStyle(color: muted, fontSize: 13.5, height: 1.5),
        ),
        const SizedBox(height: 16),
        _StepIndicator(
          step: _step,
          titles: _stepTitles,
          draft: _draft,
          onTap: (i) => setState(() => _step = i),
        ),
        const SizedBox(height: 16),
        if (state.error != null) ...[
          AppAlert(
            title: 'That could not be sent',
            message: state.error!.message,
            reference: state.error!.reference,
            details: serverDetailLines(state.error!),
          ),
          const SizedBox(height: 14),
        ],
        switch (_step) {
          0 => _StepProgramme(
              draft: _draft,
              programmes: state.programmes,
              onChange: () => setState(() {}),
            ),
          1 => _StepAbout(draft: _draft, onChange: () => setState(() {})),
          2 => _StepContact(draft: _draft, onChange: () => setState(() {})),
          _ => _StepPayment(
              draft: _draft,
              uploading: state.uploading,
              documentIds: state.documentIds,
              onUpload: () => _pickSlip(context.read<ApplicationCubit>()),
              onRemove: (id) => context.read<ApplicationCubit>().removeSlip(id),
              onChange: () => setState(() {}),
            ),
        },
        const SizedBox(height: 20),
        Row(
          children: [
            if (_step > 0) ...[
              OutlinedButton(
                onPressed: () => setState(() => _step -= 1),
                child: const Text('Back'),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: _step < _stepTitles.length - 1
                  ? FilledButton(
                      onPressed: _currentStepDone
                          ? () {
                              setState(() => _step += 1);
                              context.read<ApplicationCubit>().clearError();
                            }
                          : null,
                      child: const Text('Continue'),
                    )
                  : FilledButton(
                      onPressed: _allStepsDone && !state.submitting
                          ? () => context
                              .read<ApplicationCubit>()
                              .submit(_draft)
                          : null,
                      child: state.submitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                              ),
                            )
                          : const Text('Send my application'),
                    ),
            ),
          ],
        ),
        if (_step == _stepTitles.length - 1 && !_allStepsDone)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              'Still needed: ${_missingSteps.join(', ')}.',
              style: TextStyle(color: dark ? AppColorsDark.warn : AppColors.warn, fontSize: 12.5),
            ),
          ),
      ],
    );
  }

  List<String> get _missingSteps {
    final missing = <String>[];
    if (!_draft.sectionChosen) missing.add('what you want to study');
    if (!_draft.aboutComplete) missing.add('about you');
    if (!_draft.contactComplete) missing.add('how to reach you');
    if (!_draft.paymentComplete) missing.add('your payment');
    return missing;
  }
}

/// The numbered steps — the web's `.steps`. Each is tappable, and a completed
/// step shows its check rather than its number.
class _StepIndicator extends StatelessWidget {
  const _StepIndicator({
    required this.step,
    required this.titles,
    required this.draft,
    required this.onTap,
  });

  final int step;
  final List<String> titles;
  final ApplicationDraft draft;
  final ValueChanged<int> onTap;

  bool _done(int i) => switch (i) {
        0 => draft.sectionChosen,
        1 => draft.aboutComplete,
        2 => draft.contactComplete,
        _ => draft.paymentComplete,
      };

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Row(
      children: [
        for (var i = 0; i < titles.length; i++) ...[
          if (i > 0)
            Expanded(
              child: Container(
                height: 1.5,
                margin: const EdgeInsets.only(bottom: 22),
                color: i <= step || _done(i)
                    ? brand.withValues(alpha: 0.4)
                    : (dark ? AppColorsDark.line : AppColors.line),
              ),
            ),
          Expanded(
            child: InkWell(
              onTap: () => onTap(i),
              borderRadius: BorderRadius.circular(8),
              child: Column(
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == step
                          ? brand
                          : _done(i)
                              ? (dark ? AppColorsDark.ok : AppColors.ok)
                              : (dark ? AppColorsDark.surface2 : AppColors.surface2),
                      border: i == step || _done(i)
                          ? null
                          : Border.all(color: dark ? AppColorsDark.line : AppColors.line),
                    ),
                    child: _done(i)
                        ? const Icon(Icons.check, size: 15, color: Colors.white)
                        : Text(
                            '${i + 1}',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: i == step ? Colors.white : muted,
                            ),
                          ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    titles[i],
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: i == step ? FontWeight.w700 : FontWeight.w500,
                      color: i == step ? (dark ? AppColorsDark.ink : AppColors.ink) : muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// --------------------------------------------------------------- steps ----

class _StepProgramme extends StatelessWidget {
  const _StepProgramme({
    required this.draft,
    required this.programmes,
    required this.onChange,
  });

  final ApplicationDraft draft;
  final List<ProspectusProgramme> programmes;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    final programme = programmes.where((p) => p.id == draft.desiredProgrammeId).firstOrNull;
    final section = programme?.sections.where((s) => s.id == draft.desiredSectionId).firstOrNull;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('What you want to study', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        if (programmes.isEmpty)
          Text(
            'Nothing is open for enrolment at the moment. Please speak to the office.',
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          )
        else ...[
          AdmissionSelectField(
            label: 'Programme',
            value: draft.desiredProgrammeId,
            hint: 'Choose a programme…',
            options: programmes.map((p) => (p.id, p.name)).toList(),
            onChanged: (v) {
              draft.desiredProgrammeId = v;
              // The section belongs to the programme; keeping a stale one
              // would submit a pairing that does not exist.
              draft.desiredSectionId = '';
              onChange();
            },
          ),
          if (programme != null) ...[
            const SizedBox(height: 14),
          AdmissionSelectField(
              label: 'Which section',
              value: draft.desiredSectionId,
              hint: 'Choose a section…',
              options: programme.sections
                  .map((s) => (
                        s.id,
                        '${s.name} — ${_shift(s.shift)}'
                            '${s.isGenderRestricted ? ' (${s.genderRestriction.toLowerCase()} only)' : ''}',
                      ))
                  .toList(),
              onChanged: (v) {
                draft.desiredSectionId = v;
                onChange();
              },
            ),
          ],
          // FR-CRS-009 is absolute, so it is said BEFORE they fill in the rest
          // rather than as a rejection afterwards.
          if (section != null && section.isGenderRestricted)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: AppAlert(
                title: '${section.name} admits ${section.genderRestriction.toLowerCase()} students only',
                message:
                    'If that is not you, please choose another section — this cannot be waived.',
                warn: true,
              ),
            ),
        ],
      ],
    );
  }

  static String _shift(String code) {
    const shifts = {'MORNING': 'Morning', 'AFTERNOON': 'Afternoon', 'EVENING': 'Evening', 'WEEKEND': 'Weekend'};
    return shifts[code] ?? code;
  }
}

class _StepAbout extends StatelessWidget {
  const _StepAbout({required this.draft, required this.onChange});

  final ApplicationDraft draft;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('About you', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        AdmissionFormField(
          label: "Your full name",
          value: draft.fullName,
          maxLength: 200,
          onChanged: (v) { draft.fullName = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: "Your father's or guardian's name",
          value: draft.fatherName,
          maxLength: 200,
          onChanged: (v) { draft.fatherName = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionDateField(
          label: 'Date of birth',
          value: draft.dateOfBirth,
          hint: 'Choose…',
          firstDate: DateTime(1940),
          lastDate: DateTime.now().subtract(const Duration(days: 365 * 10)),
          onChanged: (v) { draft.dateOfBirth = v; onChange(); },
        ),
        const SizedBox(height: 14),
          AdmissionSelectField(
          label: 'Gender',
          value: draft.gender,
          hint: 'Choose…',
          options: const [('FEMALE', 'Female'), ('MALE', 'Male')],
          onChanged: (v) { draft.gender = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'CNIC',
          value: draft.nationalId,
          hint: 'Thirteen digits, with or without dashes.',
          keyboardType: TextInputType.number,
          onChanged: (v) { draft.nationalId = v; onChange(); },
        ),
        const SizedBox(height: 14),
        // The LEVEL from a list, and the detail as free text beside it: a
        // countable part and a describable part, never one free-text answer
        // typed three ways.
          AdmissionSelectField(
          label: 'Your education',
          value: draft.educationLevel,
          hint: 'Choose one…',
          options: AdmissionLabels.educationLevels.toList(),
          onChanged: (v) { draft.educationLevel = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'What exactly, and when',
          value: draft.qualification,
          hint: 'For example: FSc Pre-Engineering, 2024 — or the madrasah and year.',
          maxLength: 120,
          onChanged: (v) { draft.qualification = v; onChange(); },
        ),
      ],
    );
  }
}

class _StepContact extends StatelessWidget {
  const _StepContact({required this.draft, required this.onChange});

  final ApplicationDraft draft;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('How to reach you', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        AdmissionFormField(
          label: 'Mobile number',
          value: draft.phone,
          hint: 'We will use this on WhatsApp for class announcements.',
          keyboardType: TextInputType.phone,
          onChanged: (v) { draft.phone = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'Email address',
          value: draft.email,
          keyboardType: TextInputType.emailAddress,
          errorText: draft.emailInvalid
              ? 'That does not look like a full email address — e.g. name@gmail.com.'
              : null,
          onChanged: (v) { draft.email = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'Address',
          value: draft.address,
          onChanged: (v) { draft.address = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'City',
          value: draft.city,
          onChanged: (v) { draft.city = v; onChange(); },
        ),
        const SizedBox(height: 14),
          AdmissionSelectField(
          label: 'How did you hear about us?',
          value: draft.acquisitionSource,
          hint: 'Choose…',
          options: AdmissionLabels.sources.toList(),
          onChanged: (v) { draft.acquisitionSource = v; onChange(); },
        ),
        // FR-REG-005 — these two require a detail, so the box appears rather
        // than the submission being refused for a missing field the applicant
        // was never shown.
        if (draft.requiresAcquisitionDetail) ...[
          const SizedBox(height: 14),
        AdmissionFormField(
            label: draft.acquisitionSource == 'REFERRAL'
                ? 'Who told you about us?'
                : 'Please tell us more',
            value: draft.acquisitionDetail,
            onChanged: (v) { draft.acquisitionDetail = v; onChange(); },
          ),
        ],
      ],
    );
  }
}

class _StepPayment extends StatelessWidget {
  const _StepPayment({
    required this.draft,
    required this.uploading,
    required this.documentIds,
    required this.onUpload,
    required this.onRemove,
    required this.onChange,
  });

  final ApplicationDraft draft;
  final bool uploading;
  final List<String> documentIds;
  final VoidCallback onUpload;
  final ValueChanged<String> onRemove;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Your payment', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          'Pay the fee into the Institute\'s account, then attach a photo of the slip. '
          'The office checks it against the bank before your place is confirmed.',
          style: TextStyle(color: muted, fontSize: 13, height: 1.5),
        ),
        const SizedBox(height: 16),
        _SlipUpload(
          uploading: uploading,
          documentIds: documentIds,
          canAddMore: documentIds.length < 5,
          onUpload: onUpload,
          onRemove: onRemove,
        ),
        const SizedBox(height: 16),
        AdmissionFormField(
          label: 'Amount you paid',
          value: draft.claimedAmount,
          hint: 'In rupees.',
          keyboardType: TextInputType.number,
          onChanged: (v) { draft.claimedAmount = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionDateField(
          label: 'Date you paid',
          value: draft.claimedPaymentDate,
          hint: 'Choose…',
          firstDate: DateTime.now().subtract(const Duration(days: 365 * 2)),
          lastDate: DateTime.now(),
          onChanged: (v) { draft.claimedPaymentDate = v; onChange(); },
        ),
        const SizedBox(height: 14),
        AdmissionFormField(
          label: 'Bank reference (optional)',
          value: draft.claimedBankRef,
          hint: 'The transaction number on the slip, if it has one.',
          maxLength: 100,
          onChanged: (v) { draft.claimedBankRef = v; onChange(); },
        ),
        const SizedBox(height: 18),
        // SEC-PRV-003 — the notice version and the moment are recorded. It is
        // a checkbox somebody has to tick, never a default.
        InkWell(
          onTap: () {
            draft.consentAccepted = !draft.consentAccepted;
            onChange();
          },
          borderRadius: BorderRadius.circular(8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 20,
                height: 20,
                margin: const EdgeInsets.only(top: 1),
                decoration: BoxDecoration(
                  color: draft.consentAccepted
                      ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                      : (dark ? AppColorsDark.surface2 : Colors.white),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: draft.consentAccepted
                        ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        : (dark ? AppColorsDark.line : AppColors.line),
                    width: 1.4,
                  ),
                ),
                child: draft.consentAccepted
                    ? const Icon(Icons.check_rounded, size: 15, color: Colors.white)
                    : null,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'I agree that Prepreneurship may hold and use the details above to consider this '
                  'application and, if I am admitted, to run my enrolment. I can ask for a copy of '
                  'what is held about me at any time.',
                  style: TextStyle(fontSize: 13, color: muted, height: 1.5),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// FR-REG-008..011 — one to five slips, uploaded immediately.
class _SlipUpload extends StatelessWidget {
  const _SlipUpload({
    required this.uploading,
    required this.documentIds,
    required this.canAddMore,
    required this.onUpload,
    required this.onRemove,
  });

  final bool uploading;
  final List<String> documentIds;
  final bool canAddMore;
  final VoidCallback onUpload;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldLabel('Photo of your payment slip'),
        const SizedBox(height: 8),
        if (documentIds.isNotEmpty)
          for (var i = 0; i < documentIds.length; i++)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
              ),
              child: Row(
                children: [
                  Pill(text: 'Slip ${i + 1} attached', kind: PillKind.ok),
                  const Spacer(),
                  TextButton(
                    onPressed: () => onRemove(documentIds[i]),
                    child: const Text('remove'),
                  ),
                ],
              ),
            ),
        OutlinedButton.icon(
          onPressed: canAddMore && !uploading ? onUpload : null,
          icon: uploading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.attach_file, size: 18),
          label: Text(uploading ? 'Uploading…' : 'Attach a slip'),
        ),
        const SizedBox(height: 8),
        Text(
          'A photo from your phone is fine. JPEG, PNG or PDF, up to 5 MB. '
          'You can attach up to five.',
          style: TextStyle(fontSize: 12.5, color: muted),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------ submitted ----

/// What happens next (FR-REG-018). THE TRACKING REFERENCE IS THE WHOLE PAGE:
/// it is the only way back without an account, so it is large and accompanied
/// by the thing to do with it.
class _SubmittedView extends StatelessWidget {
  const _SubmittedView({required this.state});

  final ApplicationState state;

  @override
  Widget build(BuildContext context) {
    final result = state.result!;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
      children: [
        const Align(
          alignment: Alignment.centerLeft,
          child: Pill(text: 'Application received', kind: PillKind.ok),
        ),
        const SizedBox(height: 14),
        Text(
          result.duplicate
              ? 'We already have an application from you.'
              : 'Thank you — we have your application.',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: ink),
        ),
        const SizedBox(height: 6),
        Text(
          'Keep this reference. It is how you check on your application.',
          style: TextStyle(color: muted, fontSize: 13.5),
        ),
        const SizedBox(height: 12),
        // Selectable so a person can copy it into WhatsApp.
        SelectableText(
          result.trackingRef,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.1,
            color: dark ? AppColorsDark.brand600 : AppColors.brand700,
          ),
        ),
        const SizedBox(height: 14),
        // Say which it was. "A copy is on its way" when nothing was sent is
        // how a person closes the page without writing the reference down.
        if (!result.duplicate)
          result.emailSent == true
              ? Text(
                  'We have emailed a copy to ${result.email}. If it is not there in a few '
                  'minutes, look in your spam folder.',
                  style: TextStyle(color: muted, fontSize: 13, height: 1.5),
                )
              : AppAlert(
                  title: 'Write this reference down now.',
                  message:
                      'We could not email you a copy. Nothing is wrong with your application — '
                      'but this page is the only place the reference is shown.',
                  warn: true,
                ),
        const SizedBox(height: 16),
        Text('What happens now', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        for (final line in const [
          'The office checks your payment slip against the bank record.',
          'If anything is unclear, somebody will contact you on the number or email you gave.',
          'When you are admitted, an account is created for you and you will be sent a '
              'temporary password to sign in with.',
        ])
          ListRow(title: line),
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => TrackApplicationPage(initialReference: result.trackingRef),
              ),
            );
          },
          icon: const Icon(Icons.manage_search, size: 18),
          label: const Text('Track my application'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Done'),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------ failure -----

class _FailureView extends StatelessWidget {
  const _FailureView({required this.state});

  final ApplicationState state;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        AppAlert(
          title: 'Could not load what is on offer',
          message: state.error?.message ?? 'Something went wrong.',
          reference: state.error?.reference,
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: () => context.read<ApplicationCubit>().start(),
          icon: const Icon(Icons.refresh, size: 18),
          label: const Text('Try again'),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------- controls ----

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Text(
      label,
      style: TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: dark ? AppColorsDark.ink2 : AppColors.ink2,
      ),
    );
  }
}

