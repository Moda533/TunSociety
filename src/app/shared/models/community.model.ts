export type PostVisibility = 'Public' | 'OnlyFriends' | 'Private';
export type ReactionType = 'like' | 'insightful' | 'support';

export interface PostReactionSummary {
  like: number;
  insightful: number;
  support: number;
  myReaction: ReactionType | null;
}

export interface PostComment {
  id: string;
  userId: string;
  authorName: string;
  content: string;
  createdAtUtc: string;
}

export interface CommunityPost {
  id: string;
  userId: string;
  authorName: string;
  roleLabel: string;
  title: string;
  content: string;
  imageUrl: string | null;
  visibility: PostVisibility;
  createdAtUtc: string;
  updatedAtUtc: string | null;
  reactions: PostReactionSummary;
  comments: PostComment[];
}

export interface CreatePostRequest {
  userId: string;
  title: string;
  content: string;
  imageUrl?: string | null;
  visibility: PostVisibility;
}

export interface UpdatePostRequest {
  userId: string;
  title: string;
  content: string;
  imageUrl?: string | null;
  visibility: PostVisibility;
}

export interface DeletePostRequest {
  userId: string;
}

export interface CreateCommentRequest {
  userId: string;
  content: string;
}

export interface ReactToPostRequest {
  userId: string;
  reactionType: ReactionType;
}

export interface FriendRequest {
  id: string;
  requesterUserId: string;
  requesterDisplayName: string;
  requesterEmail: string;
  recipientUserId: string;
  recipientDisplayName: string;
  status: 'Pending' | 'Accepted' | 'Declined';
  note: string | null;
  createdAtUtc: string;
  updatedAtUtc: string | null;
}

export interface CreateFriendRequestRequest {
  requesterUserId: string;
  recipientUserId: string;
  note?: string | null;
}

export interface UpdateFriendRequestStatusRequest {
  actorUserId: string;
  status: 'Accepted' | 'Declined';
}

export interface CommunityNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  detail: string;
  isRead: boolean;
  createdAtUtc: string;
  readAtUtc: string | null;
}

export interface MarkNotificationReadRequest {
  userId: string;
}

export interface DirectMessage {
  id: string;
  senderUserId: string;
  senderName: string;
  recipientUserId: string;
  recipientName: string;
  content: string;
  createdAtUtc: string;
  isRead: boolean;
}

export interface Conversation {
  partnerUserId: string;
  partnerName: string;
  partnerRole: string;
  partnerLastVisibleMessageId: string | null;
  lastMessageAtUtc: string;
  isPartnerOnline: boolean;
  unreadCount: number;
  messages: DirectMessage[];
}

export interface SendDirectMessageRequest {
  senderUserId: string;
  recipientUserId: string;
  content: string;
}
