/**
 * PPT 模块入口
 *
 * 统一导出 PptModule / PptError / createPptModule / 类型 + 路由注册函数。
 * 外部使用：
 *   import { createPptModule, registerPptRoutes } from '@myopenclaw/server/modules/ppt';
 *
 * @module @myopenclaw/server/modules/ppt
 */

export {
  createPptModule,
  generatePptx,
  PptError,
  type PptModule,
} from './index.js';

export { registerPptRoutes } from './routes.js';

export { listThemes, resolveTheme } from './themes.js';

export { listTemplates } from './templates.js';

export type {
  PptSpec,
  SlideSpec,
  SlideTemplate,
  SlideData,
  ThemeMeta,
  TemplateMeta,
} from './types.js';
