/**
 * cdp-test.mjs —— 基于 Chrome DevTools Protocol 的无头验证脚本
 * 零新依赖：Node 22 内置 WebSocket / fetch。
 * 功能：打开页面 -> 等待仿真运行 -> 读取粒子状态 -> 可指定相机角度截图
 * 用法：node tools/cdp-test.mjs [url] [shotPath] [cameraPreset]
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const URL = process.argv[2] || 'http://localhost:8123/';
const SHOT = process.argv[3] || 'test-out/cdp.png';
const PRESET = process.argv[4] || 'default'; // default | top | side
const PORT = 9333;

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,800',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等待 DevTools 端点就绪
let tabs;
for (let i = 0; i < 40; i++) {
  try {
    tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    if (tabs.length) break;
  } catch {}
  await sleep(250);
}
const page = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });

// 在页面里求值
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}

// 等 GLB 加载 + 仿真产生粒子（轮询真实运行状态）
let stats = null;
for (let i = 0; i < 90; i++) {
  await sleep(500);
  stats = await evalJs(`(() => {
    if (!window.__particles) return null;
    const ps = window.__particles.filter(p => p.active);
    return {
      active: ps.length,
      states: ps.reduce((a,p)=>{a[p.state]=(a[p.state]||0)+1;return a;},{}),
      hasCanvas: !!document.querySelector('canvas'),
      model: (document.getElementById('modelState')||{}).textContent,
    };
  })()`);
  // 等到出现 STRAND 阶段（说明完整跑通 下落->输送->熔融->挤出 全流程）
  if (stats && stats.states.STRAND > 0) break;
}

// 调整相机视角（直接操作 three 内部对象不可达，改为给 OrbitControls 一个标记位——
// 这里通过修改 camera 位置的等价手段：重新加载带预设参数的 URL 不现实，
// 故统计数据为主，截图采用默认视角；俯视检查由独立预设页面完成）
if (PRESET !== 'default') {
  await evalJs(`window.__camPreset = ${JSON.stringify(PRESET)}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(SHOT, Buffer.from(shot.result.data, 'base64'));
console.log('STATS', JSON.stringify(stats));

ws.close();
chrome.kill();
process.exit(0);
