/**
 * main.js —— 双螺杆挤出机 3D 动态仿真主程序
 *
 * 技术约束：仅用 three 原生能力（UMD r147）+ OrbitControls + GLTFLoader，
 * requestAnimationFrame 驱动；粒子用 Points 实现，不引入流体/物理求解库。
 *
 * 全局依赖（index.html 以 <script> 顺序引入）：THREE、MachineGeometry
 */
(function () {
  'use strict';

  const C = MachineGeometry.CONFIG;

  /* ============================== 仿真运行参数 ============================== */
  const sim = {
    running: true,      // 运行 / 暂停
    rpm: 60,            // 螺杆转速（转/分），由滑杆调节
    spawnAcc: 0,        // 粒子生成计时器
  };

  /* ============================== 渲染器 / 场景 ============================== */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // 柔和阴影
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe6ec);
  scene.fog = new THREE.Fog(0xdfe6ec, 13, 30);        // 淡雾，增强纵深

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  // 支持 ?cam=top / ?cam=side 预设视角，便于从不同角度观察螺槽与物料
  const camPreset = new URLSearchParams(location.search).get('cam');
  if (camPreset === 'top') camera.position.set(0.2, 10.5, 0.6);
  else if (camPreset === 'side') camera.position.set(0.6, 2.2, 11.5);
  else if (camPreset === 'cut') camera.position.set(6.2, 6.6, 5.4);
  else camera.position.set(7.6, 5.4, 6.8);   // 默认斜俯视角，可直接看到开放料槽内的物料

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0.4, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.52;

  /* --------------------------------- 光照 --------------------------------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(7, 11, 6);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 32;
  dirLight.shadow.camera.left = -9;
  dirLight.shadow.camera.right = 9;
  dirLight.shadow.camera.top = 9;
  dirLight.shadow.camera.bottom = -9;
  dirLight.shadow.bias = -0.0004;
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.25);
  fillLight.position.set(-6, 5, -7);
  scene.add(fillLight);

  /* --------------------------------- 地面 --------------------------------- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0xcfd7de, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.64;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ============================== 设备模型装配 ============================== */
  // 整机抬升，使底座落在地面上（底座底面 y = -1.64）
  const machine = new THREE.Group();
  machine.position.y = 0;
  scene.add(machine);

  let screwLeft = null;
  let screwRight = null;

  /**
   * GLTFLoader 加载 5 个 GLB；file:// 直开时浏览器禁止 fetch 本地文件，
   * 捕获异常后改用同一套参数化几何即时建模，保证双击 HTML 也能运行。
   */
  const loader = new THREE.GLTFLoader();
  const modelStateEl = document.getElementById('modelState');

  function loadGLB(file) {
    return new Promise((resolve, reject) => {
      // 兼容不同发布基路径：优先相对当前页面，其次相对脚本目录
      loader.load('models/' + file, (gltf) => resolve(gltf.scene), undefined, () => {
        loader.load('./models/' + file, (gltf) => resolve(gltf.scene), undefined, reject);
      });
    });
  }

  async function assembleMachine() {
    try {
      const [base, barrel, screws, hopper, die] = await Promise.all([
        loadGLB('base.glb'), loadGLB('barrel.glb'), loadGLB('screws.glb'),
        loadGLB('hopper.glb'), loadGLB('die.glb'),
      ]);
      machine.add(base, barrel, screws, hopper, die);
      screwLeft = screws.getObjectByName('ScrewLeft');
      screwRight = screws.getObjectByName('ScrewRight');
      // GLB 里的阴影标记在导出时保留，这里兜底再设一次
      machine.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      modelStateEl.textContent = '模型：外部 GLB（GLTFLoader 加载）';
    } catch (err) {
      console.warn('GLB 加载失败，启用程序化几何降级：', err);
      const parts = MachineGeometry.buildAll();
      machine.add(parts.base, parts.barrel, parts.screwLeft, parts.screwRight, parts.hopper, parts.die);
      screwLeft = parts.screwLeft;
      screwRight = parts.screwRight;
      modelStateEl.textContent = '模型：内置参数化几何（本地直开降级模式）';
    }
    placeScrews();
  }

  /** 把两根螺杆从组原点平移到各自的机筒孔轴线上（几何本身以自身轴线为原点） */
  function placeScrews() {
    C.SCREW_CENTERS.forEach((c, i) => {
      const s = i === 0 ? screwLeft : screwRight;
      s.position.set(0, c.y, c.z);
    });
  }

  /* ============================== 粒子物料系统 ============================== */
  const MAX_PARTICLES = 700;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pColor = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pColor, 3));

  // 圆形柔边粒子贴图（canvas 程序化生成，不依赖外部图片）
  const sprite = makeParticleSprite();
  const pMat = new THREE.PointsMaterial({
    size: 0.16,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    alphaTest: 0.25,        // 裁掉贴图透明边缘，避免方块感
    depthWrite: false,
    depthTest: false,       // 剖视教学模式：粒子始终可见，直观展示螺槽内物料推进
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 10;   // 粒子最后绘制，保证在机械结构之上可见
  scene.add(points);

  function makeParticleSprite() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  // 熔融三色（与页面图例一致）：固体 -> 软化 -> 熔体
  const COL_SOLID = new THREE.Color(0xd8b56b);
  const COL_SOFT = new THREE.Color(0xe07b39);
  const COL_MELT = new THREE.Color(0xc23a2b);
  const tmpColor = new THREE.Color();

  /** 物料沿程的归一化进度区间（与机筒长度对应） */
  const X_FEED = C.HOPPER_X;                 // 进料起点
  const X_MELT_START = -0.9;                // 开始熔融（机筒中后段加热区）
  const X_DIE_IN = C.BARREL_LENGTH / 2;     // 进入机头
  const X_DIE_OUT = C.DIE_X;                // 离开模口

  /**
   * 粒子状态机：
   *  FALL   料斗自由下落 -> FEED 进入螺槽
   *  FEED   跟随螺槽螺旋输送，逐步变色
   *  DIE    机头收敛段，向单流道中心汇聚
   *  STRAND 模口外，随挤出条带继续前进一段后回收
   */
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      active: false, state: 'FALL',
      x: 0, y: 0, z: 0,
      vy: 0,                 // FALL 阶段下落速度
      screw: 0,              // 所属螺杆 0/1
      phase: 0,              // 螺槽相位（圈数，含小数）
      baseAngle: 0,          // 粒子在螺槽内的固定角位置
      radial: 0.4,           // 粒子所在半径
    });
    pPos[i * 3 + 1] = -999;  // 未激活粒子藏到视野外
  }

  function spawnParticle(p) {
    p.active = true;
    p.state = 'FALL';
    p.x = C.HOPPER_X + (Math.random() - 0.5) * 0.34;
    p.z = (Math.random() - 0.5) * 0.34;
    p.y = C.HOPPER_BOTTOM_Y + 1.15 + Math.random() * 0.25;
    p.vy = 0.4;
    writeColor(p, 0);
  }

  /** 按输送进度 t(0~1) 计算熔融颜色 */
  function writeColor(p, t) {
    const i = particles.indexOf(p);
    if (t < 0.45) {
      tmpColor.copy(COL_SOLID).lerp(COL_SOFT, t / 0.45);
    } else {
      tmpColor.copy(COL_SOFT).lerp(COL_MELT, Math.min(1, (t - 0.45) / 0.55));
    }
    pColor[i * 3] = tmpColor.r;
    pColor[i * 3 + 1] = tmpColor.g;
    pColor[i * 3 + 2] = tmpColor.b;
  }

  /** 粒子进入螺槽：分配螺杆、相位与槽内角位置 */
  function enterFeed(p) {
    p.state = 'FEED';
    p.screw = Math.random() < 0.5 ? 0 : 1;
    p.phase = 0;
    // 落在螺槽上半部（开放料槽侧），保证从俯视角度可见；角度适度散布
    p.baseAngle = -Math.PI * 0.85 + Math.random() * Math.PI * 1.1;
    p.radial = C.SCREW_CORE_R + 0.06 + Math.random() * (C.SCREW_OUTER_R - C.SCREW_CORE_R - 0.12);
  }

  /* ============================== 挤出条带（料坯） ============================== */
  const STRAND_RINGS = 46;
  const STRAND_RADIUS = C.NOZZLE_R * 0.82;
  // 单根管状条带：沿 X 的 10 边截面，46 个环
  const STRAND_SIDES = 10;
  const ringVerts = [];
  for (let i = 0; i < STRAND_RINGS; i++) {
    for (let j = 0; j < STRAND_SIDES; j++) {
      const a = (j / STRAND_SIDES) * Math.PI * 2;
      ringVerts.push(i * 0.11, STRAND_RADIUS * Math.cos(a), STRAND_RADIUS * Math.sin(a));
    }
  }
  const strandPositions = new Float32Array(ringVerts);
  const strandIndices = [];
  const strandGeo = new THREE.BufferGeometry();
  for (let i = 0; i < STRAND_RINGS - 1; i++) {
    for (let j = 0; j < STRAND_SIDES; j++) {
      const a = i * STRAND_SIDES + j;
      const b = i * STRAND_SIDES + (j + 1) % STRAND_SIDES;
      const c = (i + 1) * STRAND_SIDES + j;
      const d = (i + 1) * STRAND_SIDES + (j + 1) % STRAND_SIDES;
      strandIndices.push(a, c, b, b, c, d);
    }
  }
  strandGeo.setAttribute('position', new THREE.BufferAttribute(strandPositions, 3));
  strandGeo.setIndex(strandIndices);
  strandGeo.computeVertexNormals();
  const strandMat = new THREE.MeshStandardMaterial({
    color: COL_MELT, roughness: 0.55, metalness: 0.05,
    emissive: COL_MELT, emissiveIntensity: 0.12,
  });
  const strand = new THREE.Mesh(strandGeo, strandMat);
  strand.castShadow = true;
  scene.add(strand);
  let strandPhase = 0;

  /* ============================== 每帧仿真更新 ============================== */
  const clock = new THREE.Clock();
  const screwRot = [0, 0];                 // 两根螺杆累计转角（绕 X）

  function update(dt) {
    const omega = (sim.rpm / 60) * Math.PI * 2;          // 角速度 rad/s
    const vx = (sim.rpm / 60) * C.FLIGHT_LEAD;           // 物料轴向输送速度（与转速联动）

    // —— 螺杆：同步异向旋转（左 -omega，右 +omega），相位差 180° 保证啮合 ——
    screwRot[0] -= omega * dt;
    screwRot[1] += omega * dt;
    if (screwLeft) screwLeft.rotation.x = screwRot[0];
    if (screwRight) screwRight.rotation.x = screwRot[1] + Math.PI;

    // —— 粒子生成：速率与转速同步适配 ——
    sim.spawnAcc += dt * (4 + sim.rpm * 0.22);
    while (sim.spawnAcc >= 1) {
      sim.spawnAcc -= 1;
      const p = particles.find((q) => !q.active);
      if (p) spawnParticle(p);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      if (!p.active) continue;

      if (p.state === 'FALL') {
        p.vy += 3.2 * dt;
        p.y -= p.vy * dt;
        if (p.y <= C.SCREW_OUTER_R * 0.55) {   // 落到螺槽区即被螺杆“捕获”
          p.y = C.SCREW_OUTER_R * 0.55;
          enterFeed(p);
        }
      } else if (p.state === 'FEED') {
        // 螺槽推进：相位增加 -> 沿 +X 前进（速度与转速严格联动）
        p.phase += (sim.rpm / 60) * dt;
        p.x = X_FEED + p.phase * C.FLIGHT_LEAD;
        // 随机在两螺杆间少量交换，模拟啮合区的混炼翻料
        if (Math.random() < 0.004) p.screw = 1 - p.screw;

        const center = C.SCREW_CENTERS[p.screw];
        const handed = p.screw === 0 ? 1 : -1;
        // 粒子世界角位置：跟随螺棱旋转（两螺杆反向），再加固定槽内偏移
        const theta = p.baseAngle + handed * (p.screw === 0 ? screwRot[0] : screwRot[1]);
        p.y = center.y + p.radial * Math.cos(theta);
        p.z = center.z + p.radial * Math.sin(theta);

        const t = THREE.MathUtils.clamp((p.x - X_MELT_START) / (X_DIE_IN - X_MELT_START), 0, 1);
        writeColor(p, t);

        if (p.x >= X_DIE_IN) { p.state = 'DIE'; p.dieT = 0; }
      } else if (p.state === 'DIE') {
        // 机头收敛：双通道汇合，粒子向单流道中心（原点）汇聚
        p.dieT += dt * (vx / (X_DIE_OUT - X_DIE_IN));
        const k = THREE.MathUtils.clamp(p.dieT, 0, 1);
        p.x = X_DIE_IN + (X_DIE_OUT - X_DIE_IN) * k;
        p.y *= 1 - 0.85 * k;
        p.z *= 1 - 0.85 * k;
        writeColor(p, 1);
        if (k >= 1) { p.state = 'STRAND'; p.strandX = X_DIE_OUT; }
      } else if (p.state === 'STRAND') {
        // 模口外随条带前进，行进一段后回收重生
        p.strandX += vx * dt;
        p.x = p.strandX;
        const travel = p.strandX - X_DIE_OUT;
        p.y = Math.sin(travel * 6 + strandPhase) * 0.01 - 0.022 * travel * travel;
        p.z = Math.cos(travel * 6 + strandPhase) * 0.008;
        writeColor(p, 1);
        if (p.strandX > X_DIE_OUT + 2.6) p.active = false;
      }

      pPos[i * 3] = p.x;
      pPos[i * 3 + 1] = p.y;
      pPos[i * 3 + 2] = p.z;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // —— 挤出条带：固定长度 + 小幅行波与轻微下垂，呈现连续挤出的流动感 ——
    strandPhase += (sim.rpm / 60) * dt * 8;
    const posAttr = strandGeo.attributes.position;
    for (let i = 0; i < STRAND_RINGS; i++) {
      const x = X_DIE_OUT + i * 0.11;
      const travel = i * 0.11;
      const wobY = Math.sin(i * 0.55 - strandPhase) * 0.012 - 0.022 * travel * travel;
      const wobZ = Math.cos(i * 0.55 - strandPhase) * 0.01;
      for (let j = 0; j < STRAND_SIDES; j++) {
        const idx = i * STRAND_SIDES + j;
        const a = (j / STRAND_SIDES) * Math.PI * 2;
        posAttr.setXYZ(
          idx, x,
          STRAND_RADIUS * Math.cos(a) + wobY,
          STRAND_RADIUS * Math.sin(a) + wobZ
        );
      }
    }
    posAttr.needsUpdate = true;
    strandGeo.computeVertexNormals();
  }

  /** 重置物料：回收全部粒子并复位条带相位（螺杆位置保持，便于定格对比） */
  function resetMaterial() {
    particles.forEach((p, i) => {
      p.active = false;
      pPos[i * 3 + 1] = -999;
    });
    sim.spawnAcc = 0;
    pGeo.attributes.position.needsUpdate = true;
  }

  /* ============================== 动画循环 ============================== */
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);  // 限幅，防止切后台后跳变
    if (sim.running) update(dt);                  // 暂停即定格：物料与螺杆全部静止
    controls.update();
    renderer.render(scene, camera);
  }

  /* ============================== UI 控件 ============================== */
  const btnToggle = document.getElementById('btnToggle');
  const btnReset = document.getElementById('btnReset');
  const rpmSlider = document.getElementById('rpm');
  const rpmVal = document.getElementById('rpmVal');
  const runState = document.getElementById('runState');
  const stateDot = document.getElementById('stateDot');

  // 元素缺失时（如调试页）跳过绑定，避免阻断动画循环
  if (btnToggle) btnToggle.addEventListener('click', () => {
    sim.running = !sim.running;
    btnToggle.textContent = sim.running ? '暂停' : '继续';
    btnToggle.classList.toggle('paused', !sim.running);
    if (runState) runState.textContent = sim.running ? '运行中' : '已暂停';
    if (stateDot) stateDot.classList.toggle('off', !sim.running);
  });

  if (btnReset) btnReset.addEventListener('click', resetMaterial);

  if (rpmSlider) rpmSlider.addEventListener('input', () => {
    sim.rpm = Number(rpmSlider.value);
    if (rpmVal) rpmVal.textContent = sim.rpm + ' rpm';
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ============================== 启动 ============================== */
  window.__particles = particles;   // 调试钩子
  window.__getScrewRot = () => [screwRot[0], screwRot[1]];
  assembleMachine().then(animate);
})();
