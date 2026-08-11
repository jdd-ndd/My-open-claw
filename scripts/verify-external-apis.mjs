/**
 * 外部组件功能完整测试脚本
 *
 * 验证三类外部组件 API：
 *   1. 时间查询  /api/time
 *   2. 天气查询  /api/weather/lookup | /api/weather/current | /api/weather/forecast
 *   3. 路线规划  /api/routing/geocode | /api/routing/plan
 *
 * 直接调用 HTTP REST 接口，无需 WebSocket 客户端。
 */

const GATEWAY_HTTP = 'http://127.0.0.1:18780/api';
const TIMEOUT_MS = 30_000;

let pass = 0;
let fail = 0;
const failures = [];

/** 断言辅助函数 */
function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** 带 timeout 的 fetch，遇到 5xx 自动重试一次（应对上游 API 限流） */
async function apiGet(path) {
  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(`${GATEWAY_HTTP}${path}`, { signal: controller.signal });
      const json = await resp.json().catch(() => ({}));
      return { status: resp.status, body: json };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await doFetch();
  // 上游 API 限流或临时故障时重试一次
  if (first.status >= 500) {
    await new Promise((r) => setTimeout(r, 800));
    return doFetch();
  }
  return first;
}

// ════════════════════════════════════════════════════════════════
// 测试 1：时间查询 API
// ════════════════════════════════════════════════════════════════
async function test_time() {
  console.log('\n' + '═'.repeat(64));
  console.log('  测试 1: 时间查询 API — /api/time');
  console.log('═'.repeat(64));

  const { status, body } = await apiGet('/time');
  check('HTTP 状态码 200', status === 200, `status=${status}`);
  check('返回 ok=true', body?.ok === true);
  check('返回 serverTime 字段', typeof body?.data?.serverTime === 'string');
  check('返回 serverTimestamp 字段', typeof body?.data?.serverTimestamp === 'number');

  // 验证时间准确性（与本地时间差 < 5 秒）
  const serverTs = body?.data?.serverTimestamp;
  const localTs = Date.now();
  const diff = Math.abs(serverTs - localTs);
  check('服务器时间与本地时间偏差 < 5s', diff < 5000, `diff=${diff}ms`);

  if (body?.data?.serverTime) {
    console.log(`  📅 服务器时间: ${body.data.serverTime}`);
  }
}

// ════════════════════════════════════════════════════════════════
// 测试 2：天气查询 API（lookup + current + forecast）
// ════════════════════════════════════════════════════════════════
async function test_weather() {
  console.log('\n' + '═'.repeat(64));
  console.log('  测试 2: 天气查询 API — /api/weather/*');
  console.log('═'.repeat(64));

  // 2.1 lookup
  console.log('\n  ── 2.1 城市搜索 /weather/lookup ──');
  const lookupResp = await apiGet(`/weather/lookup?query=${encodeURIComponent('北京')}&count=3`);
  check('lookup 状态码 200', lookupResp.status === 200, `status=${lookupResp.status}`);
  check('lookup ok=true', lookupResp.body?.ok === true);
  check('lookup 返回 locations 数组', Array.isArray(lookupResp.body?.data?.locations));
  check('lookup 至少 1 个结果', (lookupResp.body?.data?.locations?.length ?? 0) > 0);

  const firstLocation = lookupResp.body?.data?.locations?.[0];
  if (firstLocation) {
    console.log(`  📍 命中: ${firstLocation.name}, ${firstLocation.country}`);
    console.log(`     经纬度: (${firstLocation.latitude}, ${firstLocation.longitude})`);
  }

  // 2.2 current
  console.log('\n  ── 2.2 实时天气 /weather/current ──');
  const currentResp = await apiGet(`/weather/current?city=${encodeURIComponent('北京')}`);
  check('current 状态码 200', currentResp.status === 200, `status=${currentResp.status}`);
  check('current ok=true', currentResp.body?.ok === true);
  check('current 返回 city 字段', typeof currentResp.body?.data?.city === 'string');
  check('current 返回 current 对象', typeof currentResp.body?.data?.current === 'object');
  check('current 返回 temperatureC', typeof currentResp.body?.data?.current?.temperatureC === 'number');

  if (currentResp.body?.data?.current) {
    const c = currentResp.body.data.current;
    console.log(`  🌡️  温度: ${c.temperatureC}°C`);
    console.log(`  💨 风速: ${c.windSpeedKph} km/h`);
    console.log(`  🕐 观测时间: ${c.observedAt ?? 'N/A'}`);
  }

  // 2.3 forecast
  console.log('\n  ── 2.3 多日预报 /weather/forecast ──');
  const forecastResp = await apiGet(`/weather/forecast?city=${encodeURIComponent('上海')}&days=3`);
  check('forecast 状态码 200', forecastResp.status === 200, `status=${forecastResp.status}`);
  check('forecast ok=true', forecastResp.body?.ok === true);
  check('forecast 返回 days 数组', Array.isArray(forecastResp.body?.data?.days));
  check('forecast days 长度 = 3', forecastResp.body?.data?.days?.length === 3);

  if (forecastResp.body?.data?.days?.length) {
    console.log(`  📅 上海 3 日预报:`);
    for (const day of forecastResp.body.data.days) {
      console.log(`     ${day.date} | ${day.tempMinC}°C ~ ${day.tempMaxC}°C | 降水概率 ${day.precipitationProbabilityMax}%`);
    }
  }

  // 2.4 错误处理：未找到城市
  console.log('\n  ── 2.4 错误处理：不存在的城市 ──');
  const notFoundResp = await apiGet(`/weather/current?city=zzz_not_exist_city_xyz`);
  check('未找到城市状态码 404', notFoundResp.status === 404, `status=${notFoundResp.status}`);
  check('未找到城市返回 error', !!notFoundResp.body?.error);
}

