import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { CommunityService } from './community.service';
import { UserAvatarDirectoryService } from '../../../core/services/user-avatar-directory.service';
import { UserService } from '../../user/data-access/user.service';
import {
  SearchEventResult,
  SearchPageResult,
  SearchResults,
  SearchSuggestion
} from '../models/search.model';
import { CommunityPost } from '../models/community.model';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly eventCatalog: SearchEventResult[] = [];

  constructor(
    private readonly userService: UserService,
    private readonly communityService: CommunityService,
    private readonly avatarDirectory: UserAvatarDirectoryService
  ) {}

  searchAll(query: string, userId: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return of<SearchResults>({
        query: '',
        users: [],
        posts: [],
        photos: [],
        pages: [],
        events: []
      });
    }

    const posts$ = this.getPosts(userId).pipe(
      switchMap((posts) => this.avatarDirectory.ensureUsers(this.collectPostAuthorIds(posts)).pipe(map(() => posts))),
      shareReplay(1)
    );

    return forkJoin({
      users: this.userService.search(normalizedQuery, 24).pipe(
        tap((users) => this.avatarDirectory.seedUsers(users)),
        catchError(() => of([]))
      ),
      posts: posts$.pipe(
        map((posts) => this.filterPosts(posts, normalizedQuery).slice(0, 24)),
        catchError(() => of([]))
      ),
      photos: posts$.pipe(
        map((posts) => this.filterPhotos(posts, normalizedQuery).slice(0, 24)),
        catchError(() => of([]))
      ),
      pages: of<SearchPageResult[]>([]),
      events: of(this.filterEvents(normalizedQuery))
    }).pipe(
      map(({ users, posts, photos, pages, events }) => ({
        query: normalizedQuery,
        users,
        posts,
        photos,
        pages,
        events
      }))
    );
  }

  getSuggestions(query: string, userId: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return of<SearchSuggestion[]>([]);
    }

    return forkJoin({
      users: this.userService.search(normalizedQuery, 5).pipe(
        tap((users) => this.avatarDirectory.seedUsers(users)),
        catchError(() => of([]))
      ),
      posts: this.getPosts(userId).pipe(
        switchMap((posts) => this.avatarDirectory.ensureUsers(this.collectPostAuthorIds(posts)).pipe(map(() => posts))),
        map((posts) => this.filterPosts(posts, normalizedQuery).slice(0, 4)),
        catchError(() => of([]))
      ),
      events: of(this.filterEvents(normalizedQuery).slice(0, 3))
    }).pipe(
      map(({ users, posts, events }) => [
        ...users.map((user) => ({
          id: user.id,
          kind: 'user' as const,
          title: user.displayName,
          subtitle: user.role,
          meta: user.email
        })),
        ...posts.map((post) => ({
          id: post.id,
          kind: 'post' as const,
          title: this.summarizePostContent(post.content),
          subtitle: post.authorName,
          meta: post.content
        })),
        ...events.map((event) => ({
          id: event.id,
          kind: 'event' as const,
          title: event.title,
          subtitle: event.location ?? 'Event',
          meta: event.detail
        }))
      ])
    );
  }

  private getPosts(userId: string) {
    return this.communityService.getPosts(userId, 100);
  }

  private filterPosts(posts: CommunityPost[], query: string) {
    const normalizedQuery = query.toLowerCase();
    return posts.filter((post) =>
      post.authorName.toLowerCase().includes(normalizedQuery) ||
      post.content.toLowerCase().includes(normalizedQuery)
    );
  }

  private filterPhotos(posts: CommunityPost[], query: string) {
    const normalizedQuery = query.toLowerCase();
    return posts.filter((post) =>
      !!post.imageUrl &&
      (
        post.authorName.toLowerCase().includes(normalizedQuery) ||
        post.content.toLowerCase().includes(normalizedQuery)
      )
    );
  }

  private collectPostAuthorIds(posts: CommunityPost[]): string[] {
    return Array.from(new Set(posts.flatMap((post) => [
      post.userId,
      ...post.comments.map((comment) => comment.userId)
    ])));
  }

  private filterEvents(query: string) {
    const normalizedQuery = query.toLowerCase();
    return this.eventCatalog.filter((event) =>
      event.title.toLowerCase().includes(normalizedQuery) ||
      event.detail.toLowerCase().includes(normalizedQuery) ||
      (event.location ?? '').toLowerCase().includes(normalizedQuery)
    );
  }

  private summarizePostContent(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return 'Post';
    }

    return normalized.length > 70 ? `${normalized.slice(0, 67).trim()}...` : normalized;
  }
}
