/**
 * PPT 模板类型注册
 *
 * 定义每种 SlideTemplate 的元数据，供前端工作台选择模板时显示。
 * 实际渲染逻辑在 modules/ppt/index.ts 的 renderSlide() 派发函数中。
 *
 * @module @myopenclaw/server/modules/ppt/templates
 */

import type { TemplateMeta } from './types.js';

/**
 * 列出所有可用模板
 *
 * 调用方：/api/ppt/templates 端点 + Web 工作台 PptStudio.tsx
 *
 * @returns 模板元数据列表
 */
export async function listTemplates(): Promise<TemplateMeta[]> {
  return [
    {
      id: 'cover-classic',
      type: 'cover',
      name: '经典封面',
      description: '主色背景 + 大标题 + 副标题',
      schema: { title: 'string', subtitle: 'string?' },
    },
    {
      id: 'toc-numbered',
      type: 'toc',
      name: '编号目录',
      description: '章节编号 + 标题列表',
      schema: { items: 'Array<{num: string, title: string}>' },
    },
    {
      id: 'content-recipe',
      type: 'content',
      name: '菜谱内容（食材 + 步骤）',
      description: '左栏食材、右栏步骤',
      schema: {
        ingredients: 'string[]',
        steps: 'string[]',
      },
    },
    {
      id: 'content-bullets',
      type: 'content',
      name: '项目列表',
      description: '单栏 bullet 列表',
      schema: { bullets: 'string[]' },
    },
    {
      id: 'divider-section',
      type: 'divider',
      name: '章节分隔',
      description: '辅色背景 + 大标题',
      schema: { title: 'string' },
    },
    {
      id: 'summary-close',
      type: 'summary',
      name: '结尾页',
      description: '主色背景 + 总结标题 + 副标题',
      schema: { title: 'string', subtitle: 'string?' },
    },
  ];
}