// ════════════════════════════════════════════════════════════════
// 测试 3：路线规划 API（geocode + plan）
// ════════════════════════════════════════════════════════════════
async function test_routing() {
  console.log('\n' + '═'.repeat(64));
  console.log('  测试 3: 路线规划 API — /api/routing/*');
  console.log('═'.repeat(64));

  // 3.1 geocode
  console.log('\n  ── 3.1 地理编码 /routing/geocode ──');
  const geocodeResp = await apiGet(`/routing/geocode?query=${encodeURIComponent('上海')}`);
  check('geocode 状态码 200', geocodeResp.status === 200, `status=${geocodeResp.status}`);
  check('geocode ok=true', geocodeResp.body?.ok === true);
  check('geocode 返回 name 字段', typeof geocodeResp.body?.data?.name === 'string');
  check('geocode 返回 coordinate 对象', typeof geocodeResp.body?.data?.coordinate === 'object');
  check('geocode 返回 latitude', typeof geocodeResp.body?.data?.coordinate?.latitude === 'number');
  check('geocode 返回 longitude', typeof geocodeResp.body?.data?.coordinate?.longitude === 'number');

  if (geocodeResp.body?.data) {
    console.log(`  📍 ${geocodeResp.body.data.name}`);
    console.log(`     经纬度: (${geocodeResp.body.data.coordinate.latitude}, ${geocodeResp.body.data.coordinate.longitude})`);
  }

  // 3.2 plan — 驾车
  console.log('\n  ── 3.2 路线规划（驾车） /routing/plan ──');
  const planResp = await apiGet(`/routing/plan?origin=${encodeURIComponent('北京')}&destination=${encodeURIComponent('天津')}&profile=driving`);
  check('plan 状态码 200', planResp.status === 200, `status=${planResp.status}`);
  check('plan ok=true', planResp.body?.ok === true);
  check('plan 返回 origin', typeof planResp.body?.data?.origin?.name === 'string');
  check('plan 返回 destination', typeof planResp.body?.data?.destination?.name === 'string');
  check('plan 返回 profile=driving', planResp.body?.data?.profile === 'driving');
  check('plan 返回 totalDistanceMeters', typeof planResp.body?.data?.totalDistanceMeters === 'number');
  check('plan 返回 totalDurationSeconds', typeof planResp.body?.data?.totalDurationSeconds === 'number');
  check('plan 返回 geometry 数组', Array.isArray(planResp.body?.data?.geometry));
  check('plan 返回 steps 数组', Array.isArray(planResp.body?.data?.steps));
  check('plan geometry 至少 2 个点', (planResp.body?.data?.geometry?.length ?? 0) >= 2);
  check('plan steps 至少 1 步', (planResp.body?.data?.steps?.length ?? 0) >= 1);

  if (planResp.body?.data) {
    const plan = planResp.body.data;
    const distanceKm = (plan.totalDistanceMeters / 1000).toFixed(2);
    const durationMin = Math.round(plan.totalDurationSeconds / 60);
    console.log(`  🚗 ${plan.origin.name} → ${plan.destination.name}`);
    console.log(`     总距离: ${distanceKm} 公里`);
    console.log(`     总时长: ${durationMin} 分钟`);
    console.log(`     路径点数: ${plan.geometry.length}`);
    console.log(`     步骤数: ${plan.steps.length}`);
    console.log(`     前 3 步:`);
    for (const step of plan.steps.slice(0, 3)) {
      const stepKm = (step.distanceMeters / 1000).toFixed(2);
      console.log(`       ${step.index}. ${step.instruction} — ${stepKm} km`);
    }
  }

  // 3.3 plan — 步行（短路径验证）
  console.log('\n  ── 3.3 路线规划（步行） /routing/plan ──');
  const walkResp = await apiGet(`/routing/plan?origin=${encodeURIComponent('上海')}&destination=${encodeURIComponent('苏州')}&profile=walking`);
  check('walking 状态码 200', walkResp.status === 200, `status=${walkResp.status}`);
  check('walking profile=walking', walkResp.body?.data?.profile === 'walking');
  check('walking 返回 steps', Array.isArray(walkResp.body?.data?.steps));

  if (walkResp.body?.data) {
    const plan = walkResp.body.data;
    const distanceKm = (plan.totalDistanceMeters / 1000).toFixed(2);
    const durationMin = Math.round(plan.totalDurationSeconds / 60);
    console.log(`  🚶 ${plan.origin.name} → ${plan.destination.name}`);
    console.log(`     总距离: ${distanceKm} 公里 | 时长: ${durationMin} 分钟`);
  }

  // 3.4 错误处理：不存在的地点
  console.log('\n  ── 3.4 错误处理：不存在的地点 ──');
  const errResp = await apiGet('/routing/plan?origin=zzz_no_such_place_a&destination=zzz_no_such_place_b');
  check('错误地点状态码 404', errResp.status === 404, `status=${errResp.status}`);
  check('错误地点返回 error', !!errResp.body?.error);
}

