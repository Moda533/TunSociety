import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppThemeMode = 'light' | 'dark' | 'winter';

const THEME_STORAGE_KEY = 'ts_app_theme_mode';
const THEME_MODES: AppThemeMode[] = ['light', 'dark', 'winter'];

@Injectable({ providedIn: 'root' })
export class AppThemeService {
  private readonly modeSubject = new BehaviorSubject<AppThemeMode>(this.readStoredMode());
  readonly mode$ = this.modeSubject.asObservable();

  constructor() {
    this.applyMode(this.modeSubject.value);
  }

  get currentMode(): AppThemeMode {
    return this.modeSubject.value;
  }

  setMode(mode: AppThemeMode): void {
    const nextMode = this.normalizeMode(mode);
    this.modeSubject.next(nextMode);
    this.applyMode(nextMode);
    this.persistMode(nextMode);
  }

  private readStoredMode(): AppThemeMode {
    if (typeof localStorage === 'undefined') {
      return 'light';
    }

    return this.normalizeMode(localStorage.getItem(THEME_STORAGE_KEY));
  }

  private persistMode(mode: AppThemeMode): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Theme still applies for the active page when storage is unavailable.
    }
  }

  private normalizeMode(mode: string | null): AppThemeMode {
    return THEME_MODES.includes(mode as AppThemeMode) ? (mode as AppThemeMode) : 'light';
  }

  private applyMode(mode: AppThemeMode): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.dataset['theme'] = mode;
  }
}
