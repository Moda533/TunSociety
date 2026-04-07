import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription, finalize, forkJoin, interval } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { UserAvatarDirectoryService } from '../../core/services/user-avatar-directory.service';
import { UserService } from '../../core/services/user.service';
import { User } from '../../shared/models/user.model';

interface AuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  data: string | null;
  createdAtUtc: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly roleFilterControl = new FormControl<'All' | 'User' | 'Moderator' | 'Admin'>('All', { nonNullable: true });

  users: User[] = [];
  logs: AuditLog[] = [];
  isLoading = false;
  updatingUserId = '';
  errorMessage = '';
  roleMessage = '';
  lastRefresh: Date | null = null;

  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;

  constructor(
    private readonly authService: AuthService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly apiService: ApiService,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.refresh();

    this.subscriptions.add(
      interval(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.refresh(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(silent = false): void {
    if (!silent) {
      this.errorMessage = '';
      this.isLoading = true;
    }

    forkJoin({
      users: this.apiService.get<User[]>('admin/users?skip=0&take=100'),
      logs: this.apiService.get<AuditLog[]>('admin/audit-logs?limit=50')
    })
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: ({ users, logs }) => {
          this.users = users;
          this.avatarDirectory.seedUsers(users);
          this.logs = logs;
          this.lastRefresh = new Date();
          this.errorMessage = '';
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load admin data right now.';
          }
        }
      });
  }

  get totalUsers(): number {
    return this.users.length;
  }

  get adminUsers(): number {
    return this.users.filter((user) => user.role === 'Admin').length;
  }

  get moderatorUsers(): number {
    return this.users.filter((user) => user.role === 'Moderator').length;
  }

  get frozenUsers(): number {
    return this.users.filter((user) => user.isFrozen).length;
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
        user.userName.toLowerCase().includes(search);

      return matchesRole && matchesSearch;
    });
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

  private canPollSilently(): boolean {
    return !document.hidden && !this.isLoading && !this.updatingUserId;
  }

  updateUserRole(user: User, nextRole: string): void {
    if (!nextRole || nextRole === user.role) {
      return;
    }

    this.updatingUserId = user.id;
    this.roleMessage = '';

    this.userService.update(user.id, { role: nextRole }).subscribe({
      next: (updatedUser) => {
        this.users = this.users.map((item) => item.id === updatedUser.id ? updatedUser : item);
        this.updatingUserId = '';
        this.roleMessage = `Updated ${updatedUser.displayName} to ${updatedUser.role}.`;
      },
      error: () => {
        this.updatingUserId = '';
        this.roleMessage = 'Unable to update user role.';
      }
    });
  }
}
