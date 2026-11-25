/**
 * export-models.mjs
 * 用 three 的 GLTFExporter 把参数化挤出机部件导出为轻量 GLB。
 * 运行：node tools/export-models.mjs
 * 产物：models/ 下的 base / barrel / screws / hopper / die 共 5 个 glb
 */
import './filereader-polyfill.mjs';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const THREE = require('three');
const { GLTFExporter } = require('three/examples/jsm/exporters/GLTFExporter.js');
const MG = require('../src/machine-geometry.js')(THREE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'models');
await mkdir(OUT_DIR, { recursive: true });

const parts = MG.buildAll();
// 两根螺杆合并为一个 GLB（保留 ScrewLeft / ScrewRight 两个命名分组）
const screwPair = new THREE.Group();
screwPair.name = 'ScrewPair';
screwPair.add(parts.screwLeft, parts.screwRight);

const targets = [
  ['base.glb', parts.base],
  ['barrel.glb', parts.barrel],
  ['screws.glb', screwPair],
  ['hopper.glb', parts.hopper],
  ['die.glb', parts.die],
];

const exporter = new GLTFExporter();
function exportGLB(object) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (gltf) => resolve(gltf),
      (err) => reject(err),
      { binary: true, onlyVisible: true }
    );
  });
}

for (const [fileName, object] of targets) {
  const glb = await exportGLB(object);
  const outPath = join(OUT_DIR, fileName);
  await writeFile(outPath, Buffer.from(glb));
  // 统计三角面数
  let triangles = 0;
  object.traverse((o) => {
    if (o.isMesh && o.geometry.index) triangles += o.geometry.index.count / 3;
  });
  console.log(`${fileName.padEnd(12)} ${String(glb.byteLength).padStart(7)} B  ~${Math.round(triangles)} tris`);
}
console.log('GLB export done ->', OUT_DIR);
