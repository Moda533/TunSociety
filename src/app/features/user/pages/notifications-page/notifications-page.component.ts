import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { NavbarBadgeService } from '../../../community/data-access/navbar-badge.service';
import { CommunityNotification } from '../../../community/models/community.model';

@Component({
  selector: 'app-notifications-page',
  standalone: false,
  templateUrl: './notifications-page.component.html',
  styleUrls: ['./notifications-page.component.scss']
})
export class NotificationsPageComponent implements OnInit, OnDestroy {
  readonly includeReadControl = new FormControl(true, { nonNullable: true });
  activeTab: 'all' | 'unread' | 'mentions' = 'all';

  notifications: CommunityNotification[] = [];
  isLoading = false;
  errorMessage = '';

  private readonly refreshIntervalMs = 15000;
  private readonly subscriptions = new Subscription();
  private userId: string | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        const nextUserId = user?.id ?? null;
        const hadUserId = !!this.userId;
        const shouldLoad = !!nextUserId && (!hadUserId || this.userId !== nextUserId || this.notifications.length === 0);

        this.updateView(() => {
          this.userId = nextUserId;
          if (!nextUserId && !this.authService.getToken()) {
            this.errorMessage = 'Please sign in again.';
          }
        });

        if (shouldLoad) {
          this.loadNotifications();
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadNotifications(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  selectTab(tab: 'all' | 'unread' | 'mentions'): void {
    this.activeTab = tab;
    this.includeReadControl.setValue(tab !== 'unread');
    this.loadNotifications();
  }

  markAsRead(notificationId: string, event?: Event): void {
    event?.stopPropagation();
    const userId = this.userId;
    if (!userId) {
      return;
    }

    this.communityService.markNotificationRead(notificationId, { userId }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.notifications = this.notifications.map((item) => item.id === updated.id ? updated : item);
        });
        this.navbarBadgeService.refresh(userId);
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to mark notification as read.';
        });
      }
    });
  }

  openNotification(notification: CommunityNotification): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    const navigateToTarget = () => {
      if (notification.relatedGroupConversationId) {
        void this.router.navigate(['/dashboard/messenger', notification.relatedGroupConversationId]);
        return;
      }

      if (!notification.relatedPostId) {
        return;
      }

      void this.router.navigate(['/dashboard/feed'], {
        queryParams: {
          post: notification.relatedPostId,
          comment: notification.relatedCommentId,
          reply: notification.relatedReplyId
        }
      });
    };

    if (notification.isRead) {
      navigateToTarget();
      return;
    }

    this.communityService.markNotificationRead(notification.id, { userId }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.notifications = this.notifications.map((item) => item.id === updated.id ? updated : item);
        });
        this.navbarBadgeService.refresh(userId);
        navigateToTarget();
      },
      error: () => {
        navigateToTarget();
      }
    });
  }

  canOpenNotification(notification: CommunityNotification): boolean {
    return !!notification.relatedPostId || !!notification.relatedGroupConversationId;
  }

  markAllRead(): void {
    const userId = this.userId;
    if (!userId || this.unreadCount === 0) {
      return;
    }

    this.communityService.markAllNotificationsRead(userId).subscribe({
      next: () => {
        this.updateView(() => {
          this.notifications = this.notifications.map((item) => ({
            ...item,
            isRead: true,
            readAtUtc: item.readAtUtc ?? new Date().toISOString()
          }));
        });
        this.navbarBadgeService.refresh(userId);
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to mark all notifications as read.';
        });
      }
    });
  }

  get unreadCount(): number {
    return this.notifications.filter((item) => !item.isRead).length;
  }

  get readCount(): number {
    return this.notifications.filter((item) => item.isRead).length;
  }

  get visibleNotifications(): CommunityNotification[] {
    if (this.activeTab === 'unread') {
      return this.notifications.filter((item) => !item.isRead);
    }

    if (this.activeTab === 'mentions') {
      return this.notifications.filter((item) => item.type.toLowerCase().includes('mention'));
    }

    return this.notifications;
  }

  trackByNotificationId(_: number, notification: CommunityNotification): string {
    return notification.id;
  }

  refreshNotifications(): void {
    this.loadNotifications();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.refreshNotifications();
  }

  notificationIconClass(type: string): string {
    const normalized = type.toLowerCase();

    if (normalized.includes('reaction') || normalized.includes('like') || normalized.includes('heart')) {
      return 'icon-heart';
    }

    if (normalized.includes('mention')) {
      return 'icon-mention';
    }

    if (normalized.includes('comment')) {
      return 'icon-comment';
    }

    if (normalized.includes('request') || normalized.includes('friend') || normalized.includes('follow')) {
      return 'icon-friend';
    }

    if (normalized.includes('group')) {
      return 'icon-group';
    }

    if (normalized.includes('share')) {
      return 'icon-share';
    }

    return 'icon-birthday';
  }

  notificationIconLabel(type: string): string {
    const normalized = type.toLowerCase();

    if (normalized.includes('reaction') || normalized.includes('like') || normalized.includes('heart')) {
      return 'R';
    }

    if (normalized.includes('mention')) {
      return '@';
    }

    if (normalized.includes('comment')) {
      return 'C';
    }

    if (normalized.includes('request') || normalized.includes('friend') || normalized.includes('follow')) {
      return 'F';
    }

    if (normalized.includes('group')) {
      return 'G';
    }

    if (normalized.includes('share')) {
      return 'S';
    }

    return 'N';
  }

  actorAvatarUrl(notification: CommunityNotification): string | null {
    const avatarUrl = notification.actorAvatarUrl?.trim() ?? '';
    if (!avatarUrl || avatarUrl === '/b.png' || avatarUrl === '/g.png') {
      return null;
    }

    return avatarUrl;
  }

  actorInitials(notification: CommunityNotification): string {
    const source = notification.actorDisplayName?.trim() || notification.title?.trim() || 'Notification';
    const parts = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

    if (parts.length === 0) {
      return 'N';
    }

    return parts.map((part) => part.charAt(0).toUpperCase()).join('');
  }

  private loadNotifications(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    if (!silent) {
      this.isLoading = true;
    }

    this.communityService.getNotifications(userId, this.includeReadControl.value, 80).subscribe({
      next: (items) => {
        this.updateView(() => {
          this.notifications = items;
          this.errorMessage = '';
          this.isLoading = false;
        });
        this.navbarBadgeService.refresh(userId);
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to load notifications.';
          this.isLoading = false;
        });
      }
    });
  }

  private canPollSilently(): boolean {
    return !!this.userId && !document.hidden && !this.isLoading;
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
