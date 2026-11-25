/**
 * cdp-scene-shots.mjs —— 产出两张状态截图：暂停定格、高转速
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const PORT = 9366;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, '--window-size=1280,800', 'about:blank',
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
await send('Page.navigate', { url: 'http://localhost:8123/?cam=cut' });
await sleep(8000);

// 截图 1：暂停定格
await evalJs(`document.getElementById('btnToggle').click()`);
await sleep(400);
let shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile('test-out/state-paused.png', Buffer.from(shot.result.data, 'base64'));
const paused = await evalJs(`document.getElementById('runState').textContent`);
const p1 = await evalJs(`JSON.stringify(window.__particles.filter(p=>p.active).slice(0,3).map(p=>p.x))`);
await sleep(600);
const p2 = await evalJs(`JSON.stringify(window.__particles.filter(p=>p.active).slice(0,3).map(p=>p.x))`);
console.log('暂停状态:', paused, ' 粒子位置两次采样一致:', p1 === p2);

// 恢复并切到高转速
await evalJs(`document.getElementById('btnToggle').click()`);
await evalJs(`(()=>{const s=document.getElementById('rpm');s.value=140;s.dispatchEvent(new Event('input'));})()`);
await sleep(2500);
shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile('test-out/state-highrpm.png', Buffer.from(shot.result.data, 'base64'));
const active = await evalJs(`window.__particles.filter(p=>p.active).length`);
const rpm = await evalJs(`document.getElementById('rpmVal').textContent`);
console.log('高转速:', rpm, ' 活跃粒子数:', active);
ws.close(); chrome.kill(); process.exit(0);
