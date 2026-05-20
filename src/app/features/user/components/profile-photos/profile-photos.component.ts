import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { ProfileService } from '../../data-access/profile.service';
import { Album, ProfilePhoto } from '../../models/profile-media.model';

type ProfilePhotoTab = 'photos' | 'albums';

@Component({
  selector: 'app-profile-photos',
  standalone: false,
  templateUrl: './profile-photos.component.html',
  styleUrls: ['./profile-photos.component.scss']
})
export class ProfilePhotosComponent implements OnChanges, OnDestroy {
  @Input() userId = '';
  @Input() isOwnProfile = false;

  activeTab: ProfilePhotoTab = 'photos';
  photos: ProfilePhoto[] = [];
  albums: Album[] = [];
  searchQuery = '';
  isSearchOpen = false;
  isLoadingPhotos = false;
  isLoadingAlbums = false;
  isUploadModalOpen = false;
  isSavingUpload = false;
  errorMessage = '';
  successMessage = '';
  uploadErrorMessage = '';
  selectedFile: File | null = null;
  previewUrl = '';
  previewMediaType: 'Image' | 'Video' = 'Image';

  constructor(private readonly profileService: ProfileService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] && this.userId) {
      this.activeTab = 'photos';
      this.searchQuery = '';
      this.closeUploadModal();
      this.loadPhotos();
      this.loadAlbums();
    }
  }

  ngOnDestroy(): void {
    this.revokePreviewUrl();
  }

  selectTab(tab: ProfilePhotoTab): void {
    this.activeTab = tab;
    this.errorMessage = '';
    this.successMessage = '';

    if (tab === 'photos' && this.photos.length === 0) {
      this.loadPhotos();
    }

    if (tab === 'albums' && this.albums.length === 0) {
      this.loadAlbums();
    }
  }

  get visiblePhotos(): ProfilePhoto[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      return this.photos;
    }

    return this.photos.filter((photo) =>
      photo.originalFileName.toLowerCase().includes(query) ||
      photo.mediaType.toLowerCase().includes(query));
  }

  openUploadModal(): void {
    if (!this.isOwnProfile) {
      return;
    }

    this.isUploadModalOpen = true;
    this.uploadErrorMessage = '';
    this.successMessage = '';
  }

  closeUploadModal(): void {
    this.isUploadModalOpen = false;
    this.uploadErrorMessage = '';
    this.selectedFile = null;
    this.previewMediaType = 'Image';
    this.revokePreviewUrl();
  }

  onUploadFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      this.uploadErrorMessage = 'Please choose an image or video file.';
      input!.value = '';
      return;
    }

    this.revokePreviewUrl();
    this.selectedFile = file;
    this.previewMediaType = file.type.startsWith('video/') ? 'Video' : 'Image';
    this.previewUrl = URL.createObjectURL(file);
    this.uploadErrorMessage = '';
    input!.value = '';
  }

  saveUpload(): void {
    if (!this.userId || !this.selectedFile || this.isSavingUpload) {
      return;
    }

    this.isSavingUpload = true;
    this.uploadErrorMessage = '';
    this.errorMessage = '';
    this.successMessage = '';

    this.profileService.uploadPhoto(this.userId, this.selectedFile).subscribe({
      next: () => {
        this.isSavingUpload = false;
        this.successMessage = 'Photo added.';
        this.closeUploadModal();
        this.loadPhotos();
        this.loadAlbums();
      },
      error: (error: unknown) => {
        this.isSavingUpload = false;
        this.uploadErrorMessage = this.extractErrorMessage(error, 'Unable to save this media.');
      }
    });
  }

  refreshPhotos(): void {
    this.loadPhotos();
    this.loadAlbums();
  }

  toggleSearch(): void {
    this.isSearchOpen = !this.isSearchOpen;
    if (!this.isSearchOpen) {
      this.searchQuery = '';
    }
  }

  showEditNotice(event: MouseEvent): void {
    event.stopPropagation();
    this.successMessage = '';
    this.errorMessage = 'Photo editing is not available yet.';
  }

  trackByPhotoId(_: number, photo: ProfilePhoto): string {
    return photo.id;
  }

  trackByAlbumId(_: number, album: Album): string {
    return album.id;
  }

  private loadPhotos(): void {
    if (!this.userId) {
      return;
    }

    this.isLoadingPhotos = true;
    this.errorMessage = '';

    this.profileService.getPhotos(this.userId).subscribe({
      next: (photos) => {
        this.photos = photos;
        this.isLoadingPhotos = false;
      },
      error: () => {
        this.photos = [];
        this.isLoadingPhotos = false;
        this.errorMessage = 'Unable to load photos.';
      }
    });
  }

  private loadAlbums(): void {
    if (!this.userId) {
      return;
    }

    this.isLoadingAlbums = true;

    this.profileService.getAlbums(this.userId).subscribe({
      next: (albums) => {
        this.albums = albums;
        this.isLoadingAlbums = false;
      },
      error: () => {
        this.albums = [];
        this.isLoadingAlbums = false;
      }
    });
  }

  private revokePreviewUrl(): void {
    if (!this.previewUrl) {
      return;
    }

    URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = '';
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error) {
      const payload = (error as { error?: unknown }).error;
      if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
      }
    }

    return fallback;
  }
}
