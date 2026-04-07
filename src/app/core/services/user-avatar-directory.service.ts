import { Injectable } from '@angular/core';
import { Observable, Subscription, catchError, forkJoin, interval, map, of, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { User, UserLookup } from '../../shared/models/user.model';

type AvatarSource = Pick<UserLookup, 'id' | 'avatarUrl' | 'gender'> | Pick<User, 'id' | 'avatarUrl' | 'gender'>;

interface CachedAvatarProfile {
  avatarUrl: string;
  gender: string | null;
}

@Injectable({ providedIn: 'root' })
export class UserAvatarDirectoryService {
  private readonly refreshIntervalMs = 1000;
  private readonly profiles = new Map<string, CachedAvatarProfile>();
  private readonly trackedUserIds = new Set<string>();
  private readonly refreshSubscription: Subscription;

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService
  ) {
    this.refreshSubscription = interval(this.refreshIntervalMs).subscribe(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      this.refreshTrackedProfiles().subscribe();
    });

    this.authService.user$.subscribe((user) => {
      if (user) {
        this.seedUser(user);
      }
    });
  }

  seedUser(user: AvatarSource): void {
    if (!user.id) {
      return;
    }

    this.trackedUserIds.add(user.id);
    this.profiles.set(user.id, {
      avatarUrl: user.avatarUrl?.trim() ?? '',
      gender: user.gender?.trim() ?? null
    });
  }

  seedUsers(users: AvatarSource[]): void {
    for (const user of users) {
      this.seedUser(user);
    }
  }

  resolveAvatarUrl(userId: string | null | undefined, fallbackGender?: string | null): string {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) {
      return this.defaultAvatarForGender(fallbackGender);
    }

    const currentUserId = this.authService.getUserId();
    if (currentUserId && currentUserId === normalizedUserId) {
      return this.authService.getCurrentUserAvatarUrl();
    }

    const cachedProfile = this.profiles.get(normalizedUserId);
    if (cachedProfile?.avatarUrl) {
      return cachedProfile.avatarUrl;
    }

    return this.defaultAvatarForGender(fallbackGender ?? cachedProfile?.gender ?? null);
  }

  ensureUsers(userIds: Iterable<string | null | undefined>): Observable<void> {
    const currentUserId = this.authService.getUserId();
    const normalizedIds = Array.from(new Set(
      Array.from(userIds)
        .map((id) => id?.trim() ?? '')
        .filter((id) => id.length > 0 && id !== currentUserId)
    ));

    for (const id of normalizedIds) {
      this.trackedUserIds.add(id);
    }

    const missingIds = normalizedIds.filter((id) => !this.profiles.has(id));
    if (missingIds.length === 0) {
      return of(void 0);
    }

    return forkJoin(missingIds.map((id) =>
      this.userService.getLookupById(id).pipe(
        catchError(() => of(null))
      )
    )).pipe(
      tap((users) => {
        for (const user of users) {
          if (user) {
            this.seedUser(user);
          }
        }
      }),
      map(() => void 0)
    );
  }

  refreshTrackedProfiles(): Observable<void> {
    const currentUserId = this.authService.getUserId();
    const ids = Array.from(this.trackedUserIds).filter((id) => id !== currentUserId);
    if (ids.length === 0) {
      return of(void 0);
    }

    return forkJoin(ids.map((id) =>
      this.userService.getLookupById(id).pipe(
        catchError(() => of(null))
      )
    )).pipe(
      tap((users) => {
        for (const user of users) {
          if (user) {
            this.seedUser(user);
          }
        }
      }),
      map(() => void 0)
    );
  }

  private defaultAvatarForGender(gender?: string | null): string {
    return gender?.trim().toLowerCase() === 'female' ? '/g.png' : '/b.png';
  }
}
