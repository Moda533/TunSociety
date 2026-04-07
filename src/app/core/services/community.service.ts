import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import {
  CommunityNotification,
  CommunityPost,
  Conversation,
  CreateCommentRequest,
  CreateFriendRequestRequest,
  CreatePostRequest,
  DeletePostRequest,
  FriendRequest,
  MarkNotificationReadRequest,
  ReactToPostRequest,
  DirectMessage,
  SendDirectMessageRequest,
  UpdateFriendRequestStatusRequest,
  UpdatePostRequest
} from '../../shared/models/community.model';
import { SubmissionResult } from '../../shared/models/moderation.model';

@Injectable({ providedIn: 'root' })
export class CommunityService {
  constructor(private readonly api: ApiService) {}

  getPosts(userId: string, take = 30) {
    return this.api.get<CommunityPost[]>(`posts?userId=${userId}&take=${take}`);
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

  getConversations(userId: string, messageLimit = 80) {
    return this.api.get<Conversation[]>(`directmessages/conversations?userId=${userId}&messageLimit=${messageLimit}`);
  }

  sendDirectMessage(payload: SendDirectMessageRequest) {
    return this.api.post<SubmissionResult<DirectMessage>>('directmessages', payload);
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
}
