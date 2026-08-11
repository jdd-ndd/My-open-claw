/**
 * 模拟 TUI 交互会话 — 验证路线规划功能
 *
 * 模拟用户在命令行中通过 TUI 直接查询路线的交互流程：
 *   连接网关 → 健康检查 → 连续发起多个路线规划请求 → 格式化展示结果
 *
 * 路线规划通过 REST API 直接调用（/api/routing/*），
 * 这是 TUI 客户端在命令行下最自然、最稳定的调用方式。
 *
 * 用法：
 *   node scripts/simulate-tui-routing.mjs
 */

// ============================================================
// 配置
// ============================================================
const GATEWAY_HTTP = 'http://127.0.0.1:18780/api';
const TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 120_000; // 整体超时保护

// ============================================================
// 工具函数
// ============================================================

/** 带超时的 fetch */
async function apiGet(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${GATEWAY_HTTP}${path}`, { signal: controller.signal });
    const json = await resp.json().catch(() => ({}));
    return { status: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

/** 格式化距离（米 → 公里） */
function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} 公里`;
  }
  return `${Math.round(meters)} 米`;
}

/** 格式化时长（秒 → 小时+分钟） */
function formatDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

/** 出行方式中文标签 */
const PROFILE_LABEL = {
  driving: '驾车',
  walking: '步行',
  cycling: '骑行',
};

// ============================================================
// ANSI 颜色（提升 TUI 观感）
// ============================================================
const color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

/** 打印分隔线 */
function printDivider(char = '─', len = 64) {
  console.log(color.gray + char.repeat(len) + color.reset);
}

/** 打印标题 */
function printTitle(text) {
  console.log();
  printDivider('═');
  console.log(color.bold + color.cyan + `  ${text}` + color.reset);
  printDivider('═');
}

// ============================================================
// 路线规划查询
// ============================================================

/**
 * 查询单个路线规划
 * @param {string} origin 起点名称
 * @param {string} destination 终点名称
 * @param {string} profile 出行方式：driving/walking/cycling
 */
