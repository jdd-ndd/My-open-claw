/**
 * SkillPanel —— 主动技能/工具选择面板
 *
 * 提供一个弹出式面板，展示：
 * 1. 快捷命令（Spec / Plan）
 * 2. 已注册技能列表（从服务端 /api/skills 动态加载）
 * 3. 已注册工具列表（从服务端 /api/tools 动态加载）
 *
 * 用户点击某项后，面板会以特定格式将指令文本注入到输入框中，
 * 由 Agent 解析后执行对应的技能/工具调用。
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  X,
  Sparkles,
  Zap,
  FileCode2,
  Wrench,
  Loader2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSkills, filterSkills } from '@/hooks/useSkills';
import type { SkillMeta, ToolMeta } from '@/api/skills';

/** 命令项定义（内置固定项） */
interface CommandItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** 注入到输入框的指令文本 */
  directive: string;
}

/** 面板分类 Tab */
type PanelTab = 'commands' | 'skills' | 'tools';

interface SkillPanelProps {
  /**
   * 点击某项后触发：
   * - 新版：返回 `__CHOOSE__<kind>:<name>` 特殊标识符
   * - 旧版兼容：若需要注入输入框的原始指令文本（MessageInput 会识别两种格式）
   */
  onSelect: (directive: string) => void;
  /** 关闭面板 */
  onClose: () => void;
  /** 初始 Tab */
  initialTab?: PanelTab;
  /**
   * 当前已激活项 id 列表（用于高亮已选中的项）
   * 格式：command:<id> / skill:<name> / tool:<name>
   */
  activatedIds?: string[];
}

/** 内置快捷命令 */
const BUILTIN_COMMANDS: CommandItem[] = [
  {
    id: 'spec',
    name: 'Spec',
    description: '根据需求细化完整的规范、任务、验收文档，用户确认后再严格执行，适合复杂的长线任务',
    icon: <FileCode2 className="w-4 h-4" />,
    directive:
      '[Spec模式] 请根据我的需求细化出完整的规范文档，包含：1) 功能需求 2) 技术方案 3) 任务拆解 4) 验收标准。完成后请等待我确认，再开始执行。',
  },
  {
    id: 'plan',
    name: 'Plan',
    description: '优先规划任务的执行方向，用户确认后再执行',
    icon: <Zap className="w-4 h-4" />,
    directive:
      '[Plan模式] 请针对我的需求先制定执行计划，列出关键步骤和实现思路，等待我确认后再开始执行。',
  },
];

/**
 * 优先级样式映射
 */
const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-500/10 text-red-500 border-red-500/20',
  normal: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  low: 'bg-muted text-muted-foreground border-border',
};

/**
 * 风险等级样式映射
 */
const RISK_STYLES: Record<string, string> = {
  high: 'bg-red-500/10 text-red-500',
  medium: 'bg-amber-500/10 text-amber-500',
  low: 'bg-emerald-500/10 text-emerald-500',
};

