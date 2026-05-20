export type ProfileMediaType = 'Image' | 'Video';

export interface ProfilePhoto {
  id: string;
  userId: string;
  albumId: string | null;
  mediaUrl: string;
  mediaType: ProfileMediaType;
  contentType: string;
  originalFileName: string;
  sizeBytes: number;
  createdAtUtc: string;
}

export interface Album {
  id: string;
  userId: string;
  name: string;
  coverImageUrl: string | null;
  photoCount: number;
  createdAtUtc: string;
}

export interface GroupPreview {
  id: string;
  name: string;
  coverImageUrl: string | null;
  visibility: 'Public' | string;
  memberCount: number;
}
