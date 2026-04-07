import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription, debounceTime, distinctUntilChanged, interval } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../../core/services/user.service';
import { Conversation, DirectMessage } from '../../../../shared/models/community.model';
import { ModerationFeedback } from '../../../../shared/models/moderation.model';
import { UserLookup } from '../../../../shared/models/user.model';

type TimelineItem =
  | { kind: 'date'; label: string; key: string }
  | { kind: 'message'; message: DirectMessage };

type PopupContext = 'search' | 'new';

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
  @ViewChild('chatLog') chatLog?: ElementRef<HTMLDivElement>;

  conversations: Conversation[] = [];
  searchResults: UserLookup[] = [];
  popupSearchResults: UserLookup[] = [];
  selectedConversationId = '';
  isLoading = false;
  isSending = false;
  isSearchingUsers = false;
  isSearchPopupOpen = false;
  isPopupSearchingUsers = false;
  popupContext: PopupContext = 'search';
  errorMessage = '';
  searchErrorMessage = '';
  popupSearchErrorMessage = '';
  pendingRecipient: UserLookup | null = null;
  composerHintMessage = '';
  popupSearchMode: 'all' | 'users' | 'conversations' = 'all';

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
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
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
      interval(this.refreshIntervalMs).subscribe(() => {
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
  }

  ngAfterViewInit(): void {
    this.chatLog?.nativeElement.addEventListener('scroll', this.handleChatScroll, { passive: true });
    this.queueScrollToBottom(false);
  }

  ngOnDestroy(): void {
    this.chatLog?.nativeElement.removeEventListener('scroll', this.handleChatScroll);
    this.cancelCursorSync();
    this.subscriptions.unsubscribe();
  }

  refreshConversations(): void {
    this.loadConversations();
  }

  openNewConversationPopup(): void {
    this.isSearchPopupOpen = true;
    this.popupSearchErrorMessage = '';
    this.popupSearchControl.setValue('', { emitEvent: false });
    this.popupSearchResults = [];
  }

  selectConversation(conversationId: string): void {
    this.selectedConversationId = conversationId;
    this.queueScrollToBottom(false);
  }

  openSearchPopup(): void {
    this.openNewConversationPopup();
  }

  closeSearchPopup(): void {
    this.isSearchPopupOpen = false;
    this.popupSearchErrorMessage = '';
  }

  sendMessage(): void {
    const userId = this.userId;
    const text = this.chatInputControl.value.trim();
    const recipientId = this.pendingRecipient?.id ?? this.selectedConversation?.partnerUserId;

    if (!userId || !recipientId || !text) {
      return;
    }

    const previousConversations = this.cloneConversations(this.conversations);
    const previousSelectedConversationId = this.selectedConversationId;
    const previousPendingRecipient = this.pendingRecipient;
    const optimisticMessage = this.createOptimisticMessage(userId, recipientId, text);

    this.isSending = true;
    this.chatInputControl.setValue('');
    this.selectedConversationId = recipientId;
    this.errorMessage = '';
    this.applyOptimisticMessage(
      recipientId,
      optimisticMessage,
      this.pendingRecipient?.displayName ?? this.selectedConversation?.partnerName ?? 'Member',
      this.pendingRecipient?.role ?? this.selectedConversation?.partnerRole ?? 'User'
    );
    this.pendingRecipient = null;
    this.queueScrollToBottom(true);

    this.communityService.sendDirectMessage({
      senderUserId: userId,
      recipientUserId: recipientId,
      content: text
    }).subscribe({
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

          this.replaceOptimisticMessage(recipientId, optimisticMessage.id, data);
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
    return this.conversations.find((item) => item.partnerUserId === this.selectedConversationId) ?? null;
  }

  get activePartnerName(): string {
    return this.selectedConversation?.partnerName ?? this.pendingRecipient?.displayName ?? 'Select a conversation';
  }

  get activePartnerMeta(): string {
    return this.selectedConversation?.lastMessageAtUtc
      ? this.selectedConversation.lastMessageAtUtc
      : this.pendingRecipient?.role ?? 'New conversation';
  }

  get activeMessages() {
    return this.selectedConversation?.messages ?? [];
  }

  getUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getConversationAvatarUrl(partnerUserId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(partnerUserId);
  }

  getRecipientAvatarUrl(): string {
    if (this.pendingRecipient) {
      return this.getUserAvatarUrl(this.pendingRecipient);
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
    if (!query) {
      return this.conversations;
    }

    return this.conversations.filter((conversation) =>
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

  trackByConversationId(_: number, conversation: Conversation): string {
    return conversation.partnerUserId;
  }

  trackByMessageId(_: number, message: DirectMessage): string {
    return message.id;
  }

  trackByUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByTimelineItem(_: number, item: TimelineItem): string {
    return item.kind === 'date' ? `date-${item.key}` : item.message.id;
  }

  trackByPopupConversationId(_: number, conversation: Conversation): string {
    return conversation.partnerUserId;
  }

  trackByPopupUserId(_: number, user: UserLookup): string {
    return user.id;
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
      this.selectedConversationId = existingConversation.partnerUserId;
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
    this.selectedConversationId = conversation.partnerUserId;
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

    this.communityService.getConversations(userId, 120).subscribe({
      next: (items) => {
        this.avatarDirectory.ensureUsers(this.collectConversationPartnerIds(items)).subscribe({
          next: () => {
            let selectedConversationChanged = false;
            this.updateView(() => {
              const draftConversation = this.pendingRecipient && !items.some((item) => item.partnerUserId === this.pendingRecipient?.id)
                ? this.createDraftConversation(this.pendingRecipient)
                : null;

              this.conversations = draftConversation ? [draftConversation, ...items] : items;

              if (preferredPartnerId && this.conversations.some((item) => item.partnerUserId === preferredPartnerId)) {
                this.selectedConversationId = preferredPartnerId;
              }

              if (!this.selectedConversationId && this.conversations.length > 0) {
                this.selectedConversationId = this.conversations[0].partnerUserId;
              }

              if (this.selectedConversationId && !this.conversations.some((item) => item.partnerUserId === this.selectedConversationId)) {
                this.selectedConversationId = this.conversations[0]?.partnerUserId ?? '';
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
    if (!userId || !conversation || !log || conversation.messages.length === 0) {
      return;
    }

    const visibleMessageId = this.findLastVisibleMessageId(log);
    if (!visibleMessageId) {
      return;
    }

    const currentCursor = this.visibleCursorByConversation.get(conversation.partnerUserId) ?? '';
    const pendingCursor = this.pendingCursorByConversation.get(conversation.partnerUserId) ?? '';
    if (visibleMessageId === currentCursor || visibleMessageId === pendingCursor) {
      return;
    }

    if (!this.isLaterVisibleMessage(visibleMessageId, currentCursor, conversation.messages)) {
      return;
    }

    this.pendingCursorByConversation.set(conversation.partnerUserId, visibleMessageId);
    this.communityService.updateConversationReadCursor(userId, conversation.partnerUserId, visibleMessageId).subscribe({
      next: () => {
        this.updateView(() => {
          this.visibleCursorByConversation.set(conversation.partnerUserId, visibleMessageId);
          if (this.pendingCursorByConversation.get(conversation.partnerUserId) === visibleMessageId) {
            this.pendingCursorByConversation.delete(conversation.partnerUserId);
          }

          this.conversations = this.conversations.map((item) =>
            item.partnerUserId === conversation.partnerUserId
              ? this.applyCursorToConversation(item, visibleMessageId, userId)
              : item
          );
        });
      },
      error: () => {
        if (this.pendingCursorByConversation.get(conversation.partnerUserId) === visibleMessageId) {
          this.pendingCursorByConversation.delete(conversation.partnerUserId);
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
    }

    return fallback;
  }

  private canPollSilently(): boolean {
    return !document.hidden && !this.isLoading && !this.isSending && !this.isSearchingUsers;
  }

  private createOptimisticMessage(userId: string, recipientId: string, content: string): DirectMessage {
    return {
      id: `temp-${Date.now()}`,
      senderUserId: userId,
      senderName: this.authService.getCurrentUser()?.displayName || this.authService.getCurrentUser()?.userName || 'You',
      recipientUserId: recipientId,
      recipientName: this.pendingRecipient?.displayName ?? this.selectedConversation?.partnerName ?? 'Member',
      content,
      createdAtUtc: new Date().toISOString(),
      isRead: true
    };
  }

  private applyOptimisticMessage(
    partnerUserId: string,
    message: DirectMessage,
    partnerName: string,
    partnerRole: string
  ): void {
    const existingConversation = this.conversations.find((conversation) => conversation.partnerUserId === partnerUserId);

    if (!existingConversation) {
      this.conversations = [{
        partnerUserId,
        partnerName,
        partnerRole,
        partnerLastVisibleMessageId: null,
        lastMessageAtUtc: message.createdAtUtc,
        isPartnerOnline: false,
        unreadCount: 0,
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
      ...this.conversations.filter((conversation) => conversation.partnerUserId !== partnerUserId)
    ];
  }

  private replaceOptimisticMessage(partnerUserId: string, tempMessageId: string, message: DirectMessage): void {
    this.conversations = this.conversations.map((conversation) =>
      conversation.partnerUserId === partnerUserId
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
      partnerUserId: user.id,
      partnerName: user.displayName,
      partnerRole: user.role,
      partnerLastVisibleMessageId: null,
      lastMessageAtUtc: new Date().toISOString(),
      isPartnerOnline: false,
      unreadCount: 0,
      messages: []
    };
  }

  private collectConversationPartnerIds(conversations: Conversation[]): string[] {
    const ids = conversations.map((conversation) => conversation.partnerUserId);
    if (this.pendingRecipient) {
      ids.push(this.pendingRecipient.id);
    }

    return Array.from(new Set(ids.filter((id) => id.length > 0)));
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
