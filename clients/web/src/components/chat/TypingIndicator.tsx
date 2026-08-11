import React from 'react';
import { Sparkles, BrainCircuit, Loader2 } from 'lucide-react';

interface TypingIndicatorProps {
  /** 正在进行中的 reasoning 内容（思考过程） */
  reasoning?: string;
  /** 当前流式回复内容（已有正文输出） */
  streamingContent?: string;
}

/**
 * AI 等待/回复状态指示器
 *
 * 显示四阶段状态：
 * 1. 等待处理（无 reasoning、无 content）：呼吸光晕头像 + "正在处理您的问题..." + 骨架屏占位
 * 2. 思考中（有 reasoning、无 content）：呼吸光晕 + 思考过程预览
 * 3. 正在输出（有 reasoning、有 content）：小状态提示
 * 4. reasoning 完成后纯输出期：状态栏自动缩退
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ reasoning, streamingContent }) => {
  const hasReasoning = !!(reasoning && reasoning.trim());
  const hasContent = !!(streamingContent && streamingContent.trim());

  // ── 根据阶段确定状态文本 ──
  let statusText = '正在处理您的问题...';
  let statusIcon: React.ReactNode = <Loader2 className="w-4 h-4 text-primary animate-spin" />;
  let statusColor = 'text-primary';

  if (hasReasoning) {
    if (hasContent) {
      statusText = '正在输出回复...';
      statusIcon = <BrainCircuit className="w-4 h-4 text-emerald-500 animate-pulse" />;
      statusColor = 'text-emerald-500';
    } else {
      statusText = '正在深度思考...';
      statusIcon = <BrainCircuit className="w-4 h-4 text-amber-500 animate-pulse" />;
      statusColor = 'text-amber-500';
    }
  }

  // ── 截取 reasoning 前 300 字符显示在预览框中 ──
  const reasoningPreview = hasReasoning
    ? reasoning!.trim().slice(0, 300) + (reasoning!.trim().length > 300 ? '...' : '')
    : '';

  // ── 阶段 1：纯等待（无 reasoning）时显示骨架屏占位行 ──
  const showSkeleton = !hasReasoning && !hasContent;

  return (
    <div className="flex items-start gap-3 py-4 animate-fade-in">
      {/* ────── 机器人头像（带呼吸光晕） ────── */}
      <div className="relative flex-shrink-0">
        <div className="avatar-waiting relative z-10 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary shadow-lg">
          <Sparkles className="w-4 h-4 text-primary-foreground" />
        </div>
        {/* 光晕扩散环 */}
        <div className="absolute inset-0 -z-0 animate-ping rounded-xl bg-primary/20" style={{ animationDuration: '2.5s' }} />
      </div>

      <div className="flex-1 min-w-0">
        {/* ── 状态标题行 ── */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-xs font-semibold text-foreground">贾维斯</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span className="flex items-center gap-1">
            {statusIcon}
            <span className={`text-xs font-medium ${statusColor}`}>{statusText}</span>
          </span>
          {/* 省略号动画点 */}
          <span className="typing-dot animate-bounce ml-0.5" style={{ animationDelay: '0ms', width: '4px', height: '4px' }} />
          <span className="typing-dot animate-bounce" style={{ animationDelay: '150ms', width: '4px', height: '4px' }} />
          <span className="typing-dot animate-bounce" style={{ animationDelay: '300ms', width: '4px', height: '4px' }} />
        </div>

        {/* ── 思考过程输出框 ── */}
        {hasReasoning && (
          <div className="relative rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 mb-2">
            <div className="flex items-start gap-2">
              <BrainCircuit className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mb-1">思考过程</div>
                <div className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
                  {reasoningPreview}
                  {reasoning!.trim().length > 300 && (
                    <span className="text-muted-foreground/50">...（继续思考中）</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 已开始输出正文时的过渡提示 ── */}
        {hasContent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>回复内容正在实时生成...</span>
          </div>
        )}

        {/* ── 纯等待阶段：骨架屏占位，模拟即将出现的回复 ── */}
        {showSkeleton && (
          <div className="space-y-2 mt-1">
            <div className="skeleton-shimmer h-3 rounded-lg w-[85%]" />
            <div className="skeleton-shimmer h-3 rounded-lg w-[70%]" />
            <div className="skeleton-shimmer h-3 rounded-lg w-[45%]" />
          </div>
        )}
      </div>
    </div>
  );
};
