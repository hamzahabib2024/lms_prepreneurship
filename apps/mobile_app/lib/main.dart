import 'package:flutter/material.dart';

import 'core/theme/app_theme.dart';
import 'core/theme/theme_controller.dart';
import 'features/auth/presentation/app_root.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Read before the first frame. Loading the choice inside a widget means the
  // first paint is the device's theme and the second is the chosen one — a
  // white flash on every launch for the person who asked for dark.
  await ThemeController.instance.load();
  runApp(const PrepreneurshipApp());
}

class PrepreneurshipApp extends StatelessWidget {
  const PrepreneurshipApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeController.instance,
      builder: (context, mode, _) {
        return MaterialApp(
          title: 'Prepreneurship LMS',
          debugShowCheckedModeBanner: false,
          themeMode: mode,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          home: const AppRoot(),
        );
      },
    );
  }
}
