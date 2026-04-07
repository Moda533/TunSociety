import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { SearchService } from '../../../../core/services/search.service';
import { CommunityPost } from '../../../../shared/models/community.model';
import { SearchResults, SearchScope } from '../../../../shared/models/search.model';
import { UserLookup } from '../../../../shared/models/user.model';

type SearchTabKey = SearchScope;

type SearchTab = {
  key: SearchTabKey;
  label: string;
};

type RecentSearch = {
  query: string;
  label: string;
  scope: SearchTabKey;
};

type TrendingItem = {
  tag: string;
  count: string;
};

type TagResult = {
  tag: string;
  count: number;
};

@Component({
  selector: 'app-search-page',
  standalone: false,
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss']
})
export class SearchPageComponent implements OnInit, OnDestroy {
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly tabs: SearchTab[] = [
    { key: 'all', label: 'All' },
    { key: 'users', label: 'People' },
    { key: 'posts', label: 'Posts' },
    { key: 'events', label: 'Tags' }
  ];

  readonly trendingNow: TrendingItem[] = [
    { tag: '#Technology', count: '234K posts' },
    { tag: '#Photography', count: '128K posts' },
    { tag: '#RemoteWork', count: '91K posts' },
    { tag: '#DesignSystems', count: '64K posts' }
  ];

