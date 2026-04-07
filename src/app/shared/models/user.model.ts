export interface User {
  id: string;
  userName: string;
  email: string;
  displayName: string;
  gender: string;
  age: number | null;
  avatarUrl: string;
  role: string;
  isFrozen: boolean;
}

export interface UpdateUserRequest {
  displayName?: string;
  email?: string;
  newPassword?: string;
  confirmPassword?: string;
  avatarUrl?: string;
  role?: string;
}

export interface UserLookup {
  id: string;
  displayName: string;
  email: string;
  gender: string;
  age: number | null;
  avatarUrl: string;
  role: string;
}
