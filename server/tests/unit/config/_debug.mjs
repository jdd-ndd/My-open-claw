// 调试: 验证 applyEnvOverrides 行为
process.env.MYOC_NETWORK_WS_PORT = '18800';
process.env.MYOC_LLM_APIKEY = 'sk-env-override';
process.env.MYOC_FEATURES_SCHEDULER = 'false';

import('../../../src/core/config/merger.ts').then(m => {
  // Test 1: 数字覆盖
  const cfg1 = { network: { ws: { port: 18780 } } };
  m.applyEnvOverrides(cfg1);
  console.log('Test 1 (数字覆盖):', JSON.stringify(cfg1));
  console.log('  expected: { network: { ws: { port: 18800 } } }');

  // Test 2: 字符串覆盖
  const cfg2 = { llm: { apiKey: 'original' } };
  m.applyEnvOverrides(cfg2);
  console.log('Test 2 (字符串覆盖):', JSON.stringify(cfg2));
  console.log('  expected: { llm: { apiKey: "sk-env-override" } }');
});
