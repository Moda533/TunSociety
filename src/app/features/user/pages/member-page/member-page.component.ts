import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../user/data-access/user.service';
import { CommunityPost } from '../../../community/models/community.model';
import { UserLookup } from '../../../user/models/user.model';

@Component({
  selector: 'app-member-page',
  standalone: false,
  templateUrl: './member-page.component.html',
  styleUrls: ['./member-page.component.scss']
})
export class MemberPageComponent implements OnInit, OnDestroy {
  member: UserLookup | null = null;
  memberPosts: CommunityPost[] = [];
  isLoading = false;
  isSendingRequest = false;
  errorMessage = '';
  actionMessage = '';
  searchQuery = '';

  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;
  private userId: string | null = null;
  private memberId = '';

  constructor(
    private readonly authService: AuthService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly communityService: CommunityService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly autoRefresh: AutoRefreshService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        this.userId = user?.id ?? null;
        this.loadMemberView();
      })
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        this.memberId = params.get('id') ?? '';
        this.loadMemberView();
      })
    );

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        this.searchQuery = (params.get('query') ?? '').trim();
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadMemberView(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get memberInitial(): string {
    return this.member?.displayName.charAt(0).toUpperCase() ?? 'M';
  }

  getMemberAvatarUrl(member: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(member.id, member.gender);
  }

  openSearchResults(): void {
    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query: this.searchQuery || this.member?.displayName || '',
        scope: 'users'
      }
    });
  }

  openFeedPost(post: CommunityPost): void {
    void this.router.navigate(['/dashboard/feed'], {
      queryParams: { post: post.id }
    });
  }

  sendFriendRequest(): void {
    const userId = this.userId;
    const member = this.member;

    if (!userId || !member) {
      return;
    }

    if (userId === member.id) {
      this.updateView(() => {
        this.actionMessage = 'This is your own profile.';
      });
      return;
    }

    this.updateView(() => {
      this.isSendingRequest = true;
      this.actionMessage = '';
      this.errorMessage = '';
    });

    this.communityService.createFriendRequest({
      requesterUserId: userId,
      recipientUserId: member.id,
      note: null
    }).subscribe({
      next: ({ data }) => {
        this.updateView(() => {
          this.isSendingRequest = false;
          this.actionMessage = data
            ? 'Friend request sent.'
            : 'Friend request was blocked by moderation.';
        });
      },
      error: () => {
        this.updateView(() => {
          this.isSendingRequest = false;
          this.errorMessage = 'Unable to send friend request right now.';
        });
      }
    });
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  private loadMemberView(silent = false): void {
    const userId = this.userId;
    if (!userId || !this.memberId) {
      return;
    }

    if (!silent) {
      this.updateView(() => {
        this.isLoading = true;
        this.errorMessage = '';
      });
    }

    this.userService.getLookupById(this.memberId).subscribe({
      next: (member) => {
        this.avatarDirectory.seedUser(member);
        this.communityService.getPosts(userId, 100).subscribe({
          next: (posts) => {
            this.updateView(() => {
              this.member = member;
              this.memberPosts = posts.filter((post) => post.userId === this.memberId).slice(0, 8);
              this.actionMessage = '';
              this.isLoading = false;
              this.errorMessage = '';
            });
          },
          error: () => {
            this.updateView(() => {
              if (!silent) {
                this.member = member;
                this.memberPosts = [];
                this.actionMessage = '';
                this.errorMessage = 'Unable to load this member right now.';
              }
              this.isLoading = false;
            });
          }
        });
      },
      error: () => {
        this.updateView(() => {
          if (!silent) {
            this.member = null;
            this.memberPosts = [];
            this.errorMessage = 'Unable to load this member right now.';
          }
          this.isLoading = false;
        });
      }
    });
  }

  private canPollSilently(): boolean {
    return !!this.userId && !!this.memberId && !document.hidden && !this.isLoading && !this.isSendingRequest;
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
