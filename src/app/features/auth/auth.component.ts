import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnInit, ViewChild, inject } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

type AuthMode = 'signin' | 'signup';

@Component({
  selector: 'app-auth',
  standalone: false,
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss']
})
export class AuthComponent implements OnInit, AfterViewInit {
  private readonly fb = inject(FormBuilder);
  private readonly zone = inject(NgZone);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  mode: AuthMode = 'signin';
  isSubmitting = false;
  isOauthSubmitting = false;
  showSignInPassword = false;
  showSignUpPassword = false;
  showSignUpConfirmPassword = false;
  errorMessage = '';

  @ViewChild('signInEmailInput') signInEmailInput?: ElementRef<HTMLInputElement>;
  @ViewChild('signUpFullNameInput') signUpFullNameInput?: ElementRef<HTMLInputElement>;

  readonly signInForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  readonly signUpForm = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    gender: ['', [Validators.required]],
    age: [null, [Validators.required, Validators.min(15), Validators.max(120)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, this.passwordComplexityValidator]],
    confirmPassword: ['', [Validators.required]]
  }, {
    validators: [this.matchingPasswordsValidator]
  });

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe((user) => {
        if (user?.role) {
          this.navigateByRole(user.role);
        }
      });
    }
  }

  ngAfterViewInit(): void {
    this.focusFirstInput();
  }

  setMode(mode: AuthMode): void {
    this.mode = mode;
    this.errorMessage = '';
    this.clearServerErrors(this.signInForm);
    this.clearServerErrors(this.signUpForm);
    this.focusFirstInput();
  }

  submitSignIn(): void {
    this.clearServerErrors(this.signInForm);

    if (this.signInForm.invalid) {
      this.signInForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.updateView(() => {
      this.isSubmitting = true;
    });

    const payload = this.signInForm.getRawValue();
    this.authService.login(payload)
      .pipe(finalize(() => {
        this.updateView(() => {
          this.isSubmitting = false;
        });
      }))
      .subscribe({
        next: (response) => this.updateView(() => {
          this.navigateByRole(response.user.role);
        }),
        error: (error: unknown) => {
          this.updateView(() => {
            if (this.isNetworkOrTimeoutError(error)) {
              this.errorMessage = 'API is not reachable. Start backend on http://localhost:5000.';
              return;
            }

            const httpError = error as HttpErrorResponse;
            if (httpError.status === 429) {
              this.errorMessage = 'Too many failed attempts. Try again later.';
              return;
            }

            if (httpError.status === 401) {
              this.setServerError(this.signInForm, 'password', 'Invalid email or password.');
              return;
            }

            this.errorMessage = 'Sign in failed. Please try again.';
          });
        }
      });
  }

  submitSignUp(): void {
    this.clearServerErrors(this.signUpForm);
    this.signUpForm.updateValueAndValidity();

    if (this.signUpForm.invalid) {
      this.signUpForm.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.updateView(() => {
      this.isSubmitting = true;
    });

    const rawValue = this.signUpForm.getRawValue();
    const payload = {
      fullName: String(rawValue.fullName ?? '').trim(),
      gender: String(rawValue.gender ?? '').trim(),
      age: Number(rawValue.age),
      email: String(rawValue.email ?? '').trim(),
      password: String(rawValue.password ?? ''),
      confirmPassword: String(rawValue.confirmPassword ?? '')
    };

    this.authService.register(payload)
      .pipe(finalize(() => {
        this.updateView(() => {
          this.isSubmitting = false;
        });
      }))
      .subscribe({
        next: (response) => this.updateView(() => {
          this.navigateByRole(response.user.role);
        }),
        error: (error: unknown) => {
          this.updateView(() => {
            if (this.isNetworkOrTimeoutError(error)) {
              this.errorMessage = 'API is not reachable. Start backend on http://localhost:5000.';
              return;
            }

            const httpError = error as HttpErrorResponse;
            if (httpError.status === 429) {
              this.errorMessage = 'Too many failed attempts. Try again later.';
              return;
            }

            const backendMessage = this.extractBackendMessage(httpError);

            if (httpError.status === 409) {
              this.setServerError(this.signUpForm, 'email', 'This email is already registered.');
              return;
            }

            if (backendMessage.toLowerCase().includes('gender')) {
              this.setServerError(this.signUpForm, 'gender', backendMessage);
              return;
            }

            if (backendMessage.toLowerCase().includes('age') || backendMessage.toLowerCase().includes('older')) {
              this.setServerError(this.signUpForm, 'age', backendMessage);
              return;
            }

            if (backendMessage.toLowerCase().includes('password')) {
              const targetControl = backendMessage.toLowerCase().includes('confirm')
                ? 'confirmPassword'
                : 'password';
              this.setServerError(this.signUpForm, targetControl, backendMessage);
              return;
            }

            if (backendMessage.toLowerCase().includes('email')) {
              this.setServerError(this.signUpForm, 'email', backendMessage);
              return;
            }

            if (backendMessage.toLowerCase().includes('full name') || backendMessage.toLowerCase().includes('display name')) {
              this.setServerError(this.signUpForm, 'fullName', backendMessage);
              return;
            }

            this.errorMessage = backendMessage || 'Sign up failed. Please try again.';
          });
        }
      });
  }

  startOAuth(provider: 'google' | 'github'): void {
    this.errorMessage = '';
    this.updateView(() => {
      this.isOauthSubmitting = true;
    });

    this.authService.oauth(provider)
      .pipe(finalize(() => {
        this.updateView(() => {
          this.isOauthSubmitting = false;
        });
      }))
      .subscribe({
        next: (response) => this.updateView(() => {
          this.navigateByRole(response.user.role);
        }),
        error: (error: unknown) => {
          this.updateView(() => {
            if (this.isNetworkOrTimeoutError(error)) {
              this.errorMessage = 'API is not reachable. Start backend on http://localhost:5000.';
              return;
            }

            this.errorMessage = 'OAuth is not configured yet.';
          });
        }
      });
  }

  getFieldError(form: FormGroup, controlName: string): string | null {
    const control = form.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return null;
    }

    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }

    if (controlName === 'gender' && control.hasError('required')) {
      return 'Select your gender.';
    }

    if (controlName === 'age' && control.hasError('required')) {
      return 'Enter your age.';
    }

    if (control.hasError('required')) {
      return 'This field is required.';
    }

    if (control.hasError('minlength')) {
      const min = control.getError('minlength')?.requiredLength ?? 0;
      return `Minimum ${min} characters.`;
    }

    if (controlName === 'age' && control.hasError('min')) {
      return 'You must be at least 15 years old.';
    }

    if (controlName === 'age' && control.hasError('max')) {
      return 'Enter a valid age.';
    }

    if (control.hasError('passwordComplexity')) {
      return 'Use 8+ chars with letters, numbers, and a special character.';
    }

    if (controlName === 'confirmPassword' && control.hasError('passwordMismatch')) {
      return 'Passwords must match.';
    }

    if (control.hasError('server')) {
      return control.getError('server') as string;
    }

    return null;
  }

  toggleSignInPassword(): void {
    this.showSignInPassword = !this.showSignInPassword;
  }

  toggleSignUpPassword(): void {
    this.showSignUpPassword = !this.showSignUpPassword;
  }

  toggleSignUpConfirmPassword(): void {
    this.showSignUpConfirmPassword = !this.showSignUpConfirmPassword;
  }

  private passwordComplexityValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value as string;
    if (!value) {
      return null;
    }

    const hasLetter = /[A-Za-z]/.test(value);
    const hasDigit = /\d/.test(value);
    const hasSpecial = /[^A-Za-z0-9]/.test(value);

    if (value.length < 8 || !hasLetter || !hasDigit || !hasSpecial) {
      return { passwordComplexity: true };
    }

    return null;
  }

  private matchingPasswordsValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (!password || !confirmPassword) {
      return null;
    }

    const mismatch = password.value !== confirmPassword.value;
    const currentErrors = confirmPassword.errors ?? {};

    if (mismatch) {
      confirmPassword.setErrors({ ...currentErrors, passwordMismatch: true });
      return { passwordMismatch: true };
    }

    if (currentErrors['passwordMismatch']) {
      const { passwordMismatch: _, ...rest } = currentErrors;
      confirmPassword.setErrors(Object.keys(rest).length ? rest : null);
    }

    return null;
  }

  private setServerError(form: FormGroup, controlName: string, message: string): void {
    const control = form.get(controlName);
    if (!control) {
      return;
    }

    const nextErrors = { ...(control.errors ?? {}), server: message };
    control.setErrors(nextErrors);
    control.markAsTouched();
  }

  private clearServerErrors(form: FormGroup): void {
    for (const control of Object.values(form.controls)) {
      if (!control.errors?.['server']) {
        continue;
      }

      const { server: _, ...rest } = control.errors;
      control.setErrors(Object.keys(rest).length ? rest : null);
    }
  }

  private extractBackendMessage(error: HttpErrorResponse): string {
    const payload = error.error;
    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      if (typeof payload.title === 'string' && payload.title.trim().length > 0) {
        return payload.title;
      }

      if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
        return payload.message;
      }
    }

    return '';
  }

  private isNetworkOrTimeoutError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'name' in error) {
      if ((error as { name?: string }).name === 'TimeoutError') {
        return true;
      }
    }

    if (error instanceof HttpErrorResponse) {
      return error.status === 0;
    }

    return false;
  }

  private focusFirstInput(): void {
    setTimeout(() => {
      if (this.mode === 'signin') {
        this.signInEmailInput?.nativeElement.focus();
      } else {
        this.signUpFullNameInput?.nativeElement.focus();
      }
    }, 0);
  }

  private navigateByRole(role: string): void {
    const target = role === 'Admin'
      ? '/admin'
      : role === 'Moderator'
        ? '/moderation'
        : '/dashboard';
    this.router.navigate([target]);
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
