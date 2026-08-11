import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import {
  Send,
  Paperclip,
  Square,
  X,
  LayoutGrid,
  FileCode2,
  Zap,
  Wrench,
  Sparkles,
  Image as ImageIcon,
  Film,
  Brain,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { SkillPanel } from './SkillPanel';
import { useSkills } from '@/hooks/useSkills';
import type { SkillMeta, ToolMeta } from '@/api/skills';
import type { SendMessageOptions } from '@/hooks/useChat';

interface MessageInputProps {
  /**
   * 发送消息回调
   * 第三个参数 options 携带技能面板主动激活的技能/工具/工作模式
   */
  onSend: (content: string, files?: File[], options?: SendMessageOptions) => void;
  disabled?: boolean;
  placeholder?: string;
  isStreaming?: boolean;
  onStop?: () => void;
}

/** 已激活项的分类：命令 / 技能 / 工具 */
type ActivatedKind = 'command' | 'skill' | 'tool';

/** 单个已激活胶囊项的运行时表示 */
interface ActivatedChip {
  /** 全局唯一 id，如 command:spec / skill:web-search / tool:system/time */
  id: string;
  /** 分类 */
  kind: ActivatedKind;
  /** 显示名称（短） */
  name: string;
  /** 显示图标 */
  icon?: React.ReactNode;
  /** 长描述（hover 显示） */
  description?: string;
  /** 渲染颜色分类 */
  tone: 'command' | 'skill' | 'tool';
}

/** 命令项定义（与 SkillPanel 中 BUILTIN_COMMANDS 对齐，只保留结构信息） */
const COMMAND_META: Record<string, { name: string; description: string; icon: React.ReactNode }> = {
  spec: {
    name: 'Spec',
    description: '先出完整规范文档，用户确认后再严格执行',
    icon: <FileCode2 className="w-3 h-3" />,
  },
  plan: {
    name: 'Plan',
    description: '先出详细执行计划，用户确认后再执行',
    icon: <Zap className="w-3 h-3" />,
  },
};

/** 分类 → 胶囊样式映射
 * 增强对比度：深色文字 + 半实色背景 + 明显边框，
 * 确保在浅色和深色主题下都清晰可读。
 */
const CHIP_TONE_CLASS: Record<ActivatedChip['tone'], string> = {
  // 命令：深紫色文字 + 半实色紫底
  command:
    'bg-gradient-to-br from-purple-500/35 to-fuchsia-500/35 text-purple-900 dark:text-purple-100 border-purple-500/50 hover:border-purple-500/80 shadow-sm',
  // 技能：深靛色文字 + 半实色靛底
  skill:
    'bg-gradient-to-br from-indigo-500/35 to-violet-500/35 text-indigo-900 dark:text-indigo-100 border-indigo-500/50 hover:border-indigo-500/80 shadow-sm',
  // 工具：深琥珀色文字 + 半实色琥珀底
  tool:
    'bg-gradient-to-br from-amber-400/45 to-orange-400/45 text-amber-950 dark:text-amber-100 border-amber-500/50 hover:border-amber-500/80 shadow-sm',
};

/**
 * 为已知技能/工具推荐一个图标（按名称关键词匹配）
 */
function guessIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (/image|img|画|图|photo|pic|seedream|dream|绘画/.test(n))
    return <ImageIcon className="w-3 h-3" />;
  if (/video|movie|film|视频|seedance|story|motion/.test(n))
    return <Film className="w-3 h-3" />;
  if (/brain|think|spec|code|skill|agent|prd|产品|方案|文档/.test(n))
    return <Brain className="w-3 h-3" />;
  if (/web|browser|search|查|搜|browse|打开/.test(n))
    return <Sparkles className="w-3 h-3" />;
  if (/tool|run|exec|shell|code|calc|天气|时间|日历/.test(n))
    return <Wrench className="w-3 h-3" />;
  return <Sparkles className="w-3 h-3" />;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  disabled = false,
  placeholder = '输入消息...',
  isStreaming = false,
  onStop,
}) => {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  /** 已激活的命令/技能/工具胶囊列表 */
  const [activated, setActivated] = useState<ActivatedChip[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 拉取技能/工具元数据，用于名称 / 描述查找
  const { skills, tools } = useSkills();
  const skillMap = useMemo(() => {
    const m = new Map<string, SkillMeta>();
    skills.forEach((s) => m.set(s.name, s));
    return m;
  }, [skills]);
  const toolMap = useMemo(() => {
    const m = new Map<string, ToolMeta>();
    tools.forEach((t) => m.set(t.name, t));
    return m;
  }, [tools]);

  /** 调整输入框高度自适应 */
  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, []);

  /**
   * 发送消息
   * 将激活胶囊编码到 SendMessageOptions 中，交给 useChat 传到后端
   */
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && files.length === 0 && activated.length === 0) return;

    // 按 kind 拆分激活项
    const activatedSkills: string[] = [];
    const activatedTools: string[] = [];
    let workModeCommand: 'spec' | 'plan' | undefined;
    for (const chip of activated) {
      if (chip.kind === 'skill') activatedSkills.push(chip.name);
      if (chip.kind === 'tool') activatedTools.push(chip.name);
      if (chip.kind === 'command') {
        if (chip.name.toLowerCase() === 'spec') workModeCommand = 'spec';
        else if (chip.name.toLowerCase() === 'plan') workModeCommand = 'plan';
      }
    }

    const options: SendMessageOptions = {};
    if (activatedSkills.length) options.activatedSkills = activatedSkills;
    if (activatedTools.length) options.activatedTools = activatedTools;
    if (workModeCommand) options.workModeCommand = workModeCommand;

    onSend(trimmed, files.length > 0 ? files : undefined, options);
    setValue('');
    setFiles([]);
    // 激活项作为一次性请求上下文：发送后清空，避免后续消息带上
    setActivated([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, files, activated, onSend]);

  /** 键盘事件处理 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 技能面板打开时，不拦截键盘事件（由 SkillPanel 内部处理）
      if (skillPanelOpen) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && !isStreaming && (value.trim() || files.length > 0 || activated.length > 0)) {
          handleSend();
        }
      }
      // Backspace：输入框为空且存在激活项时，移除最后一个胶囊（类似 tag 输入）
      if (e.key === 'Backspace' && !value && activated.length > 0) {
        setActivated((prev) => prev.slice(0, -1));
      }
    },
    [handleSend, disabled, isStreaming, value, files.length, activated.length, skillPanelOpen]
  );

  /** 文件选择 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selectedFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  /**
   * 处理 SkillPanel 选中：
   * - 命令：转为 command 胶囊；同时兼容旧版 directive 文本（若用户手动传入文本则追加到输入框）
   * - 技能：转为 skill 胶囊
   * - 工具：转为 tool 胶囊
   */
  const handleSkillSelect = useCallback(
    (directive: string) => {
      // 解析面板返回的特殊标识字符串：
      //   "command:spec" / "skill:web-search" / "tool:system/time"
      const m = directive.match(/^__CHOOSE__(command|skill|tool):(.+)$/);
      if (!m) {
        // 兼容：若不是特殊标识，按原先行为把指令文本加到输入框
        setValue((prev) => {
          if (!prev.trim()) return directive;
          return `${directive}\n\n${prev}`;
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }
      const kind = m[1] as ActivatedKind;
      const rawName = m[2];

      // 检查是否已激活（去重）
      const chipId = `${kind}:${rawName}`;
      setActivated((prev) => {
        if (prev.some((c) => c.id === chipId)) return prev;
        let name = rawName;
        let description: string | undefined;
        let icon: React.ReactNode;
        let tone: ActivatedChip['tone'];

        if (kind === 'command') {
          const meta = COMMAND_META[rawName.toLowerCase()];
          name = meta?.name ?? rawName;
          description = meta?.description;
          icon = meta?.icon ?? <Sparkles className="w-3 h-3" />;
          tone = 'command';
        } else if (kind === 'skill') {
          const meta = skillMap.get(rawName);
          name = meta?.displayName ?? meta?.name ?? rawName;
          description = meta?.description;
          icon = guessIcon(rawName);
          tone = 'skill';
        } else {
          const meta = toolMap.get(rawName);
          name = meta?.displayName ?? meta?.name ?? rawName;
          description = meta?.description;
          icon = <Wrench className="w-3 h-3" />;
          tone = 'tool';
        }

        return [
          ...prev,
          {
            id: chipId,
            kind,
            name,
            icon,
            description,
            tone,
          },
        ];
      });
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [skillMap, toolMap]
  );

  /** 切换技能面板 */
  const toggleSkillPanel = useCallback(() => {
    setSkillPanelOpen((prev) => !prev);
  }, []);

  /** 移除某个激活胶囊 */
  const removeChip = useCallback((id: string) => {
    setActivated((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const canSend = (value.trim() || files.length > 0 || activated.length > 0) && !disabled && !isStreaming;

  // 溢出折叠策略：超过 4 个时，把后面的折叠成 "+N" 按钮
  const VISIBLE_CHIP_COUNT = 4;
  const visibleChips = activated.slice(0, VISIBLE_CHIP_COUNT);
  const overflowChips = activated.slice(VISIBLE_CHIP_COUNT);

  return (
    <div className="relative">
      {/* 技能选择面板（弹出层） */}
      {skillPanelOpen && (
        <SkillPanel
          onSelect={handleSkillSelect}
          onClose={() => setSkillPanelOpen(false)}
          initialTab="skills"
          /** 传入当前激活列表，用于高亮已选中的项 */
          activatedIds={activated.map((c) => c.id)}
        />
      )}

      {/* 文件预览区 */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/40 text-xs animate-fade-in"
            >
              <span className="truncate max-w-[120px] font-medium">{file.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
                title="移除附件"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ═══════ 激活胶囊 / Chips 区 ═══════
          参考截图中的 agent-browser 胶囊样式：
          - 渐变色背景 + 细边
          - 每个胶囊可独立关闭
          - 超过 4 个折叠为 "+N" 并展开完整列表 */}
      {activated.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 animate-fade-in">
          {visibleChips.map((chip) => (
            <div
              key={chip.id}
              title={chip.description}
              className={cn(
                'group inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-[11px] font-medium shadow-sm backdrop-blur-sm',
                CHIP_TONE_CLASS[chip.tone]
              )}
            >
              {chip.icon && <span className="opacity-90">{chip.icon}</span>}
              <span className="whitespace-nowrap">{chip.name}</span>
              <button
                type="button"
                onClick={() => removeChip(chip.id)}
                className={cn(
                  'ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors',
                  'bg-black/10 text-current/70 hover:bg-black/20 hover:text-current'
                )}
                title="移除"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          {/* 溢出折叠：+N */}
          {overflowChips.length > 0 && (
            <div className="relative">
              <button
                type="button"
                className={cn(
                  'inline-flex items-center rounded-xl border px-2 py-1 text-[11px] font-semibold transition-all',
                  'bg-white/5 text-muted-foreground border-border hover:bg-white/10 hover:text-foreground'
                )}
                title={overflowChips.map((c) => `${c.name} — ${c.description ?? ''}`).join('\n')}
              >
                +{overflowChips.length}
              </button>
              {/* hover 展开完整溢出列表（tooltip 式） */}
              <div className="absolute left-0 bottom-[110%] z-50 hidden group-hover:block">
                <div className="mb-1 min-w-[200px] rounded-xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur-md animate-fade-in">
                  {overflowChips.map((chip) => (
                    <div
                      key={chip.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {chip.icon && <span className="text-muted-foreground">{chip.icon}</span>}
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{chip.name}</div>
                          {chip.description && (
                            <div className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                              {chip.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeChip(chip.id)}
                        className="flex h-4 w-4 items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-[20px] border border-transparent bg-transparent p-2 transition-all duration-200 focus-within:border-primary/20 focus-within:bg-background/20 focus-within:shadow-[inset_0_1px_0_hsl(var(--primary)_/_0.08)]">
        {/* 技能面板切换按钮 */}
        <button
          type="button"
          onClick={toggleSkillPanel}
          disabled={disabled}
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-all hover:bg-muted/50 disabled:opacity-50',
            skillPanelOpen || activated.length > 0
              ? 'bg-gradient-to-br from-violet-500/25 to-indigo-500/25 text-violet-200 border border-violet-400/30 shadow-[0_0_0_1px_rgba(139,92,246,0.1)]'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title="技能与工具"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        {/* 文件上传按钮 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          title="添加附件"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={skillPanelOpen ? '从面板选择技能或工具...' : placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-[200px] flex-1 resize-none bg-transparent py-2.5 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 scrollbar-thin"
        />

        {/* 发送/停止按钮 */}
        <div className="flex items-center gap-1">
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500 transition-colors hover:bg-red-500/20"
              title="停止生成"
            >
              <Square className="w-3.5 h-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-all duration-200',
                canSend
                  ? 'bg-gradient-primary text-primary-foreground shadow-lg shadow-primary/25 hover:scale-[1.03]'
                  : 'bg-muted/80 text-muted-foreground cursor-not-allowed',
              )}
              title="发送"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