async function queryRoute(origin, destination, profile = 'driving') {
  const params = new URLSearchParams({
    origin,
    destination,
    profile,
  });
  const url = `/routing/plan?${params.toString()}`;

  console.log();
  console.log(`${color.bold}> 查询路线${color.reset} ${color.yellow}[${PROFILE_LABEL[profile]}]${color.reset}：${origin} → ${destination}`);
  console.log(`${color.dim}  请求: GET /api/routing/plan?origin=...&destination=...&profile=${profile}${color.reset}`);

  const startedAt = Date.now();
  const resp = await apiGet(url);
  const elapsedMs = Date.now() - startedAt;

  if (resp.status !== 200 || !resp.body?.ok) {
    const errMsg = resp.body?.error?.message || `HTTP ${resp.status}`;
    console.log(`${color.red}  ✗ 查询失败：${errMsg}${color.reset} ${color.dim}(${elapsedMs}ms)${color.reset}`);
    return { success: false, error: errMsg, elapsedMs };
  }

  const plan = resp.body.data;
  console.log(`${color.green}  ✓ 查询成功${color.reset} ${color.dim}(${elapsedMs}ms)${color.reset}`);

  // 打印路线摘要
  console.log();
  console.log(`  ${color.magenta}🚩 起点${color.reset}    : ${plan.origin.name}`);
  console.log(`  ${color.magenta}    坐标${color.reset}    : (${plan.origin.coordinate.latitude.toFixed(5)}, ${plan.origin.coordinate.longitude.toFixed(5)})`);
  console.log(`  ${color.blue}🏁 终点${color.reset}    : ${plan.destination.name}`);
  console.log(`  ${color.blue}    坐标${color.reset}    : (${plan.destination.coordinate.latitude.toFixed(5)}, ${plan.destination.coordinate.longitude.toFixed(5)})`);
  console.log();
  console.log(`  ${color.bold}📊 总距离${color.reset}  : ${formatDistance(plan.totalDistanceMeters)}`);
  console.log(`  ${color.bold}⏱️  总时长${color.reset}  : ${formatDuration(plan.totalDurationSeconds)}`);
  console.log(`  ${color.bold}🛣️  路径点${color.reset}  : ${plan.geometry.length} 个`);
  console.log(`  ${color.bold}📝 步骤数${color.reset}  : ${plan.steps.length} 段`);

  // 打印前 5 步导航
  if (plan.steps.length > 0) {
    console.log();
    console.log(`  ${color.bold}🧭 导航步骤（前 5 段）：${color.reset}`);
    const showSteps = plan.steps.slice(0, 5);
    for (const step of showSteps) {
      const stepDistance = formatDistance(step.distanceMeters);
      console.log(`    ${color.cyan}${String(step.index).padStart(2, ' ')}.${color.reset} ${step.instruction} ${color.dim}— ${stepDistance}${color.reset}`);
    }
    if (plan.steps.length > 5) {
      console.log(`    ${color.dim}... 还有 ${plan.steps.length - 5} 段步骤${color.reset}`);
    }
  }

  return { success: true, plan, elapsedMs };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(color.bold + color.cyan);
  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║' + '模拟 TUI 交互会话 — 路线规划功能验证'.padCenter(38).padEnd(62) + '║');
  console.log('╚' + '═'.repeat(62) + '╝');
  console.log(color.reset);

  // ── 步骤 1：健康检查 ──
  printTitle('步骤 1 / 4：网关健康检查');
  const health = await apiGet('/health');
  if (health.status !== 200 || health.body?.data?.status !== 'healthy') {
    console.log(`${color.red}✗ 网关未启动或不可达 (HTTP ${health.status})${color.reset}`);
    console.log(`${color.dim}  请先执行: cd server && npm run dev${color.reset}`);
    process.exit(1);
  }
  console.log(`${color.green}✓ 网关运行正常${color.reset} ${color.dim}— status: ${health.body.data.status}${color.reset}`);

  // ── 步骤 2：多轮路线规划查询 ──
  printTitle('步骤 2 / 4：连续查询多条路线');

  // 模拟用户在 TUI 中连续发起的 3 次路线查询
  const queries = [
    { origin: '北京', destination: '天津', profile: 'driving' },
    { origin: '上海', destination: '杭州', profile: 'driving' },
    { origin: '上海', destination: '苏州', profile: 'walking' },
  ];

  const results = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    printTitle(`查询 ${i + 1} / ${queries.length}：${q.origin} → ${q.destination}（${PROFILE_LABEL[q.profile]}）`);
    const result = await queryRoute(q.origin, q.destination, q.profile);
    results.push({ ...q, ...result });
  }

  // ── 步骤 3：错误场景验证 ──
  printTitle('步骤 3 / 4：错误场景验证（不存在的地点）');
  const errorQuery = await queryRoute('zzz_no_such_place_a', 'zzz_no_such_place_b', 'driving');
  if (!errorQuery.success) {
    console.log(`${color.green}✓ 错误处理正常${color.reset} ${color.dim}— 未能识别的地点被正确拒绝${color.reset}`);
  } else {
    console.log(`${color.red}✗ 错误处理异常：应失败但成功了${color.reset}`);
  }

  // ── 步骤 4：汇总报告 ──
  printTitle('步骤 4 / 4：汇总报告');

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const avgMs = Math.round(results.reduce((sum, r) => sum + (r.elapsedMs || 0), 0) / results.length);

  console.log(`  ${color.bold}总查询数${color.reset}  : ${results.length}`);
  console.log(`  ${color.green}成功${color.reset}      : ${successCount}`);
  if (failCount > 0) {
    console.log(`  ${color.red}失败${color.reset}      : ${failCount}`);
  }
  console.log(`  ${color.bold}平均耗时${color.reset}  : ${avgMs} ms`);
  console.log();
  console.log(`  ${color.bold}各路线距离与时长：${color.reset}`);
  for (const r of results) {
    if (r.success) {
      const dist = formatDistance(r.plan.totalDistanceMeters);
      const dur = formatDuration(r.plan.totalDurationSeconds);
      const label = PROFILE_LABEL[r.profile];
      console.log(`    ${color.cyan}${label.padEnd(4)}${color.reset} ${r.origin} → ${r.destination} : ${dist} / ${dur}`);
    } else {
      console.log(`    ${color.red}${PROFILE_LABEL[r.profile].padEnd(4)}${color.reset} ${r.origin} → ${r.destination} : 失败 (${r.error})`);
    }
  }

  console.log();
  printDivider('═');
  if (successCount === results.length && !errorQuery.success) {
    console.log(`${color.bold}${color.green}  ✅ TUI 路线规划交互验证全部通过${color.reset}`);
  } else {
    console.log(`${color.bold}${color.red}  ❌ 验证存在失败项${color.reset}`);
  }
  printDivider('═');

  process.exit(successCount === results.length && !errorQuery.success ? 0 : 1);
}

// 总超时保护
setTimeout(() => {
  console.error(`\n${color.red}⏰ 总超时 ${TOTAL_TIMEOUT_MS / 1000}s，强制退出${color.reset}`);
  process.exit(2);
}, TOTAL_TIMEOUT_MS);

// String.prototype.padCenter 兼容性补丁（Node.js 没有 padCenter）
if (!String.prototype.padCenter) {
  String.prototype.padCenter = function (width) {
    const str = String(this);
    if (str.length >= width) return str;
    const total = width - str.length;
    const left = Math.floor(total / 2);
    const right = total - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  };
}

main().catch((err) => {
  console.error(`${color.red}未捕获异常：${err.message}${color.reset}`);
  console.error(err.stack);
  process.exit(1);
});
