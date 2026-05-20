import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { NavbarBadgeService } from '../../../community/data-access/navbar-badge.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { FriendRequest } from '../../../community/models/community.model';

@Component({
  selector: 'app-requests-page',
  standalone: false,
  templateUrl: './requests-page.component.html',
  styleUrls: ['./requests-page.component.scss']
})
export class RequestsPageComponent implements OnInit, OnDestroy {
  requests: FriendRequest[] = [];
  isLoading = false;
  errorMessage = '';

  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;
  userId: string | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly communityService: CommunityService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        const nextUserId = user?.id ?? null;
        const hadUserId = !!this.userId;
        const shouldLoad = !!nextUserId && (!hadUserId || this.userId !== nextUserId || this.requests.length === 0);

        this.updateView(() => {
          this.userId = nextUserId;
          if (!nextUserId && !this.authService.getToken()) {
            this.errorMessage = 'Please sign in again.';
          }
        });

        if (shouldLoad) {
          this.loadRequests();
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadRequests(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refreshRequests(): void {
    this.loadRequests();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.refreshRequests();
  }

  acceptRequest(requestId: string): void {
    this.updateStatus(requestId, 'Accepted');
  }

  declineRequest(requestId: string): void {
    this.updateStatus(requestId, 'Declined');
  }

  canRespond(request: FriendRequest): boolean {
    return request.recipientUserId === this.userId && request.status === 'Pending';
  }

  get filteredRequests(): FriendRequest[] {
    return this.requests;
  }

  counterpartName(request: FriendRequest): string {
    return request.requesterUserId === this.userId
      ? request.recipientDisplayName
      : request.requesterDisplayName;
  }

  counterpartEmail(request: FriendRequest): string {
    return request.requesterUserId === this.userId
      ? ''
      : request.requesterEmail;
  }

  requestDirection(request: FriendRequest): string {
    return request.requesterUserId === this.userId ? 'Sent' : 'Received';
  }

  get currentUserDisplayName(): string {
    return this.authService.getCurrentUser()?.displayName || this.authService.getCurrentUser()?.userName || 'Member';
  }

  getRequestAvatarUrl(request: FriendRequest): string {
    const avatarUserId = request.requesterUserId === this.userId
      ? request.recipientUserId
      : request.requesterUserId;

    return this.avatarDirectory.resolveAvatarUrl(avatarUserId);
  }

  get pendingReceivedCount(): number {
    return this.requests.filter((request) => request.status === 'Pending' && request.recipientUserId === this.userId).length;
  }

  get acceptedCount(): number {
    return this.requests.filter((request) => request.status === 'Accepted').length;
  }

  get sentCount(): number {
    return this.requests.filter((request) => request.requesterUserId === this.userId).length;
  }

  trackByRequestId(_: number, request: FriendRequest): string {
    return request.id;
  }

  private updateStatus(requestId: string, status: 'Accepted' | 'Declined'): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    const previousRequests = this.requests.map((request) => ({ ...request }));
    this.requests = this.requests.map((item) =>
      item.id === requestId
        ? {
            ...item,
            status,
            updatedAtUtc: new Date().toISOString()
          }
        : item
    );

    this.communityService.updateFriendRequestStatus(requestId, {
      actorUserId: userId,
      status
    }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.requests = this.requests.map((item) => item.id === updated.id ? updated : item);
        });
        this.navbarBadgeService.refresh(userId);
      },
      error: () => {
        this.updateView(() => {
          this.requests = previousRequests;
          this.errorMessage = 'Unable to update request status.';
        });
      }
    });
  }

  private loadRequests(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    if (!silent) {
      this.isLoading = true;
    }

    this.communityService.getFriendRequests(userId).subscribe({
      next: (items) => {
        this.avatarDirectory.ensureUsers(this.collectRequestUserIds(items)).subscribe({
          next: () => {
            this.updateView(() => {
              this.requests = items;
              this.errorMessage = '';
              this.isLoading = false;
            });
            this.navbarBadgeService.refresh(userId);
          }
        });
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to load friend requests.';
          this.isLoading = false;
        });
      }
    });
  }

  private canPollSilently(): boolean {
    return !!this.userId && !document.hidden && !this.isLoading;
  }

  private collectRequestUserIds(requests: FriendRequest[]): string[] {
    return Array.from(new Set(requests.flatMap((request) => [request.requesterUserId, request.recipientUserId])));
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
