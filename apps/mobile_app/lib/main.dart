import 'package:flutter/material.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/presentation/app_root.dart';

void main() {
  runApp(const PrepreneurshipApp());
}

class PrepreneurshipApp extends StatelessWidget {
  const PrepreneurshipApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Prepreneurship LMS',
      debugShowCheckedModeBanner: false,
      // Dark mode by OS preference only, exactly like the web client — there
      // is no toggle.
      themeMode: ThemeMode.system,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      home: const AppRoot(),
    );
  }
}
