export interface CreateMessageRequest {
  userId: string;
  content: string;
}

export interface MessageResponse {
  id: string;
  userId: string;
  content: string;
  score: number;
  status: string;
  createdAtUtc: string;
}
