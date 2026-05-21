import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/+$/, '');

  constructor(private readonly http: HttpClient) {}

  get<T>(path: string) {
    return this.http.get<T>(this.buildUrl(path));
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(this.buildUrl(path), body);
  }

  postJson<T>(path: string, body: unknown) {
    return this.http.post<T>(this.buildUrl(path), body, {
      headers: new HttpHeaders({
        'Content-Type': 'application/json'
      })
    });
  }

  put<T>(path: string, body: unknown) {
    return this.http.put<T>(this.buildUrl(path), body);
  }

  delete<T>(path: string, body?: unknown) {
    return this.http.delete<T>(this.buildUrl(path), body === undefined ? {} : { body });
  }

  private buildUrl(path: string) {
    const normalized = path.replace(/^\/+/, '');
    return `${this.baseUrl}/${normalized}`;
  }
}
