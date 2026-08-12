// react-syntax-highlighter 16.x 没有自带 .d.ts 声明文件
// 这里是项目级补充,主要用 default export 包裹代码块

declare module 'react-syntax-highlighter' {
  import type { CSSProperties, ReactNode } from 'react';

  export interface SyntaxHighlighterProps {
    language?: string;
    style?: CSSProperties | { [key: string]: CSSProperties };
    customStyle?: CSSProperties;
    wrapLongLines?: boolean;
    showLineNumbers?: boolean;
    startingLineNumber?: number;
    lineNumberStyle?: CSSProperties;
    codeTagProps?: Record<string, unknown>;
    children?: ReactNode;
  }

  const SyntaxHighlighter: React.FC<SyntaxHighlighterProps>;
  export default SyntaxHighlighter;
}

// styles/hljs/index.js 是 `export { default as oneDark } from './one-dark.js'` 这种形式
// 命名导出整个 styles 对象 + 命名导出每个 style
declare module 'react-syntax-highlighter/dist/esm/styles/hljs' {
  const styles: Record<string, React.CSSProperties>;
  export default styles;
  // 命名导出: a11yDark / oneDark / atomOneDark / github / ... 共 200+ 风格
  // 用 TypeScript 通用签名兼容所有命名导出
  export const a11yDark: React.CSSProperties;
  export const atomOneDark: React.CSSProperties;
  export const atomOneDarkReasonable: React.CSSProperties;
  export const atomOneLight: React.CSSProperties;
  export const github: React.CSSProperties;
  export const githubDark: React.CSSProperties;
  export const monokai: React.CSSProperties;
  export const tomorrow: React.CSSProperties;
  export const vs2015: React.CSSProperties;
  export const xcode: React.CSSProperties;
  const _: React.CSSProperties;
  export { _ as default };
}
