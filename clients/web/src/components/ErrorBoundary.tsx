/**
 * Error Boundary — 顶层错误捕获
 *
 * 任何子组件 render 抛错时,显示降级 UI,而不是白屏整个应用。
 * 提供 reset 按钮,用户可点 "重试" 重新挂载子树。
 *
 * 注意: ErrorBoundary 必须用 class 组件(React 18 仍未提供 hook 版 getDerivedStateFromError)。
 */
import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** 可选: 自定义降级 UI */
  fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 上报到日志/监控(此处仅 console.error,生产可接 Sentry 等)
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 捕获到子组件错误:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="font-display text-xl font-semibold text-foreground mb-2">
          出现了一个错误
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mb-1">
          页面遇到了意外问题,已阻止渲染。
        </p>
        <p className="text-xs text-muted-foreground/80 max-w-md mb-6 font-mono break-all">
          {error.message}
        </p>
        <button
          onClick={this.reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-primary text-primary-foreground text-sm font-medium shadow-lg shadow-primary/25 hover:scale-105 transition-transform"
        >
          <RefreshCw className="w-4 h-4" />
          重试
        </button>
      </div>
    );
  }
}
