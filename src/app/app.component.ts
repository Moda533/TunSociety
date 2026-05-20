import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
import { AppThemeService } from './core/services/app-theme.service';
import { AuthService } from './core/services/auth.service';
import { HttpFeedbackService } from './core/services/http-feedback.service';
import { UserAvatarDirectoryService } from './core/services/user-avatar-directory.service';
import { EMPTY_NAVBAR_BADGES, NavbarBadgeService } from './features/community/data-access/navbar-badge.service';
import { SearchService } from './features/community/data-access/search.service';
import { NavbarBadgeSummary } from './features/community/models/community.model';
import { SearchSuggestion } from './features/community/models/search.model';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnDestroy {
  @ViewChild('globalSearchInput') private globalSearchInput?: ElementRef<HTMLInputElement>;

  title = 'TunSociety';
  readonly feedback$;
  readonly searchControl = new FormControl('', { nonNullable: true });
  isMeMenuOpen = false;
  isSearchMenuOpen = false;
  isMobileNavOpen = false;
  isSearchLoading = false;
  searchSuggestions: SearchSuggestion[] = [];
  badgeSummary: NavbarBadgeSummary = EMPTY_NAVBAR_BADGES;

  private readonly badgeRefreshIntervalMs = 15000;
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly authService: AuthService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly router: Router,
    private readonly httpFeedback: HttpFeedbackService,
    private readonly searchService: SearchService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly appThemeService: AppThemeService
  ) {
    this.appThemeService.currentMode;
    this.feedback$ = this.httpFeedback.message$;

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      this.router.events
      .pipe(filter((event) => event instanceof NavigationStart || event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.httpFeedback.clear();
          this.isMeMenuOpen = false;
          this.isSearchMenuOpen = false;
          this.isMobileNavOpen = false;
        }

        if (event instanceof NavigationEnd) {
          this.resetScrollPosition();
          this.refreshNavbarBadges();
        }
      })
    );

    this.subscriptions.add(
      this.navbarBadgeService.badges$.subscribe((badges) => {
        this.badgeSummary = badges;
      })
    );

    this.subscriptions.add(
      timer(0, this.badgeRefreshIntervalMs).subscribe(() => {
        if (typeof document !== 'undefined' && document.hidden) {
          return;
        }

        this.refreshNavbarBadges();
      })
    );

    this.subscriptions.add(
      this.searchControl.valueChanges
        .pipe(
          debounceTime(180),
          distinctUntilChanged(),
          switchMap((value) => this.fetchSuggestions(value))
        )
        .subscribe((suggestions) => {
          this.searchSuggestions = suggestions;
          this.isSearchLoading = false;
        })
    );

    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        if (!user) {
          this.searchControl.setValue('', { emitEvent: false });
          this.searchSuggestions = [];
          this.isSearchMenuOpen = false;
          this.isSearchLoading = false;
          this.navbarBadgeService.reset();
          return;
        }

        this.navbarBadgeService.refresh(user.id);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  isDashboardRoute(): boolean {
    return this.router.url.startsWith('/dashboard');
  }

  isWorkspaceRoute(): boolean {
    return this.router.url.startsWith('/dashboard')
      || this.router.url.startsWith('/admin')
      || this.router.url.startsWith('/moderation')
      || this.isGuestWorkspaceRoute();
  }

  isAdminWorkspaceRoute(): boolean {
    return this.router.url.startsWith('/admin')
      || this.router.url.startsWith('/moderation')
      || this.router.url.startsWith('/dashboard')
      || this.isGuestWorkspaceRoute();
  }

  private isGuestWorkspaceRoute(): boolean {
    const path = this.router.url.split('?')[0].split('#')[0];
    return path === '/'
      || path === '/about'
      || path === '/features'
      || path === '/policy'
      || path === '/contact'
      || path === '/auth';
  }

  isModerator(): boolean {
    return this.authService.canAccessModerationWorkspace();
  }

  isAdmin(): boolean {
    return this.authService.canAccessAdminWorkspace();
  }

  currentUserName(): string {
    const user = this.authService.getCurrentUser();
    return user?.displayName || user?.userName || 'Member';
  }

  currentUserStatus(): string {
    return this.authService.getCurrentUser()?.isFrozen ? 'Frozen' : 'Active';
  }

  currentUserRole(): string {
    return this.authService.getCurrentUser()?.role || 'Member';
  }

  currentUserAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  getSuggestionAvatarUrl(userId: string): string {
    return this.avatarDirectory.resolveAvatarUrl(userId);
  }

  currentUserInitials(): string {
    const parts = this.currentUserName()
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2);

    return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'S';
  }

  get showSearchDropdown(): boolean {
    if (!this.isLoggedIn() || !this.isSearchMenuOpen) {
      return false;
    }

    const query = this.searchControl.value.trim();
    return query.length > 0 || this.isSearchLoading;
  }

  get showSearchEmptyState(): boolean {
    return this.showSearchDropdown && !this.isSearchLoading && this.searchSuggestions.length === 0;
  }

  toggleMeMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isSearchMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isMeMenuOpen = !this.isMeMenuOpen;
  }

  closeMeMenu(): void {
    this.isMeMenuOpen = false;
  }

  onMeMenuContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  onSearchContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  toggleSearchMenu(event: MouseEvent): void {
    event.stopPropagation();

    if (!this.isLoggedIn()) {
      return;
    }

    this.isMeMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchMenuOpen = !this.isSearchMenuOpen;

    if (this.isSearchMenuOpen && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        this.globalSearchInput?.nativeElement.focus();
      });
    }
  }

  openSearchMenu(): void {
    if (!this.isLoggedIn()) {
      return;
    }

    this.isMeMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchMenuOpen = true;
  }

  toggleMobileNav(event: MouseEvent): void {
    event.stopPropagation();
    this.isSearchMenuOpen = false;
    this.isMeMenuOpen = false;
    this.isMobileNavOpen = !this.isMobileNavOpen;
  }

  closeMobileNav(): void {
    this.isMobileNavOpen = false;
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    if (!query) {
      this.isSearchMenuOpen = false;
      this.searchSuggestions = [];
      return;
    }

    this.isSearchMenuOpen = false;
    this.searchSuggestions = [];
    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query,
        scope: 'all'
      }
    });
  }

  openSearchSuggestion(suggestion: SearchSuggestion): void {
    const query = this.searchControl.value.trim();
    this.isSearchMenuOpen = false;
    this.searchSuggestions = [];

    if (suggestion.kind === 'user') {
      void this.router.navigate(['/dashboard/members', suggestion.id], {
        queryParams: { query }
      });
      return;
    }

    if (suggestion.kind === 'post') {
      void this.router.navigate(['/dashboard/feed'], {
        queryParams: { post: suggestion.id }
      });
      return;
    }

    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query,
        scope: 'events'
      }
    });
  }

  logout(): void {
    this.isMeMenuOpen = false;
    this.isSearchMenuOpen = false;
    this.isMobileNavOpen = false;
    this.navbarBadgeService.reset();
    this.authService.logout();
    this.httpFeedback.clear();
    this.router.navigate(['/auth']);
  }

  dismissFeedback(): void {
    this.httpFeedback.clear();
  }


  @HostListener('document:click')
  handleDocumentClick(): void {
    this.isMeMenuOpen = false;
    this.isSearchMenuOpen = false;
    this.isMobileNavOpen = false;
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.isMeMenuOpen = false;
    this.isSearchMenuOpen = false;
    this.isMobileNavOpen = false;
  }

  @HostListener('document:keydown', ['$event'])
  handleZoomKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    const zoomKeys = new Set(['+', '-', '=', '0']);
    if (zoomKeys.has(event.key) || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
      event.preventDefault();
    }
  }

  @HostListener('document:wheel', ['$event'])
  handleZoomWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  }

  private resetScrollPosition(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }

  private refreshNavbarBadges(userId = this.authService.getUserId()): void {
    if (!this.authService.getToken() || !userId) {
      this.navbarBadgeService.reset();
      return;
    }

    this.navbarBadgeService.refresh(userId);
  }

  private fetchSuggestions(query: string) {
    const trimmedQuery = query.trim();
    const userId = this.authService.getUserId();

    if (!this.isLoggedIn() || !trimmedQuery || !userId) {
      this.isSearchLoading = false;
      return this.searchService.getSuggestions('', userId ?? '');
    }

    this.isSearchLoading = true;
    this.isSearchMenuOpen = true;

    return this.searchService.getSuggestions(trimmedQuery, userId);
  }
}
