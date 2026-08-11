/**
 * PPT 模块端到端冒烟测试
 *
 * 直接调用核心 API 生成 PPT 文件，验证：
 *   1. 编译后模块可正常加载
 *   2. 三件套（index/route/themes）协同工作
 *   3. 生成的 PPTX 是合法 ZIP 文件
 *   4. 错误路径（PptError）正确抛出
 *
 * 用法（开发期）：
 *   cd server && npx tsx verify-ppt.ts
 */
import { writeFileSync } from 'node:fs';
import { createPptModule, PptError } from './src/modules/ppt/index.js';

async function main(): Promise<void> {
  console.log('[1/4] 初始化 PptModule ...');
  const module = await createPptModule();

  console.log('[2/4] 列出主题与模板 ...');
  const themes = await module.listThemes();
  const templates = await module.listTemplates();
  console.log(`      - 主题: ${themes.length} 套`);
  console.log(`      - 模板: ${templates.length} 种`);

  console.log('[3/4] 生成 3 页菜谱 PPT (warm-kitchen 主题) ...');
  const buf = await module.generatePptx({
    theme: 'warm-kitchen',
    filename: 'recipe-demo',
    slides: [
      {
        template: 'cover',
        title: '我的家常菜谱',
        subtitle: '精选 3 道简单美味',
        data: {},
      },
      {
        template: 'toc',
        title: '目录',
        data: {
          items: [
            { num: '01', title: '番茄炒蛋' },
            { num: '02', title: '麻婆豆腐' },
            { num: '03', title: '蒜蓉西兰花' },
          ],
        },
      },
      {
        template: 'content',
        title: '番茄炒蛋',
        data: {
          ingredients: ['番茄 2 个', '鸡蛋 3 个', '葱花少许', '盐适量', '糖少许'],
          steps: [
            '番茄切块，鸡蛋打散',
            '热锅下油，蛋液下锅炒至凝固盛起',
            '锅内余油下番茄翻炒出汁',
            '加少许糖，倒回鸡蛋翻炒',
            '撒葱花起锅',
          ],
        },
      },
    ],
  });

  console.log(`      - 生成 PPTX: ${buf.length} bytes`);
  // PPTX 是 ZIP 格式，魔数为 50 4B 03 04
  const magic = buf.slice(0, 4).toString('hex');
  console.log(`      - ZIP 魔数: ${magic} ${magic === '504b0304' ? 'OK' : 'FAIL'}`);
  writeFileSync('recipe-demo.pptx', buf);
  console.log('      - 写入 recipe-demo.pptx');

  console.log('[4/4] 错误路径验证 ...');
  try {
    await module.generatePptx({ theme: 'no-such-theme', slides: [] });
    console.error('      - 期望抛错，但未抛出');
    process.exit(1);
  } catch (err) {
    if (err instanceof PptError) {
      console.log(`      - PptError 正确抛出: ${err.code} / ${err.message}`);
    } else {
      console.error('      - 非 PptError:', err);
      process.exit(1);
    }
  }

  try {
    await module.generatePptx({
      theme: 'warm-kitchen',
      slides: [],
    });
    console.error('      - 期望抛错（空 slides），但未抛出');
    process.exit(1);
  } catch (err) {
    if (err instanceof PptError && err.code === 'PPT_INVALID_SPEC') {
      console.log(`      - PPT_INVALID_SPEC 正确抛出: ${err.message}`);
    } else {
      console.error('      - 错误码不符:', err);
      process.exit(1);
    }
  }

  console.log('\n✓ 全部冒烟测试通过');
}

main().catch((err) => {
  console.error('✗ 冒烟测试失败:', err);
  process.exit(1);
});
