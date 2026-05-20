import { Injectable } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import {
  CommunityNotification,
  CommunityEvent,
  CommunityPost,
  Conversation,
  AddGroupMembersRequest,
  ClearGroupChatRequest,
  CreateEventCommentRequest,
  CreateEventEvaluationRequest,
  CreateEventRequest,
  CreateCommentRequest,
  CreateFriendRequestRequest,
  CreateGroupConversationRequest,
  CreatePostRequest,
  DeletePostRequest,
  FriendRequest,
  MarkNotificationReadRequest,
  NavbarBadgeSummary,
  ReactToPostRequest,
  DirectMessage,
  DeleteGroupConversationRequest,
  RemoveGroupMemberRequest,
  SendDirectMessageRequest,
  SendGroupMessageRequest,
  UpdateGroupCreateRoomPermissionRequest,
  UpdateEventParticipationRequest,
  UpdateFriendRequestStatusRequest,
  UpdateEventRequest,
  UpdateGroupMemberRoleRequest,
  UpdateGroupMembershipRequest,
  UpdateGroupPreferencesRequest,
  UpdateGroupProfileRequest,
  UpdatePostRequest
} from '../models/community.model';
import { SubmissionResult } from '../../moderation/models/moderation.model';

@Injectable({ providedIn: 'root' })
export class CommunityService {
  constructor(private readonly api: ApiService) {}

  getPosts(userId: string, take = 30) {
    return this.api.get<CommunityPost[]>(`posts?userId=${userId}&take=${take}`);
  }

  getEvents(userId: string, take = 30) {
    return this.api.get<CommunityEvent[]>(`events?userId=${userId}&take=${take}`);
  }

  getEvent(eventId: string, userId: string) {
    return this.api.get<CommunityEvent>(`events/${eventId}?userId=${userId}`);
  }

  createEvent(payload: CreateEventRequest) {
    return this.api.post<SubmissionResult<CommunityEvent>>('events', this.buildEventFormData(payload));
  }

  updateEvent(eventId: string, payload: UpdateEventRequest) {
    return this.api.put<SubmissionResult<CommunityEvent>>(`events/${eventId}`, this.buildEventFormData(payload));
  }

  deleteEvent(eventId: string, userId: string) {
    return this.api.delete<void>(`events/${eventId}?userId=${userId}`);
  }

  updateEventParticipation(eventId: string, payload: UpdateEventParticipationRequest) {
    return this.api.post<CommunityEvent>(`events/${eventId}/participation`, payload);
  }

  addEventComment(eventId: string, payload: CreateEventCommentRequest) {
    return this.api.post<SubmissionResult<CommunityEvent>>(`events/${eventId}/comments`, payload);
  }

  evaluateEvent(eventId: string, payload: CreateEventEvaluationRequest) {
    return this.api.post<CommunityEvent>(`events/${eventId}/evaluations`, payload);
  }

  getPost(postId: string, userId: string) {
    return this.api.get<CommunityPost>(`posts/${postId}?userId=${userId}`);
  }

  createPost(payload: CreatePostRequest) {
    return this.api.post<SubmissionResult<CommunityPost>>('posts', payload);
  }

  updatePost(postId: string, payload: UpdatePostRequest) {
    return this.api.put<SubmissionResult<CommunityPost>>(`posts/${postId}`, payload);
  }

  deletePost(postId: string, payload: DeletePostRequest) {
    return this.api.delete<void>(`posts/${postId}?userId=${payload.userId}`, payload);
  }

  addComment(postId: string, payload: CreateCommentRequest) {
    return this.api.post<SubmissionResult<CommunityPost>>(`posts/${postId}/comments`, payload);
  }

  reactToPost(postId: string, payload: ReactToPostRequest) {
    return this.api.post<CommunityPost>(`posts/${postId}/reactions`, payload);
  }

  getFriendRequests(userId: string) {
    return this.api.get<FriendRequest[]>(`friendrequests?userId=${userId}`);
  }

  createFriendRequest(payload: CreateFriendRequestRequest) {
    return this.api.post<SubmissionResult<FriendRequest>>('friendrequests', payload);
  }

  cancelFriendRequest(requestId: string) {
    return this.api.delete<void>(`friendrequests/${requestId}`);
  }

  updateFriendRequestStatus(requestId: string, payload: UpdateFriendRequestStatusRequest) {
    return this.api.post<FriendRequest>(`friendrequests/${requestId}/status`, payload);
  }

  getNotifications(userId: string, includeRead = true, take = 100) {
    return this.api.get<CommunityNotification[]>(
      `notifications?userId=${userId}&includeRead=${includeRead}&take=${take}`
    );
  }

  markNotificationRead(notificationId: string, payload: MarkNotificationReadRequest) {
    return this.api.post<CommunityNotification>(`notifications/${notificationId}/read`, payload);
  }

  markAllNotificationsRead(userId: string) {
    return this.api.post<{ updated: number }>('notifications/read-all', { userId });
  }

  getNavbarBadges(userId: string) {
    return this.api.get<NavbarBadgeSummary>(`navbar/badges?userId=${userId}`);
  }