// ════════════════════════════════════════════════════════════════
// 测试 4：运算组件 API（express / unit / currency / base）
// ════════════════════════════════════════════════════════════════
async function test_calculator() {
  console.log('\n' + '═'.repeat(64));
  console.log('  测试 4: 运算组件 API — /api/calculator/*');
  console.log('═'.repeat(64));

  // 4.1 表达式求值
  console.log('\n  ── 4.1 数学表达式求值 /calculator/express ──');

  const cases = [
    { expr: '1 + 2 * 3', expect: 7 },
    { expr: '(1 + 2) * 3', expect: 9 },
    { expr: '2^10', expect: 1024 },
    { expr: 'sin(π/2)', expect: 1, tolerance: 1e-10 },
    { expr: 'log(100)', expect: 2 },
    { expr: 'ln(e)', expect: 1, tolerance: 1e-10 },
    { expr: 'sqrt(144)', expect: 12 },
    { expr: 'abs(-5)', expect: 5 },
    { expr: '1.5e3 + 500', expect: 2000 },
    { expr: '10 % 3', expect: 1 },
  ];

  for (const c of cases) {
    const resp = await apiGet(`/calculator/express?expression=${encodeURIComponent(c.expr)}`);
    const value = resp.body?.data?.value;
    const tolerance = c.tolerance ?? 0;
    const ok = resp.status === 200 && typeof value === 'number' && Math.abs(value - c.expect) <= tolerance;
    check(`express "${c.expr}" = ${c.expect}`, ok, `got=${value}, status=${resp.status}`);
  }

  // 表达式错误处理：除零
  const divZero = await apiGet(`/calculator/express?expression=${encodeURIComponent('1/0')}`);
  check('express 除零返回 400', divZero.status === 400, `status=${divZero.status}`);
  check('express 除零返回 error', !!divZero.body?.error);

  // 4.2 单位换算
  console.log('\n  ── 4.2 单位换算 /calculator/unit ──');

  const unitCases = [
    { value: 100, from: 'km', to: 'mile', expectApprox: 62.14, label: '100km→mile' },
    { value: 1, from: 'mile', to: 'km', expectApprox: 1.609344, label: '1mile→km' },
    { value: 100, from: 'kg', to: 'lb', expectApprox: 220.4623, label: '100kg→lb' },
    { value: 100, from: 'celsius', to: 'fahrenheit', expectApprox: 212, label: '100℃→℉' },
    { value: 32, from: 'fahrenheit', to: 'celsius', expectApprox: 0, label: '32℉→℃' },
    { value: 0, from: 'celsius', to: 'kelvin', expectApprox: 273.15, label: '0℃→K' },
    { value: 1, from: 'hectare', to: 'm2', expectApprox: 10000, label: '1ha→m²' },
    { value: 100, from: 'km/h', to: 'mph', expectApprox: 62.137, label: '100km/h→mph' },
  ];

  for (const c of unitCases) {
    const resp = await apiGet(`/calculator/unit?value=${c.value}&from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}`);
    const out = resp.body?.data?.output;
    const ok = resp.status === 200 && typeof out === 'number' && Math.abs(out - c.expectApprox) < 0.01;
    check(`unit ${c.label}`, ok, `got=${out}, status=${resp.status}`);
  }

  // 单位换算错误处理：类别不匹配
  const mismatch = await apiGet(`/calculator/unit?value=1&from=km&to=kg`);
  check('unit 类别不匹配返回 400', mismatch.status === 400, `status=${mismatch.status}`);

  // 4.3 货币汇率换算（联网，允许失败重试）
  console.log('\n  ── 4.3 货币汇率换算 /calculator/currency ──');

  const cny2usd = await apiGet(`/calculator/currency?amount=100&base=CNY&target=USD`);
  check('currency 状态码 200', cny2usd.status === 200, `status=${cny2usd.status}`);
  check('currency ok=true', cny2usd.body?.ok === true);
  check('currency 返回 base=CNY', cny2usd.body?.data?.base === 'CNY');
  check('currency 返回 target=USD', cny2usd.body?.data?.target === 'USD');
  check('currency 返回 rate > 0', typeof cny2usd.body?.data?.rate === 'number' && cny2usd.body?.data?.rate > 0);
  check('currency 返回 convertedAmount > 0', typeof cny2usd.body?.data?.convertedAmount === 'number' && cny2usd.body?.data?.convertedAmount > 0);

  if (cny2usd.body?.data) {
    const d = cny2usd.body.data;
    console.log(`  💱 100 CNY → ${d.convertedAmount.toFixed(2)} USD (汇率: ${d.rate.toFixed(4)})`);
    console.log(`     更新时间: ${d.updatedAt ?? 'N/A'}`);
  }

  // 4.4 进制转换
  console.log('\n  ── 4.4 进制转换 /calculator/base ──');

  const baseCases = [
    { input: '255', from: 10, to: 16, expect: 'FF' },
    { input: '255', from: 10, to: 2, expect: '11111111' },
    { input: '0xFF', from: 16, to: 10, expect: '255' },
    { input: '777', from: 8, to: 10, expect: '511' },
    { input: '1010', from: 2, to: 10, expect: '10' },
    { input: '1024', from: 10, to: 8, expect: '2000' },
  ];

  for (const c of baseCases) {
    const resp = await apiGet(`/calculator/base?input=${encodeURIComponent(c.input)}&fromBase=${c.from}&toBase=${c.to}`);
    const out = resp.body?.data?.output;
    const ok = resp.status === 200 && out === c.expect;
    check(`base ${c.input} (${c.from}→${c.to}) = ${c.expect}`, ok, `got=${out}, status=${resp.status}`);
  }

  // 进制转换错误处理：非法字符
  const invalidDigit = await apiGet(`/calculator/base?input=9&fromBase=2&toBase=10`);
  check('base 非法字符返回 400', invalidDigit.status === 400, `status=${invalidDigit.status}`);
}

