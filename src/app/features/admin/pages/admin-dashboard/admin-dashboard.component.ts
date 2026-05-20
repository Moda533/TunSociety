import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl } from '@angular/forms';
import { Subscription, finalize, forkJoin } from 'rxjs';
import { AdminService } from '../../data-access/admin.service';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { UserService } from '../../../user/data-access/user.service';
import { User } from '../../../user/models/user.model';
import { AdminUserRiskSummary, BadgeTitle, Department } from '../../models/admin.model';

type AdminRoleFilter = 'All' | 'User' | 'Moderator' | 'Admin';

@Component({
  selector: 'app-admin-dashboard',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  readonly roleOptions: readonly AdminSelectOption[] = [
    { value: 'User', label: 'User' },
    { value: 'Moderator', label: 'Moderator' },
    { value: 'Admin', label: 'Admin' }
  ];
  readonly roleFilterOptions: readonly AdminSelectOption[] = [
    { value: 'All', label: 'All roles' },
    ...this.roleOptions
  ];
  readonly roleFilterControl = new FormControl<AdminRoleFilter>('All', { nonNullable: true });
  readonly searchControl = new FormControl('', { nonNullable: true });

  users: User[] = [];
  departments: Department[] = [];
  badges: BadgeTitle[] = [];
  selectedUserId = '';
  isLoading = false;
  updatingUserId = '';
  errorMessage = '';
  actionMessage = '';
  lastRefresh: Date | null = null;
  isDetailPopupOpen = false;

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly adminService: AdminService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = params.get('q') ?? '';
        if (nextQuery !== this.searchControl.value) {
          this.searchControl.setValue(nextQuery, { emitEvent: false });
          this.ensureSelectedUser();
        }
      })
    );

    this.subscriptions.add(
      this.roleFilterControl.valueChanges.subscribe(() => {
        this.ensureSelectedUser();
      })
    );

    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const users = data['users'] as AdminUserRiskSummary[] | null | undefined;
        if (users) {
          this.applyUsers(users);
          return;
        }

        this.refresh();
      })
    );

    this.subscriptions.add(
      this.autoRefresh.every().subscribe(() => {
        if (!this.isLoading && !this.updatingUserId) {
          this.refresh(true);
        }
      })
    );

    this.loadMembershipOptions();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(silent = false): void {
    if (!silent) {
      this.errorMessage = '';
      this.isLoading = true;
    }

    this.adminService.getUsers(0, 200)
      .pipe(finalize(() => {
        if (!silent) {
          this.isLoading = false;
        }
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (users) => {
          this.applyUsers(users);
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load users right now.';
          }
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  loadMembershipOptions(): void {
    this.subscriptions.add(
      forkJoin({
        departments: this.adminService.getDepartments(),
        badges: this.adminService.getBadges()
      }).subscribe({
        next: ({ departments, badges }) => {
          this.departments = departments;
          this.badges = badges;
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.actionMessage = 'Users loaded, but department and badge options could not be loaded.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: query || null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  clearSearch(): void {
    if (!this.searchControl.value.trim()) {
      return;
    }

    this.searchControl.setValue('');
    this.submitSearch();
  }

  selectUser(user: User): void {
    this.selectedUserId = user.id;
    this.actionMessage = '';
  }

  openUserDetails(user: User, event?: MouseEvent): void {
    event?.stopPropagation();
    this.selectUser(user);
    this.isDetailPopupOpen = true;
  }

  closeUserDetails(): void {
    this.isDetailPopupOpen = false;
  }

  openProfile(user: User): void {
    void this.router.navigate(['/admin/users', user.id], {
      queryParamsHandling: 'preserve'
    });
  }

  updateUserRole(user: User, nextRole: string): void {
    if (!nextRole || nextRole === user.role) {
      return;
    }

    this.updatingUserId = user.id;
    this.actionMessage = '';

    this.userService.update(user.id, { role: nextRole }).subscribe({
      next: (updatedUser) => {
        this.users = this.users.map((item) => item.id === updatedUser.id ? updatedUser : item);
        this.avatarDirectory.seedUser(updatedUser);
        this.updatingUserId = '';
        this.actionMessage = `Updated ${updatedUser.displayName} to ${updatedUser.role}.`;
        this.renderScheduler.schedule(this.changeDetectorRef);
      },
      error: () => {
        this.updatingUserId = '';
        this.actionMessage = 'Unable to update user role.';
        this.renderScheduler.schedule(this.changeDetectorRef);
      }
    });
  }

  updateUserDepartment(user: User, nextDepartmentId: string): void {
    const departmentId = nextDepartmentId || null;
    const badgeId = this.isBadgeAllowedForDepartment(user.badgeId, departmentId)
      ? user.badgeId
      : this.defaultBadgeIdFor(user);

    this.updateUserMembership(user, departmentId, badgeId);
  }

  updateUserBadge(user: User, nextBadgeId: string): void {
    this.updateUserMembership(user, user.departmentId, nextBadgeId || this.defaultBadgeIdFor(user));
  }

  get filteredUsers(): User[] {
    const search = this.searchControl.value.trim().toLowerCase();
    const role = this.roleFilterControl.value;

    return this.users.filter((user) => {
      const matchesRole = role === 'All' || user.role === role;
      const matchesSearch =
        !search ||
        user.displayName.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search) ||
        user.userName.toLowerCase().includes(search) ||
        user.role.toLowerCase().includes(search) ||
        (user.departmentName || 'Unassigned').toLowerCase().includes(search) ||
        (user.badgeName || 'Member').toLowerCase().includes(search) ||
        (user.isFrozen ? 'frozen' : 'active').includes(search);

      return matchesRole && matchesSearch;
    });
  }

  get selectedUser(): User | null {
    return this.users.find((user) => user.id === this.selectedUserId)
      ?? this.filteredUsers[0]
      ?? null;
  }

  get unassignedUsers(): User[] {
    return this.users.filter((user) => !user.departmentId);
  }

  get departmentOptions(): readonly AdminSelectOption[] {
    return [
      { value: '', label: 'Unassigned' },
      ...this.departments.map((department) => ({
        value: department.id,
        label: department.name
      }))
    ];
  }

  getBadgeOptionsForUser(user: User): readonly AdminSelectOption[] {
    return this.badges
      .filter((badge) => !badge.departmentId || !user.departmentId || badge.departmentId === user.departmentId || badge.id === user.badgeId)
      .map((badge) => ({
        value: badge.id,
        label: badge.departmentName ? `${badge.name} (${badge.departmentName})` : badge.name
      }));
  }

  get searchQuery(): string {
    return this.searchControl.value.trim();
  }

  getUserAvatarUrl(user: User): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getUserInitials(user: User): string {
    const source = user.displayName || user.userName || 'User';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  }

  trackByUserId(_: number, user: User): string {
    return user.id;
  }

  private applyUsers(users: User[]): void {
    this.users = users;
    this.avatarDirectory.seedUsers(users);
    this.lastRefresh = new Date();
    this.errorMessage = '';
    this.ensureSelectedUser();
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private ensureSelectedUser(): void {
    if (!this.users.length) {
      this.selectedUserId = '';
      this.isDetailPopupOpen = false;
      return;
    }

    if (!this.selectedUserId || !this.filteredUsers.some((user) => user.id === this.selectedUserId)) {
      this.selectedUserId = this.filteredUsers[0]?.id ?? this.users[0]?.id ?? '';
    }
  }

  private updateUserMembership(user: User, departmentId: string | null, badgeId: string): void {
    if (this.updatingUserId) {
      return;
    }

    this.updatingUserId = user.id;
    this.actionMessage = '';

    this.adminService.updateUserMembership(user.id, {
      departmentId,
      badgeId
    }).subscribe({
      next: (updatedUser) => {
        this.users = this.users.map((item) => item.id === updatedUser.id ? updatedUser : item);
        this.avatarDirectory.seedUser(updatedUser);
        this.updatingUserId = '';
        this.actionMessage = `Updated ${updatedUser.displayName}'s club assignment.`;
        this.renderScheduler.schedule(this.changeDetectorRef);
      },
      error: () => {
        this.updatingUserId = '';
        this.actionMessage = 'Unable to update club assignment.';
        this.renderScheduler.schedule(this.changeDetectorRef);
      }
    });
  }

  private defaultBadgeIdFor(user: User): string {
    return this.badges.find((badge) => badge.isDefault)?.id ?? user.badgeId;
  }

  private isBadgeAllowedForDepartment(badgeId: string, departmentId: string | null): boolean {
    const badge = this.badges.find((item) => item.id === badgeId);
    return !badge || !badge.departmentId || badge.departmentId === departmentId;
  }

}
