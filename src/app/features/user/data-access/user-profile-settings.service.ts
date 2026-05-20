import { Injectable } from '@angular/core';

export type ProfilePrivacy = 'Public' | 'Private';

export interface UserProfileLocalSettings {
  coverUrl: string;
  coverGalleryUrls: string[];
  coverPositionX: number;
  coverPositionY: number;
  privacy: ProfilePrivacy;
}

const defaultProfileSettings: UserProfileLocalSettings = {
  coverUrl: '',
  coverGalleryUrls: [],
  coverPositionX: 50,
  coverPositionY: 50,
  privacy: 'Public'
};

@Injectable({ providedIn: 'root' })
export class UserProfileSettingsService {
  load(userId: string): UserProfileLocalSettings {
    if (typeof localStorage === 'undefined') {
      return { ...defaultProfileSettings };
    }

    try {
      const raw = localStorage.getItem(this.settingsKey(userId));
      if (!raw) {
        return { ...defaultProfileSettings };
      }

      const parsed = JSON.parse(raw) as Partial<UserProfileLocalSettings>;
      return this.sanitizeSettings(parsed);
    } catch {
      return { ...defaultProfileSettings };
    }
  }

  save(userId: string, settings: UserProfileLocalSettings): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this.settingsKey(userId), JSON.stringify(this.sanitizeSettings(settings)));
    } catch {
      // Keep settings in memory if storage is unavailable.
    }
  }

  update(userId: string, patch: Partial<UserProfileLocalSettings>): UserProfileLocalSettings {
    const nextSettings = this.sanitizeSettings({
      ...this.load(userId),
      ...patch
    });
    this.save(userId, nextSettings);
    return nextSettings;
  }

  private settingsKey(userId: string): string {
    return `ts_profile_settings_${userId}`;
  }

  private sanitizeSettings(settings: Partial<UserProfileLocalSettings>): UserProfileLocalSettings {
    const coverGalleryUrls = Array.isArray(settings.coverGalleryUrls)
      ? settings.coverGalleryUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    return {
      coverUrl: typeof settings.coverUrl === 'string' ? settings.coverUrl : '',
      coverGalleryUrls,
      coverPositionX: this.clampPosition(settings.coverPositionX),
      coverPositionY: this.clampPosition(settings.coverPositionY),
      privacy: settings.privacy === 'Private' ? 'Private' : 'Public'
    };
  }

  private clampPosition(value: unknown): number {
    return typeof value === 'number' && !Number.isNaN(value)
      ? Math.min(100, Math.max(0, value))
      : 50;
  }
}
