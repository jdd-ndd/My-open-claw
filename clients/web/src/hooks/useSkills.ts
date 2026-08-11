/**
 * useSkills Hook
 *
 * 管理技能与工具数据的获取、缓存和过滤。
 * 在组件首次挂载时从服务端拉取 /api/skills 和 /api/tools，
 * 之后通过 getSkills/getTools 暴露数据供面板组件使用。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSkills, fetchTools, type SkillMeta, type ToolMeta } from '@/api/skills';

/** 技能/工具 hook 返回值 */
export interface UseSkillsReturn {
  skills: SkillMeta[];
  tools: ToolMeta[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** 带缓存的单例数据 —— 避免每次打开面板都重新请求 */
let cachedSkills: SkillMeta[] | null = null;
let cachedTools: ToolMeta[] | null = null;
let cacheFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<SkillMeta[]>(cachedSkills ?? []);
  const [tools, setTools] = useState<ToolMeta[]>(cachedTools ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  /** 加载技能和工具数据 */
  const loadData = useCallback(async () => {
    // 使用缓存
    const now = Date.now();
    if (cachedSkills && cachedTools && now - cacheFetchedAt < CACHE_TTL_MS) {
      setSkills(cachedSkills);
      setTools(cachedTools);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [skillsResp, toolsResp] = await Promise.all([
        fetchSkills(),
        fetchTools(),
      ]);

      if (!mountedRef.current) return;

      cachedSkills = skillsResp.skills ?? [];
      cachedTools = toolsResp.tools ?? [];
      cacheFetchedAt = now;

      setSkills(cachedSkills);
      setTools(cachedTools);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : '加载技能列表失败';
      setError(message);
      // 失败时保留旧缓存
      if (cachedSkills) setSkills(cachedSkills);
      if (cachedTools) setTools(cachedTools);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(async () => {
    cacheFetchedAt = 0; // 强制刷新缓存
    await loadData();
  }, [loadData]);

  useEffect(() => {
    mountedRef.current = true;
    void loadData();
    return () => {
      mountedRef.current = false;
    };
  }, [loadData]);

  return { skills, tools, isLoading, error, refetch };
}

/**
 * 根据搜索关键词过滤技能列表
 */
export function filterSkills(skills: SkillMeta[], keyword: string): SkillMeta[] {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return skills;
  return skills.filter((s) => {
    const haystack = [
      s.name,
      s.description,
      ...(s.triggers ?? []),
      ...(s.tools ?? []),
    ].join(' ').toLowerCase();
    return haystack.includes(trimmed);
  });
}
