import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of, Subscription } from 'rxjs';
import { PERMISSIONS } from '../../../../core/permissions';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../user/data-access/user.service';
import { AdminService } from '../../../admin/data-access/admin.service';
import { ModerationService } from '../../../moderation/data-access/moderation.service';
import {
  FriendRequest,
  CommunityEvent,
  CommunityPost,
  Conversation,
  EventParticipationStatus,
  PostComment,
  PostVisibility,
  ReactionType
} from '../../../community/models/community.model';
import {
  FriendRequestActionState,
  resolveFriendRequestActionState
} from '../../../community/data-access/friend-request-state.util';
import {
  FlaggedContentReview,
  ModerationFeedback,
  ModerationResponse
} from '../../../moderation/models/moderation.model';
import { UserLookup } from '../../../user/models/user.model';
import { PostActionMenuAction } from '../../components/post-action-menu/post-action-menu.component';

type ComposerMode = 'create' | 'edit';
type ConfirmAction =
  | 'publish-create'
  | 'publish-update'
  | 'publish-comment'
  | 'delete-post'
  | 'discard-composer'
  | 'discard-comment'
  | 'leave-page';

type ReportReason = 'Harassment' | 'Hate speech' | 'Spam' | 'False information' | 'Other';

interface ReportDialogState {
  postId: string;
  authorName: string;
  postTitle: string;
  reason: ReportReason;
  details: string;
}

interface ConfirmDialogState {
  action: ConfirmAction;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  postId?: string | null;
}

interface NoticeDialogState {
  title: string;
  message: string;
  ackLabel?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}

interface EventRatingDialogState {
  eventId: string;
  title: string;
  rating: number;
}

interface ComposerSnapshot {
  title: string;
  content: string;
  imageUrl: string;
  visibility: PostVisibility;
}

interface SelectedPostView extends CommunityPost {
  authorAvatar: string;
  caption: string;
  mentions: string[];
}

interface MentionTextSegment {
  text: string;
  isMention: boolean;
}

interface MentionCursorState {
  start: number;
  end: number;
  query: string;
}

type ShareTargetKind = 'person' | 'group';

interface ShareTargetView {
  id: string;
  conversationId: string;
  kind: ShareTargetKind;
  name: string;
  subtitle: string;
  badge: string;
  avatarUrl: string;
  fallbackInitial: string;
  isSending: boolean;
  isSent: boolean;
  errorMessage: string;
}

@Component({
  selector: 'app-feed-page',
  standalone: false,
  templateUrl: './feed-page.component.html',
  styleUrls: ['./feed-page.component.scss']
})
export class FeedPageComponent implements OnInit, OnDestroy {
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly newTitleControl = new FormControl('', { nonNullable: true });
  readonly newImageUrlControl = new FormControl('', { nonNullable: true });
  readonly newPostControl = new FormControl('', { nonNullable: true });
  readonly visibilityControl = new FormControl<PostVisibility>('Public', { nonNullable: true });
  readonly eventTitleControl = new FormControl('', { nonNullable: true });
  readonly eventDescriptionControl = new FormControl('', { nonNullable: true });
  readonly eventDateTimeControl = new FormControl('', { nonNullable: true });
  readonly eventLocationControl = new FormControl('', { nonNullable: true });
  readonly eventRatingFeedbackControl = new FormControl('', { nonNullable: true });
  readonly commentDraftByPost: Record<string, string> = {};
  readonly eventRatingOptions = [1, 2, 3, 4, 5];

  posts: CommunityPost[] = [];
  events: CommunityEvent[] = [];
  suggestedUsers: UserLookup[] = [];
  friendRequests: FriendRequest[] = [];
  isLoading = false;
  isSuggestedUsersLoading = false;
  isSubmitting = false;
  isDeletingPost = false;
  commentSubmittingPostId: string | null = null;
  isComposerOpen = false;
  composerMode: ComposerMode = 'create';
  isEventComposerOpen = false;
  eventComposerMode: ComposerMode = 'create';
  editingEventId: string | null = null;
  ratingSubmittingEventId: string | null = null;
  editingPostId: string | null = null;
  activePostModalId: string | null = null;
  commentReplyTarget: PostComment | null = null;
  commentMentionDropdownPostId: string | null = null;
  commentMentionResults: UserLookup[] = [];
  highlightedCommentId: string | null = null;
  likedCommentIds = new Set<string>();
  activeImageModalUrl: string | null = null;
  activeImageModalAlt = '';
  openPostMenuId: string | null = null;
  openEventMenuId: string | null = null;
  confirmDialog: ConfirmDialogState | null = null;
  noticeDialog: NoticeDialogState | null = null;
  reportDialog: ReportDialogState | null = null;
  eventRatingDialog: EventRatingDialogState | null = null;
  activeSharePost: CommunityPost | null = null;
  activeShareEvent: CommunityEvent | null = null;
  shareLink = '';
  sharePersonTargets: ShareTargetView[] = [];
  shareGroupTargets: ShareTargetView[] = [];
  isShareTargetsLoading = false;
  shareErrorMessage = '';
  shareCopyMessage = '';
  postErrorMessage = '';
  eventErrorMessage = '';
  generalErrorMessage = '';
  imagePreviewUrl: string | null = null;
  selectedFileName = '';
  eventImageFile: File | null = null;
  eventImagePreviewUrl: string | null = null;
  eventImageFileName = '';
  eventImageMarkedForRemoval = false;
  savedPostIds = new Set<string>(this.loadSavedPostIds());
  likedEventIds = new Set<string>(this.loadLikedEventIds());
  hiddenPostIds = new Set<string>(this.loadHiddenPostIds());
  blockedUserIds = new Set<string>(this.loadBlockedUserIds());
  readonly reportReasons: ReportReason[] = ['Harassment', 'Hate speech', 'Spam', 'False information', 'Other'];

  private readonly refreshIntervalMs = 12000;
  private readonly savedPostsKey = 'ts_saved_posts';
  private readonly subscriptions = new Subscription();
  userId: string | null = null;
  private pendingPostId: string | null = null;
  private pendingCommentId: string | null = null;
  private pendingReplyId: string | null = null;
  private loadingPostById: string | null = null;
  private commentMentionCursor: MentionCursorState | null = null;
  private commentMentionSelections: UserLookup[] = [];
  private mentionSearchSequence = 0;
  private highlightTimerId: number | null = null;
  private composerBaseline: ComposerSnapshot = this.createDefaultComposerSnapshot();
  private pendingNavigationResolver: ((value: boolean) => void) | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly adminService: AdminService,
    private readonly moderationService: ModerationService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly autoRefresh: AutoRefreshService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        const nextUserId = user?.id ?? null;
        const hadUserId = !!this.userId;
        const shouldLoad = !!nextUserId && (!hadUserId || this.userId !== nextUserId || this.posts.length === 0);
        const shouldLoadFriendRequests = !!nextUserId && (!hadUserId || this.userId !== nextUserId || this.friendRequests.length === 0);

        this.updateView(() => {
          this.userId = nextUserId;
          if (!nextUserId && !this.authService.getToken()) {
            this.generalErrorMessage = 'Please sign in again to view posts.';
          }
        });

        if (shouldLoad) {
          this.loadPosts();
          this.loadEvents();
        }

        if (shouldLoadFriendRequests) {
          this.loadFriendRequests();
        }

