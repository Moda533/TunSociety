import { CommunityPost } from './community.model';
import { UserLookup } from './user.model';

export type SearchScope = 'all' | 'users' | 'posts' | 'events';

export interface SearchEventResult {
  id: string;
  title: string;
  detail: string;
  startsAt: string | null;
  location: string | null;
}

export interface SearchResults {
  query: string;
  users: UserLookup[];
  posts: CommunityPost[];
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
