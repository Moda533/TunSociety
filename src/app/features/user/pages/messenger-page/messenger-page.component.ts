import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { NavbarBadgeService } from '../../../community/data-access/navbar-badge.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../user/data-access/user.service';
import { Conversation, ConversationType, DirectMessage, GroupConversationMember } from '../../../community/models/community.model';
import { ModerationFeedback } from '../../../moderation/models/moderation.model';
import { UserLookup } from '../../../user/models/user.model';

type TimelineItem =
  | { kind: 'date'; label: string; key: string }
  | { kind: 'message'; message: DirectMessage };

type MessageTextSegment =
  | { kind: 'text'; text: string; key: string }
  | { kind: 'link'; text: string; url: string; key: string };

type PopupContext = 'search' | 'new';

type GroupSettingsPopup =
  | 'menu'
  | 'profile'
  | 'introduction'
  | 'notice'
  | 'permission'
  | 'members'
  | 'join-requests'
  | 'invite'
  | 'pin'
  | 'mute'
  | 'clear-history'
  | 'report'
  | 'delete';

type ChatViewportState = {
  scrollTop: number;
  atBottom: boolean;
};

@Component({
  selector: 'app-messenger-page',
  standalone: false,
  templateUrl: './messenger-page.component.html',
  styleUrls: ['./messenger-page.component.scss']
})
export class MessengerPageComponent implements OnInit, OnDestroy, AfterViewInit {
  readonly chatInputControl = new FormControl('', { nonNullable: true });
  readonly discoverControl = new FormControl('', { nonNullable: true });
  readonly popupSearchControl = new FormControl('', { nonNullable: true });
  readonly groupNameControl = new FormControl('', { nonNullable: true });
  readonly groupSearchControl = new FormControl('', { nonNullable: true });
  readonly groupAvatarControl = new FormControl('', { nonNullable: true });
  readonly groupIntroductionControl = new FormControl('', { nonNullable: true });
  readonly groupNoticeControl = new FormControl('', { nonNullable: true });
  readonly groupReportControl = new FormControl('', { nonNullable: true });
  readonly groupCreateRoomPermissionControl = new FormControl<'AdminsOnly' | 'AdminsAndModerators' | 'AllMembers'>('AdminsAndModerators', { nonNullable: true });
  readonly addMemberSearchControl = new FormControl('', { nonNullable: true });
  @ViewChild('chatLog') chatLog?: ElementRef<HTMLDivElement>;

  conversations: Conversation[] = [];
  searchResults: UserLookup[] = [];
  popupSearchResults: UserLookup[] = [];
  selectedConversationId = '';
  isLoading = false;
  isSending = false;
  isSearchingUsers = false;
  isSearchPopupOpen = false;
  isChatToolsOpen = false;
  isGroupComposerOpen = false;
  isGroupSettingsMode = false;
  isEditingGroupProfile = false;
  isAddMembersOpen = false;
  isLeaveConfirmOpen = false;
  isSavingGroup = false;
  isAddingGroupMembers = false;
  isPopupSearchingUsers = false;
  isGroupSearchingUsers = false;
  isAddMemberSearchingUsers = false;
  activeGroupSettingsPopup: GroupSettingsPopup | null = null;
  popupContext: PopupContext = 'search';
  activeConversationFilter: 'all' | 'groups' | 'archived' | 'unread' = 'all';
  errorMessage = '';
  searchErrorMessage = '';
  popupSearchErrorMessage = '';
  groupErrorMessage = '';
  pendingRecipient: UserLookup | null = null;
  groupSearchResults: UserLookup[] = [];
  selectedGroupMembers: UserLookup[] = [];
  addMemberSearchResults: UserLookup[] = [];
  selectedAddMembers: UserLookup[] = [];
  composerHintMessage = '';
  groupSettingsMessage = '';
  selectedGroupAvatarFile: File | null = null;
  selectedGroupAvatarFileName = '';
  selectedGroupAvatarPreviewUrl = '';
  popupSearchMode: 'all' | 'users' | 'conversations' = 'all';
  isMobileViewport = false;

  private readonly refreshIntervalMs = 3000;
  private readonly subscriptions = new Subscription();
  private readonly visibleCursorByConversation = new Map<string, string>();
  private readonly pendingCursorByConversation = new Map<string, string>();
  private readonly handleChatScroll = () => {
    if (this.viewportAdjustmentDepth > 0) {
      return;
    }

    this.scheduleCursorSync();
  };
  private cursorSyncRafId: number | null = null;
  private viewportAdjustmentDepth = 0;
  userId: string | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.updateMobileViewportState();
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        const nextUserId = user?.id ?? null;
        const hadUserId = !!this.userId;
        const shouldLoad = !!nextUserId && (!hadUserId || this.userId !== nextUserId || this.conversations.length === 0);

        this.updateView(() => {
          this.userId = nextUserId;
          if (!nextUserId && !this.authService.getToken()) {
            this.errorMessage = 'Please sign in again.';
          }
        });

