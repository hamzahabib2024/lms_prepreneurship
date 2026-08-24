import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import 'user_detail_page.dart';
import 'create_staff_page.dart';

class UsersPage extends StatelessWidget {
  const UsersPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))..loadUsers(),
      child: const _UsersView(),
    );
  }
}

class _UsersView extends StatefulWidget {
  const _UsersView();

  @override
  State<_UsersView> createState() => _UsersViewState();
}

class _UsersViewState extends State<_UsersView> {
  final _searchController = TextEditingController();
  String? _selectedRole;
  String? _selectedStatus;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Users & roles'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_outlined, size: 22),
            tooltip: 'Create staff',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => BlocProvider.value(
                    value: context.read<AdminCubit>(),
                    child: const CreateStaffPage(),
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: BlocConsumer<AdminCubit, AdminState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionSuccess!)),
            );
            context.read<AdminCubit>().dismissResult();
          }
          if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionError!.message)),
            );
            context.read<AdminCubit>().dismissResult();
          }
        },
        builder: (context, state) {
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search by name or email…',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              context.read<AdminCubit>().setSearchQuery('');
                            },
                          )
                        : null,
                  ),
                  onChanged: (v) {
                    setState(() {});
                    context.read<AdminCubit>().setSearchQuery(v);
                  },
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                height: 36,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  children: [
                    _FilterChip(
                      label: 'All roles',
                      selected: _selectedRole == null,
                      onTap: () {
                        setState(() => _selectedRole = null);
                        context.read<AdminCubit>().setUserFilter(null);
                      },
                    ),
                    for (final r in ['student', 'teacher', 'admin', 'super_admin'])
                      _FilterChip(
                        label: _roleLabel(r),
                        selected: _selectedRole == r,
                        onTap: () {
                          setState(() => _selectedRole = r);
                          context.read<AdminCubit>().setUserFilter(r);
                        },
                      ),
                    const SizedBox(width: 8),
                    _FilterChip(
                      label: 'All statuses',
                      selected: _selectedStatus == null,
                      onTap: () {
                        setState(() => _selectedStatus = null);
                        context.read<AdminCubit>().setStatusFilter(null);
                      },
                    ),
                    for (final s in ['ACTIVE', 'SUSPENDED', 'LOCKED'])
                      _FilterChip(
                        label: s[0] + s.substring(1).toLowerCase(),
                        selected: _selectedStatus == s,
                        onTap: () {
                          setState(() => _selectedStatus = s);
                          context.read<AdminCubit>().setStatusFilter(s);
                        },
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              if (state.totalItems > 0)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    children: [
                      Text(
                        '${state.totalItems} user${state.totalItems == 1 ? '' : 's'}',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 6),
              Expanded(
                child: _buildBody(context, state),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildBody(BuildContext context, AdminState state) {
    if (state.loadingUsers && state.users.isEmpty) {
      return const SingleChildScrollView(
        padding: EdgeInsets.all(20),
        child: SkeletonCards(count: 5),
      );
    }

    if (state.usersError != null && state.users.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            AppAlert(
              title: 'Could not load users',
              message: state.usersError!.message,
              reference: state.usersError!.reference,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => context.read<AdminCubit>().loadUsers(),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }

    if (state.users.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Text(
            'No users match the current filters.',
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      );
    }

    final dark = Theme.of(context).brightness == Brightness.dark;

    return RefreshIndicator(
      onRefresh: () => context.read<AdminCubit>().loadUsers(),
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        itemCount: state.users.length,
        itemBuilder: (context, index) {
          final user = state.users[index];
          final statusColor = switch (user.status) {
            'ACTIVE' => dark ? AppColorsDark.ok : AppColors.ok,
            'SUSPENDED' => dark ? AppColorsDark.error : AppColors.error,
            'LOCKED' => dark ? AppColorsDark.warn : AppColors.warn,
            _ => dark ? AppColorsDark.muted : AppColors.muted,
          };

          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            clipBehavior: Clip.antiAlias,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => BlocProvider.value(
                        value: context.read<AdminCubit>(),
                        child: UserDetailPage(user: user),
                      ),
                    ),
                  );
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 18,
                        backgroundColor: dark ? AppColorsDark.brand050 : AppColors.brand050,
                        child: Text(
                          user.fullName.isNotEmpty ? user.fullName[0].toUpperCase() : '?',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user.fullName,
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              user.email,
                              style: TextStyle(fontSize: 12, color: dark ? AppColorsDark.muted : AppColors.muted),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              user.statusLabel,
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: statusColor,
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _roleLabel(user.roles.firstOrNull ?? ''),
                            style: TextStyle(
                              fontSize: 11,
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  static String _roleLabel(String role) => switch (role) {
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'teacher' => 'Teacher',
        'student' => 'Student',
        _ => role,
      };
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected
                ? brand.withValues(alpha: 0.12)
                : (dark ? AppColorsDark.surface2 : AppColors.surface2),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: selected
                  ? brand.withValues(alpha: 0.4)
                  : (dark ? AppColorsDark.line : AppColors.line),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: selected ? brand : (dark ? AppColorsDark.ink2 : AppColors.ink2),
            ),
          ),
        ),
      ),
    );
  }
}
