# 双螺杆挤出机 3D 动态仿真

基于 **Three.js 原生能力**的高分子加工设备原理可视化演示：展示塑料颗粒从料斗落入机筒、双螺杆啮合输送、逐步熔融混炼、最终从机头模口连续挤出条状料坯的全过程。

仅做**视觉示意**，不计算温度、剪切压力、熔融粘度等物理参数；粒子只表现物料输送与熔融趋势，无流体 / 材料物理重型求解库。

## 运行方式

### 方式一：本地静态服务器（推荐，加载外部 GLB 模型）

```bash
npm start            # 等价于 node tools/serve.mjs
```

浏览器打开 <http://localhost:8123/> 即可。此模式下 `GLTFLoader` 正常加载 `models/*.glb`。

### 方式二：直接双击 index.html（file:// 直开）

浏览器出于安全策略禁止 `file://` 页面 fetch 本地 GLB，程序会**自动降级**为同一套参数化几何即时建模（外观一致），页面左下角会提示「内置参数化几何（本地直开降级模式）」。无需联网、无需服务器即可运行。

## 交互功能

| 控件 | 说明 |
| --- | --- |
| 暂停 / 继续 | 定格整个仿真，可静止观察物料在螺槽内的推进状态 |
| 重置物料 | 清空全部粒子并重新落料（螺杆位置保持不变） |
| 螺杆转速滑杆 | 10–150 rpm 可调；粒子输送速度、生成速率与转速严格联动 |
| 鼠标左键拖拽 | 旋转视角（OrbitControls） |
| 滚轮 | 缩放 |
| 鼠标右键拖拽 | 平移相机 |

URL 预设视角：`?cam=top`（俯视）、`?cam=side`（侧视）、`?cam=cut`（斜俯剖切视角）。

## 仿真原理与实现要点

- **双螺杆**：两根螺杆旋向相反、等速反向旋转（左 `-ω`、右 `+ω`），右螺杆初始相位偏移 180° 使螺棱在啮合区交错；中心距 0.92 小于两倍外半径（1.16）形成啮合重叠，外缘与机筒保持 0.04 稳定径向间隙。
- **物料输送**：粒子状态机 `FALL（料斗下落）→ FEED（螺槽螺旋推进）→ DIE（机头收敛）→ STRAND（模口挤出）`。输送速度 `vx = rpm/60 × 螺距`，与转速确定性联动；粒子跟随螺棱角度旋转，少量在两螺杆间交换以表现混炼翻料。
- **熔融示意**：粒子颜色按沿程位置从固体金黄 `#d8b56b` → 软化橙 `#e07b39` → 熔体红 `#c23a2b` 渐变（页面右下角有图例）。
- **挤出条带**：固定环数的管状网格 + 行波摆动与轻微下垂，呈现连续挤出的流动感，避免每帧重建几何。
- **粒子系统**：单个 `THREE.Points` + 对象池（上限 700），圆形柔边贴图由 canvas 程序化生成，关闭深度写入、置于最前渲染，保证剖视机筒内物料清晰可读。
- **渲染**：环境光 + 双方向光、PCF 柔和阴影、淡雾增强纵深；机筒采用教学剖视结构（底部 U 形料槽 + C 形加热抱箍，上部敞开）。

## 目录结构

```
├── index.html              # 入口页面（简洁控制面板）
├── src/
│   ├── main.js             # 仿真主程序：场景/装配/粒子状态机/动画循环/UI
│   ├── machine-geometry.js # 参数化挤出机几何（Node 导出 GLB 与浏览器降级共用）
│   └── style.css           # 面板与图例样式
├── models/                 # 5 个轻量 GLB（总计约 0.5 MB，约 1.2 万三角面）
│   ├── base.glb  barrel.glb  screws.glb  hopper.glb  die.glb
├── vendor/                 # 本地 UMD 依赖（three r147 + OrbitControls + GLTFLoader）
└── tools/
    ├── serve.mjs            # 零依赖静态服务器
    ├── export-models.mjs    # 用 GLTFExporter 把参数化几何导出为 GLB
    ├── filereader-polyfill.mjs  # Node 端 GLTFExporter 所需 FileReader polyfill
    └── cdp-*.mjs            # 基于 Chrome DevTools Protocol 的无头自动化验证
```

## 重新生成模型

几何参数集中在 `src/machine-geometry.js` 顶部的 `CONFIG`。修改后重新导出 GLB：

```bash
npm run build:models
```

## 自动化验证

需本机安装 Chrome / Edge（脚本默认路径指向 Chrome，可在 `tools/cdp-*.mjs` 顶部修改）。先 `npm start` 启动服务器，再运行：

```bash
npm run test:rotation   # 验证双螺杆等幅、反向、恒定角速度
npm run test:func       # 验证启停定格、转速联动、重置物料等交互
```

## 技术约束

- Three.js r147（UMD），仅用其原生能力 + 官方 `OrbitControls` / `GLTFLoader`
- `requestAnimationFrame` 驱动单循环，无流体、物理、材质参数求解库
- 无外部图片 / 字体 / CDN 依赖，断网可运行
