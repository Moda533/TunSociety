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
  parentCommentId: string | null;
  authorName: string;
  content: string;
  mentionedUserIds: string[];
  replies: PostComment[];
  repliesCount: number;
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
  parentCommentId?: string | null;
  mentionedUserIds?: string[];
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
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  title: string;
  detail: string;
  isRead: boolean;
  createdAtUtc: string;
  readAtUtc: string | null;
  relatedPostId: string | null;
  relatedCommentId: string | null;
  relatedReplyId: string | null;
  relatedGroupConversationId: string | null;
  imageUrl: string | null;
}

export interface NavbarBadgeSummary {
  unreadNotificationsCount: number;
  hasUnreadMessages: boolean;
  hasPendingFriendRequests: boolean;
}

export interface MarkNotificationReadRequest {
  userId: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  conversationType: ConversationType;
  senderUserId: string;
  senderName: string;
  recipientUserId: string;
  recipientName: string;
  content: string;
  createdAtUtc: string;
  isRead: boolean;
}

export type ConversationType = 'Private' | 'Group';

export interface GroupConversationMember {
  userId: string;
  displayName: string;
  role: string;
  status: string;
  avatarUrl: string | null;
  isCurrentUser: boolean;
  joinedAtUtc: string;
}

export interface Conversation {
  conversationId: string;
  conversationType: ConversationType;
  partnerUserId: string;
  partnerName: string;
  partnerRole: string;
  avatarUrl: string | null;
  groupIntroduction: string | null;
  groupNotice: string | null;
  createRoomPermission: string;
  inviteCode: string | null;
  currentUserRole: string | null;
  currentUserMembershipStatus: string | null;
  currentUserCanEditGroup: boolean;
  currentUserCanManageMembers: boolean;
  currentUserCanDeleteGroup: boolean;
  isMuted: boolean;
  isPinned: boolean;
  partnerLastVisibleMessageId: string | null;
  lastMessageAtUtc: string;
  isPartnerOnline: boolean;
  isArchived: boolean;
  memberCount: number;
  unreadCount: number;
  members: GroupConversationMember[];
  messages: DirectMessage[];
}

export interface SendDirectMessageRequest {
  senderUserId: string;
  recipientUserId: string;
  content: string;
}

export interface CreateGroupConversationRequest {
  creatorUserId: string;
  name: string;
  avatarUrl?: string | null;
  memberUserIds: string[];
}

export interface SendGroupMessageRequest {
  senderUserId: string;
  content: string;
}

export interface UpdateGroupProfileRequest {
  actorUserId: string;
  name: string;
  avatarUrl?: string | null;
  introduction?: string | null;
  notice?: string | null;
}

export interface AddGroupMembersRequest {
  actorUserId: string;
  memberUserIds: string[];
}

export interface UpdateGroupMemberRoleRequest {
  actorUserId: string;
  role: 'Admin' | 'Moderator' | 'Member';
}

export interface RemoveGroupMemberRequest {
  actorUserId: string;
}

export interface UpdateGroupMembershipRequest {
  userId: string;
}

export interface UpdateGroupPreferencesRequest {
  userId: string;
  isMuted?: boolean;
  isPinned?: boolean;
}

export interface UpdateGroupCreateRoomPermissionRequest {
  actorUserId: string;
  createRoomPermission: 'AdminsOnly' | 'AdminsAndModerators' | 'AllMembers';
}

export interface ClearGroupChatRequest {
  userId: string;
}

export interface DeleteGroupConversationRequest {
  actorUserId: string;
}

export type EventParticipationStatus = 'Going' | 'Interested' | 'GoingInterested';

export interface EventParticipant {
  userId: string;
  displayName: string;
  role: string;
  status: EventParticipationStatus;
  updatedAtUtc: string;
}

export interface EventComment {
  id: string;
  userId: string;
  authorName: string;
  content: string;
  createdAtUtc: string;
}

export interface CommunityEvent {
  id: string;
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  title: string;
  description: string;
  startsAtUtc: string;
  location: string;
  imageUrl: string | null;
  chatConversationId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string | null;
  myStatus: EventParticipationStatus | null;
  goingCount: number;
  interestedCount: number;
  commentsCount: number;
  averageRating: number | null;
  evaluationCount: number;
  myRating: number | null;
  participants: EventParticipant[];
  comments: EventComment[];
}

export interface CreateEventRequest {
  userId: string;
  title: string;
  description: string;
  startsAtUtc: string;
  location: string;
  image?: File | null;
  removeImage?: boolean;
}

export interface UpdateEventRequest extends CreateEventRequest {}

export interface UpdateEventParticipationRequest {
  userId: string;
  status: 'Going' | 'Interested' | 'None';
}

export interface CreateEventCommentRequest {
  userId: string;
  content: string;
}

export interface CreateEventEvaluationRequest {
  userId: string;
  rating: number;
  feedback?: string | null;
}