export const SkillPanel: React.FC<SkillPanelProps> = ({
  onSelect,
  onClose,
  initialTab = 'skills',
  activatedIds,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>(initialTab);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 已激活集合（用 Set 便于 O(1) 查询）
  const activatedSet = useMemo(
    () => new Set(activatedIds ?? []),
    [activatedIds]
  );

  const { skills, tools, isLoading, error } = useSkills();

  // 过滤后的技能列表
  const filteredSkills = filterSkills(skills, searchKeyword);
  // 过滤后的工具列表
  const filteredTools = tools.filter((t) => {
    const trimmed = searchKeyword.trim().toLowerCase();
    if (!trimmed) return true;
    const haystack = [t.name, t.description, t.category ?? ''].join(' ').toLowerCase();
    return haystack.includes(trimmed);
  });

  // 搜索命令
  const filteredCommands = searchKeyword.trim()
    ? BUILTIN_COMMANDS.filter(
        (c) =>
          c.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          c.description.toLowerCase().includes(searchKeyword.toLowerCase())
      )
    : BUILTIN_COMMANDS;

  /** 关闭面板 */
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  /** 点击命令：发送特殊标识 `__CHOOSE__command:<id>`，由 MessageInput 转为胶囊 */
  const handleSelectCommand = useCallback(
    (cmd: CommandItem) => {
      onSelect(`__CHOOSE__command:${cmd.id}`);
      // 命令（Spec / Plan 等）通常只选择一个，选完即关面板
      onClose();
    },
    [onSelect, onClose]
  );

  /** 点击技能：发送 `__CHOOSE__skill:<name>`。选择后不关闭面板，允许多选 */
  const handleSelectSkill = useCallback(
    (skill: SkillMeta) => {
      onSelect(`__CHOOSE__skill:${skill.name}`);
    },
    [onSelect]
  );

  /** 点击工具：发送 `__CHOOSE__tool:<name>`。选择后不关闭面板，允许多选 */
  const handleSelectTool = useCallback(
    (tool: ToolMeta) => {
      onSelect(`__CHOOSE__tool:${tool.name}`);
    },
    [onSelect]
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const getCurrentList = () => {
        if (activeTab === 'commands') return filteredCommands;
        if (activeTab === 'skills') return filteredSkills;
        return filteredTools;
      };

      const list = getCurrentList();

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, list.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < list.length) {
          if (activeTab === 'commands') handleSelectCommand(list[selectedIndex] as CommandItem);
          else if (activeTab === 'skills') handleSelectSkill(list[selectedIndex] as SkillMeta);
          else handleSelectTool(list[selectedIndex] as ToolMeta);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    },
    [activeTab, filteredCommands, filteredSkills, filteredTools, selectedIndex, handleClose, handleSelectCommand, handleSelectSkill, handleSelectTool]
  );

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClose]);

  // Tab 切换时重置选中索引
  useEffect(() => {
    setSelectedIndex(-1);
  }, [activeTab]);

  // 搜索时重置选中索引
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchKeyword]);

  // 自动聚焦搜索框
  useEffect(() => {
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 right-0 mb-2 w-full max-h-[420px] overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur-xl z-50 animate-fade-in-up"
      onKeyDown={handleKeyDown}
    >
      {/* 搜索栏 */}
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          placeholder="输入搜索..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {searchKeyword && (
          <button
            type="button"
            onClick={() => setSearchKeyword('')}
            className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2">
        <TabButton
          active={activeTab === 'commands'}
          onClick={() => setActiveTab('commands')}
          count={BUILTIN_COMMANDS.length}
          label="命令"
        />
        <TabButton
          active={activeTab === 'skills'}
          onClick={() => setActiveTab('skills')}
          count={skills.length}
          label="技能"
        />
        <TabButton
          active={activeTab === 'tools'}
          onClick={() => setActiveTab('tools')}
          count={tools.length}
          label="工具"
        />
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin max-h-[300px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span className="text-xs">正在加载技能列表...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <AlertCircle className="w-5 h-5 mb-2 text-red-500" />
            <span className="text-xs text-red-500">{error}</span>
            <span className="text-[11px] mt-1">请确认服务端已启动</span>
          </div>
        ) : activeTab === 'commands' ? (
          <CommandList
            items={filteredCommands}
            selectedIndex={selectedIndex}
            onSelect={handleSelectCommand}
            activatedIds={Array.from(activatedSet)}
          />
        ) : activeTab === 'skills' ? (
          <SkillList
            skills={filteredSkills}
            selectedIndex={selectedIndex}
            onSelect={handleSelectSkill}
            activatedIds={Array.from(activatedSet)}
          />
        ) : (
          <ToolList
            tools={filteredTools}
            selectedIndex={selectedIndex}
            onSelect={handleSelectTool}
            activatedIds={Array.from(activatedSet)}
          />
        )}
      </div>

      {/* 底部提示 */}
      <div className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>↑↓ 导航 · Enter 选择 · Esc 关闭</span>
        <span className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3" />
          选择后将注入指令到输入框
        </span>
      </div>
    </div>
  );
};

