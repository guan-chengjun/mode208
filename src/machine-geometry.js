/**
 * machine-geometry.js
 * 双螺杆挤出机参数化几何（无外部模型依赖）。
 *
 * 同一份几何代码服务两条路径：
 *   1) Node 端 export-models.mjs 调用这些工厂函数，用 GLTFExporter 导出 *.glb；
 *   2) 浏览器端 GLTFLoader 加载失败（如 file:// 直开）时直接调用工厂函数即时建模。
 *
 * 坐标约定：输送方向为 +X，机筒轴线水平，机筒中心位于世界原点 (0,0,0)。
 * 约定全局存在 THREE（浏览器 UMD 全局；Node 端由导出脚本注入 require('three')）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory; // Node: 工厂函数，调用时传入 THREE
  } else {
    root.MachineGeometry = factory(THREE); // 浏览器: 直接用全局 THREE
  }
})(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  /* ---------------- 整机关键尺寸（同时驱动几何与粒子运动，保持一致） ---------------- */
  const CONFIG = {
    BARREL_LENGTH: 7.2,        // 机筒长度（X 向）
    BORE_RADIUS: 0.62,         // 单个机筒内孔半径
    SCREW_CENTER_DIST: 0.92,   // 两螺杆中心距（< 2*外半径，保证啮合区重叠）
    SCREW_OUTER_R: 0.58,      // 螺杆外半径（与机筒保留小间隙）
    SCREW_CORE_R: 0.24,        // 螺杆芯轴半径
    FLIGHT_LEAD: 0.9,          // 螺距（导程）：螺杆转一圈物料前进的距离
    FLIGHT_THICK: 0.07,        // 螺棱轴向厚度
    FLIGHT_TURNS: 7,           // 螺棱总圈数
    HOPPER_X: -2.55,           // 料斗落料口 X 位置（机筒上方）
    HOPPER_BOTTOM_Y: 1.05,     // 料斗锥底下沿高度（贴近机筒上表面）
    DIE_X: 4.15,               // 机头外端（模口）X 位置
    NOZZLE_R: 0.16,            // 模口半径
  };
  CONFIG.SCREW_LENGTH = CONFIG.FLIGHT_LEAD * CONFIG.FLIGHT_TURNS; // 6.3
  // 两螺杆的 Y/Z 中心（沿 X 轴并排，Z 方向错开）
  CONFIG.SCREW_CENTERS = [
    { y: 0, z: -CONFIG.SCREW_CENTER_DIST / 2 },
    { y: 0, z: +CONFIG.SCREW_CENTER_DIST / 2 },
  ];

  /* ---------------------------------- 材质 ---------------------------------- */
  function materials() {
    return {
      // 机筒：深灰钢
      barrel: new THREE.MeshStandardMaterial({ color: 0x5d6b78, metalness: 0.75, roughness: 0.38 }),
      // 机筒上盖：半透明，便于观察内部螺杆与物料
      cover: new THREE.MeshStandardMaterial({
        color: 0x9fb4c4, metalness: 0.1, roughness: 0.15,
        transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide,
      }),
      // 螺杆：亮面加工钢（降低反光强度，让螺旋轮廓更易读）
      screw: new THREE.MeshStandardMaterial({ color: 0xd2d8de, metalness: 0.85, roughness: 0.32 }),
      // 螺棱：略浅、更亮，与芯轴区分，突出螺旋输送结构
      flight: new THREE.MeshStandardMaterial({ color: 0xe6ebef, metalness: 0.8, roughness: 0.28 }),
      // 料斗 / 机头：铸铁质感
      hopper: new THREE.MeshStandardMaterial({ color: 0x7c8794, metalness: 0.7, roughness: 0.45 }),
      // 底座：喷漆钢
      base: new THREE.MeshStandardMaterial({ color: 0x3f4a56, metalness: 0.55, roughness: 0.55 }),
      // 加热圈 / 法兰
      band: new THREE.MeshStandardMaterial({ color: 0x40484f, metalness: 0.8, roughness: 0.35 }),
      // 模口内腔（深色，表现孔洞）
      dark: new THREE.MeshStandardMaterial({ color: 0x14171a, metalness: 0.4, roughness: 0.7 }),
    };
  }

  /* ----------------------------- 基础几何辅助函数 ----------------------------- */

  /** 绕 X 轴的圆柱（THREE 圆柱默认沿 Y，这里统一转到 X） */
  function cylinderX(rTop, rBottom, len, radialSeg = 32, openEnded = false) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, radialSeg, 1, openEnded);
    g.rotateZ(-Math.PI / 2); // Y 轴 -> X 轴
    return g;
  }

  /**
   * 螺旋螺棱（等厚螺带）：沿 X 轴的单圈螺旋面，径向从芯轴到外半径。
   * @param handed 旋向 +1 / -1（两根螺杆旋向相反）
   */
  function flightRibbonGeometry(handed) {
    const { SCREW_OUTER_R: ro, SCREW_CORE_R: ri, FLIGHT_LEAD: lead,
      FLIGHT_THICK: thick, FLIGHT_TURNS: turns } = CONFIG;
    const radialSeg = 6;                 // 径向分段（芯轴 -> 外缘）
    const perTurn = 28;                  // 每圈角度分段
    const angleSeg = perTurn * turns;    // 总角度分段
    const length = lead * turns;
    const x0 = -length / 2;
    const half = thick / 2;

    const positions = [];
    const indices = [];
    const row = radialSeg + 1;

    // 两条螺旋线：前侧面 x+half、后侧面 x-half，各自生成径向网格
    for (let side = 0; side < 2; side++) {
      const dx = side === 0 ? half : -half;
      for (let i = 0; i <= angleSeg; i++) {
        const t = i / angleSeg;
        const theta = t * turns * Math.PI * 2 * handed;
        for (let j = 0; j <= radialSeg; j++) {
          const r = ri + (ro - ri) * (j / radialSeg);
          positions.push(
            x0 + t * length + dx,
            r * Math.cos(theta),
            r * Math.sin(theta)
          );
        }
      }
    }

    const layerVerts = (angleSeg + 1) * row;
    const idx = (side, i, j) => side * layerVerts + i * row + j;

    // 两个侧面（朝向相反）
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < angleSeg; i++) {
        for (let j = 0; j < radialSeg; j++) {
          const a = idx(side, i, j), b = idx(side, i, j + 1);
          const c = idx(side, i + 1, j), d = idx(side, i + 1, j + 1);
          if (side === 0) indices.push(a, b, c, b, d, c);
          else indices.push(a, c, b, b, c, d);
        }
      }
    }
    // 外缘面与内缘面（封边，避免螺带侧面看穿）
    for (let i = 0; i < angleSeg; i++) {
      const o0 = idx(0, i, radialSeg), o1 = idx(0, i + 1, radialSeg);
      const o2 = idx(1, i, radialSeg), o3 = idx(1, i + 1, radialSeg);
      indices.push(o0, o2, o1, o1, o2, o3);
      const n0 = idx(0, i, 0), n1 = idx(0, i + 1, 0);
      const n2 = idx(1, i, 0), n3 = idx(1, i + 1, 0);
      indices.push(n0, n1, n2, n1, n3, n2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /** 8 字形双孔截面（两圆相交轮廓，圆心沿 X 轴排列，旋转后对应世界 Z 向两螺杆） */
  function figureEightShape(r) {
    const d = CONFIG.SCREW_CENTER_DIST / 2;
    const beta = Math.acos(d / r);          // 交点对应的圆心角参数
    const a = Math.sqrt(r * r - d * d);     // 交点到中心连线的距离
    const s = new THREE.Shape();
    // 右圆外弧（经 +X 侧）：从下交点 (0,-a) 到上交点 (0,+a)
    s.moveTo(0, -a);
    s.absarc(d, 0, r, -(Math.PI - beta), Math.PI - beta, false);
    // 左圆外弧（经 -X 侧）：从上交点绕回下交点
    s.absarc(-d, 0, r, beta, Math.PI * 2 - beta, false);
    return s;
  }

  /** 沿 X 拉伸的 8 字法兰/盖板（旋转后两孔圆心落在世界 Z 轴，与螺杆同心） */
  function figureEightPlate(thickness, r) {
    const geo = new THREE.ExtrudeGeometry(figureEightShape(r), {
      depth: thickness, bevelEnabled: false, curveSegments: 40,
    });
    geo.rotateY(Math.PI / 2);   // 拉伸方向 Z -> X；形状 X -> 世界 Z
    geo.translate(-thickness / 2, 0, 0);
    geo.computeVertexNormals();
    return geo;
  }

  /* --------------------------------- 各部件 --------------------------------- */

  /**
   * 单根螺杆（组原点在螺杆轴线上，可直接绕 X 轴旋转）
   * @param handed 旋向：左螺杆 +1，右螺杆 -1
   */
  function buildScrew(handed, m) {
    const g = new THREE.Group();
    g.name = handed > 0 ? 'ScrewLeft' : 'ScrewRight';
    const { SCREW_OUTER_R: ro, SCREW_CORE_R: ri, SCREW_LENGTH: len } = CONFIG;

    const core = new THREE.Mesh(cylinderX(ri, ri, len, 24), m.screw);
    core.name = 'core';
    const flight = new THREE.Mesh(flightRibbonGeometry(handed), m.flight);
    flight.name = 'flight';
    // 两端支承轴（略细，伸出机筒外）
    const shaftGeo = cylinderX(ri * 0.7, ri * 0.7, 0.9, 16);
    const shaftF = new THREE.Mesh(shaftGeo, m.screw); shaftF.position.x = -len / 2 - 0.45;
    const shaftR = new THREE.Mesh(shaftGeo.clone(), m.screw); shaftR.position.x = len / 2 + 0.45;

    g.add(core, flight, shaftF, shaftR);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /**
   * 机筒：教学剖视结构——底部 U 形料槽（包角约 150°，上部敞开以观察螺杆与物料）
   * + 槽口边沿 + 底部 C 形加热抱箍 + 端部法兰
   */
  function buildBarrel(m) {
    const g = new THREE.Group();
    g.name = 'Barrel';
    const { BARREL_LENGTH: L, BORE_RADIUS: br, SCREW_CENTERS: ctr } = CONFIG;
    // 料槽包角：rotateZ(-90°) 后圆柱 theta 对应世界 -Z；取底部约 150° 圆弧
    const TROUGH_SPAN = (150 * Math.PI) / 180;
    const TROUGH_START = Math.PI + (Math.PI - TROUGH_SPAN) / 2; // 关于底部对称

    // 底部 U 形料槽（开口大，便于观察）
    const troughGeo = new THREE.CylinderGeometry(br, br, L, 36, 1, true, TROUGH_START, TROUGH_SPAN);
    troughGeo.rotateZ(-Math.PI / 2);
    // 料槽上沿的两个端点（世界坐标下的 z 向位置）
    const rimZ = br * Math.sin((Math.PI - TROUGH_SPAN) / 2);
    const rimY = -br * Math.cos((Math.PI - TROUGH_SPAN) / 2);

    ctr.forEach((c, i) => {
      const trough = new THREE.Mesh(troughGeo, m.barrel);
      trough.name = `trough${i}`;
      trough.position.set(0, c.y, c.z);
      trough.castShadow = true; trough.receiveShadow = true;
      g.add(trough);

      // 槽口两条纵向边沿（细圆杆，标示剖切开口位置）
      [-1, 1].forEach((side) => {
        const rimGeo = cylinderX(0.035, 0.035, L, 10);
        const rim = new THREE.Mesh(rimGeo, m.band);
        rim.name = 'rim';
        rim.position.set(0, c.y + rimY, c.z + side * rimZ);
        g.add(rim);
      });
    });

    // 端部 8 字法兰（进料端、出料端各一片）
    const flangeGeo = figureEightPlate(0.18, br + 0.12);
    const flF = new THREE.Mesh(flangeGeo, m.band); flF.position.x = -L / 2 - 0.05;
    const flR = new THREE.Mesh(flangeGeo.clone(), m.band); flR.position.x = L / 2 + 0.05;
    g.add(flF, flR);

    // 加热抱箍：与料槽同包角的底部 C 形环带，均布 4 组
    const bandX = [-1.9, -0.65, 0.65, 1.9];
    bandX.forEach((x) => {
      ctr.forEach((c, i) => {
        const bandGeo = new THREE.CylinderGeometry(br + 0.035, br + 0.035, 0.28, 36, 1, true, TROUGH_START, TROUGH_SPAN);
        bandGeo.rotateZ(-Math.PI / 2);
        const band = new THREE.Mesh(bandGeo, m.band);
        band.name = 'heaterBand';
        band.position.set(x, c.y, c.z);
        g.add(band);
      });
    });

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /** 料斗：方形锥斗 + 下料颈 + 顶口翻边 */
  function buildHopper(m) {
    const g = new THREE.Group();
    g.name = 'Hopper';
    const { HOPPER_X: hx, HOPPER_BOTTOM_Y: yb, BORE_RADIUS: br } = CONFIG;

    // 锥斗（四棱台，薄壁）
    const wallGeo = new THREE.CylinderGeometry(0.85, 0.22, 1.15, 4, 1, true);
    wallGeo.rotateY(Math.PI / 4);
    const wall = new THREE.Mesh(wallGeo, m.hopper);
    wall.position.set(hx, yb + 0.62, 0);

    // 下料颈（方形短管，通向机筒开口）
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.46), m.hopper);
    neck.position.set(hx, yb - 0.08, 0);

    // 顶口翻边
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 1.35), m.band);
    lip.position.set(hx, yb + 1.22, 0);

    g.add(wall, neck, lip);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /** 机头（模头）：阶梯转接段 + 收敛喷嘴 + 深色模口 */
  function buildDie(m) {
    const g = new THREE.Group();
    g.name = 'Die';
    const { BARREL_LENGTH: L, DIE_X: dx, NOZZLE_R: nr, SCREW_CENTERS: ctr } = CONFIG;
    const xStart = L / 2 + 0.15;

    // 转接腔体：8 字截面的短厚块，包住两个螺杆末端
    const chamber = new THREE.Mesh(figureEightPlate(0.55, CONFIG.BORE_RADIUS + 0.1), m.hopper);
    chamber.position.x = xStart + 0.22;

    // 收敛段（圆锥台，双通道汇合为单流道）
    const coneLen = 0.7;
    const cone = new THREE.Mesh(cylinderX(nr * 1.9, CONFIG.BORE_RADIUS * 0.95, coneLen, 32), m.hopper);
    cone.position.x = xStart + 0.55 + coneLen / 2;

    // 模口直管
    const nozzleLen = dx - (xStart + 0.55 + coneLen);
    const nozzle = new THREE.Mesh(cylinderX(nr * 1.35, nr * 1.35, nozzleLen, 28), m.band);
    nozzle.position.x = dx - nozzleLen / 2;

    // 模口端面深色圆片（表现孔洞）
    const hole = new THREE.Mesh(cylinderX(nr, nr, 0.04, 24), m.dark);
    hole.position.x = dx + 0.01;

    g.add(chamber, cone, nozzle, hole);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /** 底座：喷漆钢板 + 4 个支承座（托住机筒） */
  function buildBase(m) {
    const g = new THREE.Group();
    g.name = 'Base';

    const slab = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.28, 2.5), m.base);
    slab.position.set(0.3, -1.5, 0);

    const supportGeo = new THREE.BoxGeometry(0.35, 1.25, 1.5);
    [-3.0, 2.6].forEach((x) => {
      const s = new THREE.Mesh(supportGeo, m.base);
      s.position.set(x, -0.78, 0);
      g.add(s);
    });
    // 两端矮挡边
    const railGeo = new THREE.BoxGeometry(9.6, 0.18, 0.16);
    const rail1 = new THREE.Mesh(railGeo, m.band); rail1.position.set(0.3, -1.32, 1.18);
    const rail2 = new THREE.Mesh(railGeo.clone(), m.band); rail2.position.set(0.3, -1.32, -1.18);

    g.add(slab, rail1, rail2);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  return {
    CONFIG,
    materials,
    buildScrew,
    buildBarrel,
    buildHopper,
    buildDie,
    buildBase,
    // 供导出脚本逐个导出
    buildAll() {
      const m = materials();
      return {
        base: buildBase(m),
        barrel: buildBarrel(m),
        screwLeft: buildScrew(+1, m),
        screwRight: buildScrew(-1, m),
        hopper: buildHopper(m),
        die: buildDie(m),
      };
    },
  };
});
