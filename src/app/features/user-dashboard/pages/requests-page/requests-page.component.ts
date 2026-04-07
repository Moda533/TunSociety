import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../../core/services/user.service';
import { FriendRequest } from '../../../../shared/models/community.model';
import { ModerationFeedback } from '../../../../shared/models/moderation.model';
import { UserLookup } from '../../../../shared/models/user.model';

@Component({
  selector: 'app-requests-page',
  standalone: false,
  templateUrl: './requests-page.component.html',
  styleUrls: ['./requests-page.component.scss']
})
export class RequestsPageComponent implements OnInit, OnDestroy {
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly filterControl = new FormControl<'all' | 'pending' | 'accepted' | 'sent'>('all', { nonNullable: true });
  readonly discoverControl = new FormControl('', { nonNullable: true });
  readonly noteControl = new FormControl('', { nonNullable: true });

  requests: FriendRequest[] = [];
  userResults: UserLookup[] = [];
  isLoading = false;
  isSearchingUsers = false;
  errorMessage = '';
  searchErrorMessage = '';

  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;
  private searchRefreshInFlight = false;
  userId: string | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly communityService: CommunityService,
    private readonly userService: UserService,
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
      interval(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadRequests(true);
          if (this.discoverControl.value.trim()) {
            this.searchUsers(true);
          }
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
    const userId = this.userId;
    if (!userId) {
      return [];
    }

    const search = this.searchControl.value.trim().toLowerCase();
    const filter = this.filterControl.value;

    return this.requests.filter((item) => {
      const counterpartName = this.counterpartName(item).toLowerCase();
      const counterpartEmail = this.counterpartEmail(item).toLowerCase();
      const note = (item.note ?? '').toLowerCase();

      const matchesSearch =
        search.length === 0 ||
        counterpartName.includes(search) ||
        counterpartEmail.includes(search) ||
        note.includes(search);

      if (!matchesSearch) {
        return false;
      }

      if (filter === 'pending') {
        return item.status === 'Pending' && item.recipientUserId === userId;
      }

      if (filter === 'accepted') {
        return item.status === 'Accepted';
      }

      if (filter === 'sent') {
        return item.requesterUserId === userId;
      }

      return true;
    });
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

  getUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
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

  trackByUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  searchUsers(silent = false): void {
    const query = this.discoverControl.value.trim();
    if (!query) {
      if (!silent) {
        this.userResults = [];
        this.searchErrorMessage = '';
      }
      return;
    }

    if (silent) {
      this.searchRefreshInFlight = true;
    } else {
      this.isSearchingUsers = true;
      this.searchErrorMessage = '';
    }

    this.userService.search(query, 10).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.userResults = users;
          if (silent) {
            this.searchRefreshInFlight = false;
          } else {
            this.isSearchingUsers = false;
          }
        });
      },
      error: () => {
        this.updateView(() => {
          if (silent) {
            this.searchRefreshInFlight = false;
          } else {
            this.searchErrorMessage = 'Unable to search users right now.';
            this.isSearchingUsers = false;
          }
        });
      }
    });
  }

  sendRequest(recipient: UserLookup): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    this.communityService.createFriendRequest({
      requesterUserId: userId,
      recipientUserId: recipient.id,
      note: this.noteControl.value.trim() || null
    }).subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.searchErrorMessage = this.buildModerationMessage('Friend request not sent.', moderation);
            return;
          }

          this.requests = [data, ...this.requests];
          this.userResults = this.userResults.filter((user) => user.id !== recipient.id);
          this.noteControl.setValue('');
          this.searchErrorMessage = moderation.action === 'Allow'
            ? ''
            : this.buildModerationMessage('Friend request sent without the blocked note.', moderation);
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.searchErrorMessage = this.extractErrorMessage(error, 'Unable to send this friend request.');
        });
      }
    });
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
    return !document.hidden && !this.isLoading && !this.isSearchingUsers && !this.searchRefreshInFlight;
  }

  private collectRequestUserIds(requests: FriendRequest[]): string[] {
    return Array.from(new Set(requests.flatMap((request) => [request.requesterUserId, request.recipientUserId])));
  }

  private applyModerationAccountState(moderation: ModerationFeedback): void {
    if (moderation.accountFrozen) {
      this.authService.markCurrentUserFrozen();
    }
  }

  private buildModerationMessage(prefix: string, moderation: ModerationFeedback): string {
    const parts = [prefix];
    if (moderation.reason) {
      parts.push(moderation.reason);
    }

    if (moderation.warningCount > 0) {
      parts.push(`Warning ${moderation.warningCount} of 3.`);
    }

    if (moderation.accountFrozen) {
      parts.push('Your account is now frozen.');
    }

    return parts.join(' ').trim();
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 423) {
      this.authService.markCurrentUserFrozen();
    }

    if (error && typeof error === 'object' && 'error' in error) {
      const payload = (error as { error?: unknown }).error;
      if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
      }
    }

    return fallback;
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
