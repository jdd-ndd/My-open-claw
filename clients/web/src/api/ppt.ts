/**
 * PPT 制作 API 模块
 *
 * 封装服务端 /api/ppt/* 端点，供 Web 工作台 PptStudio 调用。
 * 与 skills.ts 风格一致：使用 httpClient 拦截器，自动解包 { ok, data } 响应。
 */
import { httpClient } from './http';

/** 主题元数据 */
export interface ThemeMeta {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  headerFont: string;
  bodyFont: string;
}

/** 模板元数据 */
export interface TemplateMeta {
  id: string;
  type: 'cover' | 'toc' | 'content' | 'divider' | 'summary';
  name: string;
  description: string;
  schema: Record<string, string>;
}

/** 幻灯片规格 */
export interface SlideSpec {
  template: 'cover' | 'toc' | 'content' | 'divider' | 'summary';
  title: string;
  subtitle?: string;
  data?: Record<string, unknown>;
}

/** PPT 制作请求 */
export interface PptSpec {
  theme: string;
  filename?: string;
  slides: SlideSpec[];
}

/** 主题列表响应 */
export interface ThemesListResponse {
  total: number;
  themes: ThemeMeta[];
}

/** 模板列表响应 */
export interface TemplatesListResponse {
  total: number;
  templates: TemplateMeta[];
}

/**
 * 获取所有可用主题
 * GET /api/ppt/themes
 */
export async function fetchPptThemes(): Promise<ThemesListResponse> {
  return httpClient.get('/ppt/themes') as Promise<ThemesListResponse>;
}

/**
 * 获取所有可用模板
 * GET /api/ppt/templates
 */
export async function fetchPptTemplates(): Promise<TemplatesListResponse> {
  return httpClient.get('/ppt/templates') as Promise<TemplatesListResponse>;
}

/**
 * 生成 PPT 文件并自动下载
 *
 * POST /api/ppt/make（返回 application/vnd.openxmlformats-officedocument.presentationml.presentation）
 *
 * 注意：axios 拦截器会尝试把响应解包为 JSON，但二进制流不能这样处理。
 * 所以这里绕过拦截器，直接 fetch + blob 处理。
 */
export async function generatePpt(spec: PptSpec): Promise<Blob> {
  const baseURL = httpClient.defaults.baseURL || '/api';
  const token = localStorage.getItem('token') || '';

  const response = await fetch(`${baseURL}/ppt/make`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(spec),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      message = errBody?.error?.message || errBody?.message || message;
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message);
  }

  return response.blob();
}

/**
 * 生成 PPT 并触发浏览器下载
 *
 * @param spec PPT 制作请求
 * @param filename 下载文件名（不含扩展名），默认 spec.filename 或 'presentation'
 */
export async function downloadPpt(spec: PptSpec, filename?: string): Promise<string> {
  const blob = await generatePpt(spec);
  const name = filename || spec.filename || 'presentation';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.pptx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 释放 URL 资源
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `${name}.pptx`;
}