        if (nextUserId) {
          this.loadSuggestedUsers();
        } else {
          this.updateView(() => {
            this.suggestedUsers = [];
            this.friendRequests = [];
            this.isSuggestedUsersLoading = false;
          });
        }
      })
    );

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const postId = params.get('post');
        const commentId = params.get('comment');
        const replyId = params.get('reply');
        this.updateView(() => {
          this.pendingPostId = postId;
          this.pendingCommentId = commentId;
          this.pendingReplyId = replyId;
          if (!postId) {
            this.activePostModalId = null;
            this.highlightedCommentId = null;
            return;
          }

          if (this.posts.some((post) => post.id === postId)) {
            this.activePostModalId = postId;
            this.scheduleCommentHighlight();
          }
        });

        if (postId && !this.posts.some((post) => post.id === postId)) {
          this.loadPostById(postId);
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadPosts(true);
          this.loadEvents(true);
          this.loadSuggestedUsers(true);
          this.loadFriendRequests(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.highlightTimerId !== null) {
      window.clearTimeout(this.highlightTimerId);
    }
    this.resolvePendingNavigation(false);
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.openPostMenuId = null;
    this.openEventMenuId = null;
    this.closeMentionDropdown();
  }

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedWork) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  canLeavePage(): boolean | Promise<boolean> {
    if (!this.hasUnsavedWork) {
      return true;
    }

    this.confirmDialog = {
      action: 'leave-page',
      title: 'Leave page?',
      message: this.hasActiveCommentDraft
        ? "You haven't finished your comment yet. Do you want to leave without finishing?"
        : 'You have an unfinished post draft. Do you want to leave without finishing it?',
      confirmLabel: 'Leave page',
      tone: 'danger'
    };

    return new Promise<boolean>((resolve) => {
      this.pendingNavigationResolver = resolve;
    });
  }

  get filteredPosts(): CommunityPost[] {
    const search = this.searchControl.value.trim().toLowerCase();
    return this.posts.filter((post) =>
      !this.hiddenPostIds.has(post.id) &&
      !this.blockedUserIds.has(post.userId) &&
      (!search ||
      post.authorName.toLowerCase().includes(search) ||
      post.content.toLowerCase().includes(search))
    );
  }

  get filteredEvents(): CommunityEvent[] {
    const search = this.searchControl.value.trim().toLowerCase();
    return this.events.filter((event) =>
      !search ||
      event.title.toLowerCase().includes(search) ||
      event.description.toLowerCase().includes(search) ||
      event.location.toLowerCase().includes(search)
    );
  }

  get isFrozenUser(): boolean {
    return this.authService.getCurrentUser()?.isFrozen ?? false;
  }

  get canModeratePosts(): boolean {
    return this.authService.hasPermission(PERMISSIONS.moderationReview);
  }

  get canManageEvents(): boolean {
    return this.authService.canManageEvents();
  }

  get currentUserDisplayName(): string {
    return this.authService.getCurrentUser()?.displayName || this.authService.getCurrentUser()?.userName || 'Member';
  }

  get currentUserRole(): string {
    return this.authService.getCurrentUser()?.role || 'Community member';
  }

  get currentUserAvatarUrl(): string {
    return this.avatarDirectory.resolveAvatarUrl(this.userId ?? this.authService.getUserId(), this.authService.getCurrentUser()?.gender);
  }

  get currentUserAvatar(): string {
    return this.currentUserAvatarUrl;
  }

  get currentUserInitials(): string {
    return this.currentUserDisplayName
      .split(/\s+/)
      .filter((part: string) => part.length > 0)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase() ?? '')
      .join('') || 'TS';
  }

  getSuggestedUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getPostAvatarUrl(post: CommunityPost): string {
    return this.avatarDirectory.resolveAvatarUrl(post.userId);
  }

  getCommentAvatarUrl(comment: PostComment): string {
    return this.avatarDirectory.resolveAvatarUrl(comment.userId);
  }

  getLookupAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id);
  }

  getSuggestedUserInitials(user: UserLookup): string {
    return user.displayName
      .split(/\s+/)
      .filter((part: string) => part.length > 0)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase() ?? '')
      .join('') || 'TS';
  }

  isFemaleUser(user: UserLookup): boolean {
    return user.gender.trim().toLowerCase() === 'female';
  }

  get totalCommentCount(): number {
    return this.posts.reduce((sum, post) => sum + this.getPostCommentCount(post), 0);
  }

  get totalReactionCount(): number {
    return this.posts.reduce(
      (sum, post) => sum + post.reactions.like + post.reactions.insightful + post.reactions.support,
      0
    );
  }

  get activePost(): CommunityPost | null {
    if (!this.activePostModalId) {
      return null;
    }

    const post = this.posts.find((item) => item.id === this.activePostModalId) ?? null;
    if (!post || this.hiddenPostIds.has(post.id) || this.blockedUserIds.has(post.userId)) {
      return null;
    }

    return post;
  }

  get selectedPost(): SelectedPostView | null {
    const post = this.activePost;
    if (!post) {
      return null;
    }

    return {
      ...post,
      authorAvatar: this.getPostAvatarUrl(post),
      caption: post.content,
      mentions: this.collectPostMentions(post)
    };
  }

  get hasComposerDraft(): boolean {
    const current = this.captureComposerSnapshot();
    return current.title !== this.composerBaseline.title ||
      current.content !== this.composerBaseline.content ||
      current.imageUrl !== this.composerBaseline.imageUrl ||
      current.visibility !== this.composerBaseline.visibility;
  }

  get hasActiveCommentDraft(): boolean {
    const postId = this.activePostModalId;
    if (!postId) {
      return false;
    }

    return (this.commentDraftByPost[postId] ?? '').trim().length > 0;
  }

  get hasUnsavedWork(): boolean {
    return this.hasComposerDraft || Object.values(this.commentDraftByPost).some((draft) => draft.trim().length > 0);
  }

  getCommentDraft(postId: string): string {
    return this.commentDraftByPost[postId] ?? '';
  }

  getPostCommentCount(post: CommunityPost): number {
    return post.comments.reduce((sum, comment) => sum + 1 + (comment.replies?.length ?? 0), 0);
  }

  getCommentReplies(comment: PostComment): PostComment[] {
    return comment.replies ?? [];
  }

  getCommentPlaceholder(): string {
    return this.commentReplyTarget ? 'Write a reply...' : 'Write a public comment...';
  }

  get replyTargetName(): string {
    return this.commentReplyTarget?.authorName ?? '';
  }

  isCommentLiked(comment: PostComment): boolean {
    return this.likedCommentIds.has(comment.id);
  }

  trackByMentionUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByTextSegment(index: number, segment: MentionTextSegment): string {
    return `${index}-${segment.text}`;
  }

  get composerConfirmLabel(): string {
    return this.composerMode === 'edit' ? 'Save changes' : 'Publish post';
  }

  refreshFeed(): void {
    this.loadPosts();
    this.loadEvents();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.refreshFeed();
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  trackByEventId(_: number, event: CommunityEvent): string {
    return event.id;
  }

  trackBySuggestedUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByShareTargetId(_: number, target: ShareTargetView): string {
    return `${target.kind}-${target.id}`;
  }

  getSuggestedFriendRequestActionState(user: UserLookup): FriendRequestActionState {
    return resolveFriendRequestActionState(this.userId, user.id, this.friendRequests);
  }

  trackByCommentId(_: number, comment: PostComment): string {
    return comment.id;
  }

  formatMentionSegments(content: string): MentionTextSegment[] {
    const mentionRegex = /(@[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9_][A-Za-z0-9_.-]*){0,2})/g;
    const segments: MentionTextSegment[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: content.slice(lastIndex, match.index), isMention: false });
      }

      segments.push({ text: match[0], isMention: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      segments.push({ text: content.slice(lastIndex), isMention: false });
    }

    return segments.length > 0 ? segments : [{ text: content, isMention: false }];
  }

  toggleCommentLike(comment: PostComment): void {
    const next = new Set(this.likedCommentIds);
    if (next.has(comment.id)) {
      next.delete(comment.id);
    } else {
      next.add(comment.id);
    }

    this.likedCommentIds = next;
  }

  startReply(comment: PostComment): void {
    this.commentReplyTarget = comment.parentCommentId
      ? this.activePost?.comments.find((item) => item.id === comment.parentCommentId) ?? comment
      : comment;
    this.closeMentionDropdown();

    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.comment-input-field');
      input?.focus();
    }, 0);
  }

  cancelReply(): void {
    this.commentReplyTarget = null;
  }

  isPostLiked(post: CommunityPost): boolean {
    return post.reactions.myReaction === 'like';
  }

  openUserProfile(userId: string | null | undefined): void {
    const trimmedUserId = userId?.trim();
    if (!trimmedUserId) {
      return;
    }

    if (trimmedUserId === this.userId) {
      void this.router.navigate(['/dashboard/profile']);
      return;
    }

    void this.router.navigate(['/dashboard/members', trimmedUserId]);
  }

  openPostImageViewer(post: CommunityPost): void {
    const imageUrl = post.imageUrl?.trim();
    if (!imageUrl) {
      return;
    }

    this.activeImageModalUrl = imageUrl;
    this.activeImageModalAlt = `${post.authorName} post image`;
  }

  closePostImageViewer(): void {
    this.activeImageModalUrl = null;
    this.activeImageModalAlt = '';
  }

  private collectPostMentions(post: CommunityPost): string[] {
    const mentionRegex = /(^|[\s([{"'`>])(@[A-Za-z0-9_][A-Za-z0-9_.-]*)/g;
    const mentions = new Map<string, string>();
    const commentTexts = post.comments.flatMap((comment) => [
      comment.content,
      ...(comment.replies ?? []).map((reply) => reply.content)
    ]);
    const sourceTexts = [post.content, ...commentTexts];

    for (const text of sourceTexts) {
      mentionRegex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = mentionRegex.exec(text)) !== null) {
        const mention = match[2];
        const key = mention.toLowerCase();
        if (!mentions.has(key)) {
          mentions.set(key, mention);
        }
      }
    }

    return Array.from(mentions.values());
  }

  isPostHidden(post: CommunityPost): boolean {
    return this.hiddenPostIds.has(post.id) || this.blockedUserIds.has(post.userId);
  }

  openEventDetails(event: CommunityEvent): void {
    this.openEventMenuId = null;
    void this.router.navigate(['/dashboard/events', event.id]);
  }

  openCreateEventComposer(): void {
    this.openPostMenuId = null;
    this.openEventMenuId = null;
    this.eventComposerMode = 'create';
    this.editingEventId = null;
    this.eventErrorMessage = '';
    this.resetEventComposerFields();
    this.isEventComposerOpen = true;
  }

  openEditEventComposer(event: CommunityEvent): void {
    this.openEventMenuId = null;
    this.eventComposerMode = 'edit';
    this.editingEventId = event.id;
    this.eventErrorMessage = '';
    this.eventTitleControl.setValue(event.title);
    this.eventDescriptionControl.setValue(event.description);
    this.eventDateTimeControl.setValue(this.toDatetimeLocalValue(event.startsAtUtc));
    this.eventLocationControl.setValue(event.location);
    this.eventImageFile = null;
    this.eventImagePreviewUrl = event.imageUrl;
    this.eventImageFileName = '';
    this.eventImageMarkedForRemoval = false;
    this.isEventComposerOpen = true;
  }

  closeEventComposer(): void {
    this.isEventComposerOpen = false;
    this.eventComposerMode = 'create';
    this.editingEventId = null;
    this.eventErrorMessage = '';
    this.resetEventComposerFields();
  }

  submitEventComposer(): void {
    const userId = this.userId;
    if (!userId || this.isSubmitting || !this.validateEventComposer()) {
      return;
    }

    const payload = {
      userId,
      title: this.eventTitleControl.value.trim(),
      description: this.eventDescriptionControl.value.trim(),
      startsAtUtc: new Date(this.eventDateTimeControl.value).toISOString(),
      location: this.eventLocationControl.value.trim(),
      image: this.eventImageFile,
      removeImage: this.eventImageMarkedForRemoval
    };

    this.isSubmitting = true;
    const request$ = this.eventComposerMode === 'edit' && this.editingEventId
      ? this.communityService.updateEvent(this.editingEventId, payload)
      : this.communityService.createEvent(payload);

    request$.subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          this.isSubmitting = false;
          if (!data) {
            this.eventErrorMessage = this.buildModerationMessage('Event was not saved.', moderation);
            return;
          }

          this.events = [
            data,
            ...this.events.filter((event) => event.id !== data.id)
          ].sort((left, right) => new Date(right.startsAtUtc).getTime() - new Date(left.startsAtUtc).getTime());
          this.closeEventComposer();
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.eventErrorMessage = this.resolveError(error, 'Unable to save event.');
          this.isSubmitting = false;
        });
      }
    });
  }

  deleteEvent(event: CommunityEvent): void {
    const userId = this.userId;
    if (!userId || this.isDeletingPost) {
      return;
    }

    this.isDeletingPost = true;
    this.communityService.deleteEvent(event.id, userId).subscribe({
      next: () => {
        this.updateView(() => {
          this.events = this.events.filter((item) => item.id !== event.id);
          this.isDeletingPost = false;
          this.openNotice('Event deleted', `${event.title} was removed from the feed.`, 'success');
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.isDeletingPost = false;
          this.openNotice('Delete failed', this.resolveError(error, 'Unable to delete event.'), 'warning');
        });
      }
    });
  }

  setEventParticipation(event: CommunityEvent, status: EventParticipationStatus): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    if (status === 'GoingInterested') {
      return;
    }

    const previousEvent = { ...event };
    const nextEvent = this.buildOptimisticEventParticipation(event, status);
    this.updateView(() => {
      this.replaceEvent(nextEvent);
    });

    this.communityService.updateEventParticipation(event.id, { userId, status }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.replaceEvent(updated);
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.replaceEvent(previousEvent);
          this.openNotice('Event update failed', this.resolveError(error, 'Unable to update your event status.'), 'warning');
        });
      }
    });
  }

  isEventGoing(event: CommunityEvent): boolean {
    return event.myStatus === 'Going' || event.myStatus === 'GoingInterested';
  }

  isEventInterested(event: CommunityEvent): boolean {
    return event.myStatus === 'Interested' || event.myStatus === 'GoingInterested';
  }

  private buildOptimisticEventParticipation(
    event: CommunityEvent,
    status: 'Going' | 'Interested'
  ): CommunityEvent {
    const wasGoing = this.isEventGoing(event);
    const wasInterested = this.isEventInterested(event);
    const isGoing = status === 'Going' ? !wasGoing : wasGoing;
    const isInterested = status === 'Interested' ? !wasInterested : wasInterested;

    return {
      ...event,
      myStatus: this.buildEventParticipationStatus(isGoing, isInterested),
      goingCount: Math.max(0, event.goingCount + (isGoing === wasGoing ? 0 : isGoing ? 1 : -1)),
      interestedCount: Math.max(0, event.interestedCount + (isInterested === wasInterested ? 0 : isInterested ? 1 : -1))
    };
  }

  private buildEventParticipationStatus(isGoing: boolean, isInterested: boolean): EventParticipationStatus | null {
    if (isGoing && isInterested) {
      return 'GoingInterested';
    }

    if (isGoing) {
      return 'Going';
    }

    return isInterested ? 'Interested' : null;
  }

  isEventLiked(event: CommunityEvent): boolean {
    return this.likedEventIds.has(event.id);
  }

  toggleEventLike(event: CommunityEvent): void {
    if (this.likedEventIds.has(event.id)) {
      this.likedEventIds.delete(event.id);
    } else {
      this.likedEventIds.add(event.id);
    }

    this.persistLikedEventIds();
  }

  getEventRatingValue(event: CommunityEvent): number {
    if (this.eventRatingDialog?.eventId === event.id) {
      return this.eventRatingDialog.rating;
    }

    return event.myRating ?? Math.round(event.averageRating ?? 0);
  }

  rateEvent(event: CommunityEvent, rating: number, clickEvent: MouseEvent): void {
    clickEvent.stopPropagation();
    if (!this.userId || this.ratingSubmittingEventId === event.id) {
      return;
    }

    if (!this.isPastEvent(event)) {
      this.openNotice('Rating locked', 'Event rating opens after the event starts.');
      return;
    }

    this.eventRatingFeedbackControl.setValue('');
    this.eventRatingDialog = {
      eventId: event.id,
      title: event.title,
      rating
    };
  }

  closeEventRatingDialog(): void {
    this.eventRatingDialog = null;
    this.eventRatingFeedbackControl.setValue('');
  }

  submitEventRating(): void {
    const dialog = this.eventRatingDialog;
    const userId = this.userId;
    if (!dialog || !userId || this.ratingSubmittingEventId === dialog.eventId) {
      return;
    }

    this.ratingSubmittingEventId = dialog.eventId;
    this.communityService.evaluateEvent(dialog.eventId, {
      userId,
      rating: dialog.rating,
      feedback: this.eventRatingFeedbackControl.value.trim() || null
    }).subscribe({
      next: (updated) => {
        this.updateView(() => {
          this.replaceEvent(updated);
          this.ratingSubmittingEventId = null;
          this.closeEventRatingDialog();
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.ratingSubmittingEventId = null;
          this.openNotice('Rating failed', this.resolveError(error, 'Unable to save rating now.'), 'warning');
        });
      }
    });
  }

  isPastEvent(event: CommunityEvent): boolean {
    return new Date(event.startsAtUtc).getTime() <= Date.now();
  }

  openCreateComposer(): void {
    this.openPostMenuId = null;
    this.activePostModalId = null;
    this.composerMode = 'create';
    this.editingPostId = null;
    this.noticeDialog = null;
    this.postErrorMessage = '';
    this.generalErrorMessage = '';
    this.resetComposerFields();
    this.composerBaseline = this.createDefaultComposerSnapshot();
    this.isComposerOpen = true;
  }

  openEditComposer(post: CommunityPost): void {
    this.openPostMenuId = null;
    this.activePostModalId = null;
    this.composerMode = 'edit';
    this.editingPostId = post.id;
    this.noticeDialog = null;
    this.postErrorMessage = '';
    this.generalErrorMessage = '';
    this.newTitleControl.setValue(post.title);
    this.newPostControl.setValue(post.content);
    this.newImageUrlControl.setValue(post.imageUrl ?? '');
    this.visibilityControl.setValue(post.visibility);
    this.imagePreviewUrl = post.imageUrl;
    this.selectedFileName = '';
    this.composerBaseline = this.captureComposerSnapshot();
    this.isComposerOpen = true;
  }

  openReportDialog(post: CommunityPost): void {
    this.openPostMenuId = null;
    this.reportDialog = {
      postId: post.id,
      authorName: post.authorName,
      postTitle: post.title,
      reason: 'Harassment',
      details: ''
    };
  }

  closeReportDialog(): void {
    this.reportDialog = null;
  }

  submitReportDialog(): void {
    const dialog = this.reportDialog;
    if (!dialog) {
      return;
    }

    const reports = this.loadReports();
    reports.unshift({
      postId: dialog.postId,
      authorName: dialog.authorName,
      postTitle: dialog.postTitle,
      reason: dialog.reason,
      details: dialog.details.trim(),
      createdAtUtc: new Date().toISOString()
    });
    this.persistReports(reports.slice(0, 20));
    this.reportDialog = null;
    this.openNotice('Report submitted', 'Thanks. The post has been recorded in your local review list.', 'success', 'Done');
  }

  requestCloseComposer(): void {
    if (this.hasComposerDraft) {
      this.confirmDialog = {
        action: 'discard-composer',
        title: 'Discard this post draft?',
        message: 'You have unsaved post changes. Do you want to close this popup without saving them?',
        confirmLabel: 'Discard draft',
        tone: 'danger'
      };
      return;
    }

    this.closeComposer(true);
  }

  requestSubmitComposer(): void {
    if (!this.validateComposer()) {
      return;
    }

    this.confirmDialog = {
      action: this.composerMode === 'edit' ? 'publish-update' : 'publish-create',
      title: this.composerMode === 'edit' ? 'Save post changes?' : 'Publish this post?',
      message: this.composerMode === 'edit'
        ? 'Your updated post will be sent through moderation before it is saved.'
        : 'Your post will be sent through moderation before it is published.',
      confirmLabel: this.composerMode === 'edit' ? 'Save changes' : 'Publish post'
    };
  }

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.openNotice('Image warning', 'Image too large. Use a file under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        this.openNotice('Image warning', 'Invalid image file format.');
        return;
      }

      this.newImageUrlControl.setValue(result);
      this.imagePreviewUrl = result;
      this.selectedFileName = file.name;
      this.postErrorMessage = '';
    };

    reader.onerror = () => {
      this.openNotice('Image warning', 'Could not read selected file.');
    };

    reader.readAsDataURL(file);
  }

  onImageUrlInputChange(): void {
    const value = this.newImageUrlControl.value.trim();
    if (!value) {
      this.imagePreviewUrl = null;
      this.selectedFileName = '';
      return;
    }

    this.imagePreviewUrl = value;
    this.selectedFileName = '';
  }

  clearImage(): void {
    this.newImageUrlControl.setValue('');
    this.imagePreviewUrl = null;
    this.selectedFileName = '';
  }

  onEventImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      this.openNotice('Image warning', 'Image too large. Use a file under 20MB.');
      if (input) {
        input.value = '';
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        this.openNotice('Image warning', 'Invalid image file format.');
        if (input) {
          input.value = '';
        }
        return;
      }

      this.eventImageFile = file;
      this.eventImagePreviewUrl = result;
      this.eventImageFileName = file.name;
      this.eventImageMarkedForRemoval = false;
      this.eventErrorMessage = '';
    };

    reader.onerror = () => {
      this.openNotice('Image warning', 'Could not read selected file.');
      if (input) {
        input.value = '';
      }
    };

    reader.readAsDataURL(file);
  }

  clearEventImage(input?: HTMLInputElement): void {
    this.eventImageFile = null;
    this.eventImagePreviewUrl = null;
    this.eventImageFileName = '';
    this.eventImageMarkedForRemoval = this.eventComposerMode === 'edit';
    if (input) {
      input.value = '';
    }
  }

  reactToPost(post: CommunityPost, reaction: ReactionType): void {
    const userId = this.userId;
    if (!userId || this.isFrozenUser) {
      this.openNotice('Reaction blocked', 'Your account is frozen. Reactions are disabled.', 'warning');
      return;
    }

    const previousPost = {
      ...post,
      reactions: { ...post.reactions }
    };
    const optimisticPost: CommunityPost = {
      ...post,
      reactions: this.buildOptimisticReactions(post, reaction)
    };
    this.updateView(() => {
      this.replacePost(optimisticPost);
    });

    this.communityService.reactToPost(post.id, {
      userId,
      reactionType: reaction
    }).subscribe({
      next: (updatedPost) => {
        this.updateView(() => {
          this.replacePost(updatedPost);
        });
      },
      error: () => {
        this.updateView(() => {
          this.replacePost(previousPost);
          this.openNotice('Reaction failed', 'Unable to update reaction now.', 'warning');
        });
      }
    });
  }

  isPostSaved(postId: string): boolean {
    return this.savedPostIds.has(postId);
  }

  toggleSavedPost(post: CommunityPost): void {
    if (this.savedPostIds.has(post.id)) {
      this.savedPostIds.delete(post.id);
      this.persistSavedPostIds();
      return;
    }

    this.savedPostIds.add(post.id);
    this.persistSavedPostIds();
    this.openNotice('Saved', 'Post saved to this browser.', 'success', 'Great');
  }

  hidePost(post: CommunityPost): void {
    this.hiddenPostIds.add(post.id);
    this.persistHiddenPostIds();
    if (this.activePostModalId === post.id) {
      this.closeCommentModal(true);
    }
    this.openPostMenuId = null;
    this.openNotice('Post hidden', 'This post will no longer appear in your feed.', 'success', 'OK');
  }

  blockUser(post: CommunityPost): void {
    this.blockedUserIds.add(post.userId);
    this.persistBlockedUserIds();
    if (this.activePostModalId === post.id) {
      this.closeCommentModal(true);
    }
    this.openPostMenuId = null;
    this.openNotice('User blocked', `${post.authorName} is blocked on this browser.`, 'success', 'OK');
  }

  sharePost(post: CommunityPost): void {
    if (!this.userId) {
      this.openNotice('Session expired', 'Please sign in again to share this post.', 'warning');
      return;
    }

    this.openPostMenuId = null;
    this.updateView(() => {
      this.activeSharePost = post;
      this.activeShareEvent = null;
      this.shareLink = this.buildShareUrl(post.id);
      this.sharePersonTargets = [];
      this.shareGroupTargets = [];
      this.shareErrorMessage = '';
      this.shareCopyMessage = '';
      this.isShareTargetsLoading = true;
    });

    this.loadShareTargets();
  }

  shareEvent(event: CommunityEvent): void {
    if (!this.userId) {
      this.openNotice('Session expired', 'Please sign in again to share this event.', 'warning');
      return;
    }

    this.openEventMenuId = null;
    this.updateView(() => {
      this.activeSharePost = null;
      this.activeShareEvent = event;
      this.shareLink = this.buildEventShareUrl(event.id);
      this.sharePersonTargets = [];
      this.shareGroupTargets = [];
      this.shareErrorMessage = '';
      this.shareCopyMessage = '';
      this.isShareTargetsLoading = true;
    });

    this.loadShareTargets();
  }

  closeSharePopup(): void {
    this.activeSharePost = null;
    this.activeShareEvent = null;
    this.shareLink = '';
    this.sharePersonTargets = [];
    this.shareGroupTargets = [];
    this.shareErrorMessage = '';
    this.shareCopyMessage = '';
    this.isShareTargetsLoading = false;
  }

  get shareModalEyebrow(): string {
    return this.activeShareEvent ? 'Share event' : 'Share post';
  }

  get shareModalDescription(): string {
    if (this.activeShareEvent) {
      return `${this.activeShareEvent.title} will open directly from the event link.`;
    }

    const post = this.activeSharePost;
    return post ? `${post.authorName}'s post will open directly in the feed.` : '';
  }

  get sharePreviewTitle(): string {
    if (this.activeShareEvent) {
      return this.activeShareEvent.title;
    }

    const post = this.activeSharePost;
    return post ? (post.title || `${post.authorName}'s post`) : '';
  }

  get sharePreviewSummary(): string {
    if (this.activeShareEvent) {
      return this.summarizePostContent(this.activeShareEvent.description, 120);
    }

    return this.activeSharePost ? this.summarizePostContent(this.activeSharePost.content, 120) : '';
  }

  copyShareLink(): void {
    if (!this.shareLink) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      this.shareCopyMessage = this.shareLink;
      return;
    }

    navigator.clipboard.writeText(this.shareLink)
      .then(() => {
        this.updateView(() => {
          this.shareCopyMessage = 'Link copied.';
        });
      })
      .catch(() => {
        this.updateView(() => {
          this.shareCopyMessage = this.shareLink;
        });
      });
  }

  sendPostShare(target: ShareTargetView): void {
    const post = this.activeSharePost;
    const event = this.activeShareEvent;
    const userId = this.userId;
    if ((!post && !event) || !userId || target.isSending || target.isSent) {
      return;
    }

    this.setShareTargetState(target, {
      isSending: true,
      errorMessage: ''
    });

    const message = post ? this.buildPostShareMessage(post) : this.buildEventShareMessage(event!);
    const send$ = target.kind === 'group'
      ? this.communityService.sendGroupMessage(target.conversationId, {
          senderUserId: userId,
          content: message
        })
      : this.communityService.sendDirectMessage({
          senderUserId: userId,
          recipientUserId: target.id,
          content: message
        });

    send$.subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.setShareTargetState(target, {
              isSending: false,
              errorMessage: this.buildModerationMessage('Share was not sent.', moderation)
            });
            return;
          }

          this.setShareTargetState(target, {
            isSending: false,
            isSent: true,
            errorMessage: ''
          });
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.setShareTargetState(target, {
            isSending: false,
            errorMessage: this.resolveError(error, 'Unable to send this share right now.')
          });
        });
      }
    });
  }

  sendFriendRequestByName(displayName: string): void {
    const userId = this.userId;
    if (!userId) {
      this.openNotice('Session expired', 'Please sign in again.', 'warning');
      return;
    }

    this.userService.search(displayName, 1).subscribe({
      next: (matches) => {
        const recipient = matches[0];
        if (!recipient) {
          this.openNotice('No match found', `No member matched "${displayName}".`, 'warning');
          return;
        }

        this.sendFriendRequestToUser(recipient);
      },
      error: () => {
        this.openNotice('Search failed', 'Unable to look up that person right now.', 'warning');
      }
    });
  }

  sendFriendRequestToUser(user: UserLookup): void {
    const requesterUserId = this.userId;
    if (!requesterUserId) {
      this.openNotice('Session expired', 'Please sign in again.', 'warning');
      return;
    }

    this.communityService.createFriendRequest({
      requesterUserId,
      recipientUserId: user.id,
      note: null
    }).subscribe({
      next: ({ data }) => {
        this.updateView(() => {
          if (data) {
            this.friendRequests = [data, ...this.friendRequests.filter((request) => request.id !== data.id)];
            this.openNotice('Request sent', `Friend request sent to ${user.displayName}.`, 'success');
            return;
          }

          this.openNotice('Request sent', `Friend request sent to ${user.displayName}.`, 'success');
        });
      },
      error: () => {
        this.openNotice('Request failed', 'Unable to send that friend request.', 'warning');
      }
    });
  }

  toggleSuggestedFriendRequest(user: UserLookup): void {
    const action = this.getSuggestedFriendRequestActionState(user);

    if (action.kind === 'cancel' && action.requestId) {
      this.cancelFriendRequest(action.requestId, user.displayName);
      return;
    }

    if (action.kind !== 'add') {
      return;
    }

    this.sendFriendRequestToUser(user);
  }

  togglePostMenu(postId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openPostMenuId = this.openPostMenuId === postId ? null : postId;
    this.openEventMenuId = null;
  }

  toggleEventMenu(eventId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openEventMenuId = this.openEventMenuId === eventId ? null : eventId;
    this.openPostMenuId = null;
  }

  handlePostMenuAction(post: CommunityPost, action: PostActionMenuAction): void {
    this.openPostMenuId = null;

    switch (action) {
      case 'hide':
        this.hidePost(post);
        break;
      case 'report':
        this.openReportDialog(post);
        break;
      case 'block-account':
        this.blockUser(post);
        break;
      case 'share':
        void this.sharePost(post);
        break;
      case 'edit':
        this.openEditComposer(post);
        break;
      case 'delete':
        this.requestDeletePost(post);
        break;
      case 'view-moderation':
        this.openPostModerationDetails(post);
        break;
      case 'approve':
        this.approvePostFromMenu(post);
        break;
      case 'flag':
        this.flagPostFromMenu(post);
        break;
      case 'block-post':
        this.blockPostFromMenu(post);
        break;
      case 'ai-classification':
        this.showAiClassificationResult(post);
        break;
    }
  }

  handleEventMenuAction(event: CommunityEvent, action: PostActionMenuAction): void {
    this.openEventMenuId = null;

    switch (action) {
      case 'edit':
        this.openEditEventComposer(event);
        break;
      case 'delete':
        this.deleteEvent(event);
        break;
      default:
        break;
    }
  }

  isOwnPost(post: CommunityPost): boolean {
    return !!this.userId && post.userId === this.userId;
  }

  openCommentModal(post: CommunityPost): void {
    this.openPostMenuId = null;
    this.generalErrorMessage = '';
    this.closePostImageViewer();
    if (this.activePostModalId === post.id) {
      return;
    }

    if (this.hasActiveCommentDraft) {
      this.confirmDialog = {
        action: 'discard-comment',
        title: 'Leave page?',
        message: "You haven't finished your comment yet. Do you want to leave without finishing?",
        confirmLabel: 'Leave page',
        tone: 'danger',
        postId: post.id
      };
      return;
    }

    this.resetCommentComposerState();
    this.activePostModalId = post.id;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { post: post.id, comment: null, reply: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  requestCloseCommentModal(): void {
    if (this.hasActiveCommentDraft) {
      this.confirmDialog = {
        action: 'discard-comment',
        title: 'Leave page?',
        message: "You haven't finished your comment yet. Do you want to leave without finishing?",
        confirmLabel: 'Leave page',
        tone: 'danger'
      };
      return;
    }

    this.closeCommentModal(true);
  }

  closePostModal(): void {
    this.closePostImageViewer();
    this.requestCloseCommentModal();
  }

  updateCommentDraft(postId: string, event: Event): void {
    const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
    const value = target?.value ?? '';
    this.commentDraftByPost[postId] = value;
    this.updateMentionSearch(postId, value, target?.selectionStart ?? value.length);
  }

  requestSubmitComment(post: CommunityPost): void {
    const draft = (this.commentDraftByPost[post.id] ?? '').trim();
    if (!draft) {
      return;
    }

    this.confirmDialog = {
      action: 'publish-comment',
      title: this.commentReplyTarget ? 'Post this reply?' : 'Post this comment?',
      message: this.commentReplyTarget
        ? 'Your reply will be sent through moderation before it is added to the post.'
        : 'Your comment will be sent through moderation before it is added to the post.',
      confirmLabel: this.commentReplyTarget ? 'Post reply' : 'Post comment',
      postId: post.id
    };
  }

  requestDeletePost(post: CommunityPost): void {
    this.openPostMenuId = null;
    this.confirmDialog = {
      action: 'delete-post',
      title: 'Delete this post?',
      message: 'This action will remove your post and its comments. You will need to confirm to continue.',
      confirmLabel: 'Delete post',
      tone: 'danger',
      postId: post.id
    };
  }

  cancelConfirmDialog(): void {
    if (this.confirmDialog?.action === 'leave-page') {
      this.resolvePendingNavigation(false);
    }

    this.confirmDialog = null;
  }

  closeConfirmOrNoticeDialog(): void {
    if (this.confirmDialog) {
      this.cancelConfirmDialog();
      return;
    }

    if (this.noticeDialog) {
      this.closeNoticeDialog();
    }
  }

  closeNoticeDialog(): void {
    this.noticeDialog = null;
  }

  executeConfirmDialog(): void {
    const dialog = this.confirmDialog;
    if (!dialog) {
      return;
    }

    this.confirmDialog = null;

    switch (dialog.action) {
      case 'publish-create':
        this.createPost();
        break;
      case 'publish-update':
        this.updatePost();
        break;
      case 'publish-comment':
        if (dialog.postId) {
          const post = this.posts.find((item) => item.id === dialog.postId);
          if (post) {
            this.addComment(post);
          }
        }
        break;
      case 'delete-post':
        if (dialog.postId) {
          this.deletePost(dialog.postId);
        }
        break;
      case 'discard-composer':
        this.closeComposer(true);
        break;
      case 'discard-comment':
        this.closeCommentModal(true, dialog.postId ?? null);
        break;
      case 'leave-page':
        this.resolvePendingNavigation(true);
        break;
    }
  }

  private createPost(): void {
    const userId = this.userId;
    if (!userId) {
      this.openNotice('Session expired', 'Please sign in again.', 'warning');
      return;
    }

    if (this.isFrozenUser) {
      this.openNotice('Posting blocked', 'Your account is frozen. Posting is disabled.', 'warning');
      return;
    }

    this.isSubmitting = true;

    this.communityService.createPost({
      userId,
      title: this.buildTechnicalPostTitle(),
      content: this.newPostControl.value.trim(),
      imageUrl: this.normalizeImageValue(),
      visibility: this.visibilityControl.value
    }).subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.openNotice('Post not published', this.buildModerationMessage('Post not published.', moderation), 'warning');
            this.isSubmitting = false;
            return;
          }

          this.posts = [data, ...this.posts.filter((item) => item.id !== data.id)];
          this.postErrorMessage = '';
          this.closeComposer(true);
          this.isSubmitting = false;
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.openNotice('Post failed', this.resolveError(error, 'Unable to create post right now.'), 'warning');
          this.isSubmitting = false;
        });
      }
    });
  }

  private updatePost(): void {
    const userId = this.userId;
    if (!userId || !this.editingPostId) {
      this.openNotice('Session expired', 'Please sign in again.', 'warning');
      return;
    }

    if (this.isFrozenUser) {
      this.openNotice('Update blocked', 'Your account is frozen. Updating posts is disabled.', 'warning');
      return;
    }

    this.isSubmitting = true;

    this.communityService.updatePost(this.editingPostId, {
      userId,
      title: this.buildTechnicalPostTitle(),
      content: this.newPostControl.value.trim(),
      imageUrl: this.normalizeImageValue(),
      visibility: this.visibilityControl.value
    }).subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.openNotice('Post not updated', this.buildModerationMessage('Post not updated.', moderation), 'warning');
            this.isSubmitting = false;
            return;
          }

          this.replacePost(data);
          this.postErrorMessage = '';
          this.closeComposer(true);
          this.isSubmitting = false;
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.openNotice('Update failed', this.resolveError(error, 'Unable to update this post right now.'), 'warning');
          this.isSubmitting = false;
        });
      }
    });
  }

  private addComment(post: CommunityPost): void {
    const userId = this.userId;
    if (!userId || this.isFrozenUser) {
      this.openNotice('Comment blocked', 'Your account is frozen. Comments are disabled.', 'warning');
      return;
    }

    const draft = (this.commentDraftByPost[post.id] ?? '').trim();
    if (!draft) {
      return;
    }

    this.commentSubmittingPostId = post.id;
    const replyTarget = this.commentReplyTarget;

    this.communityService.addComment(post.id, {
      userId,
      content: draft,
      parentCommentId: replyTarget?.parentCommentId ?? replyTarget?.id ?? null,
      mentionedUserIds: this.resolveMentionedUserIds(draft)
    }).subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.openNotice('Comment not published', this.buildModerationMessage('Comment not published.', moderation), 'warning');
            this.commentSubmittingPostId = null;
            return;
          }

          this.commentDraftByPost[post.id] = '';
          this.resetCommentComposerState();
          this.generalErrorMessage = '';
          this.replacePost(data);
          this.avatarDirectory.ensureUsers(this.collectAvatarUserIds([data])).subscribe();
          this.commentSubmittingPostId = null;
        });
      },
      error: () => {
        this.updateView(() => {
          this.commentSubmittingPostId = null;
          this.openNotice('Comment failed', 'Unable to add comment now.', 'warning');
        });
      }
    });
  }

  private deletePost(postId: string): void {
    const userId = this.userId;
    if (!userId) {
      this.openNotice('Session expired', 'Please sign in again.', 'warning');
      return;
    }

    const previousPosts = this.posts.map((post) => ({
      ...post,
      comments: post.comments.map((comment) => ({
        ...comment,
        replies: (comment.replies ?? []).map((reply) => ({ ...reply }))
      })),
      reactions: { ...post.reactions }
    }));
    const previousActivePostId = this.activePostModalId;

    this.updateView(() => {
      this.isDeletingPost = true;
      this.posts = this.posts.filter((post) => post.id !== postId);
      delete this.commentDraftByPost[postId];
      if (this.activePostModalId === postId) {
        this.activePostModalId = null;
      }
    });

    this.communityService.deletePost(postId, { userId }).subscribe({
      next: () => {
        this.updateView(() => {
          this.generalErrorMessage = '';
          this.isDeletingPost = false;
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.posts = previousPosts;
          this.activePostModalId = previousActivePostId;
          this.openNotice('Delete failed', this.resolveError(error, 'Unable to delete this post right now.'), 'warning');
          this.isDeletingPost = false;
        });
      }
    });
  }

  private openPostModerationDetails(post: CommunityPost): void {
    if (!this.canModeratePosts) {
      return;
    }

    const query = this.summarizePostContent(post.content, 60) || post.authorName;
    if (this.authService.canAccessAdminWorkspace()) {
      void this.router.navigate(['/admin/moderation'], {
        queryParams: { q: query },
        queryParamsHandling: 'merge'
      });
      return;
    }

    void this.router.navigate(['/moderation']);
  }

  private approvePostFromMenu(post: CommunityPost): void {
    if (!this.canModeratePosts) {
      return;
    }

    if (!this.authService.canAccessAdminWorkspace()) {
      this.openNotice(
        'Open moderation details',
        'Moderator review actions are completed from the moderation workspace so the case keeps its evidence trail.',
        'warning',
        'OK'
      );
      return;
    }

    this.findFlaggedPostReview(post, (review) => {
      this.adminService.reviewModerationResult(review.moderationResultId, {
        action: 'Dismiss',
        reason: 'Approved from the feed post action menu.'
      }).subscribe({
        next: () => {
          this.updateView(() => {
            this.openNotice('Post approved', 'The active moderation case was dismissed.', 'success', 'Done');
          });
        },
        error: () => {
          this.updateView(() => {
            this.openNotice('Approve failed', 'Unable to approve this moderation case right now.', 'warning');
          });
        }
      });
    });
  }

  private flagPostFromMenu(post: CommunityPost): void {
    if (!this.canModeratePosts) {
      return;
    }

    this.showAiClassificationResult(
      post,
      'Flag review',
      'Use the moderation workspace to commit a saved flag decision with full evidence.'
    );
  }

  private blockPostFromMenu(post: CommunityPost): void {
    if (!this.canModeratePosts) {
      return;
    }

    this.showAiClassificationResult(
      post,
      'Block review',
      'Use the moderation workspace to commit a saved block decision with full evidence.'
    );
  }

  private showAiClassificationResult(
    post: CommunityPost,
    title = 'AI classification result',
    suffix?: string
  ): void {
    if (!this.canModeratePosts) {
      return;
    }

    this.moderationService.score({
      messageId: post.id,
      content: this.buildPostModerationContent(post),
      contentType: 'POST'
    }).subscribe({
      next: (result) => {
        this.updateView(() => {
          this.openNotice(title, this.formatAiClassificationResult(result, suffix), this.getClassificationTone(result), 'Done');
        });
      },
      error: () => {
        this.updateView(() => {
          this.openNotice('AI check failed', 'Unable to classify this post right now.', 'warning');
        });
      }
    });
  }

  private findFlaggedPostReview(post: CommunityPost, onFound: (review: FlaggedContentReview) => void): void {
    this.moderationService.getFlaggedContent(100, undefined, post.userId).subscribe({
      next: (items) => {
        const review = items.find((item) => item.contentId === post.id || item.messageId === post.id);
        this.updateView(() => {
          if (!review) {
            this.openNotice(
              'No active moderation case',
              'This post is already approved or no flagged moderation case was found.',
              'default',
              'OK'
            );
            return;
          }

          onFound(review);
        });
      },
      error: () => {
        this.updateView(() => {
          this.openNotice('Moderation unavailable', 'Unable to load moderation details right now.', 'warning');
        });
      }
    });
  }

  private buildPostModerationContent(post: CommunityPost): string {
    return `Content: ${post.content}`;
  }

  private formatAiClassificationResult(result: ModerationResponse, suffix?: string): string {
    const flags = result.flags.length ? result.flags.join(', ') : 'none';
    const reason = result.reason ? ` Reason: ${result.reason}` : '';
    const note = suffix ? ` ${suffix}` : '';
    return `Action: ${result.action}. Score: ${result.score.toFixed(3)}. Flags: ${flags}.${reason}${note}`;
  }

  private getClassificationTone(result: ModerationResponse): NoticeDialogState['tone'] {
    if (result.action === 'Block') {
      return 'danger';
    }

    if (result.action === 'Flag') {
      return 'warning';
    }

    return 'success';
  }

  private loadPosts(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    if (!silent) {
      this.isLoading = true;
    }

    this.communityService.getPosts(userId, 40).subscribe({
      next: (posts) => {
        this.avatarDirectory.ensureUsers(this.collectAvatarUserIds(posts)).subscribe({
          next: () => {
            this.updateView(() => {
              this.posts = posts;

              if (this.pendingPostId && posts.some((post) => post.id === this.pendingPostId)) {
                this.activePostModalId = this.pendingPostId;
                this.scheduleCommentHighlight();
              }

              if (this.activePostModalId && !posts.some((post) => post.id === this.activePostModalId)) {
                this.activePostModalId = null;
              }

              if (this.activePostModalId) {
                const activePost = posts.find((post) => post.id === this.activePostModalId);
                if (activePost && this.isPostHidden(activePost)) {
                  this.activePostModalId = null;
                }
              }

              this.generalErrorMessage = '';
              this.isLoading = false;
            });

            if (this.pendingPostId && !posts.some((post) => post.id === this.pendingPostId)) {
              this.loadPostById(this.pendingPostId);
            }
          }
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.generalErrorMessage = this.resolveError(error, 'Unable to load posts.');
          this.isLoading = false;
        });
      }
    });
  }

  private loadEvents(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    this.communityService.getEvents(userId, 40).subscribe({
      next: (events) => {
        this.updateView(() => {
          this.events = events;
        });
      },
      error: (error: unknown) => {
        if (!silent) {
          this.updateView(() => {
            this.generalErrorMessage = this.resolveError(error, 'Unable to load events.');
          });
        }
      }
    });
  }

  private loadSuggestedUsers(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    if (!silent) {
      this.updateView(() => {
        this.isSuggestedUsersLoading = true;
      });
    }

    this.userService.search('', 3).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.suggestedUsers = users.filter((user) => user.id !== userId && !this.blockedUserIds.has(user.id));
          this.isSuggestedUsersLoading = false;
        });
      },
      error: () => {
        this.updateView(() => {
          if (!silent) {
            this.suggestedUsers = [];
          }
          this.isSuggestedUsersLoading = false;
        });
      }
    });
  }

  private loadFriendRequests(silent = false): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    this.communityService.getFriendRequests(userId).subscribe({
      next: (requests) => {
        this.updateView(() => {
          this.friendRequests = requests;
        });
      },
      error: () => {
        if (!silent) {
          this.updateView(() => {
            this.openNotice('Requests unavailable', 'Unable to load friend requests right now.', 'warning');
          });
        }
      }
    });
  }

  private loadShareTargets(): void {
    const userId = this.userId;
    if (!userId) {
      this.updateView(() => {
        this.isShareTargetsLoading = false;
        this.shareErrorMessage = 'Please sign in again to load share targets.';
      });
      return;
    }

    const friendFallbacks = this.getAcceptedFriendLookupsFromRequests();
    const fallbackById = new Map(friendFallbacks.map((user) => [user.id, user]));
    const friendIds = friendFallbacks.map((user) => user.id);
    const friendLookups$ = friendIds.length > 0
      ? forkJoin(friendIds.map((friendId) =>
          this.userService.getLookupById(friendId).pipe(catchError(() => of(fallbackById.get(friendId) ?? null)))
        ))
      : of([] as Array<UserLookup | null>);

    forkJoin({
      friends: friendLookups$,
      suggested: this.userService.search('', 40).pipe(catchError(() => of([] as UserLookup[]))),
      conversations: this.communityService.getConversations(userId, 20, false).pipe(catchError(() => of([] as Conversation[])))
    }).subscribe({
      next: ({ friends, suggested, conversations }) => {
        const friendUsers = friends.filter((user): user is UserLookup => !!user);
        const allUsers = [...friendUsers, ...suggested];
        this.avatarDirectory.seedUsers(allUsers);

        this.updateView(() => {
          const friendIdSet = new Set(friendIds);
          const personTargets = this.buildPersonShareTargets(allUsers, friendIdSet);
          const groupTargets = this.buildGroupShareTargets(conversations);

          this.sharePersonTargets = personTargets;
          this.shareGroupTargets = groupTargets;
          this.isShareTargetsLoading = false;
          this.shareErrorMessage = personTargets.length || groupTargets.length
            ? ''
            : 'No friends or active groups are available to share with yet.';
        });
      },
      error: () => {
        this.updateView(() => {
          this.sharePersonTargets = [];
          this.shareGroupTargets = [];
          this.isShareTargetsLoading = false;
          this.shareErrorMessage = 'Unable to load share targets right now.';
        });
      }
    });
  }

  private buildPersonShareTargets(users: UserLookup[], friendIds: Set<string>): ShareTargetView[] {
    const currentUserId = this.userId;
    const targets = new Map<string, ShareTargetView>();

    for (const user of users) {
      if (!user.id || user.id === currentUserId || this.blockedUserIds.has(user.id) || targets.has(user.id)) {
        continue;
      }

      const isFriend = friendIds.has(user.id);
      targets.set(user.id, {
        id: user.id,
        conversationId: user.id,
        kind: 'person',
        name: user.displayName,
        subtitle: user.email || user.role || 'Member',
        badge: isFriend ? 'Friend' : 'Suggested',
        avatarUrl: this.avatarDirectory.resolveAvatarUrl(user.id, user.gender),
        fallbackInitial: this.getShareFallbackInitial(user.displayName),
        isSending: false,
        isSent: false,
        errorMessage: ''
      });
    }

    return Array.from(targets.values()).sort((a, b) => {
      if (a.badge !== b.badge) {
        return a.badge === 'Friend' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  }

  private buildGroupShareTargets(conversations: Conversation[]): ShareTargetView[] {
    return conversations
      .filter((conversation) =>
        conversation.conversationType === 'Group' &&
        !conversation.isArchived &&
        conversation.currentUserMembershipStatus === 'Active'
      )
      .map((conversation) => ({
        id: this.getShareConversationId(conversation),
        conversationId: this.getShareConversationId(conversation),
        kind: 'group' as const,
        name: conversation.partnerName,
        subtitle: `${conversation.memberCount} member${conversation.memberCount === 1 ? '' : 's'}`,
        badge: 'Group',
        avatarUrl: conversation.avatarUrl ?? '',
        fallbackInitial: this.getShareFallbackInitial(conversation.partnerName),
        isSending: false,
        isSent: false,
        errorMessage: ''
      }))
      .filter((target) => target.conversationId.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private getAcceptedFriendLookupsFromRequests(): UserLookup[] {
    const userId = this.userId;
    if (!userId) {
      return [];
    }

    const friends = new Map<string, UserLookup>();
    for (const request of this.friendRequests) {
      if (request.status !== 'Accepted') {
        continue;
      }

      const isRequester = request.requesterUserId === userId;
      const friendId = isRequester ? request.recipientUserId : request.requesterUserId;
      if (!friendId || friends.has(friendId)) {
        continue;
      }

      friends.set(friendId, {
        id: friendId,
        displayName: isRequester ? request.recipientDisplayName : request.requesterDisplayName,
        email: isRequester ? '' : request.requesterEmail,
        gender: '',
        age: null,
        avatarUrl: '',
        role: 'User',
        departmentId: null,
        departmentName: 'Unassigned',
        badgeId: '',
        badgeName: 'Member',
        createdAtUtc: request.createdAtUtc
      });
    }

    return Array.from(friends.values());
  }

  private setShareTargetState(target: ShareTargetView, patch: Partial<Pick<ShareTargetView, 'isSending' | 'isSent' | 'errorMessage'>>): void {
    const update = (item: ShareTargetView) =>
      item.kind === target.kind && item.id === target.id ? { ...item, ...patch } : item;

    if (target.kind === 'group') {
      this.shareGroupTargets = this.shareGroupTargets.map(update);
      return;
    }

    this.sharePersonTargets = this.sharePersonTargets.map(update);
  }

  private cancelFriendRequest(requestId: string, displayName: string): void {
    const previousRequests = [...this.friendRequests];

    this.updateView(() => {
      this.friendRequests = this.friendRequests.filter((request) => request.id !== requestId);
    });

    this.communityService.cancelFriendRequest(requestId).subscribe({
      next: () => {
        this.updateView(() => {
          this.openNotice('Request canceled', `Friend request to ${displayName} was canceled.`, 'success');
        });
      },
      error: () => {
        const userId = this.userId;
        if (!userId) {
          this.updateView(() => {
            this.friendRequests = previousRequests;
            this.openNotice('Cancel failed', 'Unable to cancel that friend request.', 'warning');
          });
          return;
        }

        this.communityService.getFriendRequests(userId).subscribe({
          next: (requests) => {
            this.updateView(() => {
              this.friendRequests = requests;
              if (!requests.some((request) => request.id === requestId)) {
                this.openNotice('Request canceled', `Friend request to ${displayName} was canceled.`, 'success');
                return;
              }

              this.friendRequests = previousRequests;
              this.openNotice('Cancel failed', 'Unable to cancel that friend request.', 'warning');
            });
          },
          error: () => {
            this.updateView(() => {
              this.friendRequests = previousRequests;
              this.openNotice('Cancel failed', 'Unable to cancel that friend request.', 'warning');
            });
          }
        });
      }
    });
  }

  private replacePost(updatedPost: CommunityPost): void {
    this.posts = this.posts.map((post) => post.id === updatedPost.id ? updatedPost : post);
  }

  private replaceEvent(updatedEvent: CommunityEvent): void {
    this.events = this.events.map((event) => event.id === updatedEvent.id ? updatedEvent : event);
  }

  private collectAvatarUserIds(posts: CommunityPost[]): string[] {
    return Array.from(new Set(posts.flatMap((post) => [
      post.userId,
      ...post.comments.flatMap((comment) => [
        comment.userId,
        ...(comment.replies ?? []).map((reply) => reply.userId)
      ])
    ])));
  }

  private closeComposer(force = false): void {
    if (!force && this.hasComposerDraft) {
      this.requestCloseComposer();
      return;
    }

    this.isComposerOpen = false;
    this.composerMode = 'create';
    this.editingPostId = null;
    this.postErrorMessage = '';
    this.resetComposerFields();
    this.composerBaseline = this.createDefaultComposerSnapshot();
  }

  private closeCommentModal(force = false, nextPostId: string | null = null): void {
    if (!force && this.hasActiveCommentDraft) {
      this.requestCloseCommentModal();
      return;
    }

    this.closePostImageViewer();

    if (this.activePostModalId) {
      delete this.commentDraftByPost[this.activePostModalId];
    }

    this.resetCommentComposerState();
    this.activePostModalId = nextPostId;
    this.generalErrorMessage = '';
    this.highlightedCommentId = null;
    this.pendingCommentId = null;
    this.pendingReplyId = null;

    if (this.route.snapshot.queryParamMap.has('post') || nextPostId) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: nextPostId ? { post: nextPostId, comment: null, reply: null } : { post: null, comment: null, reply: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  private resetCommentComposerState(): void {
    this.commentReplyTarget = null;
    this.commentMentionCursor = null;
    this.commentMentionDropdownPostId = null;
    this.commentMentionResults = [];
    this.commentMentionSelections = [];
    this.mentionSearchSequence += 1;
  }

  private updateMentionSearch(postId: string, value: string, cursorPosition: number): void {
    const beforeCursor = value.slice(0, cursorPosition);
    const mentionMatch = /(^|\s)@([A-Za-z0-9_.-]*)$/.exec(beforeCursor);
    if (!mentionMatch) {
      this.closeMentionDropdown();
      return;
    }

    const query = mentionMatch[2] ?? '';
    const atIndex = beforeCursor.length - query.length - 1;
    this.commentMentionCursor = {
      start: atIndex,
      end: cursorPosition,
      query
    };
    this.commentMentionDropdownPostId = postId;

    const sequence = ++this.mentionSearchSequence;
    this.userService.search(query, 8).subscribe({
      next: (users) => {
        if (sequence !== this.mentionSearchSequence) {
          return;
        }

        this.updateView(() => {
          this.commentMentionResults = users;
          this.avatarDirectory.ensureUsers(users.map((user) => user.id)).subscribe();
        });
      },
      error: () => {
        if (sequence !== this.mentionSearchSequence) {
          return;
        }

        this.updateView(() => {
          this.commentMentionResults = [];
        });
      }
    });
  }

  private closeMentionDropdown(): void {
    this.commentMentionCursor = null;
    this.commentMentionDropdownPostId = null;
    this.commentMentionResults = [];
  }

  selectMentionUser(postId: string, user: UserLookup, input: HTMLInputElement | HTMLTextAreaElement): void {
    const cursor = this.commentMentionCursor;
    if (!cursor || this.commentMentionDropdownPostId !== postId) {
      return;
    }

    const currentValue = this.commentDraftByPost[postId] ?? '';
    const insertedMention = `@${user.displayName} `;
    const nextValue = `${currentValue.slice(0, cursor.start)}${insertedMention}${currentValue.slice(cursor.end)}`;
    this.commentDraftByPost[postId] = nextValue;

    if (!this.commentMentionSelections.some((candidate) => candidate.id === user.id)) {
      this.commentMentionSelections = [...this.commentMentionSelections, user];
    }

    this.closeMentionDropdown();

    window.setTimeout(() => {
      const nextCursorPosition = cursor.start + insertedMention.length;
      input.focus();
      input.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  }

  private resolveMentionedUserIds(content: string): string[] {
    const selectedIds = this.commentMentionSelections
      .filter((user) => content.includes(`@${user.displayName}`))
      .map((user) => user.id);

    return Array.from(new Set(selectedIds));
  }

  private resetComposerFields(): void {
    this.newTitleControl.setValue('');
    this.newImageUrlControl.setValue('');
    this.newPostControl.setValue('');
    this.visibilityControl.setValue('Public');
    this.imagePreviewUrl = null;
    this.selectedFileName = '';
  }

  private resetEventComposerFields(): void {
    this.eventTitleControl.setValue('');
    this.eventDescriptionControl.setValue('');
    this.eventDateTimeControl.setValue('');
    this.eventLocationControl.setValue('');
    this.eventImageFile = null;
    this.eventImagePreviewUrl = null;
    this.eventImageFileName = '';
    this.eventImageMarkedForRemoval = false;
  }

  private validateComposer(): boolean {
    const content = this.newPostControl.value.trim();

    if (!content) {
      this.openNotice('Post warning', "Write what's on your mind before posting.", 'warning');
      return false;
    }

    if (content.length < 8) {
      this.openNotice('Post warning', 'Write at least 8 characters.', 'warning');
      return false;
    }

    this.postErrorMessage = '';
    return true;
  }

  private validateEventComposer(): boolean {
    if (!this.eventTitleControl.value.trim()) {
      this.eventErrorMessage = 'Event title is required.';
      return false;
    }

    if (!this.eventDescriptionControl.value.trim()) {
      this.eventErrorMessage = 'Event description is required.';
      return false;
    }

    if (!this.eventDateTimeControl.value || Number.isNaN(new Date(this.eventDateTimeControl.value).getTime())) {
      this.eventErrorMessage = 'Choose a valid event date and time.';
      return false;
    }

    if (!this.eventLocationControl.value.trim()) {
      this.eventErrorMessage = 'Event location is required.';
      return false;
    }

    this.eventErrorMessage = '';
    return true;
  }

  private toDatetimeLocalValue(iso: string): string {
    const date = new Date(iso);
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  private createDefaultComposerSnapshot(): ComposerSnapshot {
    return {
      title: '',
      content: '',
      imageUrl: '',
      visibility: 'Public'
    };
  }

  private buildShareUrl(postId: string): string {
    const targetUrl = this.router.serializeUrl(this.router.createUrlTree(['/dashboard/feed'], {
      queryParams: { post: postId }
    }));

    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${targetUrl}`;
    }

    return targetUrl;
  }

  private buildEventShareUrl(eventId: string): string {
    const targetUrl = this.router.serializeUrl(this.router.createUrlTree(['/dashboard/events', eventId]));

    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${targetUrl}`;
    }

    return targetUrl;
  }

  private buildPostShareMessage(post: CommunityPost): string {
    const summary = this.summarizePostContent(post.content, 120);
    const title = post.title?.trim() || `${post.authorName}'s post`;
    const intro = summary ? `Shared a post: ${title} - ${summary}` : `Shared a post: ${title}`;
    return `${intro}\n${this.buildShareUrl(post.id)}`;
  }

  private buildEventShareMessage(event: CommunityEvent): string {
    const summary = this.summarizePostContent(event.description, 120);
    const when = new Date(event.startsAtUtc).toLocaleString();
    const intro = summary
      ? `Shared an event: ${event.title} - ${summary}`
      : `Shared an event: ${event.title}`;
    return `${intro}\n${when} at ${event.location}\n${this.buildEventShareUrl(event.id)}`;
  }

  private getShareFallbackInitial(value: string): string {
    return value
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'TS';
  }

  private getShareConversationId(conversation: Conversation): string {
    return conversation.conversationId || conversation.partnerUserId;
  }

  private loadSavedPostIds(): string[] {
    try {
      const raw = localStorage.getItem(this.savedPostsKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    } catch {
      return [];
    }
  }

  private loadLikedEventIds(): string[] {
    try {
      const raw = localStorage.getItem('ts_liked_events');
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    } catch {
      return [];
    }
  }

  private loadHiddenPostIds(): string[] {
    try {
      const raw = localStorage.getItem('ts_hidden_posts');
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    } catch {
      return [];
    }
  }

  private loadBlockedUserIds(): string[] {
    try {
      const raw = localStorage.getItem('ts_blocked_users');
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    } catch {
      return [];
    }
  }

  private loadReports(): Array<{
    postId: string;
    authorName: string;
    postTitle: string;
    reason: ReportReason;
    details: string;
    createdAtUtc: string;
  }> {
    try {
      const raw = localStorage.getItem('ts_post_reports');
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is {
        postId: string;
        authorName: string;
        postTitle: string;
        reason: ReportReason;
        details: string;
        createdAtUtc: string;
      } => {
        return !!item &&
          typeof item === 'object' &&
          typeof (item as { postId?: unknown }).postId === 'string' &&
          typeof (item as { authorName?: unknown }).authorName === 'string' &&
          typeof (item as { postTitle?: unknown }).postTitle === 'string';
      }) : [];
    } catch {
      return [];
    }
  }

  private persistSavedPostIds(): void {
    try {
      localStorage.setItem(this.savedPostsKey, JSON.stringify(Array.from(this.savedPostIds)));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }

  private persistLikedEventIds(): void {
    try {
      localStorage.setItem('ts_liked_events', JSON.stringify(Array.from(this.likedEventIds)));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }

  private persistHiddenPostIds(): void {
    try {
      localStorage.setItem('ts_hidden_posts', JSON.stringify(Array.from(this.hiddenPostIds)));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }

  private persistBlockedUserIds(): void {
    try {
      localStorage.setItem('ts_blocked_users', JSON.stringify(Array.from(this.blockedUserIds)));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }

  private persistReports(reports: Array<{
    postId: string;
    authorName: string;
    postTitle: string;
    reason: ReportReason;
    details: string;
    createdAtUtc: string;
  }>): void {
    try {
      localStorage.setItem('ts_post_reports', JSON.stringify(reports));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }

  private captureComposerSnapshot(): ComposerSnapshot {
    return {
      title: this.newTitleControl.value.trim(),
      content: this.newPostControl.value.trim(),
      imageUrl: this.newImageUrlControl.value.trim(),
      visibility: this.visibilityControl.value
    };
  }

  private normalizeImageValue(): string | null {
    const imageValue = this.newImageUrlControl.value.trim();
    return imageValue.length > 0 ? imageValue : null;
  }

  private buildTechnicalPostTitle(): string {
    const contentTitle = this.summarizePostContent(this.newPostControl.value, 110);
    return contentTitle || `${this.currentUserDisplayName}'s post`;
  }

  summarizePostContent(content: string, maxLength = 90): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
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

  private resolveError(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status === 0) {
        return 'API is unreachable. Start backend on http://localhost:5000.';
      }

      if (status === 423) {
        return 'Your account is frozen. This action is blocked.';
      }
    }

    if (error && typeof error === 'object' && 'error' in error) {
      const payload = (error as { error?: unknown }).error;
      if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
      }
    }

    return fallback;
  }

  private loadPostById(postId: string): void {
    const userId = this.userId;
    if (!userId || this.loadingPostById === postId) {
      return;
    }

    this.loadingPostById = postId;
    this.communityService.getPost(postId, userId).subscribe({
      next: (post) => {
        this.avatarDirectory.ensureUsers(this.collectAvatarUserIds([post])).subscribe({
          next: () => {
            this.updateView(() => {
              this.posts = [post, ...this.posts.filter((item) => item.id !== post.id)];
              this.activePostModalId = post.id;
              this.generalErrorMessage = '';
              this.loadingPostById = null;
              this.scheduleCommentHighlight();
            });
          },
          error: () => {
            this.updateView(() => {
              this.posts = [post, ...this.posts.filter((item) => item.id !== post.id)];
              this.activePostModalId = post.id;
              this.loadingPostById = null;
              this.scheduleCommentHighlight();
            });
          }
        });
      },
      error: () => {
        this.updateView(() => {
          this.loadingPostById = null;
          this.generalErrorMessage = 'Unable to open the related post.';
        });
      }
    });
  }

  private scheduleCommentHighlight(): void {
    const targetId = this.pendingReplyId ?? this.pendingCommentId;
    if (!this.activePostModalId || !targetId) {
      return;
    }

    if (this.highlightTimerId !== null) {
      window.clearTimeout(this.highlightTimerId);
    }

    this.highlightedCommentId = targetId;
    this.highlightTimerId = window.setTimeout(() => {
      document.getElementById(`comment-${targetId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      });

      this.highlightTimerId = window.setTimeout(() => {
        if (this.highlightedCommentId === targetId) {
          this.highlightedCommentId = null;
          this.changeDetectorRef.detectChanges();
        }
      }, 2600);
    }, 180);
  }

  private canPollSilently(): boolean {
    return !!this.userId &&
      (!document.hidden) &&
      !this.isLoading &&
      !this.isSuggestedUsersLoading &&
      !this.isShareTargetsLoading &&
      !this.isSubmitting &&
      !this.isDeletingPost &&
      !this.ratingSubmittingEventId &&
      !this.commentSubmittingPostId &&
      !this.openPostMenuId &&
      !this.openEventMenuId &&
      !this.isComposerOpen &&
      !this.isEventComposerOpen &&
      !this.activePostModalId &&
      !this.activeSharePost &&
      !this.activeShareEvent &&
      !this.eventRatingDialog &&
      !this.confirmDialog &&
      !this.noticeDialog &&
      !this.hasUnsavedWork;
  }

  private buildOptimisticReactions(post: CommunityPost, reaction: ReactionType) {
    const next = { ...post.reactions };
    const previousReaction = post.reactions.myReaction;

    if (previousReaction) {
      next[previousReaction] = Math.max(0, next[previousReaction] - 1);
    }

    if (previousReaction === reaction) {
      next.myReaction = null;
      return next;
    }

    next[reaction] += 1;
    next.myReaction = reaction;
    return next;
  }

  private openNotice(
    title: string,
    message: string,
    tone: NoticeDialogState['tone'] = 'warning',
    ackLabel = 'OK'
  ): void {
    this.noticeDialog = { title, message, tone, ackLabel };
  }

  private resolvePendingNavigation(value: boolean): void {
    if (!this.pendingNavigationResolver) {
      return;
    }

    const resolve = this.pendingNavigationResolver;
    this.pendingNavigationResolver = null;
    resolve(value);
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
