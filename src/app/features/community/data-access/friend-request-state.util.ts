import { FriendRequest } from '../models/community.model';

export type FriendRequestActionKind = 'add' | 'cancel' | 'pending' | 'friends' | 'declined';

export interface FriendRequestActionState {
  label: string;
  kind: FriendRequestActionKind;
  disabled: boolean;
  requestId: string | null;
}

export function resolveFriendRequestActionState(
  currentUserId: string | null,
  counterpartUserId: string,
  requests: FriendRequest[]
): FriendRequestActionState {
  if (!currentUserId) {
    return {
      label: 'Add',
      kind: 'add',
      disabled: true,
      requestId: null
    };
  }

  if (currentUserId === counterpartUserId) {
    return {
      label: 'You',
      kind: 'friends',
      disabled: true,
      requestId: null
    };
  }

  const request = requests.find((item) =>
    (item.requesterUserId === currentUserId && item.recipientUserId === counterpartUserId) ||
    (item.requesterUserId === counterpartUserId && item.recipientUserId === currentUserId)
  );

  if (!request) {
    return {
      label: 'Add',
      kind: 'add',
      disabled: false,
      requestId: null
    };
  }

  if (request.status === 'Pending') {
    if (request.requesterUserId === currentUserId) {
      return {
        label: 'Cancel',
        kind: 'cancel',
        disabled: false,
        requestId: request.id
      };
    }

    return {
      label: 'Pending',
      kind: 'pending',
      disabled: true,
      requestId: request.id
    };
  }

  if (request.status === 'Accepted') {
    return {
      label: 'Friends',
      kind: 'friends',
      disabled: true,
      requestId: request.id
    };
  }

  return {
    label: 'Declined',
    kind: 'declined',
    disabled: true,
    requestId: request.id
  };
}
