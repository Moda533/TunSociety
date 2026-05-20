import { Injectable } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { Album, GroupPreview, ProfilePhoto } from '../models/profile-media.model';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  constructor(private readonly api: ApiService) {}

  getPhotos(userId: string) {
    return this.api.get<ProfilePhoto[]>(`profiles/${userId}/photos`);
  }

  uploadPhoto(userId: string, media: File, albumId?: string | null) {
    const formData = new FormData();
    formData.append('media', media);
    if (albumId) {
      formData.append('albumId', albumId);
    }

    return this.api.post<ProfilePhoto>(`profiles/${userId}/photos`, formData);
  }

  getAlbums(userId: string) {
    return this.api.get<Album[]>(`profiles/${userId}/albums`);
  }

  getGroups(userId: string) {
    return this.api.get<GroupPreview[]>(`profiles/${userId}/groups`);
  }
}
