import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import {
  EMPTY_NAVBAR_BADGES,
  NavbarBadgeService
} from '../../../community/data-access/navbar-badge.service';
import { NavbarBadgeSummary } from '../../../community/models/community.model';

@Component({
  selector: 'app-user-dashboard',
  standalone: false,
  templateUrl: './user-dashboard.component.html',
  styleUrls: ['./user-dashboard.component.scss']
})
export class UserDashboardComponent implements OnInit, OnDestroy {
  @ViewChild('dashboardSearchInput') private dashboardSearchInput?: ElementRef<HTMLInputElement>;

  readonly searchControl = new FormControl('', { nonNullable: true });
  badgeSummary: NavbarBadgeSummary = EMPTY_NAVBAR_BADGES;
  pullDistance = 0;
  pullProgress = 0;
  isPullRefreshing = false;
  isAccountMenuOpen = false;
  isMobileNavOpen = false;
  isSearchOpen = false;

  private readonly pullThreshold = 92;
  private readonly pullMax = 132;
  private pullStartY = 0;
  private isPullTracking = false;
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly authService: AuthService,
    private readonly navbarBadgeService: NavbarBadgeService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.navbarBadgeService.badges$.subscribe((badges) => {
        this.badgeSummary = badges;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  currentUserName(): string {
    const user = this.authService.getCurrentUser();
    return user?.displayName || user?.userName || 'Member';
  }

  currentUserRole(): string {
    return this.authService.getCurrentUser()?.role || 'User';
  }

  currentUserAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  canOpenModeration(): boolean {
    return this.authService.canAccessModerationWorkspace();
  }

  canOpenAdmin(): boolean {
    return this.authService.canAccessAdminWorkspace();
  }

  get pullIndicatorTransform(): string {
    const offset = this.isPullRefreshing ? 66 : this.pullDistance;
    return `translate3d(-50%, ${offset}px, 0) rotate(${this.pullProgress * 360}deg)`;
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    this.isSearchOpen = false;

    if (!query) {
      void this.router.navigate(['/dashboard/search'], {
        queryParams: { scope: 'all' }
      });
      return;
    }

    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query,
        scope: 'all'
      }
    });
  }

  clearSearch(): void {
    if (!this.searchControl.value.trim()) {
      return;
    }

    this.searchControl.setValue('');
    this.submitSearch();
  }

  logout(): void {
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.navbarBadgeService.reset();
    this.authService.logout();
    void this.router.navigate(['/auth']);
  }

  toggleAccountMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  closeAccountMenu(): void {
    this.isAccountMenuOpen = false;
  }

  onAccountMenuContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  toggleMobileNav(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isSearchOpen = false;
    this.isMobileNavOpen = !this.isMobileNavOpen;
  }

  closeMobileNav(): void {
    this.isMobileNavOpen = false;
  }

  toggleSearch(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = !this.isSearchOpen;

    if (this.isSearchOpen && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        this.dashboardSearchInput?.nativeElement.focus();
      });
    }
  }

  onSearchContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  get currentUserInitials(): string {
    const source = this.currentUserName();
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  }

  get currentUserStatus(): string {
    return this.authService.getCurrentUser()?.isFrozen ? 'Frozen' : 'Active';
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }

  @HostListener('window:touchstart', ['$event'])
  handlePullStart(event: TouchEvent): void {
    if (this.isPullRefreshing || event.touches.length !== 1 || window.scrollY > 0) {
      return;
    }

    this.pullStartY = event.touches[0].clientY;
    this.isPullTracking = true;
  }

  @HostListener('window:touchmove', ['$event'])
  handlePullMove(event: TouchEvent): void {
    if (!this.isPullTracking || event.touches.length !== 1) {
      return;
    }

    if (window.scrollY > 0) {
      this.resetPullState();
      return;
    }

    const rawDistance = event.touches[0].clientY - this.pullStartY;
    if (rawDistance <= 0) {
      this.resetPullState();
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    this.pullDistance = Math.min(this.pullMax, rawDistance * 0.58);
    this.pullProgress = Math.min(1, this.pullDistance / this.pullThreshold);
  }

  @HostListener('window:touchend')
  @HostListener('window:touchcancel')
  handlePullEnd(): void {
    if (!this.isPullTracking) {
      return;
    }

    const shouldRefresh = this.pullProgress >= 1;
    this.isPullTracking = false;

    if (!shouldRefresh) {
      this.resetPullState();
      return;
    }

    this.isPullRefreshing = true;
    this.pullDistance = 66;
    this.pullProgress = 1;
    window.dispatchEvent(new CustomEvent('tunSocietyPullRefresh'));
    this.navbarBadgeService.refresh(this.authService.getUserId());

    window.setTimeout(() => {
      this.isPullRefreshing = false;
      this.resetPullState();
    }, 850);
  }

  private resetPullState(): void {
    this.isPullTracking = false;
    this.pullDistance = 0;
    this.pullProgress = 0;
  }
}
