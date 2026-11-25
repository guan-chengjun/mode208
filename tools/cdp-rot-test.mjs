/**
 * cdp-rot-test.mjs —— 验证两根螺杆同步、反向旋转
 * 思路：暂停后读取两螺杆当前 rotation.x，分两步各推进固定时间，
 *       对比两者角度变化量的符号与幅值（应等幅反号）。
 */
import { spawn } from 'node:child_process';
const PORT = 9355;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, 'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) {
  try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.length) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let mid = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => { const id = ++mid; ws.send(JSON.stringify({ id, method, params })); return new Promise((res) => pending.set(id, res)); };
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value;

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8123/?cam=side' });
await sleep(8000);

// 等距采样三次螺杆角度（运行状态），同时记录高精度时间戳
const samples = [];
for (let i = 0; i < 3; i++) {
  samples.push(await evalJs(`JSON.stringify({ rot: window.__getScrewRot(), t: performance.now() })`));
  await sleep(400);
}
const nums = samples.map((s) => JSON.parse(s));
// 用「角度变化 / 实际耗时」得到角速度，再做比较（消除帧间隔抖动）
const rate = (a, b) => [
  (b.rot[0] - a.rot[0]) / (b.t - a.t),
  (b.rot[1] - a.rot[1]) / (b.t - a.t),
];
const r1 = rate(nums[0], nums[1]);
const r2 = rate(nums[1], nums[2]);
const d1 = [nums[1].rot[0] - nums[0].rot[0], nums[1].rot[1] - nums[0].rot[1]];
const oppositeSign = Math.sign(d1[0]) !== Math.sign(d1[1]);
const equalMag = Math.abs(Math.abs(d1[0]) - Math.abs(d1[1])) < 1e-6;
// 两段角速度相对偏差应小于 5%（无头渲染帧抖动范围内）
const jitter = Math.abs(r1[0] - r2[0]) / Math.abs(r1[0]);
const steady = jitter < 0.05;

console.log('角度采样:', samples.map((s) => JSON.parse(s).rot));
console.log('角速度(rad/ms) 段1:', r1, ' 段2:', r2);
console.log('[啮合] 两螺杆转向相反:', oppositeSign ? 'PASS' : 'FAIL');
console.log('[同步] 两螺杆等幅旋转:', equalMag ? 'PASS' : 'FAIL');
console.log(`[稳定] 角速度恒定（相对偏差 ${(jitter * 100).toFixed(2)}% < 5%）:`, steady ? 'PASS' : 'FAIL');
ws.close(); chrome.kill(); process.exit(0);
