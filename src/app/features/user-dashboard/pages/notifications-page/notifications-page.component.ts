import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { CommunityNotification } from '../../../../shared/models/community.model';

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
      interval(this.refreshIntervalMs).subscribe(() => {
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

  markAsRead(notificationId: string): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    this.communityService.markNotificationRead(notificationId, { userId }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.notifications = this.notifications.map((item) => item.id === updated.id ? updated : item);
        });
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to mark notification as read.';
        });
      }
    });
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

  notificationIconClass(type: string): string {
    const normalized = type.toLowerCase();

    if (normalized.includes('like') || normalized.includes('heart')) {
      return 'icon-heart';
    }

    if (normalized.includes('comment')) {
      return 'icon-comment';
    }

    if (normalized.includes('friend')) {
      return 'icon-friend';
    }

    if (normalized.includes('share')) {
      return 'icon-share';
    }

    return 'icon-birthday';
  }

  notificationIconLabel(type: string): string {
    const normalized = type.toLowerCase();

    if (normalized.includes('like') || normalized.includes('heart')) {
      return 'Like';
    }

    if (normalized.includes('comment')) {
      return 'Comment';
    }

    if (normalized.includes('friend')) {
      return 'Friend';
    }

    if (normalized.includes('share')) {
      return 'Share';
    }

    return 'Info';
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
    return !document.hidden && !this.isLoading;
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
