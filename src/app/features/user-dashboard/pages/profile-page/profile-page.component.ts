import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { UserService } from '../../../../core/services/user.service';
import { CommunityPost } from '../../../../shared/models/community.model';
import { User } from '../../../../shared/models/user.model';

type ProfilePrivacy = 'Public' | 'Private';

const MAX_AVATAR_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

interface LocalProfileSettings {
  coverUrl: string;
  coverGalleryUrls: string[];
  coverPositionX: number;
  coverPositionY: number;
  privacy: ProfilePrivacy;
}

@Component({
  selector: 'app-profile-page',
  standalone: false,
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss']
})
export class ProfilePageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  readonly defaultProfileAvatarUrl = this.createDefaultProfileAvatarUrl();

  @ViewChild('avatarUploadInput') private avatarUploadInput?: ElementRef<HTMLInputElement>;
  @ViewChild('coverUploadInput') private coverUploadInput?: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  userPosts: CommunityPost[] = [];
  isLoading = false;
  isPostsLoading = false;
  isSaving = false;
  isEditorOpen = false;
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
  isCoverMenuOpen = false;
  isCoverPickerOpen = false;
  isCoverRepositionOpen = false;
  private avatarSyncInFlight = false;
  private avatarPreviewObjectUrl: string | null = null;

  readonly profileForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    newPassword: [''],
    confirmPassword: ['']
  });

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly userService: UserService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.authService.user$.subscribe((user) => {
      const nextUserId = user?.id ?? null;
      const shouldLoad = !!nextUserId && (!this.currentUser || this.currentUser.id !== nextUserId);

      this.updateView(() => {
        this.currentUser = user;
      });

      if (shouldLoad) {
        this.loadProfile(nextUserId);
        this.loadProfilePosts(nextUserId);
        this.loadLocalSettings(nextUserId);
      }
    });

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }
  }

  saveProfile(): void {
    const userId = this.authService.getUserId();
    if (!userId) {
      this.errorMessage = 'Please sign in again.';
      return;
    }

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const formValue = this.profileForm.getRawValue();
    const nextDisplayName = formValue.displayName.trim();
    const nextEmail = formValue.email.trim().toLowerCase();
    const nextPassword = formValue.newPassword;
    const confirmPassword = formValue.confirmPassword;

    if ((nextPassword.length > 0 || confirmPassword.length > 0) && nextPassword !== confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.userService.update(userId, {
      displayName: nextDisplayName,
      email: nextEmail,
      newPassword: nextPassword || undefined,
      confirmPassword: confirmPassword || undefined
    })
      .subscribe({
      next: (user) => {
        this.updateView(() => {
          this.applyUser(user);
          this.persistLocalSettings();
          this.successMessage = 'Profile updated.';
          this.isSaving = false;
          this.isEditorOpen = false;
          this.profileForm.patchValue({
            newPassword: '',
            confirmPassword: ''
          });
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
    if (!this.currentUser) {
      return;
    }

    this.profileForm.patchValue({
      displayName: this.currentUser.displayName,
      email: this.currentUser.email,
      newPassword: '',
      confirmPassword: ''
    });
    this.loadLocalSettings(this.currentUser.id);
    this.errorMessage = '';
    this.successMessage = '';
  }

  openProfileEditor(): void {
    if (!this.currentUser) {
      return;
    }

    this.resetProfileForm();
    this.loadLocalSettings(this.currentUser.id);
    this.isEditorOpen = true;
  }

  closeProfileEditor(): void {
    this.isEditorOpen = false;
    this.isCoverMenuOpen = false;
    this.resetProfileForm();
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.isCoverMenuOpen = false;
  }

  get memberStatus(): string {
    return this.currentUser?.isFrozen ? 'Frozen' : 'Active';
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

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  getPostAvatarUrl(post: CommunityPost): string {
    return this.avatarDirectory.resolveAvatarUrl(post.userId);
  }

  private applyUser(user: User): void {
    this.clearAvatarPreviewObjectUrl();
    this.currentUser = user;
    this.profileAvatarUrl = user.avatarUrl?.trim() ?? '';
    this.profileForm.patchValue({
      displayName: user.displayName,
      email: user.email,
      newPassword: '',
      confirmPassword: ''
    });
    this.authService.updateStoredUser(user);
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

  loadProfilePosts(userId: string): void {
    this.isPostsLoading = true;

    this.communityService.getPosts(userId, 100).subscribe({
      next: (posts) => {
        this.updateView(() => {
          this.userPosts = posts.filter((post) => post.userId === userId);
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

  private loadProfile(userId: string): void {
    this.updateView(() => {
      this.isLoading = true;
      this.errorMessage = '';
    });

    this.userService.getById(userId).subscribe({
      next: (user) => {
        this.updateView(() => {
          this.applyUser(user);
          this.isLoading = false;
        });
      },
      error: () => {
        this.updateView(() => {
          this.errorMessage = 'Unable to load profile right now.';
          this.isLoading = false;
        });
      }
    });
  }

  private loadLocalSettings(userId: string): void {
    try {
      const raw = localStorage.getItem(this.settingsKey(userId));
      const currentAvatarUrl = this.currentUser?.avatarUrl?.trim() ?? '';
      if (!raw) {
        this.profileAvatarUrl = currentAvatarUrl;
        this.profileCoverUrl = '';
        this.coverGalleryUrls = [];
        this.coverPositionX = 50;
        this.coverPositionY = 50;
        this.profilePrivacy = 'Public';
        this.profileAvatarFileName = '';
        this.profileCoverFileName = '';
        return;
      }

      const parsed = JSON.parse(raw) as Partial<LocalProfileSettings>;
      this.profileAvatarUrl = currentAvatarUrl;
      this.profileCoverUrl = typeof parsed.coverUrl === 'string' ? parsed.coverUrl : '';
      this.coverGalleryUrls = Array.isArray(parsed.coverGalleryUrls)
        ? parsed.coverGalleryUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      this.coverPositionX = this.clampPosition(typeof parsed.coverPositionX === 'number' ? parsed.coverPositionX : 50);
      this.coverPositionY = this.clampPosition(typeof parsed.coverPositionY === 'number' ? parsed.coverPositionY : 50);
      this.profilePrivacy = parsed.privacy === 'Private' ? 'Private' : 'Public';
      this.profileAvatarFileName = this.profileAvatarUrl ? 'Uploaded image' : '';
      this.profileCoverFileName = this.profileCoverUrl ? 'Uploaded image' : '';
      this.ensureCoverGalleryHasCurrentCover();
      this.persistLocalSettings();
    } catch {
      this.profileAvatarUrl = this.currentUser?.avatarUrl?.trim() ?? '';
      this.profileCoverUrl = '';
      this.coverGalleryUrls = [];
      this.coverPositionX = 50;
      this.coverPositionY = 50;
      this.profilePrivacy = 'Public';
      this.profileAvatarFileName = '';
      this.profileCoverFileName = '';
      this.persistLocalSettings();
    }
  }

  private persistLocalSettings(): void {
    const userId = this.currentUser?.id;
    if (!userId) {
      return;
    }

    const payload: LocalProfileSettings = {
      coverUrl: this.profileCoverUrl.trim(),
      coverGalleryUrls: this.coverGalleryUrls,
      coverPositionX: this.coverPositionX,
      coverPositionY: this.coverPositionY,
      privacy: this.profilePrivacy
    };

    try {
      localStorage.setItem(this.settingsKey(userId), JSON.stringify(payload));
    } catch {
      // Keep the settings in memory if storage is unavailable.
    }
  }

  private syncProfileAvatar(file: File, previousAvatarUrl: string): void {
    if (this.avatarSyncInFlight) {
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

  private settingsKey(userId: string): string {
    return `ts_profile_settings_${userId}`;
  }

  onProfileAvatarFileSelected(event: Event): void {
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
    this.readImageFile(event, (dataUrl, fileName) => {
      this.applyCoverImage(dataUrl, fileName);
    });
  }

  triggerAvatarUpload(): void {
    this.avatarUploadInput?.nativeElement.click();
  }

  triggerCoverUpload(): void {
    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = false;
    this.isCoverRepositionOpen = false;
    this.coverUploadInput?.nativeElement.click();
  }

  toggleCoverMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isCoverMenuOpen = !this.isCoverMenuOpen;
  }

  openCoverPicker(event?: MouseEvent): void {
    event?.stopPropagation();
    this.isCoverMenuOpen = false;
    this.isCoverPickerOpen = true;
  }

  openCoverReposition(event?: MouseEvent): void {
    event?.stopPropagation();
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
    this.profileCoverUrl = url;
    this.profileCoverFileName = 'Selected image';
    this.ensureCoverGalleryHasCurrentCover();
    this.persistLocalSettings();
    this.closeCoverPicker();
  }

  onCoverPositionChange(axis: 'x' | 'y', value: string): void {
    const nextValue = this.clampPosition(Number(value));
    if (axis === 'x') {
      this.coverPositionX = nextValue;
    } else {
      this.coverPositionY = nextValue;
    }

    this.persistLocalSettings();
  }

  shiftCoverPosition(axis: 'x' | 'y', delta: number): void {
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

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