        if (shouldLoad) {
          this.loadConversations();
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.loadConversations(true);
        }
      })
    );

    this.subscriptions.add(
      this.popupSearchControl.valueChanges.pipe(debounceTime(250), distinctUntilChanged()).subscribe(() => {
        if (!this.isSearchPopupOpen || this.popupSearchMode === 'conversations') {
          return;
        }

        this.popupSearchUsers();
      })
    );

    this.subscriptions.add(
      this.groupSearchControl.valueChanges.pipe(debounceTime(250), distinctUntilChanged()).subscribe(() => {
        if (this.isGroupComposerOpen) {
          this.searchGroupMembers();
        }
      })
    );

    this.subscriptions.add(
      this.addMemberSearchControl.valueChanges.pipe(debounceTime(250), distinctUntilChanged()).subscribe(() => {
        if (this.isAddMembersOpen) {
          this.searchMembersToAdd();
        }
      })
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        const routeConversationId = params.get('conversationId') ?? '';
        this.isGroupSettingsMode = this.router.url.includes('/settings');
        if (routeConversationId) {
          this.selectedConversationId = routeConversationId;
          this.queueScrollToBottom(false);
        } else if (this.isMobileViewport) {
          this.selectedConversationId = '';
        }
      })
    );

    this.subscriptions.add(
      this.router.events.subscribe(() => {
        this.isGroupSettingsMode = this.router.url.includes('/settings');
      })
    );
  }

  ngAfterViewInit(): void {
    this.chatLog?.nativeElement.addEventListener('scroll', this.handleChatScroll, { passive: true });
    this.queueScrollToBottom(false);
  }

  ngOnDestroy(): void {
    this.chatLog?.nativeElement.removeEventListener('scroll', this.handleChatScroll);
    this.cancelCursorSync();
    this.resetSelectedGroupAvatar();
    this.subscriptions.unsubscribe();
  }

  refreshConversations(): void {
    this.loadConversations();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.refreshConversations();
  }

  @HostListener('window:resize')
  handleResize(): void {
    this.updateMobileViewportState();
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.isChatToolsOpen = false;
  }

  openNewConversationPopup(): void {
    this.isSearchPopupOpen = true;
    this.isChatToolsOpen = false;
    this.popupSearchErrorMessage = '';
    this.popupSearchControl.setValue('', { emitEvent: false });
    this.popupSearchResults = [];
  }

  selectConversation(conversationId: string): void {
    this.selectedConversationId = conversationId;
    this.isGroupSettingsMode = false;
    if (this.isMobileViewport) {
      void this.router.navigate(['/dashboard/messenger', conversationId]);
    }
    this.markSelectedGroupRead();
    this.queueScrollToBottom(false);
  }

  openSearchPopup(): void {
    this.openNewConversationPopup();
  }

  toggleChatTools(event: MouseEvent): void {
    event.stopPropagation();
    this.isChatToolsOpen = !this.isChatToolsOpen;
  }

  applyConversationFilter(filter: 'all' | 'groups' | 'archived' | 'unread'): void {
    this.activeConversationFilter = filter;
    this.isChatToolsOpen = false;
  }

  openGroupComposer(): void {
    this.isChatToolsOpen = false;
    this.groupErrorMessage = '';
    this.groupNameControl.setValue('');
    this.groupSearchControl.setValue('', { emitEvent: false });
    this.groupSearchResults = [];
    this.selectedGroupMembers = [];
    this.resetSelectedGroupAvatar();
    this.isGroupComposerOpen = true;
  }

  closeGroupComposer(): void {
    this.isGroupComposerOpen = false;
    this.groupErrorMessage = '';
    this.resetSelectedGroupAvatar();
  }

  backToConversationList(): void {
    this.selectedConversationId = '';
    this.isGroupSettingsMode = false;
    void this.router.navigate(['/dashboard/messenger']);
  }

  closeSearchPopup(): void {
    this.isSearchPopupOpen = false;
    this.popupSearchErrorMessage = '';
  }

  sendMessage(): void {
    const userId = this.userId;
    const text = this.chatInputControl.value.trim();
    const selectedConversation = this.selectedConversation;
    const isGroup = selectedConversation?.conversationType === 'Group';
    const recipientId = this.pendingRecipient?.id ?? selectedConversation?.partnerUserId;
    const conversationId = this.pendingRecipient?.id ?? selectedConversation?.conversationId ?? selectedConversation?.partnerUserId;

    if (!userId || !conversationId || !recipientId || !text) {
      return;
    }

    if (isGroup && !this.canSendInSelectedConversation) {
      this.errorMessage = 'Stay in this group before sending messages.';
      return;
    }

    const previousConversations = this.cloneConversations(this.conversations);
    const previousSelectedConversationId = this.selectedConversationId;
    const previousPendingRecipient = this.pendingRecipient;
    const optimisticMessage = this.createOptimisticMessage(
      userId,
      conversationId,
      text,
      isGroup ? 'Group' : 'Private',
      isGroup ? '' : recipientId
    );

    this.isSending = true;
    this.chatInputControl.setValue('');
    this.selectedConversationId = conversationId;
    this.errorMessage = '';
    this.applyOptimisticMessage(
      conversationId,
      optimisticMessage,
      this.pendingRecipient?.displayName ?? selectedConversation?.partnerName ?? 'Member',
      this.pendingRecipient?.role ?? selectedConversation?.partnerRole ?? 'User',
      isGroup ? 'Group' : 'Private'
    );
    this.pendingRecipient = null;
    this.queueScrollToBottom(true);

    const send$ = isGroup
      ? this.communityService.sendGroupMessage(conversationId, { senderUserId: userId, content: text })
      : this.communityService.sendDirectMessage({
          senderUserId: userId,
          recipientUserId: recipientId,
          content: text
        });

    send$.subscribe({
      next: ({ data, moderation }) => {
        this.updateView(() => {
          this.applyModerationAccountState(moderation);
          if (!data) {
            this.conversations = previousConversations;
            this.selectedConversationId = previousSelectedConversationId;
            this.pendingRecipient = previousPendingRecipient;
            this.chatInputControl.setValue(text);
            this.errorMessage = this.buildModerationMessage('Message not sent.', moderation);
            this.isSending = false;
            return;
          }

          this.replaceOptimisticMessage(conversationId, optimisticMessage.id, data);
          this.errorMessage = '';
          this.isSending = false;
          this.queueScrollToBottom(true);
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.conversations = previousConversations;
          this.selectedConversationId = previousSelectedConversationId;
          this.pendingRecipient = previousPendingRecipient;
          this.chatInputControl.setValue(text);
          this.errorMessage = this.extractErrorMessage(error, 'Unable to send message right now.');
          this.isSending = false;
        });
      }
    });
  }

  insertComposerSnippet(snippet: string): void {
    const currentValue = this.chatInputControl.value;
    const separator = currentValue && !currentValue.endsWith(' ') ? ' ' : '';
    this.chatInputControl.setValue(`${currentValue}${separator}${snippet}`.trimStart());
    this.composerHintMessage = '';
  }

  flagComposerFeature(feature: string): void {
    this.composerHintMessage = `${feature} is not connected yet.`;
  }

  get selectedConversation(): Conversation | null {
    return this.conversations.find((item) => this.getConversationId(item) === this.selectedConversationId || item.partnerUserId === this.selectedConversationId) ?? null;
  }

  get activePartnerName(): string {
    return this.selectedConversation?.partnerName ?? this.pendingRecipient?.displayName ?? 'Select a conversation';
  }

  get activePartnerMeta(): string {
    return this.selectedConversation?.lastMessageAtUtc
      ? this.selectedConversation.lastMessageAtUtc
      : this.pendingRecipient?.role ?? 'New conversation';
  }

  get isMobileListMode(): boolean {
    return this.isMobileViewport && !this.selectedConversationId;
  }

  get isMobileChatMode(): boolean {
    return this.isMobileViewport && !!this.selectedConversationId;
  }

  get activeMessages() {
    return this.selectedConversation?.messages ?? [];
  }

  get selectedGroupConversation(): Conversation | null {
    const conversation = this.selectedConversation;
    return conversation?.conversationType === 'Group' ? conversation : null;
  }

  get shouldShowGroupMembershipGate(): boolean {
    return this.selectedGroupConversation?.currentUserMembershipStatus === 'Pending';
  }

  get canSendInSelectedConversation(): boolean {
    const conversation = this.selectedConversation;
    return conversation?.conversationType !== 'Group' || conversation.currentUserMembershipStatus === 'Active';
  }

  get shouldShowGroupEmptyState(): boolean {
    const group = this.selectedGroupConversation;
    return !!group &&
      group.messages.length === 0 &&
      group.currentUserMembershipStatus === 'Active' &&
      (!group.groupIntroduction || !group.groupNotice || !group.avatarUrl || group.memberCount <= 2);
  }

  get visibleGroupMembers(): GroupConversationMember[] {
    return this.selectedGroupConversation?.members ?? [];
  }

  get activeGroupRoleLabel(): string {
    return this.formatGroupRole(this.selectedGroupConversation?.currentUserRole ?? 'Member');
  }

  getUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getConversationAvatarUrl(partnerUserId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(partnerUserId);
  }

  getConversationAvatar(conversation: Conversation): string {
    if (conversation.conversationType === 'Group') {
      return conversation.avatarUrl ?? '';
    }

    return this.avatarDirectory.resolveAvatarUrl(conversation.partnerUserId);
  }

  getRecipientAvatarUrl(): string {
    if (this.pendingRecipient) {
      return this.getUserAvatarUrl(this.pendingRecipient);
    }

    if (this.selectedConversation?.conversationType === 'Group') {
      return this.selectedConversation.avatarUrl ?? '';
    }

    return this.avatarDirectory.resolveAvatarUrl(this.selectedConversation?.partnerUserId ?? null);
  }

  getPartnerAvatarFallbackInitial(): string {
    const name = this.selectedConversation?.partnerName ?? this.pendingRecipient?.displayName ?? 'Member';
    return name.charAt(0).toUpperCase();
  }

  getPartnerReadCursorLabel(): string {
    return `${this.selectedConversation?.partnerName ?? 'Member'} has reached this message`;
  }

  get filteredConversations(): Conversation[] {
    const query = this.discoverControl.value.trim().toLowerCase();
    let conversations = this.conversations;
    if (this.activeConversationFilter === 'groups') {
      conversations = conversations.filter((conversation) => conversation.conversationType === 'Group' && !conversation.isArchived);
    } else if (this.activeConversationFilter === 'archived') {
      conversations = conversations.filter((conversation) => conversation.isArchived);
    } else if (this.activeConversationFilter === 'unread') {
      conversations = conversations.filter((conversation) => conversation.unreadCount > 0);
    } else {
      conversations = conversations.filter((conversation) => !conversation.isArchived);
    }

    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) =>
      conversation.partnerName.toLowerCase().includes(query) ||
      conversation.partnerRole.toLowerCase().includes(query) ||
      conversation.messages.some((message) => message.content.toLowerCase().includes(query))
    );
  }

  get selectedConversationStatus(): string {
    if (this.selectedConversation && this.selectedConversation.messages.length === 0) {
      return 'New conversation';
    }

    if (this.selectedConversation?.isPartnerOnline) {
      return 'Active now';
    }

    if (this.selectedConversation?.lastMessageAtUtc) {
      return 'Last seen recently';
    }

    return this.pendingRecipient ? 'New conversation' : 'Select a conversation';
  }

  get unreadConversationCount(): number {
    return this.conversations.filter((conversation) => conversation.unreadCount > 0).length;
  }

  get activeConversationUnread(): number {
    return this.selectedConversation?.unreadCount ?? 0;
  }

  trackByConversationId = (_: number, conversation: Conversation): string => this.getConversationId(conversation);

  trackByMessageId(_: number, message: DirectMessage): string {
    return message.id;
  }

  trackByUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByTimelineItem(_: number, item: TimelineItem): string {
    return item.kind === 'date' ? `date-${item.key}` : item.message.id;
  }

  trackByMessageTextSegment(_: number, segment: MessageTextSegment): string {
    return segment.key;
  }

  trackByPopupConversationId = (_: number, conversation: Conversation): string => this.getConversationId(conversation);

  trackByPopupUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByGroupMemberId(_: number, member: GroupConversationMember): string {
    return member.userId;
  }

  timelineFor(messages: DirectMessage[]): TimelineItem[] {
    const items: TimelineItem[] = [];
    let lastBucket = '';

    for (const message of messages) {
      const bucket = this.formatDateBucket(message.createdAtUtc);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        items.push({
          kind: 'date',
          key: bucket,
          label: this.formatDateLabel(message.createdAtUtc)
        });
      }

      items.push({
        kind: 'message',
        message
      });
    }

    return items;
  }

  formatMessageSegments(content: string): MessageTextSegment[] {
    const segments: MessageTextSegment[] = [];
    const linkPattern = /(https?:\/\/[^\s<>"']+|\/dashboard\/[^\s<>"']+|\/messages\/[^\s<>"']+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let segmentIndex = 0;

    while ((match = linkPattern.exec(content)) !== null) {
      const rawMatch = match[0];
      const trimmedLink = rawMatch.replace(/[),.!?\]]+$/g, '');
      const trailingText = rawMatch.slice(trimmedLink.length);

      if (match.index > lastIndex) {
        segments.push({
          kind: 'text',
          text: content.slice(lastIndex, match.index),
          key: `text-${segmentIndex++}-${match.index}`
        });
      }

      if (trimmedLink) {
        segments.push({
          kind: 'link',
          text: trimmedLink,
          url: trimmedLink,
          key: `link-${segmentIndex++}-${match.index}`
        });
      }

      if (trailingText) {
        segments.push({
          kind: 'text',
          text: trailingText,
          key: `text-${segmentIndex++}-${match.index + trimmedLink.length}`
        });
      }

      lastIndex = match.index + rawMatch.length;
    }

    if (lastIndex < content.length) {
      segments.push({
        kind: 'text',
        text: content.slice(lastIndex),
        key: `text-${segmentIndex}-${lastIndex}`
      });
    }

    return segments.length ? segments : [{ kind: 'text', text: content, key: 'text-empty' }];
  }

  openMessageLink(url: string, event: MouseEvent): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const target = new URL(url, window.location.origin);
      if (target.origin !== window.location.origin) {
        return;
      }

      event.preventDefault();
      void this.router.navigateByUrl(`${target.pathname}${target.search}${target.hash}`);
    } catch {
      event.preventDefault();
    }
  }

  searchUsers(): void {
    const query = this.discoverControl.value.trim();
    if (!query) {
      this.searchResults = [];
      this.searchErrorMessage = '';
      return;
    }

    this.isSearchingUsers = true;
    this.searchErrorMessage = '';

    this.userService.search(query, 10).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.searchResults = users;
          this.isSearchingUsers = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.searchErrorMessage = 'Unable to search users right now.';
          this.isSearchingUsers = false;
        });
      }
    });
  }

  popupSearchUsers(): void {
    const query = this.popupSearchControl.value.trim();
    if (!query) {
      this.popupSearchResults = [];
      this.popupSearchErrorMessage = '';
      return;
    }

    this.isPopupSearchingUsers = true;
    this.popupSearchErrorMessage = '';

    this.userService.search(query, 10).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.popupSearchResults = users;
          this.isPopupSearchingUsers = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.popupSearchErrorMessage = 'Unable to search users right now.';
          this.isPopupSearchingUsers = false;
        });
      }
    });
  }

  searchGroupMembers(): void {
    const query = this.groupSearchControl.value.trim();
    if (!query) {
      this.groupSearchResults = [];
      this.groupErrorMessage = '';
      return;
    }

    this.isGroupSearchingUsers = true;
    this.groupErrorMessage = '';
    this.userService.search(query, 12).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.groupSearchResults = users.filter((user) =>
            user.id !== this.userId && !this.selectedGroupMembers.some((member) => member.id === user.id)
          );
          this.isGroupSearchingUsers = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.groupErrorMessage = 'Unable to search members right now.';
          this.isGroupSearchingUsers = false;
        });
      }
    });
  }

  addGroupMember(user: UserLookup): void {
    if (this.selectedGroupMembers.some((member) => member.id === user.id)) {
      return;
    }

    this.selectedGroupMembers = [...this.selectedGroupMembers, user];
    this.groupSearchResults = this.groupSearchResults.filter((item) => item.id !== user.id);
    this.groupSearchControl.setValue('', { emitEvent: false });
  }

  removeGroupMember(userId: string): void {
    this.selectedGroupMembers = this.selectedGroupMembers.filter((member) => member.id !== userId);
  }

  createGroupConversation(): void {
    const userId = this.userId;
    const name = this.groupNameControl.value.trim();
    if (!userId || !name || this.selectedGroupMembers.length === 0) {
      this.groupErrorMessage = 'Add a group name and at least one member.';
      return;
    }

    this.communityService.createGroupConversation({
      creatorUserId: userId,
      name,
      memberUserIds: this.selectedGroupMembers.map((member) => member.id)
    }).subscribe({
      next: (conversation) => {
        const selectedFile = this.selectedGroupAvatarFile;
        if (!selectedFile) {
          this.finishCreatedGroupConversation(conversation);
          return;
        }

        this.communityService.uploadGroupAvatar(this.getConversationId(conversation), userId, selectedFile).subscribe({
          next: (updatedConversation) => this.finishCreatedGroupConversation(updatedConversation),
          error: () => this.finishCreatedGroupConversation(conversation)
        });
      },
      error: (error: unknown) => {
        this.updateView(() => {
          this.groupErrorMessage = this.extractErrorMessage(error, 'Unable to create group chat.');
        });
      }
    });
  }

  openGroupSettings(): void {
    const group = this.selectedGroupConversation;
    if (!group) {
      return;
    }

    this.isGroupSettingsMode = true;
    this.syncGroupProfileControls(group);
    void this.router.navigate(['/dashboard/messenger', this.getConversationId(group), 'settings']);
  }

  backToGroupChat(): void {
    const group = this.selectedGroupConversation;
    this.isGroupSettingsMode = false;
    if (group) {
      void this.router.navigate(['/dashboard/messenger', this.getConversationId(group)]);
      return;
    }

    this.backToConversationList();
  }

  beginEditGroupProfile(): void {
    this.openGroupSettingsPopup('profile');
  }

  cancelEditGroupProfile(): void {
    this.isEditingGroupProfile = false;
    this.closeGroupSettingsPopup();
  }

  openGroupSettingsPopup(popup: GroupSettingsPopup): void {
    const group = this.selectedGroupConversation;
    if (!group) {
      return;
    }

    if (
      (popup === 'profile' || popup === 'introduction' || popup === 'notice') &&
      !group.currentUserCanEditGroup
    ) {
      return;
    }

    if (popup === 'permission' && !group.currentUserCanManageMembers) {
      return;
    }

    this.syncGroupProfileControls(group);
    this.groupSettingsMessage = '';
    this.groupReportControl.setValue('', { emitEvent: false });
    this.resetSelectedGroupAvatar();
    this.activeGroupSettingsPopup = popup;
    this.isEditingGroupProfile = popup === 'profile';
  }

  closeGroupSettingsPopup(): void {
    this.activeGroupSettingsPopup = null;
    this.isEditingGroupProfile = false;
    this.groupSettingsMessage = '';
    this.groupReportControl.setValue('', { emitEvent: false });
    this.resetSelectedGroupAvatar();
  }

  onGroupAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.resetSelectedGroupAvatar();
      return;
    }

    this.revokeGroupAvatarPreview();
    this.selectedGroupAvatarFile = file;
    this.selectedGroupAvatarFileName = file.name;
    this.selectedGroupAvatarPreviewUrl = URL.createObjectURL(file);
  }

  clearSelectedGroupAvatar(): void {
    this.resetSelectedGroupAvatar();
  }

  get groupAvatarPreviewUrl(): string {
    return this.selectedGroupAvatarPreviewUrl || this.selectedGroupConversation?.avatarUrl || '';
  }

  saveGroupProfile(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    const name = this.groupNameControl.value.trim();
    if (!userId || !group || !group.currentUserCanEditGroup || !name) {
      this.groupSettingsMessage = 'Group name is required.';
      return;
    }

    this.isSavingGroup = true;
    this.groupSettingsMessage = '';
    this.communityService.updateGroupProfile(this.getConversationId(group), {
      actorUserId: userId,
      name,
      avatarUrl: group.avatarUrl,
      introduction: this.groupIntroductionControl.value.trim() || null,
      notice: this.groupNoticeControl.value.trim() || null
    }).subscribe({
      next: (conversation) => {
        this.saveSelectedGroupAvatarIfNeeded(conversation);
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update group profile.');
        this.isSavingGroup = false;
      }
    });
  }

  saveGroupTextSection(section: 'introduction' | 'notice'): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group || !group.currentUserCanEditGroup) {
      return;
    }

    const name = this.groupNameControl.value.trim() || group.partnerName;
    this.isSavingGroup = true;
    this.groupSettingsMessage = '';
    this.communityService.updateGroupProfile(this.getConversationId(group), {
      actorUserId: userId,
      name,
      avatarUrl: group.avatarUrl,
      introduction: section === 'introduction' ? this.groupIntroductionControl.value.trim() || null : group.groupIntroduction,
      notice: section === 'notice' ? this.groupNoticeControl.value.trim() || null : group.groupNotice
    }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.isSavingGroup = false;
        this.closeGroupSettingsPopup();
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update group setting.');
        this.isSavingGroup = false;
      }
    });
  }

  openAddMembers(): void {
    const group = this.selectedGroupConversation;
    if (!group?.currentUserCanEditGroup) {
      return;
    }

    this.activeGroupSettingsPopup = null;
    this.groupSettingsMessage = '';
    this.addMemberSearchControl.setValue('', { emitEvent: false });
    this.addMemberSearchResults = [];
    this.selectedAddMembers = [];
    this.isAddMembersOpen = true;
  }

  closeAddMembers(): void {
    this.isAddMembersOpen = false;
    this.addMemberSearchResults = [];
    this.selectedAddMembers = [];
    this.groupSettingsMessage = '';
  }

  searchMembersToAdd(): void {
    const group = this.selectedGroupConversation;
    const query = this.addMemberSearchControl.value.trim();
    if (!group || !query) {
      this.addMemberSearchResults = [];
      return;
    }

    const existingIds = new Set(group.members.map((member) => member.userId));
    this.isAddMemberSearchingUsers = true;
    this.userService.search(query, 12).subscribe({
      next: (users) => {
        this.avatarDirectory.seedUsers(users);
        this.updateView(() => {
          this.addMemberSearchResults = users.filter((user) =>
            user.id !== this.userId &&
            !existingIds.has(user.id) &&
            !this.selectedAddMembers.some((member) => member.id === user.id)
          );
          this.isAddMemberSearchingUsers = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.groupSettingsMessage = 'Unable to search members right now.';
          this.isAddMemberSearchingUsers = false;
        });
      }
    });
  }

  addSettingsMember(user: UserLookup): void {
    if (this.selectedAddMembers.some((member) => member.id === user.id)) {
      return;
    }

    this.selectedAddMembers = [...this.selectedAddMembers, user];
    this.addMemberSearchResults = this.addMemberSearchResults.filter((item) => item.id !== user.id);
    this.addMemberSearchControl.setValue('', { emitEvent: false });
  }

  removeSettingsMember(userId: string): void {
    this.selectedAddMembers = this.selectedAddMembers.filter((member) => member.id !== userId);
  }

  confirmAddGroupMembers(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group || this.selectedAddMembers.length === 0) {
      this.groupSettingsMessage = 'Select at least one member.';
      return;
    }

    this.isAddingGroupMembers = true;
    this.groupSettingsMessage = '';
    this.communityService.addGroupMembers(this.getConversationId(group), {
      actorUserId: userId,
      memberUserIds: this.selectedAddMembers.map((member) => member.id)
    }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.isAddingGroupMembers = false;
        this.closeAddMembers();
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to add members.');
        this.isAddingGroupMembers = false;
      }
    });
  }

  acceptGroupMembership(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group) {
      return;
    }

    this.communityService.acceptGroupMembership(this.getConversationId(group), { userId }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.groupSettingsMessage = '';
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update group membership.');
      }
    });
  }

  requestLeaveGroup(): void {
    this.activeGroupSettingsPopup = null;
    this.isLeaveConfirmOpen = true;
  }

  cancelLeaveGroup(): void {
    this.isLeaveConfirmOpen = false;
  }

  confirmLeaveGroup(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group) {
      return;
    }

    const conversationId = this.getConversationId(group);
    this.communityService.leaveGroupConversation(conversationId, { userId }).subscribe({
      next: () => {
        this.conversations = this.conversations.filter((item) => this.getConversationId(item) !== conversationId);
        this.isLeaveConfirmOpen = false;
        this.selectedConversationId = '';
        this.isGroupSettingsMode = false;
        void this.router.navigate(['/dashboard/messenger']);
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to leave group.');
        this.isLeaveConfirmOpen = false;
      }
    });
  }

  setGroupPreference(kind: 'mute' | 'pin', value: boolean): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group) {
      return;
    }

    this.communityService.updateGroupPreferences(this.getConversationId(group), {
      userId,
      isMuted: kind === 'mute' ? value : undefined,
      isPinned: kind === 'pin' ? value : undefined
    }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.closeGroupSettingsPopup();
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update group setting.');
      }
    });
  }

  updateCreateRoomPermission(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group || !group.currentUserCanManageMembers) {
      return;
    }

    this.communityService.updateGroupCreateRoomPermission(this.getConversationId(group), {
      actorUserId: userId,
      createRoomPermission: this.groupCreateRoomPermissionControl.value
    }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.closeGroupSettingsPopup();
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update permission.');
      }
    });
  }

  clearGroupChatHistory(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group) {
      return;
    }

    this.communityService.clearGroupChatHistory(this.getConversationId(group), { userId }).subscribe({
      next: (conversation) => {
        this.updateGroupConversation(conversation);
        this.closeGroupSettingsPopup();
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to clear chat history.');
      }
    });
  }

  updateGroupMemberRole(member: GroupConversationMember, role: 'Admin' | 'Moderator' | 'Member'): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group || !group.currentUserCanManageMembers || member.isCurrentUser || member.role === 'Owner') {
      return;
    }

    this.communityService.updateGroupMemberRole(this.getConversationId(group), member.userId, {
      actorUserId: userId,
      role
    }).subscribe({
      next: (conversation) => this.updateGroupConversation(conversation),
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to update member role.');
      }
    });
  }

  removeManagedGroupMember(member: GroupConversationMember): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group || !group.currentUserCanManageMembers || member.isCurrentUser || member.role === 'Owner') {
      return;
    }

    this.communityService.removeGroupMember(this.getConversationId(group), member.userId, {
      actorUserId: userId
    }).subscribe({
      next: (conversation) => this.updateGroupConversation(conversation),
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to remove member.');
      }
    });
  }

  deleteGroupConversation(): void {
    const userId = this.userId;
    const group = this.selectedGroupConversation;
    if (!userId || !group?.currentUserCanDeleteGroup) {
      return;
    }

    const conversationId = this.getConversationId(group);
    this.communityService.deleteGroupConversation(conversationId, { actorUserId: userId }).subscribe({
      next: () => {
        this.conversations = this.conversations.filter((item) => this.getConversationId(item) !== conversationId);
        this.selectedConversationId = '';
        this.isGroupSettingsMode = false;
        void this.router.navigate(['/dashboard/messenger']);
      },
      error: (error: unknown) => {
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to delete group.');
      }
    });
  }

  copyInviteLink(): void {
    const group = this.selectedGroupConversation;
    if (!group?.inviteCode) {
      this.groupSettingsMessage = 'Invite link is not available yet.';
      return;
    }

    const link = this.getGroupInviteLink(group);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        this.groupSettingsMessage = 'Invite link copied.';
      });
      return;
    }

    this.groupSettingsMessage = link;
  }

  openGroupProfileQuickAction(target: 'name' | 'intro' | 'members'): void {
    if (target === 'members') {
      this.openAddMembers();
      return;
    }

    this.openGroupSettings();
    this.openGroupSettingsPopup(target === 'name' ? 'profile' : 'introduction');
  }

  confirmGroupPreference(kind: 'mute' | 'pin', value: boolean): void {
    this.setGroupPreference(kind, value);
  }

  submitGroupReport(): void {
    const report = this.groupReportControl.value.trim();
    this.groupSettingsMessage = report ? 'Report submitted for moderator review.' : 'Add a short report note first.';
    if (report) {
      this.closeGroupSettingsPopup();
    }
  }

  getGroupInviteLink(group: Conversation): string {
    return `${window.location.origin}/messages/${this.getConversationId(group)}?invite=${group.inviteCode}`;
  }

  formatConversationTime(iso: string): string {
    const value = new Date(iso);
    const diffMs = Date.now() - value.getTime();
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

    if (diffMinutes < 60) {
      return `${diffMinutes}m`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h`;
    }

    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays}d`;
    }

    return `${Math.max(1, Math.round(diffDays / 7))}w`;
  }

  formatMessageTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatDateLabel(iso: string): string {
    return new Date(iso).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private formatDateBucket(iso: string): string {
    const date = new Date(iso);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  startConversation(user: UserLookup): void {
    const existingConversation = this.conversations.find((conversation) => conversation.partnerUserId === user.id);
    this.searchResults = [];
    this.popupSearchResults = [];
    this.searchErrorMessage = '';
    this.popupSearchErrorMessage = '';
    this.discoverControl.setValue('');
    this.popupSearchControl.setValue('', { emitEvent: false });

    if (existingConversation) {
      this.pendingRecipient = null;
      this.selectedConversationId = this.getConversationId(existingConversation);
      this.isSearchPopupOpen = false;
      this.queueScrollToBottom(false);
      return;
    }

    this.pendingRecipient = user;
    this.ensureDraftConversation(user);
    this.selectedConversationId = user.id;
    this.isSearchPopupOpen = false;
    this.queueScrollToBottom(false);
  }

  selectPopupConversation(conversation: Conversation): void {
    this.pendingRecipient = null;
    this.selectedConversationId = this.getConversationId(conversation);
    this.isSearchPopupOpen = false;
    this.popupSearchErrorMessage = '';
    this.queueScrollToBottom(false);
  }

  private loadConversations(silent = false, preferredPartnerId = ''): void {
    const userId = this.userId;
    if (!userId) {
      return;
    }

    const previousSelectedConversationId = this.selectedConversationId;
    const viewportState = this.captureChatViewportState();

    if (!silent) {
      this.isLoading = true;
    }

    this.communityService.getConversations(userId, 120, true).subscribe({
      next: (items) => {
        this.avatarDirectory.ensureUsers(this.collectConversationPartnerIds(items)).subscribe({
          next: () => {
            let selectedConversationChanged = false;
            this.updateView(() => {
              const draftConversation = this.pendingRecipient && !items.some((item) => item.partnerUserId === this.pendingRecipient?.id)
                ? this.createDraftConversation(this.pendingRecipient)
                : null;

              this.conversations = draftConversation ? [draftConversation, ...items] : items;

              if (preferredPartnerId && this.conversations.some((item) => this.getConversationId(item) === preferredPartnerId || item.partnerUserId === preferredPartnerId)) {
                this.selectedConversationId = preferredPartnerId;
              }

              if (!this.selectedConversationId && this.conversations.length > 0 && !this.isMobileViewport) {
                this.selectedConversationId = this.getConversationId(this.conversations[0]);
              }

              if (this.selectedConversationId && !this.conversations.some((item) => this.getConversationId(item) === this.selectedConversationId || item.partnerUserId === this.selectedConversationId)) {
                this.selectedConversationId = this.isMobileViewport ? '' : (this.conversations[0] ? this.getConversationId(this.conversations[0]) : '');
              }

              selectedConversationChanged = previousSelectedConversationId !== this.selectedConversationId;

              this.errorMessage = '';
              this.isLoading = false;
            });

            if (selectedConversationChanged) {
              this.queueScrollToBottom(false);
            } else {
              this.restoreChatViewport(viewportState);
            }
            this.markSelectedGroupRead();
            this.navbarBadgeService.refresh(userId);
          }
        });
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to load conversations.';
          this.isLoading = false;
        });
      }
    });
  }

  get conversationSearchResults(): Conversation[] {
    const query = this.popupSearchControl.value.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return this.conversations.filter((conversation) =>
      conversation.partnerName.toLowerCase().includes(query) ||
      conversation.partnerRole.toLowerCase().includes(query) ||
      conversation.messages.some((message) => message.content.toLowerCase().includes(query))
    ).slice(0, 8);
  }

  get visiblePopupUsers(): UserLookup[] {
    if (this.popupSearchMode === 'conversations') {
      return [];
    }

    return this.popupSearchResults;
  }

  get hasPopupSearchQuery(): boolean {
    return this.popupSearchControl.value.trim().length > 0;
  }

  get recentConversationSuggestions(): Conversation[] {
    return [...this.conversations]
      .sort((left, right) => new Date(right.lastMessageAtUtc).getTime() - new Date(left.lastMessageAtUtc).getTime())
      .slice(0, 6);
  }

  private scheduleCursorSync(): void {
    if (this.cursorSyncRafId !== null) {
      return;
    }

    this.cursorSyncRafId = window.requestAnimationFrame(() => {
      this.cursorSyncRafId = null;
      this.syncCursorFromViewport();
    });
  }

  private cancelCursorSync(): void {
    if (this.cursorSyncRafId === null) {
      return;
    }

    window.cancelAnimationFrame(this.cursorSyncRafId);
    this.cursorSyncRafId = null;
  }

  private queueScrollToBottom(smooth = true): void {
    this.cancelCursorSync();
    this.viewportAdjustmentDepth += 1;
    setTimeout(() => {
      this.scrollToBottom(smooth);
      this.viewportAdjustmentDepth = Math.max(0, this.viewportAdjustmentDepth - 1);
      this.scheduleCursorSync();
    }, 0);
  }

  private scrollToBottom(smooth = true): void {
    const log = this.chatLog?.nativeElement;
    if (!log) {
      return;
    }

    log.scrollTo({
      top: log.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  private captureChatViewportState(): ChatViewportState | null {
    const log = this.chatLog?.nativeElement;
    if (!log) {
      return null;
    }

    return {
      scrollTop: log.scrollTop,
      atBottom: this.isChatScrolledToBottom(log)
    };
  }

  private restoreChatViewport(state: ChatViewportState | null): void {
    const log = this.chatLog?.nativeElement;
    if (!log) {
      return;
    }

    this.cancelCursorSync();
    this.viewportAdjustmentDepth += 1;
    setTimeout(() => {
      const currentLog = this.chatLog?.nativeElement;
      if (!currentLog) {
        this.viewportAdjustmentDepth = Math.max(0, this.viewportAdjustmentDepth - 1);
        return;
      }

      if (state?.atBottom) {
        this.scrollToBottom(false);
      } else if (state) {
        currentLog.scrollTop = state.scrollTop;
      }

      this.viewportAdjustmentDepth = Math.max(0, this.viewportAdjustmentDepth - 1);
      this.scheduleCursorSync();
    }, 0);
  }

  private isChatScrolledToBottom(log: HTMLDivElement): boolean {
    const threshold = 24;
    return log.scrollHeight - log.scrollTop - log.clientHeight <= threshold;
  }

  private syncCursorFromViewport(): void {
    const userId = this.userId;
    const conversation = this.selectedConversation;
    const log = this.chatLog?.nativeElement;
    if (!userId || !conversation || conversation.conversationType === 'Group' || !log || conversation.messages.length === 0) {
      return;
    }

    const conversationId = this.getConversationId(conversation);
    const visibleMessageId = this.findLastVisibleMessageId(log);
    if (!visibleMessageId) {
      return;
    }

    const currentCursor = this.visibleCursorByConversation.get(conversationId) ?? '';
    const pendingCursor = this.pendingCursorByConversation.get(conversationId) ?? '';
    if (visibleMessageId === currentCursor || visibleMessageId === pendingCursor) {
      return;
    }

    if (!this.isLaterVisibleMessage(visibleMessageId, currentCursor, conversation.messages)) {
      return;
    }

    this.pendingCursorByConversation.set(conversationId, visibleMessageId);
    this.communityService.updateConversationReadCursor(userId, conversation.partnerUserId, visibleMessageId).subscribe({
      next: () => {
        this.updateView(() => {
          this.visibleCursorByConversation.set(conversationId, visibleMessageId);
          if (this.pendingCursorByConversation.get(conversationId) === visibleMessageId) {
            this.pendingCursorByConversation.delete(conversationId);
          }

          this.conversations = this.conversations.map((item) =>
            this.getConversationId(item) === conversationId
              ? this.applyCursorToConversation(item, visibleMessageId, userId)
              : item
          );
        });
        this.navbarBadgeService.refresh(userId);
      },
      error: () => {
        if (this.pendingCursorByConversation.get(conversationId) === visibleMessageId) {
          this.pendingCursorByConversation.delete(conversationId);
        }
      }
    });
  }

  private findLastVisibleMessageId(log: HTMLDivElement): string | null {
    const containerRect = log.getBoundingClientRect();
    let visibleMessageId: string | null = null;
    const partnerUserId = this.selectedConversation?.partnerUserId ?? '';

    for (const element of Array.from(log.querySelectorAll<HTMLElement>('[data-message-id]'))) {
      const rect = element.getBoundingClientRect();
      const isVisible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;
      const messageId = element.dataset['messageId'] ?? '';
      const senderUserId = element.dataset['messageSenderId'] ?? '';
      if (isVisible && messageId && !messageId.startsWith('temp-') && senderUserId === partnerUserId) {
        visibleMessageId = messageId;
      }
    }

    return visibleMessageId;
  }

  private isLaterVisibleMessage(candidateId: string, currentId: string, messages: DirectMessage[]): boolean {
    if (!candidateId) {
      return false;
    }

    if (!currentId) {
      return true;
    }

    const candidateIndex = messages.findIndex((message) => message.id === candidateId);
    const currentIndex = messages.findIndex((message) => message.id === currentId);

    if (candidateIndex === -1) {
      return false;
    }

    if (currentIndex === -1) {
      return true;
    }

    return candidateIndex > currentIndex;
  }

  private applyCursorToConversation(conversation: Conversation, visibleMessageId: string, userId: string): Conversation {
    const cursorIndex = conversation.messages.findIndex((message) => message.id === visibleMessageId);
    if (cursorIndex === -1) {
      return conversation;
    }

    const messages = conversation.messages.map((message, index) =>
      index <= cursorIndex && message.recipientUserId === userId
        ? { ...message, isRead: true }
        : message
    );

    return {
      ...conversation,
      messages,
      unreadCount: messages.filter((message) => message.recipientUserId === userId && !message.isRead).length
    };
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

      if (payload && typeof payload === 'object') {
        if ('title' in payload && typeof (payload as { title?: unknown }).title === 'string') {
          return (payload as { title: string }).title;
        }

        if ('errors' in payload && payload.errors && typeof payload.errors === 'object') {
          const errors = Object.values(payload.errors as Record<string, unknown>);
          const firstError = errors.flatMap((value) => Array.isArray(value) ? value : [value])
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
          if (firstError) {
            return firstError;
          }
        }
      }
    }

    return fallback;
  }

  private saveSelectedGroupAvatarIfNeeded(conversation: Conversation): void {
    const userId = this.userId;
    const selectedFile = this.selectedGroupAvatarFile;
    if (!userId || !selectedFile) {
      this.updateGroupConversation(conversation);
      this.isSavingGroup = false;
      this.closeGroupSettingsPopup();
      return;
    }

    this.communityService.uploadGroupAvatar(this.getConversationId(conversation), userId, selectedFile).subscribe({
      next: (updatedConversation) => {
        this.updateGroupConversation(updatedConversation);
        this.isSavingGroup = false;
        this.closeGroupSettingsPopup();
      },
      error: (error: unknown) => {
        this.updateGroupConversation(conversation);
        this.groupSettingsMessage = this.extractErrorMessage(error, 'Unable to upload group picture.');
        this.isSavingGroup = false;
      }
    });
  }

  private finishCreatedGroupConversation(conversation: Conversation): void {
    this.updateView(() => {
      this.conversations = [conversation, ...this.conversations.filter((item) => this.getConversationId(item) !== this.getConversationId(conversation))];
      this.selectedConversationId = this.getConversationId(conversation);
      this.isGroupComposerOpen = false;
      this.groupErrorMessage = '';
      this.resetSelectedGroupAvatar();
      this.queueScrollToBottom(false);
      if (this.isMobileViewport) {
        void this.router.navigate(['/dashboard/messenger', this.getConversationId(conversation)]);
      }
    });
  }

  private resetSelectedGroupAvatar(): void {
    this.revokeGroupAvatarPreview();
    this.selectedGroupAvatarFile = null;
    this.selectedGroupAvatarFileName = '';
    this.selectedGroupAvatarPreviewUrl = '';
  }

  private revokeGroupAvatarPreview(): void {
    if (this.selectedGroupAvatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.selectedGroupAvatarPreviewUrl);
    }
  }

  private syncGroupProfileControls(group: Conversation): void {
    this.groupNameControl.setValue(group.partnerName ?? '', { emitEvent: false });
    this.groupAvatarControl.setValue(group.avatarUrl ?? '', { emitEvent: false });
    this.groupIntroductionControl.setValue(group.groupIntroduction ?? '', { emitEvent: false });
    this.groupNoticeControl.setValue(group.groupNotice ?? '', { emitEvent: false });
    this.groupCreateRoomPermissionControl.setValue(
      (group.createRoomPermission as 'AdminsOnly' | 'AdminsAndModerators' | 'AllMembers') || 'AdminsAndModerators',
      { emitEvent: false }
    );
  }

  private updateGroupConversation(conversation: Conversation): void {
    const conversationId = this.getConversationId(conversation);
    this.conversations = [
      conversation,
      ...this.conversations.filter((item) => this.getConversationId(item) !== conversationId)
    ];
    this.selectedConversationId = conversationId;
    this.syncGroupProfileControls(conversation);
  }

  formatGroupRole(role: string): string {
    switch (role) {
      case 'Owner':
      case 'Admin':
        return 'Group Admin';
      case 'Moderator':
        return 'Group Moderator';
      default:
        return 'Group Member';
    }
  }

  private canPollSilently(): boolean {
    return !!this.userId &&
      !document.hidden &&
      !this.isLoading &&
      !this.isSending &&
      !this.isSearchingUsers &&
      !this.isGroupComposerOpen &&
      !this.activeGroupSettingsPopup &&
      !this.isAddMembersOpen &&
      !this.isLeaveConfirmOpen;
  }

  private createOptimisticMessage(
    userId: string,
    conversationId: string,
    content: string,
    conversationType: ConversationType,
    recipientUserId: string
  ): DirectMessage {
    return {
      id: `temp-${Date.now()}`,
      conversationId,
      conversationType,
      senderUserId: userId,
      senderName: this.authService.getCurrentUser()?.displayName || this.authService.getCurrentUser()?.userName || 'You',
      recipientUserId,
      recipientName: this.pendingRecipient?.displayName ?? this.selectedConversation?.partnerName ?? 'Member',
      content,
      createdAtUtc: new Date().toISOString(),
      isRead: true
    };
  }

  private applyOptimisticMessage(
    conversationId: string,
    message: DirectMessage,
    partnerName: string,
    partnerRole: string,
    conversationType: ConversationType
  ): void {
    const existingConversation = this.conversations.find((conversation) => this.getConversationId(conversation) === conversationId || conversation.partnerUserId === conversationId);

    if (!existingConversation) {
      this.conversations = [{
        conversationId,
        conversationType,
        partnerUserId: conversationId,
        partnerName,
        partnerRole,
        avatarUrl: null,
        groupIntroduction: null,
        groupNotice: null,
        createRoomPermission: 'AdminsAndModerators',
        inviteCode: null,
        currentUserRole: conversationType === 'Group' ? 'Owner' : null,
        currentUserMembershipStatus: conversationType === 'Group' ? 'Active' : null,
        currentUserCanEditGroup: conversationType === 'Group',
        currentUserCanManageMembers: conversationType === 'Group',
        currentUserCanDeleteGroup: conversationType === 'Group',
        partnerLastVisibleMessageId: null,
        lastMessageAtUtc: message.createdAtUtc,
        isPartnerOnline: false,
        isArchived: false,
        isMuted: false,
        isPinned: false,
        memberCount: conversationType === 'Group' ? 1 : 2,
        unreadCount: 0,
        members: [],
        messages: [message]
      }, ...this.conversations];
      return;
    }

    this.conversations = [
      {
        ...existingConversation,
        lastMessageAtUtc: message.createdAtUtc,
        unreadCount: 0,
        messages: [...existingConversation.messages, message]
      },
      ...this.conversations.filter((conversation) => this.getConversationId(conversation) !== this.getConversationId(existingConversation))
    ];
  }

  private replaceOptimisticMessage(conversationId: string, tempMessageId: string, message: DirectMessage): void {
    this.conversations = this.conversations.map((conversation) =>
      this.getConversationId(conversation) === conversationId || conversation.partnerUserId === conversationId
        ? {
            ...conversation,
            lastMessageAtUtc: message.createdAtUtc,
            messages: conversation.messages.map((item) => item.id === tempMessageId ? message : item)
          }
        : conversation
    );
  }

  private ensureDraftConversation(user: UserLookup): void {
    if (this.conversations.some((conversation) => conversation.partnerUserId === user.id)) {
      return;
    }

    this.conversations = [this.createDraftConversation(user), ...this.conversations];
  }

  private createDraftConversation(user: UserLookup): Conversation {
    return {
      conversationId: user.id,
      conversationType: 'Private',
      partnerUserId: user.id,
      partnerName: user.displayName,
      partnerRole: user.role,
      avatarUrl: user.avatarUrl ?? null,
      groupIntroduction: null,
      groupNotice: null,
      createRoomPermission: 'AdminsAndModerators',
      inviteCode: null,
      currentUserRole: null,
      currentUserMembershipStatus: null,
      currentUserCanEditGroup: false,
      currentUserCanManageMembers: false,
      currentUserCanDeleteGroup: false,
      partnerLastVisibleMessageId: null,
      lastMessageAtUtc: new Date().toISOString(),
      isPartnerOnline: false,
      isArchived: false,
      isMuted: false,
      isPinned: false,
      memberCount: 2,
      unreadCount: 0,
      members: [],
      messages: []
    };
  }

  private collectConversationPartnerIds(conversations: Conversation[]): string[] {
    const ids = conversations
      .filter((conversation) => conversation.conversationType !== 'Group')
      .map((conversation) => conversation.partnerUserId);
    if (this.pendingRecipient) {
      ids.push(this.pendingRecipient.id);
    }

    return Array.from(new Set(ids.filter((id) => id.length > 0)));
  }

  getConversationId(conversation: Conversation): string {
    return conversation.conversationId || conversation.partnerUserId;
  }

  private updateMobileViewportState(): void {
    this.isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 720;
  }

  private markSelectedGroupRead(): void {
    const userId = this.userId;
    const conversation = this.selectedConversation;
    if (!userId || !conversation || conversation.conversationType !== 'Group' || conversation.unreadCount === 0) {
      return;
    }

    const conversationId = this.getConversationId(conversation);
    this.communityService.markGroupConversationRead(userId, conversationId).subscribe({
      next: () => {
        this.conversations = this.conversations.map((item) =>
          this.getConversationId(item) === conversationId
            ? { ...item, unreadCount: 0, partnerLastVisibleMessageId: item.messages[item.messages.length - 1]?.id ?? item.partnerLastVisibleMessageId }
            : item
        );
        this.navbarBadgeService.refresh(userId);
      }
    });
  }

  private cloneConversations(conversations: Conversation[]): Conversation[] {
    return conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message }))
    }));
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
