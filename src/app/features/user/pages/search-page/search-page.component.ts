import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { NavbarBadgeService } from '../../../community/data-access/navbar-badge.service';
import { SearchService } from '../../../community/data-access/search.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { CommunityPost, FriendRequest, ReactionType } from '../../../community/models/community.model';
import { ModerationFeedback } from '../../../moderation/models/moderation.model';
import { SearchPageResult, SearchResults } from '../../../community/models/search.model';
import { UserLookup } from '../../../user/models/user.model';

type SearchTabKey = 'all' | 'users' | 'posts' | 'photos' | 'pages';

type SearchTab = {
  key: SearchTabKey;
  label: string;
};

type RelationshipState =
  | { kind: 'none'; label: string }
  | { kind: 'friends'; label: string; requestId: string }
  | { kind: 'request-sent'; label: string; requestId: string }
  | { kind: 'request-received'; label: string; requestId: string }
  | { kind: 'self'; label: string };

type SelectedPostSource = 'post' | 'photo';

@Component({
  selector: 'app-search-page',
  standalone: false,
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss']
})
export class SearchPageComponent implements OnInit, OnDestroy {
  readonly postCommentControl = new FormControl('', { nonNullable: true });
  readonly tabs: SearchTab[] = [
    { key: 'all', label: 'All' },
    { key: 'users', label: 'People' },
    { key: 'posts', label: 'Posts' },
    { key: 'photos', label: 'Photos' },
    { key: 'pages', label: 'Pages' }
  ];
  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;
  private readonly allPreviewLimit = 3;
  private readonly photoPreviewLimit = 6;
  private readonly pagePreviewLimit = 3;

  query = '';
  activeTab: SearchTabKey = 'all';
  results: SearchResults = {
    query: '',
    users: [],
    posts: [],
    photos: [],
    pages: [],
    events: []
  };
  isLoading = false;
  isLoadingFriendRequests = false;
  isSubmittingFriendAction = false;
  isSubmittingPostAction = false;
  errorMessage = '';
  selectedPost: CommunityPost | null = null;
  selectedPostSource: SelectedPostSource = 'post';
  selectedPostMessage = '';

  private searchRequest?: Subscription;
  private currentUserId: string | null = null;
  private friendRequests: FriendRequest[] = [];

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly searchService: SearchService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly communityService: CommunityService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly autoRefresh: AutoRefreshService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        const nextUserId = user?.id ?? null;
        const shouldReload = nextUserId !== this.currentUserId;

