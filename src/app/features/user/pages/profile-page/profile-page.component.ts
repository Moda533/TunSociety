import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../user/data-access/user.service';
import { CommunityPost, ReactionType } from '../../../community/models/community.model';
import { ModerationFeedback } from '../../../moderation/models/moderation.model';
import { User } from '../../../user/models/user.model';
import { ProfilePrivacy, UserProfileSettingsService } from '../../data-access/user-profile-settings.service';

const MAX_AVATAR_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

@Component({
  selector: 'app-profile-page',
  standalone: false,
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss']
})
export class ProfilePageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  readonly defaultProfileAvatarUrl = this.createDefaultProfileAvatarUrl();
  readonly postCommentControl = new FormControl('', { nonNullable: true });

  @ViewChild('avatarUploadInput') private avatarUploadInput?: ElementRef<HTMLInputElement>;
  @ViewChild('coverUploadInput') private coverUploadInput?: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  authUser: User | null = null;
  userPosts: CommunityPost[] = [];
  isLoading = false;
  isPostsLoading = false;
  isSaving = false;
  isEditorOpen = false;
  isOwnProfile = true;
  errorMessage = '';
  successMessage = '';
  profileAvatarUrl = '';
  profileCoverUrl = '';
  coverGalleryUrls: string[] = [];
  coverPositionX = 50;
  coverPositionY = 50;
  profileAvatarFileName = '';
  profileCoverFileName = '';
  profilePrivacy: ProfilePrivacy = 'Public';
  activeProfileSection: 'posts' | 'photos' = 'posts';
  isCoverMenuOpen = false;
  isProfileMoreMenuOpen = false;
  isCoverPickerOpen = false;
  isCoverRepositionOpen = false;
  activeImageModalUrl: string | null = null;
  activeImageModalAlt = '';
  selectedPost: CommunityPost | null = null;
  selectedPostMessage = '';
  isSubmittingPostAction = false;
  private avatarSyncInFlight = false;
  private avatarPreviewObjectUrl: string | null = null;
  private profileRouteUserId: string | null = null;
  private lastLoadedProfileKey = '';
  private readonly refreshIntervalMs = 15000;
  private readonly subscriptions = new Subscription();

  readonly profileForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]]
  });

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly profileSettings: UserProfileSettingsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly autoRefresh: AutoRefreshService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        this.updateView(() => {
          this.authUser = user;
        });

        this.refreshProfileView();
      })
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        this.profileRouteUserId = params.get('id');
        this.refreshProfileView();
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canRefreshProfileSilently()) {
          this.refreshProfileView(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.clearAvatarPreviewObjectUrl();
  }

  @HostListener('window:tunSocietyPullRefresh')
  handlePullRefresh(): void {
    this.refreshProfileView(true);
  }

  private refreshProfileView(force = false): void {
    const viewerUserId = this.authUser?.id ?? null;
    const targetUserId = this.profileRouteUserId ?? viewerUserId;

    if (!viewerUserId || !targetUserId) {
      return;
    }

    const profileKey = `${viewerUserId}:${targetUserId}`;
    if (!force && profileKey === this.lastLoadedProfileKey && this.currentUser?.id === targetUserId) {
      return;
    }

    this.lastLoadedProfileKey = profileKey;
    this.loadProfile(targetUserId, viewerUserId);
  }

  private canRefreshProfileSilently(): boolean {
    return !!this.authUser?.id &&
      !document.hidden &&
      !this.isLoading &&
      !this.isPostsLoading &&
      !this.isSaving &&
      !this.isEditorOpen &&
      !this.isCoverMenuOpen &&
      !this.isProfileMoreMenuOpen &&
      !this.isCoverPickerOpen &&
      !this.isCoverRepositionOpen &&
      !this.activeImageModalUrl &&
      !this.selectedPost &&
      !this.isSubmittingPostAction;
  }

  saveProfile(): void {
    const userId = this.authUser?.id ?? this.authService.getUserId();
    if (!userId) {
      this.errorMessage = 'Please sign in again.';
      return;
    }

    if (!this.isOwnProfile) {
      return;
    }

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const formValue = this.profileForm.getRawValue();
    const nextDisplayName = formValue.displayName.trim();
    const nextEmail = formValue.email.trim().toLowerCase();

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.userService.update(userId, {
      displayName: nextDisplayName,
      email: nextEmail
    })
      .subscribe({
      next: (user) => {
        this.updateView(() => {
          this.applyUser(user);
          this.persistLocalSettings();
          this.successMessage = 'Profile updated.';
          this.isSaving = false;
          this.isEditorOpen = false;
        });
      },
        error: (error: unknown) => {
          this.updateView(() => {
            this.errorMessage = this.extractErrorMessage(error, 'Unable to update your profile.');
            this.isSaving = false;
          });
        }
      });
  }

  resetProfileForm(): void {
    if (!this.currentUser || !this.isOwnProfile) {
      return;
    }

    this.profileForm.patchValue({
      displayName: this.currentUser.displayName,
      email: this.currentUser.email
    });
    this.loadLocalSettings(this.currentUser.id);
    this.errorMessage = '';
    this.successMessage = '';
  }

  openProfileEditor(): void {
    if (!this.currentUser || !this.isOwnProfile) {
      return;
    }

    this.resetProfileForm();
    this.loadLocalSettings(this.currentUser.id);
    this.isEditorOpen = true;
  }

  closeProfileEditor(): void {
    this.isEditorOpen = false;
    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = false;
    this.isCoverRepositionOpen = false;
    this.resetProfileForm();
  }

  openImageViewer(imageUrl: string | null | undefined, altText: string): void {
    const trimmedUrl = imageUrl?.trim();
    if (!trimmedUrl) {
      return;
    }

    this.activeImageModalUrl = trimmedUrl;
    this.activeImageModalAlt = altText;
  }

  closeImageViewer(): void {
    this.activeImageModalUrl = null;
    this.activeImageModalAlt = '';
  }

  openUserProfile(userId: string | null | undefined): void {
    const trimmedUserId = userId?.trim();
    if (!trimmedUserId) {
      return;
    }

    if (trimmedUserId === (this.authUser?.id ?? this.authService.getUserId())) {
      void this.router.navigate(['/dashboard/profile']);
      return;
    }

    void this.router.navigate(['/dashboard/members', trimmedUserId]);
  }

  openPostModal(post: CommunityPost): void {
    this.selectedPost = post;
    this.selectedPostMessage = '';
    this.postCommentControl.setValue('', { emitEvent: false });
  }

  closePostModal(): void {
    this.selectedPost = null;
    this.selectedPostMessage = '';
    this.postCommentControl.setValue('', { emitEvent: false });
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.isCoverMenuOpen = false;
    this.isProfileMoreMenuOpen = false;
  }

  get memberStatus(): string {
    return this.currentUser?.isFrozen ? 'Frozen' : 'Active';
  }

  get isFrozenUser(): boolean {
    return this.authService.getCurrentUser()?.isFrozen ?? false;
  }

  get currentUserInitials(): string {
    const source = this.currentUser?.displayName || this.currentUser?.userName || 'Member';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'TS';
  }

  get profileAvatarSource(): string {
    if (this.profileAvatarUrl.trim()) {
      return this.profileAvatarUrl.trim();
    }

    return this.avatarDirectory.resolveAvatarUrl(this.currentUser?.id, this.currentUser?.gender);
  }

  get currentViewerAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  getPostAvatarUrl(post: CommunityPost): string {
    return this.avatarDirectory.resolveAvatarUrl(post.userId);
  }

  getCommentAvatarUrl(userId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(userId);
  }

  isPostLiked(post: CommunityPost): boolean {
    return post.reactions.myReaction === 'like';
  }

  selectProfileSection(section: 'posts' | 'photos', event?: MouseEvent): void {
    event?.stopPropagation();
    this.activeProfileSection = section;
    this.isProfileMoreMenuOpen = false;
  }

  toggleProfileMoreMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isProfileMoreMenuOpen = !this.isProfileMoreMenuOpen;
  }

  openProfileMoreItem(label: string, event: MouseEvent): void {
    event.stopPropagation();
    this.isProfileMoreMenuOpen = false;

    if (label === 'Groups') {
      this.activeProfileSection = 'photos';
      return;
    }

    this.successMessage = '';
    this.errorMessage = `${label} is not available yet.`;
  }

  reactToProfilePost(post: CommunityPost, reactionType: ReactionType): void {
    const userId = this.authService.getUserId();
    if (!userId || this.isFrozenUser || this.isSubmittingPostAction) {
      return;
    }

    this.isSubmittingPostAction = true;
    this.selectedPostMessage = '';

    this.communityService.reactToPost(post.id, {
      userId,
      reactionType
    }).subscribe({
      next: (updatedPost) => {
        this.updateView(() => {
          this.replaceProfilePost(updatedPost);
          this.isSubmittingPostAction = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.selectedPostMessage = 'Unable to update the reaction right now.';
          this.isSubmittingPostAction = false;
        });
      }
    });
  }

  submitSelectedPostComment(): void {
    const post = this.selectedPost;
    const userId = this.authService.getUserId();
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
        this.updateView(() => {
          this.isSubmittingPostAction = false;

          if (!data) {
            this.selectedPostMessage = this.buildModerationMessage('Comment not posted.', moderation);
            return;
          }

          this.postCommentControl.setValue('', { emitEvent: false });
          this.replaceProfilePost(data);
          this.selectedPostMessage = 'Comment posted.';
        });
      },
      error: () => {
        this.updateView(() => {
          this.isSubmittingPostAction = false;
          this.selectedPostMessage = 'Unable to post your comment right now.';
        });
      }
    });
  }

  private applyUser(user: User): void {
    this.clearAvatarPreviewObjectUrl();
    this.currentUser = user;
    this.profileAvatarUrl = user.avatarUrl?.trim() ?? '';
    if (this.isOwnProfile) {
      this.profileForm.patchValue({
        displayName: user.displayName,
        email: user.email
      });
      this.authService.updateStoredUser(user);
    }
  }

  get profileCoverStyle(): Record<string, string> {
    return this.profileCoverUrl
      ? {
        backgroundPosition: `${this.coverPositionX}% ${this.coverPositionY}%`
      }
      : {};
  }

  get profileCoverObjectPosition(): string {
    return `${this.coverPositionX}% ${this.coverPositionY}%`;
  }

  loadProfilePosts(viewerUserId: string, profileUserId: string): void {
    this.isPostsLoading = true;

    this.communityService.getPosts(viewerUserId, 100).subscribe({
      next: (posts) => {
        this.updateView(() => {
          this.userPosts = posts.filter((post) => post.userId === profileUserId);
          this.isPostsLoading = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.userPosts = [];
          this.isPostsLoading = false;
        });
      }
    });
  }

  private loadProfile(profileUserId: string, viewerUserId: string): void {
    this.updateView(() => {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';
      this.isEditorOpen = false;
      this.isCoverMenuOpen = false;
      this.isProfileMoreMenuOpen = false;
      this.isCoverPickerOpen = false;
      this.isCoverRepositionOpen = false;
      this.closeImageViewer();
    });

    this.userService.getById(profileUserId).subscribe({
      next: (user) => {
        this.updateView(() => {
          this.isOwnProfile = viewerUserId === user.id;
          this.applyUser(user);
          this.loadLocalSettings(user.id);
          this.loadProfilePosts(viewerUserId, user.id);
          this.isLoading = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.currentUser = null;
          this.userPosts = [];
          this.errorMessage = 'Unable to load profile right now.';
          this.isLoading = false;
        });
      }
    });
  }

  private loadLocalSettings(userId: string): void {
    const settings = this.profileSettings.load(userId);
    this.profileAvatarUrl = this.currentUser?.avatarUrl?.trim() ?? '';
    this.profileCoverUrl = settings.coverUrl;
    this.coverGalleryUrls = settings.coverGalleryUrls;
    this.coverPositionX = settings.coverPositionX;
    this.coverPositionY = settings.coverPositionY;
    this.profilePrivacy = settings.privacy;
    this.profileAvatarFileName = this.profileAvatarUrl ? 'Uploaded image' : '';
    this.profileCoverFileName = this.profileCoverUrl ? 'Uploaded image' : '';
    this.ensureCoverGalleryHasCurrentCover();
  }

  private persistLocalSettings(): void {
    const userId = this.currentUser?.id;
    if (!userId || !this.isOwnProfile) {
      return;
    }

    const payload = {
      coverUrl: this.profileCoverUrl.trim(),
      coverGalleryUrls: this.coverGalleryUrls,
      coverPositionX: this.coverPositionX,
      coverPositionY: this.coverPositionY,
      privacy: this.profilePrivacy
    };

    this.profileSettings.save(userId, payload);
  }

  private syncProfileAvatar(file: File, previousAvatarUrl: string): void {
    if (this.avatarSyncInFlight || !this.isOwnProfile) {
      return;
    }

    this.avatarSyncInFlight = true;
    this.userService.uploadAvatar(file).subscribe({
      next: (user) => {
        this.avatarSyncInFlight = false;
        try {
          this.updateView(() => {
            this.applyUser(user);
            this.successMessage = 'Profile picture updated.';
            this.errorMessage = '';
          });
        } finally {
          this.clearAvatarPreviewObjectUrl();
        }
      },
      error: (error: unknown) => {
        this.avatarSyncInFlight = false;
        try {
          this.updateView(() => {
            this.profileAvatarUrl = previousAvatarUrl;
            this.successMessage = '';
            this.errorMessage = this.extractErrorMessage(error, 'Unable to update your profile picture.');
          });
        } finally {
          this.clearAvatarPreviewObjectUrl();
        }
      }
    });
  }

  onProfileAvatarFileSelected(event: Event): void {
    if (!this.isOwnProfile) {
      return;
    }

    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_AVATAR_UPLOAD_SIZE_BYTES) {
      input.value = '';
      this.openEditorNotice('Image too large. Please choose a file under 20MB.');
      return;
    }

    if (this.avatarSyncInFlight) {
      input.value = '';
      this.openEditorNotice('Please wait for the current profile picture upload to finish.');
      return;
    }

    if (!this.authService.getUserId()) {
      input.value = '';
      this.openEditorNotice('Please sign in again.');
      return;
    }

    const previousAvatarUrl = this.currentUser?.avatarUrl?.trim() ?? this.avatarDirectory.resolveAvatarUrl(this.currentUser?.id, this.currentUser?.gender);
    this.clearAvatarPreviewObjectUrl();
    const previewUrl = URL.createObjectURL(file);
    this.avatarPreviewObjectUrl = previewUrl;

    this.updateView(() => {
      this.profileAvatarUrl = previewUrl;
      this.profileAvatarFileName = file.name;
      this.errorMessage = '';
      this.successMessage = 'Uploading profile picture...';
    });

    input.value = '';
    this.syncProfileAvatar(file, previousAvatarUrl);
  }

  onProfileCoverFileSelected(event: Event): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.readImageFile(event, (dataUrl, fileName) => {
      this.applyCoverImage(dataUrl, fileName);
    });
  }

  triggerAvatarUpload(): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.avatarUploadInput?.nativeElement.click();
  }

  triggerCoverUpload(): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = false;
    this.isCoverRepositionOpen = false;
    this.coverUploadInput?.nativeElement.click();
  }

  toggleCoverMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.isOwnProfile) {
      return;
    }

    this.isCoverMenuOpen = !this.isCoverMenuOpen;
  }

  openCoverPicker(event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.isOwnProfile) {
      return;
    }

    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = true;
  }

  openCoverReposition(event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.isOwnProfile) {
      return;
    }

    this.isCoverMenuOpen = false;
    this.isCoverRepositionOpen = true;
  }

  closeCoverPicker(): void {
    this.isCoverPickerOpen = false;
  }

  closeCoverReposition(): void {
    this.isCoverRepositionOpen = false;
  }

  selectStoredCover(url: string): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.profileCoverUrl = url;
    this.profileCoverFileName = 'Selected image';
    this.ensureCoverGalleryHasCurrentCover();
    this.persistLocalSettings();
    this.closeCoverPicker();
  }

  onCoverPositionChange(axis: 'x' | 'y', value: string): void {
    if (!this.isOwnProfile) {
      return;
    }

    const nextValue = this.clampPosition(Number(value));
    if (axis === 'x') {
      this.coverPositionX = nextValue;
    } else {
      this.coverPositionY = nextValue;
    }

    this.persistLocalSettings();
  }

  shiftCoverPosition(axis: 'x' | 'y', delta: number): void {
    if (!this.isOwnProfile) {
      return;
    }

    if (axis === 'x') {
      this.coverPositionX = this.clampPosition(this.coverPositionX + delta);
    } else {
      this.coverPositionY = this.clampPosition(this.coverPositionY + delta);
    }

    this.persistLocalSettings();
  }

  private readImageFile(
    event: Event,
    onLoaded: (dataUrl: string, fileName: string) => void
  ): void {
    if (!this.isOwnProfile) {
      return;
    }

    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      input.value = '';
      this.openEditorNotice('Please choose an image file.');
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      input.value = '';
      this.openEditorNotice('Image too large. Please choose a file under 4MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        this.updateView(() => {
          this.openEditorNotice('Unsupported image file.');
        });
        return;
      }

      this.updateView(() => {
        onLoaded(result, file.name);
      });
    };

    reader.onerror = () => {
      this.updateView(() => {
        this.openEditorNotice('Could not read the selected file.');
      });
    };

    reader.readAsDataURL(file);
    input.value = '';
  }

  private applyCoverImage(dataUrl: string, fileName: string): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.profileCoverUrl = dataUrl;
    this.profileCoverFileName = fileName;
    this.coverGalleryUrls = [dataUrl, ...this.coverGalleryUrls.filter((item) => item !== dataUrl)].slice(0, 12);
    this.ensureCoverGalleryHasCurrentCover();
    this.persistLocalSettings();
    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = false;
    this.isCoverRepositionOpen = false;
  }

  private ensureCoverGalleryHasCurrentCover(): void {
    if (!this.profileCoverUrl.trim()) {
      return;
    }

    if (!this.coverGalleryUrls.includes(this.profileCoverUrl)) {
      this.coverGalleryUrls = [this.profileCoverUrl, ...this.coverGalleryUrls].slice(0, 12);
    }
  }

  private clampPosition(value: number): number {
    if (Number.isNaN(value)) {
      return 50;
    }

    return Math.min(100, Math.max(0, value));
  }

  private openEditorNotice(message: string): void {
    this.errorMessage = message;
  }

  private clearAvatarPreviewObjectUrl(): void {
    if (!this.avatarPreviewObjectUrl) {
      return;
    }

    URL.revokeObjectURL(this.avatarPreviewObjectUrl);
    this.avatarPreviewObjectUrl = null;
  }

  private createDefaultProfileAvatarUrl(): string {
    return this.defaultAvatarForGender('Male');
  }

  private defaultAvatarForGender(gender?: string | null): string {
    return gender?.trim().toLowerCase() === 'female' ? '/g.png' : '/b.png';
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 423) {
      this.authService.markCurrentUserFrozen();
      this.currentUser = this.authService.getCurrentUser();
    }

    if (error && typeof error === 'object' && 'error' in error) {
      const payload = (error as { error?: unknown }).error;
      if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
      }
    }

    return fallback;
  }

  private replaceProfilePost(updatedPost: CommunityPost): void {
    this.userPosts = this.userPosts.map((post) => post.id === updatedPost.id ? updatedPost : post);

    if (this.selectedPost?.id === updatedPost.id) {
      this.selectedPost = updatedPost;
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

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
