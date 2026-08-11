import axios, { type AxiosInstance } from 'axios';

interface HttpClientConfig {
  baseURL: string;
  timeout?: number;
}

export function createHttpClient(config: HttpClientConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout || 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use(
    (cfg) => cfg,
    (error) => Promise.reject(error),
  );

  // 响应拦截器：直接解包到业务数据层（axios response -> body -> data）
  // 下游调用者直接断言为业务类型，无需再访问 .data
  client.interceptors.response.use(
    (response) => response.data?.data ?? response.data,
    (error) => {
      const message = error.response?.data?.message || error.message || '网络请求失败';
      return Promise.reject(new Error(message));
    },
  );

  return client;
}

export async function uploadFile(
  client: AxiosInstance,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ url: string; name: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total && onProgress) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent);
      }
    },
  });

  return response as unknown as { url: string; name: string; size: number };
}

export const httpClient = createHttpClient({
  baseURL: '/api',
});
