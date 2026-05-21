import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, catchError, finalize, of, shareReplay, tap, timeout } from 'rxjs';
import { ApiService } from './api.service';
import { ADMIN_WORKSPACE_PERMISSIONS, MODERATION_WORKSPACE_PERMISSIONS, PERMISSIONS } from '../permissions';
import { AuthResponse, LoginRequest, RegisterRequest } from '../../features/auth/models/auth.model';
import { User } from '../../features/user/models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly requestTimeoutMs = 15000;
  private readonly tokenKey = 'ts_token';
  private readonly userKey = 'ts_user';
  private readonly userSubject = new BehaviorSubject<User | null>(this.readStoredUser());
  private syncRequest$?: Observable<User | null>;
  readonly user$ = this.userSubject.asObservable();

  constructor(private readonly api: ApiService) {}

  register(payload: RegisterRequest) {
    return this.api.postJson<AuthResponse>('auth/register', payload).pipe(
      timeout(this.requestTimeoutMs),
      tap((response) => this.persistSession(response))
    );
  }

  login(payload: LoginRequest) {
    return this.api.postJson<AuthResponse>('auth/login', payload).pipe(
      timeout(this.requestTimeoutMs),
      tap((response) => this.persistSession(response))
    );
  }

  oauth(provider: 'google' | 'github') {
    return this.api.post<AuthResponse>(`auth/oauth/${provider}`, {}).pipe(
      timeout(this.requestTimeoutMs)
    );
  }

  logout() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    this.syncRequest$ = undefined;
    this.userSubject.next(null);
  }

  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  getCurrentUser(): User | null {
    return this.userSubject.value;
  }

  getCurrentUserAvatarUrl(): string {
    const user = this.userSubject.value;
    return this.resolveAvatarUrl(user?.avatarUrl ?? null, user?.gender ?? null);
  }

  resolveAvatarUrl(avatarUrl: string | null | undefined, gender?: string | null): string {
    const normalizedAvatarUrl = avatarUrl?.trim();
    if (normalizedAvatarUrl) {
      return normalizedAvatarUrl;
    }

    return gender?.trim().toLowerCase() === 'female' ? '/g.png' : '/b.png';
  }

  getUserId(): string | null {
    return this.userSubject.value?.id ?? null;
  }

  isLoggedIn(): boolean {
    return !!this.getToken() && !!this.userSubject.value;
  }

  isAdmin(): boolean {
    return this.userSubject.value?.role === 'Admin';
  }

  isModerator(): boolean {
    return this.userSubject.value?.role === 'Moderator';
  }

  hasPermission(permission: string, user: User | null = this.userSubject.value): boolean {
    return (user?.permissions ?? []).includes(permission);
  }

  hasAnyPermission(permissions: readonly string[], user: User | null = this.userSubject.value): boolean {
    const userPermissions = user?.permissions ?? [];
    return permissions.some((permission) => userPermissions.includes(permission));
  }

  canAccessAdminWorkspace(user: User | null = this.userSubject.value): boolean {
    return this.hasAnyPermission(ADMIN_WORKSPACE_PERMISSIONS, user);
  }

  canAccessModerationWorkspace(user: User | null = this.userSubject.value): boolean {
    return this.hasAnyPermission(MODERATION_WORKSPACE_PERMISSIONS, user);
  }

  canManageEvents(user: User | null = this.userSubject.value): boolean {
    return this.hasPermission(PERMISSIONS.eventsManage, user);
  }

  getDefaultRoute(role?: string | null): string {
    const user = this.userSubject.value;

    if (user) {
      if (this.hasPermission(PERMISSIONS.usersRead, user)) {
        return '/admin';
      }

      if (this.hasPermission(PERMISSIONS.departmentsRead, user)) {
        return '/admin/departments';
      }

      if (this.hasPermission(PERMISSIONS.badgesRead, user)) {
        return '/admin/badges';
      }

      if (this.hasPermission(PERMISSIONS.rolePermissionsRead, user)) {
        return '/admin/role-permissions';
      }

      if (this.hasPermission(PERMISSIONS.eventsManage, user)) {
        return '/admin/event-evaluations';
      }

      if (this.hasPermission(PERMISSIONS.moderationReview, user)) {
        return '/admin/moderation';
      }

      if (this.hasPermission(PERMISSIONS.appealsRead, user)) {
        return '/admin/appeals';
      }
    }

    if (user && this.canAccessModerationWorkspace(user)) {
      return '/moderation';
    }

    return role === 'Admin' ? '/admin' : role === 'Moderator' ? '/moderation' : '/dashboard/profile';
  }

  updateStoredUser(user: User) {
    this.persistUser(user);
  }

  markCurrentUserFrozen() {
    const user = this.userSubject.value;
    if (!user || user.isFrozen) {
      return;
    }

    this.updateStoredUser({
      ...user,
      isFrozen: true
    });
  }

  private persistSession(response: AuthResponse) {
    localStorage.setItem(this.tokenKey, response.token);
    this.persistUser(response.user);
  }

  syncCurrentUser(force = false): Observable<User | null> {
    const token = this.getToken();
    if (!token) {
      this.clearStoredUser();
      return of(null);
    }

    if (!force && this.syncRequest$) {
      return this.syncRequest$;
    }

    const request$ = this.api.get<User>('users/me').pipe(
      timeout(this.requestTimeoutMs),
      tap((user) => this.persistUser(user)),
      catchError(() => {
        this.clearStoredUser();
        return of(null);
      }),
      finalize(() => {
        this.syncRequest$ = undefined;
      }),
      shareReplay(1)
    );

    this.syncRequest$ = request$;
    return request$;
  }

  private persistUser(user: User) {
    this.userSubject.next(user);

    try {
      localStorage.setItem(this.userKey, JSON.stringify(user));
      return;
    } catch {
      try {
        localStorage.setItem(this.userKey, JSON.stringify({
          ...user,
          avatarUrl: ''
        }));
        return;
      } catch {
        localStorage.removeItem(this.userKey);
      }
    }
  }

  private clearStoredUser() {
    localStorage.removeItem(this.userKey);
    this.userSubject.next(null);
  }

  private readStoredUser(): User | null {
    const raw = localStorage.getItem(this.userKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<User>;
      if (parsed.id && parsed.userName && parsed.email && parsed.role) {
        const storedAvatarUrl = typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl.trim() : '';
        return {
          ...parsed,
          permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
          avatarUrl: storedAvatarUrl.startsWith('data:') || storedAvatarUrl.startsWith('blob:')
            ? ''
            : storedAvatarUrl
        } as User;
      }
    } catch {
      return null;
    }

    return null;
  }
}
