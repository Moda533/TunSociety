import { User } from '../../user/models/user.model';

export interface RegisterRequest {
  email: string;
  fullName: string;
  gender: string;
  age: number;
  password: string;
  confirmPassword: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