// ════════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║  外部组件功能完整测试 — 时间 / 天气 / 路线规划             ║');
  console.log('╚' + '═'.repeat(62) + '╝');

  // 先 ping 网关健康状态
  const health = await apiGet('/health');
  if (health.status !== 200) {
    console.log(`\n❌ 网关未启动或不可达 (HTTP ${health.status})，请先执行 npm run dev`);
    process.exit(1);
  }
  console.log(`\n  ✓ 网关健康状态: ${health.body?.data?.status ?? 'unknown'}`);

  try {
    await test_time();
  } catch (e) {
    console.log(`  ✗ 时间测试异常: ${e.message}`);
    fail++;
    failures.push('test_time');
  }

  try {
    await test_weather();
  } catch (e) {
    console.log(`  ✗ 天气测试异常: ${e.message}`);
    fail++;
    failures.push('test_weather');
  }

  try {
    await test_routing();
  } catch (e) {
    console.log(`  ✗ 路线规划测试异常: ${e.message}`);
    fail++;
    failures.push('test_routing');
  }

  try {
    await test_calculator();
  } catch (e) {
    console.log(`  ✗ 运算组件测试异常: ${e.message}`);
    fail++;
    failures.push('test_calculator');
  }

  // 汇总
  console.log('\n' + '═'.repeat(64));
  console.log('  汇总报告');
  console.log('═'.repeat(64));
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  if (failures.length > 0) {
    console.log(`  失败项: ${failures.join(', ')}`);
  }
  console.log(`  整体: ${fail === 0 ? '✅ 全部通过' : '❌ 存在失败'}`);

  process.exit(fail === 0 ? 0 : 1);
}

// 总超时保护
setTimeout(() => {
  console.log('\n⏰ 总超时 60s，强制退出');
  process.exit(2);
}, 60_000);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
