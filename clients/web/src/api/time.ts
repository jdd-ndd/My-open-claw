import { httpClient } from './http';

export interface ServerTimeResponse {
  serverTime: string;
  serverTimestamp: number;
}

export async function fetchServerTime(): Promise<ServerTimeResponse> {
  return httpClient.get('/time') as Promise<ServerTimeResponse>;
}
