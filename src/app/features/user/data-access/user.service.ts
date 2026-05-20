import { Injectable } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { UpdateUserRequest, User, UserLookup } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private readonly api: ApiService) {}

  getById(userId: string) {
    return this.api.get<User>(`users/${userId}`);
  }

  getLookupById(userId: string) {
    return this.api.get<UserLookup>(`users/${userId}/lookup`);
  }

  update(userId: string, payload: UpdateUserRequest) {
    return this.api.put<User>(`users/${userId}`, payload);
  }

  uploadAvatar(avatar: File) {
    const formData = new FormData();
    formData.append('avatar', avatar);
    return this.api.post<User>('users/me/avatar', formData);
  }

  search(query: string, take = 20) {
    const encodedQuery = encodeURIComponent(query.trim());
    return this.api.get<UserLookup[]>(`users/search?query=${encodedQuery}&take=${take}`);
  }
}
