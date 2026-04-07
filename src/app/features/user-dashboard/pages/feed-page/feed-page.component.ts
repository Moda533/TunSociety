import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../../core/services/user.service';
import {
  FriendRequest,
  CommunityPost,
  PostComment,
  PostVisibility,
  ReactionType
} from '../../../../shared/models/community.model';
import {
  FriendRequestActionState,
  resolveFriendRequestActionState
} from '../../../../core/utils/friend-request-state.util';
import { ModerationFeedback } from '../../../../shared/models/moderation.model';
import { UserLookup } from '../../../../shared/models/user.model';

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
  readonly commentDraftByPost: Record<string, string> = {};

  posts: CommunityPost[] = [];
  suggestedUsers: UserLookup[] = [];
  friendRequests: FriendRequest[] = [];
  isLoading = false;
  isSuggestedUsersLoading = false;
  isSubmitting = false;
  isDeletingPost = false;
  commentSubmittingPostId: string | null = null;
  isComposerOpen = false;
  composerMode: ComposerMode = 'create';
  editingPostId: string | null = null;
  activePostModalId: string | null = null;
  openPostMenuId: string | null = null;
  confirmDialog: ConfirmDialogState | null = null;
  noticeDialog: NoticeDialogState | null = null;
  reportDialog: ReportDialogState | null = null;
  postErrorMessage = '';
  generalErrorMessage = '';
  imagePreviewUrl: string | null = null;
  selectedFileName = '';
  savedPostIds = new Set<string>(this.loadSavedPostIds());
  hiddenPostIds = new Set<string>(this.loadHiddenPostIds());
  blockedUserIds = new Set<string>(this.loadBlockedUserIds());
  readonly reportReasons: ReportReason[] = ['Harassment', 'Hate speech', 'Spam', 'False information', 'Other'];

  private readonly refreshIntervalMs = 12000;
  private readonly savedPostsKey = 'ts_saved_posts';
  private readonly subscriptions = new Subscription();
  private userId: string | null = null;
  private pendingPostId: string | null = null;
  private composerBaseline: ComposerSnapshot = this.createDefaultComposerSnapshot();
  private pendingNavigationResolver: ((value: boolean) => void) | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
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
        this.updateView(() => {
          this.pendingPostId = postId;
          if (!postId) {
            this.activePostModalId = null;
            return;
          }

          if (this.posts.some((post) => post.id === postId)) {
            this.activePostModalId = postId;
          }
        });
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      interval(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadPosts(true);
          this.loadSuggestedUsers(true);
          this.loadFriendRequests(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.resolvePendingNavigation(false);
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.openPostMenuId = null;
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
      post.title.toLowerCase().includes(search) ||
      post.content.toLowerCase().includes(search))
    );
  }

  get isFrozenUser(): boolean {
    return this.authService.getCurrentUser()?.isFrozen ?? false;
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
    return this.posts.reduce((sum, post) => sum + post.comments.length, 0);
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

  get composerConfirmLabel(): string {
    return this.composerMode === 'edit' ? 'Save changes' : 'Publish post';
  }

  refreshFeed(): void {
    this.loadPosts();
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  trackBySuggestedUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  getSuggestedFriendRequestActionState(user: UserLookup): FriendRequestActionState {
    return resolveFriendRequestActionState(this.userId, user.id, this.friendRequests);
  }

  trackByCommentId(_: number, comment: PostComment): string {
    return comment.id;
  }

  isPostLiked(post: CommunityPost): boolean {
    return post.reactions.myReaction === 'like';
  }

  private collectPostMentions(post: CommunityPost): string[] {
    const mentionRegex = /(^|[\s([{"'`>])(@[A-Za-z0-9_][A-Za-z0-9_.-]*)/g;
    const mentions = new Map<string, string>();
    const sourceTexts = [post.title, post.content, ...post.comments.map((comment) => comment.content)];

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

  async sharePost(post: CommunityPost): Promise<void> {
    const shareUrl = this.buildShareUrl(post.id);
    const sharePayload = {
      title: post.title,
      text: `${post.authorName} shared "${post.title}"`,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(sharePayload);
        this.openNotice('Share ready', 'Use the native share sheet to send the post link.', 'success', 'Done');
        return;
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
          return;
        }
      }
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl)
        .then(() => {
          this.openNotice('Share link copied', 'The feed link was copied to your clipboard.', 'success', 'Done');
        })
        .catch(() => {
          this.openNotice('Share ready', shareUrl, 'default', 'OK');
        });
      return;
    }

    this.openNotice('Share ready', shareUrl, 'default', 'OK');
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
  }

  isOwnPost(post: CommunityPost): boolean {
    return !!this.userId && post.userId === this.userId;
  }

  openCommentModal(post: CommunityPost): void {
    this.openPostMenuId = null;
    this.generalErrorMessage = '';
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

    this.activePostModalId = post.id;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { post: post.id },
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
    this.requestCloseCommentModal();
  }

  updateCommentDraft(postId: string, event: Event): void {
    const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
    this.commentDraftByPost[postId] = target?.value ?? '';
  }

  requestSubmitComment(post: CommunityPost): void {
    const draft = (this.commentDraftByPost[post.id] ?? '').trim();
    if (!draft) {
      return;
    }

    this.confirmDialog = {
      action: 'publish-comment',
      title: 'Post this comment?',
      message: 'Your comment will be sent through moderation before it is added to the post.',
      confirmLabel: 'Post comment',
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
      title: this.newTitleControl.value.trim(),
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
      title: this.newTitleControl.value.trim(),
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

    this.communityService.addComment(post.id, {
      userId,
      content: draft
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
          this.generalErrorMessage = '';
          this.replacePost(data);
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
      comments: post.comments.map((comment) => ({ ...comment })),
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

  private collectAvatarUserIds(posts: CommunityPost[]): string[] {
    return Array.from(new Set(posts.flatMap((post) => [
      post.userId,
      ...post.comments.map((comment) => comment.userId)
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

    if (this.activePostModalId) {
      delete this.commentDraftByPost[this.activePostModalId];
    }

    this.activePostModalId = nextPostId;
    this.generalErrorMessage = '';

    if (this.route.snapshot.queryParamMap.has('post') || nextPostId) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: nextPostId ? { post: nextPostId } : { post: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  private resetComposerFields(): void {
    this.newTitleControl.setValue('');
    this.newImageUrlControl.setValue('');
    this.newPostControl.setValue('');
    this.visibilityControl.setValue('Public');
    this.imagePreviewUrl = null;
    this.selectedFileName = '';
  }

  private validateComposer(): boolean {
    const title = this.newTitleControl.value.trim();
    const content = this.newPostControl.value.trim();

    if (!title) {
      this.openNotice('Post warning', 'Add a title.', 'warning');
      return false;
    }

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

  private canPollSilently(): boolean {
    return (!document.hidden) &&
      !this.isSubmitting &&
      !this.isDeletingPost &&
      !this.commentSubmittingPostId &&
      !this.isComposerOpen &&
      !this.activePostModalId &&
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
