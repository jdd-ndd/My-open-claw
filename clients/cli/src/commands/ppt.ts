/**
 * ppt 命令实现
 *
 * PPT 制作命令，让用户通过 CLI 快速生成演示文稿。
 *
 * 提供以下子操作：
 *   - themes: 列出可用主题
 *   - templates: 列出可用模板
 *   - make: 生成 PPT（自动下载到本地）
 *
 * 数据来源：通过 HTTP API 从 Gateway 拉取实时数据。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGatewayClient } from '../api/client.js';
import { ExitCode } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';

/* ─── 类型 ───────────────────────────────────────────────────────── */
interface ThemeMeta {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  headerFont: string;
  bodyFont: string;
}

interface TemplateMeta {
  id: string;
  type: string;
  name: string;
  description: string;
  schema: Record<string, string>;
}

interface PptApiError {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
}

/* ─── ppt 命令主体 ───────────────────────────────────────────────── */
export function createPptCommand(config: MyOpenClawConfig): Command {
  const cmd = new Command('ppt')
    .description('PPT 制作命令（主题 / 模板 / 生成）');

  /* ppt themes */
  cmd
    .command('themes')
    .description('列出所有可用 PPT 主题')
    .action(async () => {
      const spinner = ora('正在获取主题列表...').start();
      try {
        const client = createGatewayClient({ baseURL: config.gateway.url || 'http://127.0.0.1:18780' });
        const res = await client.get<{ ok: boolean; data: { themes: ThemeMeta[] } }>('/api/ppt/themes');
        spinner.succeed();
        const themes = res.data?.data?.themes ?? [];
        if (themes.length === 0) {
          console.log(chalk.dim('  无可用主题'));
          return;
        }
        const table = new Table({
          head: ['ID', '名称', '主色', '辅色', '字体'],
          colWidths: [22, 22, 12, 12, 18],
        });
        for (const t of themes) {
          table.push([
            t.id,
            t.name,
            `#${t.primary}`,
            `#${t.secondary}`,
            `${t.headerFont} / ${t.bodyFont}`,
          ]);
        }
        console.log(chalk.bold(`\n可用主题（${themes.length} 套）\n`));
        console.log(table.toString());
      } catch (err: unknown) {
        spinner.fail('无法连接到 Gateway');
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        process.exit(ExitCode.GATEWAY_UNREACHABLE);
      }
    });

  /* ppt templates */
  cmd
    .command('templates')
    .description('列出所有可用 PPT 模板')
    .option('--type <type>', '按模板类型过滤 (cover|toc|content|divider|summary)')
    .action(async (opts: { type?: string }) => {
      const spinner = ora('正在获取模板列表...').start();
      try {
        const client = createGatewayClient({ baseURL: config.gateway.url || 'http://127.0.0.1:18780' });
        const res = await client.get<{ ok: boolean; data: { templates: TemplateMeta[] } }>('/api/ppt/templates');
        spinner.succeed();
        const templates = res.data?.data?.templates ?? [];
        const filtered = opts.type
          ? templates.filter((t) => t.type === opts.type)
          : templates;
        if (filtered.length === 0) {
          console.log(chalk.dim('  无匹配模板'));
          return;
        }
        const table = new Table({
          head: ['ID', '类型', '名称', '说明'],
          colWidths: [22, 12, 18, 50],
        });
        for (const t of filtered) {
          table.push([t.id, t.type, t.name, t.description]);
        }
        console.log(chalk.bold(`\n可用模板（${filtered.length} 种）\n`));
        console.log(table.toString());
      } catch (err: unknown) {
        spinner.fail('无法连接到 Gateway');
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        process.exit(ExitCode.GATEWAY_UNREACHABLE);
      }
    });

  /* ppt make */
  cmd
    .command('make')
    .description('生成 PPT 并保存到本地')
    .requiredOption('-t, --theme <id>', '主题 ID')
    .requiredOption('-s, --spec <path>', '幻灯片规格 JSON 文件路径')
    .option('-o, --out <path>', '输出文件路径（默认当前目录下的 presentation.pptx）')
    .action(async (opts: { theme: string; spec: string; out?: string }) => {
      const spinner = ora('正在生成 PPT ...').start();
      try {
        // 读取幻灯片规格 JSON 文件
        const fs = await import('node:fs/promises');
        let raw: string;
        try {
          raw = await fs.readFile(opts.spec, 'utf-8');
        } catch {
          spinner.fail(`无法读取规格文件: ${opts.spec}`);
          process.exit(ExitCode.USAGE_ERROR);
        }

        let slides: unknown[];
        try {
          slides = JSON.parse(raw);
        } catch {
          spinner.fail(`规格文件不是有效的 JSON: ${opts.spec}`);
          process.exit(ExitCode.USAGE_ERROR);
        }

        if (!Array.isArray(slides) || slides.length === 0) {
          spinner.fail('幻灯片规格必须是非空数组');
          process.exit(ExitCode.USAGE_ERROR);
        }

        // 调用 Gateway API
        const client = createGatewayClient({ baseURL: config.gateway.url || 'http://127.0.0.1:18780' });
        const res = await client.post<ArrayBuffer>(
          '/api/ppt/make',
          { theme: opts.theme, slides, filename: 'presentation' },
          { responseType: 'arraybuffer' },
        );

        spinner.succeed();

        const buffer = Buffer.from(res.data);
        const outPath = resolve(opts.out || 'presentation.pptx');
        writeFileSync(outPath, buffer);

        console.log();
        console.log(chalk.green.bold('  ✔ PPT 生成完成'));
        console.log(chalk.dim(`    - 主题: ${opts.theme}`));
        console.log(chalk.dim(`    - 页数: ${slides.length}`));
        console.log(chalk.dim(`    - 大小: ${(buffer.length / 1024).toFixed(1)} KB`));
        console.log(chalk.dim(`    - 输出: ${outPath}`));
        console.log();
      } catch (err: unknown) {
        spinner.fail('PPT 生成失败');
        // 尝试解析 Gateway 错误响应
        const errorResponse = (err as Record<string, unknown>)?.response as
          | { data: PptApiError }
          | undefined;
        if (errorResponse?.data?.error) {
          console.error(chalk.red(`  ${errorResponse.data.error.code}: ${errorResponse.data.error.message}`));
          process.exit(ExitCode.GATEWAY_ERROR);
        }
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        process.exit(ExitCode.GENERAL_ERROR);
      }
    });

  return cmd;
}
