/**
 * 技能与工具 API 模块
 *
 * 提供从服务端获取已注册技能和工具列表的接口，
 * 供前端 SkillsPanel 组件动态渲染可选能力列表。
 */
import { httpClient } from './http';

/** 技能元数据（对齐服务端 SkillMeta 字段） */
export interface SkillMeta {
  name: string;
  /** 可选的人性化展示名称；若不存在，降级使用 name */
  displayName?: string;
  description: string;
  version: string;
  author?: string;
  triggers?: string[];
  tools?: string[];
  requires?: string[];
  priority?: 'low' | 'normal' | 'high';
  filePath?: string;
}

/** 工具元数据（对齐服务端 Tool 字段） */
export interface ToolMeta {
  name: string;
  /** 可选的人性化展示名称；若不存在，降级使用 name */
  displayName?: string;
  description: string;
  category?: string;
  risk?: 'low' | 'medium' | 'high';
  builtin?: boolean;
  parameters?: Record<string, unknown>;
}

/** 技能列表响应 */
export interface SkillsListResponse {
  total: number;
  skills: SkillMeta[];
  note?: string;
}

/** 工具列表响应 */
export interface ToolsListResponse {
  total: number;
  tools: ToolMeta[];
  note?: string;
}

/**
 * 获取所有已注册技能列表
 *
 * GET /api/skills
 */
export async function fetchSkills(): Promise<SkillsListResponse> {
  return httpClient.get('/skills') as Promise<SkillsListResponse>;
}

/**
 * 获取所有已注册工具列表
 *
 * GET /api/tools
 */
export async function fetchTools(): Promise<ToolsListResponse> {
  return httpClient.get('/tools') as Promise<ToolsListResponse>;
}