  query = '';
  activeTab: SearchTabKey = 'all';
  results: SearchResults = {
    query: '',
    users: [],
    posts: [],
    events: []
  };
  recentSearches: RecentSearch[] = this.loadRecentSearches();
  isLoading = false;
  errorMessage = '';

  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 15000;
  private userId: string | null = null;
  private searchRequest?: Subscription;
  private readonly recentSearchesKey = 'ts_recent_searches';
  private readonly fallbackRecentSearches: RecentSearch[] = [
    { query: 'React best practices', label: 'React best practices', scope: 'posts' },
    { query: 'Sarah Anderson', label: 'Sarah Anderson', scope: 'users' },
    { query: '#WebDevelopment', label: '#WebDevelopment', scope: 'events' },
    { query: 'Coffee shops near me', label: 'Coffee shops near me', scope: 'all' }
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly searchService: SearchService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly zone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        this.userId = user?.id ?? null;
        if (!user && this.authService.getToken()) {
          this.authService.syncCurrentUser().subscribe();
        }

        if (this.query) {
          this.runSearch(this.query);
        }
      })
    );

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = (params.get('query') ?? '').trim();
        const nextTab = this.normalizeTab(params.get('scope'));

        this.updateView(() => {
          this.query = nextQuery;
          this.activeTab = nextTab;
          this.searchControl.setValue(nextQuery, { emitEvent: false });
          this.errorMessage = '';
        });

        if (nextQuery) {
          this.runSearch(nextQuery);
        } else {
          this.clearResults();
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }

    this.subscriptions.add(
      interval(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.runSearch(this.query, true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.searchRequest?.unsubscribe();
  }

  get hasQuery(): boolean {
    return this.query.trim().length > 0;
  }

  get resultCountSummary(): string {
    if (!this.hasQuery) {
      return 'Search for people, posts, and tags across the community.';
    }

    const total = this.results.users.length + this.results.posts.length + this.derivedTags.length;
    return `${total} result${total === 1 ? '' : 's'} for "${this.query}".`;
  }

  get visibleUsers(): UserLookup[] {
    if (this.activeTab === 'users') {
      return this.results.users;
    }

    return this.results.users.slice(0, 3);
  }

  get visiblePosts(): CommunityPost[] {
    if (this.activeTab === 'posts') {
      return this.results.posts;
    }

    return this.results.posts.slice(0, 3);
  }

  get derivedTags(): TagResult[] {
    const counts = new Map<string, number>();
    const tagPattern = /#[A-Za-z0-9_]+/g;

    for (const post of this.results.posts) {
      const matchedTags = new Set<string>();
      const text = `${post.title} ${post.content}`;
      const matches = text.match(tagPattern) ?? [];

      for (const tag of matches) {
        matchedTags.add(tag.toLowerCase());
      }

      for (const tag of matchedTags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, 8);
  }

  get visibleTags(): TagResult[] {
    if (this.activeTab === 'events') {
      return this.derivedTags;
    }

    return this.derivedTags.slice(0, 4);
  }

  get showPeopleSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'users';
  }

  get showPostSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'posts';
  }

  get showTagSection(): boolean {
    return this.activeTab === 'all' || this.activeTab === 'events';
  }

  get hasAnyResults(): boolean {
    return this.visibleUsers.length > 0 || this.visiblePosts.length > 0 || this.visibleTags.length > 0;
  }

  selectTab(tab: SearchTabKey): void {
    this.activeTab = tab;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        query: this.query || null,
        scope: tab
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    if (!query) {
      this.updateView(() => {
        this.query = '';
        this.clearResults();
      });
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          query: null,
          scope: this.activeTab
        },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
      return;
    }

    this.runSearch(query);
    this.rememberRecentSearch(query, this.activeTab);

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        query,
        scope: this.activeTab
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  openRecentSearch(recent: RecentSearch): void {
    this.searchControl.setValue(recent.query);
    this.activeTab = recent.scope;
    this.submitSearch();
  }

  runTrendingSearch(tag: TrendingItem): void {
    this.searchControl.setValue(tag.tag);
    this.activeTab = 'posts';
    this.submitSearch();
  }

  removeRecentSearch(index: number): void {
    this.recentSearches = this.recentSearches.filter((_, itemIndex) => itemIndex !== index);
    this.persistRecentSearches(this.recentSearches);
  }

  openMember(user: UserLookup): void {
    void this.router.navigate(['/dashboard/members', user.id], {
      queryParams: { query: this.query || null }
    });
  }

  openPost(post: CommunityPost): void {
    void this.router.navigate(['/dashboard/feed'], {
      queryParams: { post: post.id }
    });
  }

  getUserAvatarUrl(user: UserLookup): string {
    return this.avatarDirectory.resolveAvatarUrl(user.id, user.gender);
  }

  getPostAvatarUrl(post: CommunityPost): string {
    return this.avatarDirectory.resolveAvatarUrl(post.userId);
  }

  openTag(tag: TagResult): void {
    this.searchControl.setValue(tag.tag);
    this.activeTab = 'posts';
    this.submitSearch();
  }

  trackByUserId(_: number, user: UserLookup): string {
    return user.id;
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  trackByTag(_: number, tag: TagResult): string {
    return tag.tag;
  }

  trackByRecentSearch(_: number, recent: RecentSearch): string {
    return recent.query;
  }

  trackByTrending(_: number, item: TrendingItem): string {
    return item.tag;
  }

  private runSearch(query: string, silent = false): void {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !this.userId) {
      this.searchRequest?.unsubscribe();
      this.searchRequest = undefined;
      this.clearResults();
      return;
    }

    if (!silent) {
      this.updateView(() => {
        this.isLoading = true;
        this.errorMessage = '';
      });
    }

    this.searchRequest?.unsubscribe();
    this.searchRequest = this.searchService.searchAll(normalizedQuery, this.userId).subscribe({
      next: (results) => {
        this.updateView(() => {
          this.results = results;
          this.query = results.query;
          this.isLoading = false;
          this.searchRequest = undefined;
        });
      },
      error: () => {
        this.updateView(() => {
          if (!silent) {
            this.clearResults();
            this.errorMessage = 'Unable to load search results right now.';
          }
          this.isLoading = false;
          this.searchRequest = undefined;
        });
      }
    });
  }

  private clearResults(): void {
    this.searchRequest?.unsubscribe();
    this.searchRequest = undefined;
    this.results = {
      query: '',
      users: [],
      posts: [],
      events: []
    };
    this.isLoading = false;
  }

  private canPollSilently(): boolean {
    return !document.hidden && !this.isLoading && !this.searchRequest && this.hasQuery;
  }

  private normalizeTab(scope: string | null): SearchTabKey {
    return scope === 'users' || scope === 'posts' || scope === 'events' ? scope : 'all';
  }

  private loadRecentSearches(): RecentSearch[] {
    try {
      const raw = localStorage.getItem(this.recentSearchesKey);
      if (!raw) {
        return [...this.fallbackRecentSearches];
      }

      const parsed = JSON.parse(raw) as RecentSearch[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return [...this.fallbackRecentSearches];
      }

      return parsed
        .filter((item) => typeof item.query === 'string' && item.query.trim().length > 0)
        .slice(0, 5);
    } catch {
      return [...this.fallbackRecentSearches];
    }
  }

  private rememberRecentSearch(query: string, scope: SearchTabKey): void {
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return;
    }

    const nextEntry: RecentSearch = {
      query: cleanedQuery,
      label: cleanedQuery,
      scope
    };

    const nextRecentSearches = [
      nextEntry,
      ...this.recentSearches.filter((item) => item.query.toLowerCase() !== cleanedQuery.toLowerCase())
    ].slice(0, 5);

    this.recentSearches = nextRecentSearches;
    this.persistRecentSearches(nextRecentSearches);
  }

  private persistRecentSearches(recentSearches: RecentSearch[]): void {
    try {
      localStorage.setItem(this.recentSearchesKey, JSON.stringify(recentSearches));
    } catch {
      // Ignore storage failures and keep the in-memory list functional.
    }
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }
}
