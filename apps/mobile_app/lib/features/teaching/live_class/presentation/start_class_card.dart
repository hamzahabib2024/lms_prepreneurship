import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../../academic/class_page/data/class_page_repository.dart';
import '../../../academic/class_page/presentation/class_page.dart';
import '../cubit/start_class_cubit.dart';
import '../data/live_class_repository.dart';

/// START A CLASS NOW — FR-LIV, the ad-hoc case.
///
/// The System could only hold a class somebody had booked in advance, which
/// is not how teaching goes. A revision hour called after a bad assessment, a
/// cancelled slot picked up, one more hour on a topic that needs it — all of
/// that happened OUTSIDE the LMS, as a link pasted into a group chat with no
/// register and no record that the class occurred at all (§2.2.2).
///
/// Two fields, because a teacher pressing this has students waiting. Which
/// subject cannot be guessed; everything else has a sensible answer already.
///
/// ABSENT, NOT DISABLED, when there is nothing to teach. A student or an
/// administrator holds no assignments, and a card offering them a class they
/// cannot start is clutter that also reads as broken.
class StartClassCard extends StatelessWidget {
  const StartClassCard({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => StartClassCubit(LiveClassRepository(api))..load(),
      child: _StartClassView(api: api),
    );
  }
}

class _StartClassView extends StatelessWidget {
  const _StartClassView({required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocConsumer<StartClassCubit, StartClassState>(
      listenWhen: (a, b) => a.started != b.started && b.started != null,
      listener: (context, state) {
        // Straight into the room. Staying here to find the class you just
        // started would be one tap of nothing.
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => RepositoryProvider(
              create: (_) => ClassPageRepository(api),
              child: ClassPage(sessionId: state.started!.id, canEnd: true),
            ),
          ),
        );
      },
      builder: (context, state) {
        if (state.loading || state.hasNothingToOffer) {
          return const SizedBox.shrink();
        }
        final cubit = context.read<StartClassCubit>();

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
              const Text(
                'Start a class now',
                style: TextStyle(
                  fontFamily: AppFonts.display,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                'Opens the room straight away and takes the register, the same '
                'as a class you booked.',
                style: TextStyle(fontSize: 12.5, color: muted),
              ),
              const SizedBox(height: 14),

              DropdownButtonFormField<String>(
                initialValue: state.sectionSubjectId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Which class',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: [
                  for (final option in state.options)
                    DropdownMenuItem(
                      value: option.sectionSubjectId,
                      child: Text(option.label, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: state.busy
                    ? null
                    : (value) {
                        if (value != null) cubit.chooseClass(value);
                      },
              ),
              const SizedBox(height: 12),

              DropdownButtonFormField<int>(
                initialValue: state.minutes,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'For how long',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: const [
                  DropdownMenuItem(value: 30, child: Text('30 minutes')),
                  DropdownMenuItem(value: 60, child: Text('1 hour')),
                  DropdownMenuItem(value: 90, child: Text('1½ hours')),
                  DropdownMenuItem(value: 120, child: Text('2 hours')),
                ],
                onChanged: state.busy
                    ? null
                    : (value) {
                        if (value != null) cubit.chooseDuration(value);
                      },
              ),
              const SizedBox(height: 8),

              // Says what the figure is for: it holds the teacher's diary
              // against the clash check, and the class can be ended early.
              Text(
                'You can end the class whenever you are finished.',
                style: TextStyle(fontSize: 12.5, color: muted),
              ),

              if (state.error != null) ...[
                const SizedBox(height: 12),
                AppAlert(
                  title: 'The class could not be started',
                  message: state.error!.message,
                  reference: state.error!.reference,
                ),
              ],

              const SizedBox(height: 14),
              FilledButton(
                onPressed: state.canStart ? cubit.start : null,
                child: Text(state.busy ? 'Opening the room…' : 'Start now'),
              ),
            ],
          ),
        );
      },
    );
  }
}