  getConversations(userId: string, messageLimit = 80, includeArchived = false) {
    return this.api.get<Conversation[]>(
      `directmessages/conversations?userId=${userId}&messageLimit=${messageLimit}&includeArchived=${includeArchived}`
    );
  }

  sendDirectMessage(payload: SendDirectMessageRequest) {
    return this.api.post<SubmissionResult<DirectMessage>>('directmessages', payload);
  }

  createGroupConversation(payload: CreateGroupConversationRequest) {
    return this.api.post<Conversation>('directmessages/groups', payload);
  }

  getGroupConversation(conversationId: string, userId: string, messageLimit = 120) {
    return this.api.get<Conversation>(
      `directmessages/groups/${conversationId}?userId=${userId}&messageLimit=${messageLimit}`
    );
  }

  updateGroupProfile(conversationId: string, payload: UpdateGroupProfileRequest) {
    return this.api.put<Conversation>(`directmessages/groups/${conversationId}/profile`, payload);
  }

  uploadGroupAvatar(conversationId: string, actorUserId: string, avatar: File) {
    const formData = new FormData();
    formData.append('actorUserId', actorUserId);
    formData.append('avatar', avatar);
    return this.api.post<Conversation>(`directmessages/groups/${conversationId}/avatar`, formData);
  }

  addGroupMembers(conversationId: string, payload: AddGroupMembersRequest) {
    return this.api.post<Conversation>(`directmessages/groups/${conversationId}/members`, payload);
  }

  updateGroupMemberRole(conversationId: string, memberUserId: string, payload: UpdateGroupMemberRoleRequest) {
    return this.api.post<Conversation>(
      `directmessages/groups/${conversationId}/members/${memberUserId}/role`,
      payload
    );
  }

  removeGroupMember(conversationId: string, memberUserId: string, payload: RemoveGroupMemberRequest) {
    return this.api.post<Conversation>(
      `directmessages/groups/${conversationId}/members/${memberUserId}/remove`,
      payload
    );
  }

  acceptGroupMembership(conversationId: string, payload: UpdateGroupMembershipRequest) {
    return this.api.post<Conversation>(`directmessages/groups/${conversationId}/membership/accept`, payload);
  }

  leaveGroupConversation(conversationId: string, payload: UpdateGroupMembershipRequest) {
    return this.api.post<{ updated: number }>(`directmessages/groups/${conversationId}/membership/leave`, payload);
  }

  updateGroupPreferences(conversationId: string, payload: UpdateGroupPreferencesRequest) {
    return this.api.post<Conversation>(`directmessages/groups/${conversationId}/preferences`, payload);
  }

  updateGroupCreateRoomPermission(conversationId: string, payload: UpdateGroupCreateRoomPermissionRequest) {
    return this.api.post<Conversation>(
      `directmessages/groups/${conversationId}/create-room-permission`,
      payload
    );
  }

  clearGroupChatHistory(conversationId: string, payload: ClearGroupChatRequest) {
    return this.api.post<Conversation>(`directmessages/groups/${conversationId}/clear-history`, payload);
  }

  deleteGroupConversation(conversationId: string, payload: DeleteGroupConversationRequest) {
    return this.api.post<{ deleted: boolean }>(`directmessages/groups/${conversationId}/delete`, payload);
  }

  sendGroupMessage(conversationId: string, payload: SendGroupMessageRequest) {
    return this.api.post<SubmissionResult<DirectMessage>>(`directmessages/groups/${conversationId}/messages`, payload);
  }

  markGroupConversationRead(userId: string, conversationId: string) {
    return this.api.post<{ updated: number; lastVisibleMessageId: string | null }>(
      `directmessages/groups/${conversationId}/read`,
      { userId }
    );
  }

  archiveConversation(userId: string, conversationId: string, isArchived: boolean) {
    return this.api.post<{ updated: number; isArchived?: boolean }>(
      `directmessages/conversations/${conversationId}/archive`,
      { userId, isArchived }
    );
  }

  updateConversationReadCursor(userId: string, partnerUserId: string, lastVisibleMessageId: string) {
    return this.api.post<{ updated: number; lastVisibleMessageId: string | null }>(
      `directmessages/conversations/${partnerUserId}/cursor`,
      {
        userId,
        lastVisibleMessageId
      }
    );
  }

  markConversationRead(userId: string, partnerUserId: string) {
    return this.api.post<{ updated: number }>(`directmessages/conversations/${partnerUserId}/read`, { userId });
  }

  private buildEventFormData(payload: CreateEventRequest | UpdateEventRequest): FormData {
    const formData = new FormData();
    formData.append('userId', payload.userId);
    formData.append('title', payload.title);
    formData.append('description', payload.description);
    formData.append('startsAtUtc', payload.startsAtUtc);
    formData.append('location', payload.location);
    formData.append('removeImage', payload.removeImage ? 'true' : 'false');

    if (payload.image) {
      formData.append('image', payload.image, payload.image.name);
    }

    return formData;
  }
}