        this.currentUserId = nextUserId;
        if (shouldReload) {
          this.loadFriendRequests();
          if (this.query) {
            this.runSearch(this.query);
          }
        }
      })
    );

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = (params.get('query') ?? '').trim();
        const nextTab = this.normalizeTab(params.get('scope'));

        this.query = nextQuery;
        this.activeTab = nextTab;
        this.selectedPost = null;
        this.selectedPostMessage = '';
        this.postCommentControl.setValue('', { emitEvent: false });
        this.errorMessage = '';

        if (nextQuery) {
          this.runSearch(nextQuery);
          return;
        }

        this.clearResults();
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.runSearch(this.query, true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.searchRequest?.unsubscribe();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.loadFriendRequests();
    this.runSearch(this.query);
  }

  get hasQuery(): boolean {
    return this.query.trim().length > 0;
  }

  get currentUserAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  get isFrozenUser(): boolean {
    return this.authService.getCurrentUser()?.isFrozen ?? false;
  }

  get resultCountSummary(): string {
    if (!this.hasQuery) {
      return 'Search for people, posts, photos, and pages across the community.';
    }

    const total = this.results.users.length + this.results.posts.length + this.results.photos.length + this.results.pages.length;
    const parts = [
      `${this.results.users.length} people`,
      `${this.results.posts.length} posts`,
      `${this.results.photos.length} photos`,
      `${this.results.pages.length} pages`
    ];

    return `${total} result${total === 1 ? '' : 's'} for "${this.query}". ${parts.join(' | ')}.`;
  }

  get showPeopleSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'users';
  }

  get showPostSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'posts';
  }

  get showPhotoSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'photos';
  }

  get showPagesSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'pages';
  }

  get visibleUsers(): UserLookup[] {
    return this.activeTab === 'users'
      ? this.results.users
      : this.results.users.slice(0, this.allPreviewLimit);
  }

  get visiblePosts(): CommunityPost[] {
    return this.activeTab === 'posts'
      ? this.results.posts
      : this.results.posts.slice(0, this.allPreviewLimit);
  }

  get visiblePhotos(): CommunityPost[] {
    return this.activeTab === 'photos'
      ? this.results.photos
      : this.results.photos.slice(0, this.photoPreviewLimit);
  }

  get visiblePages(): SearchPageResult[] {
    return this.activeTab === 'pages'
      ? this.results.pages
      : this.results.pages.slice(0, this.pagePreviewLimit);
  }

  get hasAnyResults(): boolean {
    return this.visibleUsers.length > 0 ||
      this.visiblePosts.length > 0 ||
      this.visiblePhotos.length > 0 ||
      this.visiblePages.length > 0;
  }

  get showDiscoveryEmptyState(): boolean {
    return !this.hasQuery || !this.hasAnyResults;
  }

  tabCount(tab: SearchTabKey): number {
    switch (tab) {
      case 'users':
        return this.results.users.length;
      case 'posts':
        return this.results.posts.length;
      case 'photos':
        return this.results.photos.length;
      case 'pages':
        return this.results.pages.length;
      default:
        return this.results.users.length + this.results.posts.length + this.results.photos.length + this.results.pages.length;
    }
  }

  shouldShowSeeMore(tab: SearchTabKey): boolean {
    return this.activeTab === 'all' && this.tabCount(tab) > this.previewLimitFor(tab);
  }

  selectTab(tab: SearchTabKey): void {
    this.activeTab = tab;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        query: this.query || null,
        scope: tab
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  openUser(user: UserLookup): void {
    void this.router.navigate(['/dashboard/members', user.id], {
      queryParams: { query: this.query || null }
    });
  }

  openMessage(user: UserLookup): void {
    void this.router.navigate(['/dashboard/messenger'], {
      queryParams: { userId: user.id, query: this.query || null }
    });
  }

  openPost(post: CommunityPost, source: SelectedPostSource = 'post'): void {
    this.selectedPost = post;
    this.selectedPostSource = source;
    this.selectedPostMessage = '';
    this.postCommentControl.setValue('', { emitEvent: false });
  }

  closePostModal(): void {
    this.selectedPost = null;
    this.selectedPostSource = 'post';
    this.selectedPostMessage = '';
    this.postCommentControl.setValue('', { emitEvent: false });
  }

  reactToSelectedPost(reactionType: ReactionType): void {
    if (!this.selectedPost) {
      return;
    }

    this.reactToPost(this.selectedPost, reactionType);
  }

  reactToSearchPost(post: CommunityPost, reactionType: ReactionType): void {
    this.reactToPost(post, reactionType);
  }

  submitSelectedPostComment(): void {
    const post = this.selectedPost;
    const userId = this.currentUserId;
    const content = this.postCommentControl.value.trim();

    if (!post || !userId || !content || this.isSubmittingPostAction) {
      return;
    }

    if (this.isFrozenUser) {
      this.selectedPostMessage = 'Your account is frozen. Comments are disabled.';
      return;
    }

    this.isSubmittingPostAction = true;
    this.selectedPostMessage = '';

    this.communityService.addComment(post.id, {
      userId,
      content
    }).subscribe({
      next: ({ data, moderation }) => {
        this.isSubmittingPostAction = false;

        if (!data) {
          this.selectedPostMessage = this.buildModerationMessage('Comment not posted.', moderation);
          return;
        }

        this.syncUpdatedPost(data);
        this.postCommentControl.setValue('', { emitEvent: false });
        this.selectedPostMessage = 'Comment posted.';
      },
      error: () => {
        this.isSubmittingPostAction = false;
        this.selectedPostMessage = 'Unable to post your comment right now.';
      }
    });
  }

  getRelationshipState(user: UserLookup): RelationshipState {
    if (!this.currentUserId) {
      return { kind: 'none', label: 'Add Friend' };
    }

    if (user.id === this.currentUserId) {
      return { kind: 'self', label: 'You' };
    }

    const relatedRequests = this.friendRequests.filter((request) =>
      (request.requesterUserId === this.currentUserId && request.recipientUserId === user.id) ||
      (request.requesterUserId === user.id && request.recipientUserId === this.currentUserId)
    );

    const accepted = relatedRequests.find((request) => request.status === 'Accepted');
    if (accepted) {
      return { kind: 'friends', label: 'Friends', requestId: accepted.id };
    }

    const outgoing = relatedRequests.find((request) =>
      request.status === 'Pending' &&
      request.requesterUserId === this.currentUserId &&
      request.recipientUserId === user.id
    );
    if (outgoing) {
      return { kind: 'request-sent', label: 'Request sent', requestId: outgoing.id };
    }

    const incoming = relatedRequests.find((request) =>
      request.status === 'Pending' &&
      request.requesterUserId === user.id &&
      request.recipientUserId === this.currentUserId
    );
    if (incoming) {
      return { kind: 'request-received', label: 'Request received', requestId: incoming.id };
    }

    return { kind: 'none', label: 'Add Friend' };
  }

  canAddFriend(user: UserLookup): boolean {
    return this.getRelationshipState(user).kind === 'none';
  }

  canCancelRequest(user: UserLookup): boolean {
    return this.getRelationshipState(user).kind === 'request-sent';
  }

  canAcceptRequest(user: UserLookup): boolean {
    return this.getRelationshipState(user).kind === 'request-received';
  }

  canDeclineRequest(user: UserLookup): boolean {
    return this.getRelationshipState(user).kind === 'request-received';
  }

  relationshipLabel(user: UserLookup): string {
    return this.getRelationshipState(user).label;
  }

  requestFriend(user: UserLookup): void {
    const currentUserId = this.currentUserId;
    if (!currentUserId || this.isSubmittingFriendAction) {
      return;
    }

    this.isSubmittingFriendAction = true;
    this.communityService.createFriendRequest({
      requesterUserId: currentUserId,
      recipientUserId: user.id,
      note: null
    }).subscribe({
      next: () => {
        this.isSubmittingFriendAction = false;
        this.loadFriendRequests();
        this.navbarBadgeService.refresh(this.currentUserId);
      },
      error: () => {
        this.isSubmittingFriendAction = false;
        this.errorMessage = 'Unable to send friend request right now.';
      }
    });
  }

  cancelFriendRequest(user: UserLookup): void {
    const state = this.getRelationshipState(user);
    if (state.kind !== 'request-sent' || this.isSubmittingFriendAction) {
      return;
    }

    this.isSubmittingFriendAction = true;
    this.communityService.cancelFriendRequest(state.requestId).subscribe({
      next: () => {
        this.isSubmittingFriendAction = false;
        this.loadFriendRequests();
        this.navbarBadgeService.refresh(this.currentUserId);
      },
      error: () => {
        this.isSubmittingFriendAction = false;
        this.errorMessage = 'Unable to cancel friend request right now.';
      }
    });
  }

  acceptFriendRequest(user: UserLookup): void {
    const state = this.getRelationshipState(user);
    if (state.kind !== 'request-received' || !this.currentUserId || this.isSubmittingFriendAction) {
      return;
    }

    this.isSubmittingFriendAction = true;
    this.communityService.updateFriendRequestStatus(state.requestId, {
      actorUserId: this.currentUserId,
      status: 'Accepted'
    }).subscribe({
      next: () => {
        this.isSubmittingFriendAction = false;
        this.loadFriendRequests();
        this.navbarBadgeService.refresh(this.currentUserId);
      },
      error: () => {
        this.isSubmittingFriendAction = false;
        this.errorMessage = 'Unable to accept the request right now.';
      }
    });
  }

  declineFriendRequest(user: UserLookup): void {
    const state = this.getRelationshipState(user);
    if (state.kind !== 'request-received' || !this.currentUserId || this.isSubmittingFriendAction) {
      return;
    }

    this.isSubmittingFriendAction = true;
    this.communityService.updateFriendRequestStatus(state.requestId, {
      actorUserId: this.currentUserId,
      status: 'Declined'
    }).subscribe({
      next: () => {
        this.isSubmittingFriendAction = false;
        this.loadFriendRequests();
        this.navbarBadgeService.refresh(this.currentUserId);
      },
      error: () => {
        this.isSubmittingFriendAction = false;
        this.errorMessage = 'Unable to decline the request right now.';
      }
    });
  }

  openPage(page: SearchPageResult): void {
    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query: page.name,
        scope: 'pages'
      }
    });
  }

  getUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getPostAvatarUrl(post: CommunityPost): string {
    return this.avatarDirectory.resolveAvatarUrl(post.userId);
  }

  getPageAvatarUrl(page: SearchPageResult): string {
    return page.imageUrl?.trim() || '';
  }

  getSuggestionAvatarUrl(userId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(userId);
  }

  getCommentAvatarUrl(userId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(userId);
  }

  openUserById(userId: string): void {
    void this.router.navigate(['/dashboard/members', userId], {
      queryParams: { query: this.query || null }
    });
  }

  trackByUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  trackByPageId(_: number, page: SearchPageResult): string {
    return page.id;
  }

  private runSearch(query: string, silent = false): void {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !this.currentUserId) {
      this.searchRequest?.unsubscribe();
      this.searchRequest = undefined;
      this.clearResults();
      return;
    }

    if (!silent) {
      this.isLoading = true;
      this.errorMessage = '';
    }

    this.searchRequest?.unsubscribe();
    this.searchRequest = this.searchService.searchAll(normalizedQuery, this.currentUserId).subscribe({
      next: (results) => {
        this.results = results;
        this.query = results.query;
        this.isLoading = false;
        this.searchRequest = undefined;
      },
      error: () => {
        if (!silent) {
          this.clearResults();
          this.errorMessage = 'Unable to load search results right now.';
        }
        this.isLoading = false;
        this.searchRequest = undefined;
      }
    });
  }

  private clearResults(): void {
    this.searchRequest?.unsubscribe();
    this.searchRequest = undefined;
    this.results = {
      query: '',
      users: [],
      posts: [],
      photos: [],
      pages: [],
      events: []
    };
    this.isLoading = false;
  }

  private canPollSilently(): boolean {
    return !!this.currentUserId && !document.hidden && !this.isLoading && !this.searchRequest && this.hasQuery;
  }

  private normalizeTab(scope: string | null): SearchTabKey {
    return scope === 'users' ||
      scope === 'posts' ||
      scope === 'photos' ||
      scope === 'pages'
      ? scope
      : 'all';
  }

  private previewLimitFor(tab: SearchTabKey): number {
    switch (tab) {
      case 'photos':
        return this.photoPreviewLimit;
      case 'pages':
        return this.pagePreviewLimit;
      default:
        return this.allPreviewLimit;
    }
  }

  private reactToPost(post: CommunityPost, reactionType: ReactionType): void {
    const userId = this.currentUserId;

    if (!post || !userId || this.isSubmittingPostAction) {
      return;
    }

    if (this.isFrozenUser) {
      this.selectedPostMessage = 'Your account is frozen. Reactions are disabled.';
      return;
    }

    this.isSubmittingPostAction = true;
    this.selectedPostMessage = '';

    this.communityService.reactToPost(post.id, {
      userId,
      reactionType
    }).subscribe({
      next: (updatedPost) => {
        this.syncUpdatedPost(updatedPost);
        this.isSubmittingPostAction = false;
      },
      error: () => {
        this.selectedPostMessage = 'Unable to update the reaction right now.';
        this.isSubmittingPostAction = false;
      }
    });
  }

  private loadFriendRequests(): void {
    if (!this.currentUserId) {
      this.friendRequests = [];
      return;
    }

    this.isLoadingFriendRequests = true;
    this.communityService.getFriendRequests(this.currentUserId).subscribe({
      next: (requests) => {
        this.friendRequests = requests;
        this.isLoadingFriendRequests = false;
        this.navbarBadgeService.refresh(this.currentUserId);
      },
      error: () => {
        this.friendRequests = [];
        this.isLoadingFriendRequests = false;
      }
    });
  }

  private syncUpdatedPost(post: CommunityPost): void {
    this.results = {
      ...this.results,
      posts: this.results.posts.map((item) => item.id === post.id ? post : item),
      photos: this.results.photos.map((item) => item.id === post.id ? post : item)
    };

    if (this.selectedPost?.id === post.id) {
      this.selectedPost = post;
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
}
