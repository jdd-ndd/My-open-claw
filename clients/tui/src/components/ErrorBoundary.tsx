/**
 * 简易 ErrorBoundary(Ink 不支持类组件错误边界,
 * 这里仅做渲染包装,实际错误处理在 App 中通过 useState 捕获)
 */
import React from 'react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error) => React.ReactNode;
}

export interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 简单输出到 stderr,生产环境可接入日志系统
    process.stderr.write(`[ErrorBoundary] ${error.message}\n${info.componentStack ?? ''}\n`);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return null;
    }
    return this.props.children;
  }
}
