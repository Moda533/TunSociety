import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AppThemeMode, AppThemeService } from '../../../../core/services/app-theme.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService } from '../../data-access/user.service';
import { ProfilePrivacy, UserProfileSettingsService } from '../../data-access/user-profile-settings.service';
import { User } from '../../models/user.model';

interface ThemeOption {
  value: AppThemeMode;
  label: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-settings-page',
  standalone: false,
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss']
})
export class SettingsPageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  readonly themeOptions: ThemeOption[] = [
    {
      value: 'light',
      label: 'Light',
      description: 'Bright surfaces for daytime use.',
      icon: 'sun'
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Low-light colors across the app.',
      icon: 'moon'
    },
    {
      value: 'winter',
      label: 'Winter',
      description: 'Cool blue surfaces and softer contrast.',
      icon: 'snowflake'
    }
  ];

  readonly passwordForm = this.fb.nonNullable.group({
    newPassword: ['', [Validators.required]],
    confirmPassword: ['', [Validators.required]]
  });

  currentUser: User | null = null;
  activeTheme: AppThemeMode = 'light';
  profilePrivacy: ProfilePrivacy = 'Public';
  isSavingPassword = false;
  successMessage = '';
  errorMessage = '';

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly authService: AuthService,
    private readonly appThemeService: AppThemeService,
    private readonly profileSettings: UserProfileSettingsService,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.activeTheme = this.appThemeService.currentMode;

    const user = this.authService.getCurrentUser();
    if (user) {
      this.applyUser(user);
    }

    this.subscriptions.add(
      this.appThemeService.mode$.subscribe((mode) => {
        this.activeTheme = mode;
      })
    );

    this.subscriptions.add(
      this.authService.user$.subscribe((nextUser) => {
        if (nextUser) {
          this.applyUser(nextUser);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  selectTheme(mode: AppThemeMode): void {
    this.appThemeService.setMode(mode);
    this.successMessage = '';
    this.errorMessage = '';
  }

  updatePrivacy(privacy: string): void {
    const userId = this.currentUser?.id ?? this.authService.getUserId();
    if (!userId) {
      this.errorMessage = 'Please sign in again.';
      this.successMessage = '';
      return;
    }

    const nextPrivacy: ProfilePrivacy = privacy === 'Private' ? 'Private' : 'Public';
    this.profilePrivacy = nextPrivacy;
    this.profileSettings.update(userId, { privacy: nextPrivacy });
    this.successMessage = 'Privacy settings updated.';
    this.errorMessage = '';
  }

  savePassword(): void {
    const userId = this.currentUser?.id ?? this.authService.getUserId();
    if (!userId) {
      this.errorMessage = 'Please sign in again.';
      this.successMessage = '';
      return;
    }

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      this.errorMessage = 'Enter and confirm your new password.';
      this.successMessage = '';
      return;
    }

    const formValue = this.passwordForm.getRawValue();
    if (formValue.newPassword !== formValue.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      this.successMessage = '';
      return;
    }

    this.isSavingPassword = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.userService.update(userId, {
      newPassword: formValue.newPassword,
      confirmPassword: formValue.confirmPassword
    }).subscribe({
      next: (user) => {
        this.authService.updateStoredUser(user);
        this.currentUser = user;
        this.passwordForm.reset();
        this.successMessage = 'Password updated.';
        this.errorMessage = '';
        this.isSavingPassword = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.extractErrorMessage(error, 'Unable to update your password.');
        this.successMessage = '';
        this.isSavingPassword = false;
      }
    });
  }

  private applyUser(user: User): void {
    this.currentUser = user;
    this.profilePrivacy = this.profileSettings.load(user.id).privacy;
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