/** Tab 按钮 */
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  count: number;
  label: string;
}> = ({ active, onClick, count, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
      active
        ? 'bg-primary/15 text-primary'
        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    )}
  >
    {label}
    <span
      className={cn(
        'px-1.5 py-0.5 rounded text-[10px]',
        active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
      )}
    >
      {count}
    </span>
  </button>
);

/** 命令列表 */
const CommandList: React.FC<{
  items: CommandItem[];
  selectedIndex: number;
  onSelect: (cmd: CommandItem) => void;
  activatedIds?: string[];
}> = ({ items, selectedIndex, onSelect, activatedIds }) => {
  const activatedSet = new Set(activatedIds ?? []);
  if (items.length === 0) {
    return <EmptyHint text="未找到匹配的命令" />;
  }
  return (
    <ul className="py-1">
      {items.map((cmd, i) => {
        const active = activatedSet.has(`command:${cmd.id}`);
        return (
          <li key={cmd.id}>
            <button
              type="button"
              onClick={() => onSelect(cmd)}
              className={cn(
                'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors relative',
                i === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted/40',
                active && 'bg-violet-500/10'
              )}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                {cmd.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{cmd.name}</span>
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/30 text-violet-900 dark:text-violet-100 border border-violet-500/50">
                      已激活
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{cmd.description}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** 技能列表 */
const SkillList: React.FC<{
  skills: SkillMeta[];
  selectedIndex: number;
  onSelect: (skill: SkillMeta) => void;
  activatedIds?: string[];
}> = ({ skills, selectedIndex, onSelect, activatedIds }) => {
  const activatedSet = new Set(activatedIds ?? []);
  if (skills.length === 0) {
    return <EmptyHint text="暂无已注册技能" />;
  }
  return (
    <ul className="py-1">
      {skills.map((skill, i) => {
        const active = activatedSet.has(`skill:${skill.name}`);
        return (
          <li key={skill.name}>
            <button
              type="button"
              onClick={() => onSelect(skill)}
              className={cn(
                'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors relative',
                i === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted/40',
                active && 'bg-violet-500/10'
              )}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{skill.name}</span>
                  <span className="text-[10px] text-muted-foreground">v{skill.version}</span>
                  {skill.priority && (
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded border text-[10px]',
                        PRIORITY_STYLES[skill.priority] ?? PRIORITY_STYLES.normal
                      )}
                    >
                      {skill.priority}
                    </span>
                  )}
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/30 text-violet-900 dark:text-violet-100 border border-violet-500/50">
                      已激活
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {skill.description}
                </div>
                {skill.triggers && skill.triggers.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skill.triggers.slice(0, 3).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                    {skill.triggers.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">+{skill.triggers.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** 工具列表 */
const ToolList: React.FC<{
  tools: ToolMeta[];
  selectedIndex: number;
  onSelect: (tool: ToolMeta) => void;
  activatedIds?: string[];
}> = ({ tools, selectedIndex, onSelect, activatedIds }) => {
  const activatedSet = new Set(activatedIds ?? []);
  if (tools.length === 0) {
    return <EmptyHint text="暂无已注册工具" />;
  }
  return (
    <ul className="py-1">
      {tools.map((tool, i) => {
        const active = activatedSet.has(`tool:${tool.name}`);
        return (
          <li key={tool.name}>
            <button
              type="button"
              onClick={() => onSelect(tool)}
              className={cn(
                'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors relative',
                i === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted/40',
                active && 'bg-amber-500/10'
              )}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-accent text-accent-foreground">
                <Wrench className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{tool.name}</span>
                  {tool.category && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                      {tool.category}
                    </span>
                  )}
                  {tool.risk && (
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px]',
                        RISK_STYLES[tool.risk] ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {tool.risk}
                    </span>
                  )}
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/30 text-amber-950 dark:text-amber-100 border border-amber-500/50 ml-auto">
                      已激活
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {tool.description}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** 空状态提示 */
const EmptyHint: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
    <Sparkles className="w-5 h-5 mb-2 opacity-40" />
    <span className="text-xs">{text}</span>
  </div>
);
