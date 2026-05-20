import { CommunityPost } from './community.model';
import { UserLookup } from '../../user/models/user.model';

export type SearchScope = 'all' | 'users' | 'posts' | 'events';

export interface SearchEventResult {
  id: string;
  title: string;
  detail: string;
  startsAt: string | null;
  location: string | null;
}

export interface SearchPageResult {
  id: string;
  name: string;
  category: string;
  followersCount: number;
  imageUrl: string | null;
  headline?: string | null;
  isVerified?: boolean;
}

export interface SearchResults {
  query: string;
  users: UserLookup[];
  posts: CommunityPost[];
  photos: CommunityPost[];
  pages: SearchPageResult[];
  events: SearchEventResult[];
}

export type SearchSuggestionKind = 'user' | 'post' | 'event';

export interface SearchSuggestion {
  id: string;
  kind: SearchSuggestionKind;
  title: string;
  subtitle: string;
  meta?: string;
}
