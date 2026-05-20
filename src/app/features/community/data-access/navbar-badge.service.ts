import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CommunityService } from './community.service';
import { NavbarBadgeSummary } from '../models/community.model';

export const EMPTY_NAVBAR_BADGES: NavbarBadgeSummary = {
  unreadNotificationsCount: 0,
  hasUnreadMessages: false,
  hasPendingFriendRequests: false
};

@Injectable({ providedIn: 'root' })
export class NavbarBadgeService {
  private readonly badgesSubject = new BehaviorSubject<NavbarBadgeSummary>(EMPTY_NAVBAR_BADGES);
  readonly badges$ = this.badgesSubject.asObservable();

  constructor(private readonly communityService: CommunityService) {}

  refresh(userId: string | null | undefined): void {
    if (!userId) {
      this.reset();
      return;
    }

    this.communityService.getNavbarBadges(userId).subscribe({
      next: (badges) => {
        this.badgesSubject.next({
          unreadNotificationsCount: Math.max(0, Number(badges.unreadNotificationsCount) || 0),
          hasUnreadMessages: !!badges.hasUnreadMessages,
          hasPendingFriendRequests: !!badges.hasPendingFriendRequests
        });
      },
      error: () => {
        this.reset();
      }
    });
  }

  reset(): void {
    this.badgesSubject.next(EMPTY_NAVBAR_BADGES);
  }
}
