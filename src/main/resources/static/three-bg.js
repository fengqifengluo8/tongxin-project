/**
 * Three.js 动态科技背景渲染器
 * 为警务指挥系统的三个角色提供不同的3D场景背景
 */
import * as THREE from 'three';

let renderer, scene, camera, animationId;
let currentGroup = null;
const groups = {};
const clock = new THREE.Clock();

// 设备性能分级
function getDeviceTier() {
  const pixelRatio = window.devicePixelRatio || 1;
  const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
  if (isMobile && pixelRatio <= 2) return 'low';
  if (isMobile) return 'medium';
  return 'high';
}

// WebGL可用性检测
function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('webgl2'));
  } catch { return false; }
}

// 创建粒子系统
function createParticles(count, color, spread, yBase, yRange) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = yBase + Math.random() * yRange;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: color,
    size: 0.08,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  return new THREE.Points(geometry, material);
}

// 创建光环
function createRing(radius, color, opacity, tubeRadius) {
  const geometry = new THREE.TorusGeometry(radius, tubeRadius || 0.05, 8, 64);
  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: opacity,
    depthWrite: false
  });
  return new THREE.Mesh(geometry, material);
}

// ========== 构建四个场景组 ==========

function buildHubGroup() {
  const group = new THREE.Group();
  group.name = 'hub';

  // 大面积半透明地面
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x061228, transparent: true, opacity: 0.85, depthWrite: false });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  group.add(ground);

  // 网格环
  const gridRing = createRing(8, 0x3b82f6, 0.3, 0.03);
  gridRing.rotation.x = Math.PI / 2;
  gridRing.position.y = 0.1;
  group.add(gridRing);

  // 指挥中心 - 蓝色二十面体
  const cmdGeo = new THREE.IcosahedronGeometry(0.8, 0);
  const cmdMat = new THREE.MeshPhongMaterial({ color: 0x3b82f6, emissive: 0x1e3a5f, transparent: true, opacity: 0.9 });
  const cmdMesh = new THREE.Mesh(cmdGeo, cmdMat);
  cmdMesh.position.set(-5, 1.5, 0);
  cmdMesh.userData = { rotSpeed: 0.3 };
  group.add(cmdMesh);

  // 警员 - 绿色八面体
  const offGeo = new THREE.OctahedronGeometry(0.7, 0);
  const offMat = new THREE.MeshPhongMaterial({ color: 0x22c55e, emissive: 0x14532d, transparent: true, opacity: 0.9 });
  const offMesh = new THREE.Mesh(offGeo, offMat);
  offMesh.position.set(0, 1.5, 2);
  offMesh.userData = { rotSpeed: 0.2 };
  group.add(offMesh);

  // 公众 - 白色圆环
  const gstRing = createRing(0.7, 0xfbbf24, 0.8, 0.06);
  gstRing.position.set(5, 1.5, 0);
  gstRing.userData = { rotSpeed: 0.15 };
  group.add(gstRing);

  // 粒子
  const particles = createParticles(70, 0x3b82f6, 25, -1, 8);
  group.add(particles);

  group.visible = false;
  return group;
}

function buildCommanderGroup() {
  const group = new THREE.Group();
  group.name = 'commander';

  // 全息网格地面
  const grid = new THREE.GridHelper(30, 40, 0x0ea5e9, 0x1e3a5f);
  grid.position.y = -2;
  group.add(grid);

  // 三层旋转光环
  const ring1 = createRing(6, 0x3b82f6, 0.4, 0.04);
  ring1.position.y = 1;
  ring1.userData = { rotSpeed: 0.2, axis: 'y' };
  group.add(ring1);

  const ring2 = createRing(8, 0x0ea5e9, 0.3, 0.04);
  ring2.position.y = 3;
  ring2.rotation.x = Math.PI / 3;
  ring2.userData = { rotSpeed: 0.15, axis: 'y' };
  group.add(ring2);

  const ring3 = createRing(10, 0x06b6d4, 0.2, 0.03);
  ring3.position.y = 5;
  ring3.rotation.x = -Math.PI / 4;
  ring3.userData = { rotSpeed: 0.1, axis: 'y' };
  group.add(ring3);

  // 数据流粒子列
  for (let i = 0; i < 5; i++) {
    const colParticles = createParticles(40, 0x22d3ee, 2, -1, 7);
    colParticles.position.x = (i - 2) * 5;
    colParticles.position.z = (i % 2 === 0 ? -3 : 3);
    group.add(colParticles);
  }

  // 扫描线平面
  const scanGeo = new THREE.PlaneGeometry(30, 0.1);
  const scanMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const scanLine = new THREE.Mesh(scanGeo, scanMat);
  scanLine.position.y = 0;
  scanLine.name = 'scanLine';
  group.add(scanLine);

  group.visible = false;
  return group;
}

function buildOfficerGroup() {
  const group = new THREE.Group();
  group.name = 'officer';

  // 简化网格地面
  const grid = new THREE.GridHelper(18, 18, 0x22c55e, 0x14532d);
  grid.position.y = -2;
  group.add(grid);

  // 单个旋转光环
  const ring = createRing(5, 0x22c55e, 0.35, 0.04);
  ring.position.y = 1.5;
  ring.userData = { rotSpeed: 0.2, axis: 'y' };
  group.add(ring);

  // 轻量粒子
  const particles = createParticles(50, 0x4ade80, 16, -1, 5);
  group.add(particles);

  group.visible = false;
  return group;
}

function buildGuestGroup() {
  const group = new THREE.Group();
  group.name = 'guest';

  // 柔和网格地面
  const grid = new THREE.GridHelper(16, 16, 0xfbbf24, 0x422006);
  grid.position.y = -2;
  group.add(grid);

  // 白色光环
  const ring = createRing(4.5, 0xfbbf24, 0.3, 0.04);
  ring.position.y = 1.2;
  ring.userData = { rotSpeed: 0.1, axis: 'y' };
  group.add(ring);

  // 安全区域方块
  const colors = [0xfbbf24, 0xf59e0b, 0x22c55e];
  for (let i = 0; i < 6; i++) {
    const boxGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const boxMat = new THREE.MeshPhongMaterial({
      color: colors[i % 3],
      emissive: colors[i % 3],
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.6
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    const angle = (Math.PI * 2 * i) / 6;
    box.position.set(Math.cos(angle) * 6, 1, Math.sin(angle) * 6);
    group.add(box);
  }

  // 少量粒子
  const particles = createParticles(35, 0xfde68a, 14, -1, 4);
  group.add(particles);

  group.visible = false;
  return group;
}

function buildAllGroups(sharedScene, tier) {
  const hub = buildHubGroup();
  const commander = buildCommanderGroup();
  const officer = buildOfficerGroup();
  const guest = buildGuestGroup();

  sharedScene.add(hub);
  sharedScene.add(commander);
  sharedScene.add(officer);
  sharedScene.add(guest);

  groups.hub = hub;
  groups.commander = commander;
  groups.officer = officer;
  groups.guest = guest;
}

// ========== 公开API ==========

export function initBgRenderer(canvas) {
  if (!isWebGLAvailable()) {
    document.body.classList.add('bg-fallback');
    return false;
  }

  const tier = getDeviceTier();

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier !== 'low',
    alpha: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'low' ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.5,
    100
  );
  camera.position.set(0, 5, 15);
  camera.lookAt(0, 0, 0);

  // 环境光
  const ambient = new THREE.AmbientLight(0x1a2a4a, 0.6);
  scene.add(ambient);

  // 点光源
  const pointLight = new THREE.PointLight(0x0ea5e9, 0.8, 30);
  pointLight.position.set(0, 3, 0);
  scene.add(pointLight);

  buildAllGroups(scene, tier);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.body.classList.add('bg-threejs');
  return true;
}

export function switchBgScene(role) {
  if (!scene) return;

  // 映射角色到场景组名
  const groupName = (role === 'commander' || role === 'officer' || role === 'guest')
    ? role : 'hub';

  const targetGroup = groups[groupName];
  if (!targetGroup || targetGroup === currentGroup) return;

  // 隐藏当前组
  if (currentGroup) {
    currentGroup.visible = false;
  }

  // 显示目标组
  targetGroup.visible = true;
  currentGroup = targetGroup;

  // 调整相机位置
  switch (groupName) {
    case 'hub':
      camera.position.set(0, 6, 14);
      break;
    case 'commander':
      camera.position.set(0, 4, 11);
      break;
    case 'officer':
      camera.position.set(0, 3, 9);
      break;
    case 'guest':
      camera.position.set(0, 2.5, 8);
      break;
  }
  camera.lookAt(0, 0, 0);
}

export function startBgAnimation() {
  if (!renderer) return;

  function animate() {
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    const time = performance.now() * 0.001;

    if (!currentGroup || !currentGroup.visible) {
      renderer.render(scene, camera);
      return;
    }

    // 旋转所有带rotSpeed的对象
    currentGroup.children.forEach(child => {
      if (child.userData && child.userData.rotSpeed) {
        child.rotation.y += child.userData.rotSpeed * delta;
      }
    });

    // 扫描线动画
    if (currentGroup.name === 'commander') {
      const scanLine = currentGroup.children.find(c => c.name === 'scanLine');
      if (scanLine) {
        scanLine.position.y = Math.sin(time * 0.5) * 5;
      }
    }

    // 粒子上升循环
    currentGroup.children.forEach(child => {
      if (child.isPoints && child.geometry.attributes.position) {
        const positions = child.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i + 1] += delta * 0.5;
          if (positions[i + 1] > 6) positions[i + 1] = -2;
        }
        child.geometry.attributes.position.needsUpdate = true;
      }
    });

    renderer.render(scene, camera);
  }

  animate();
}

export function stopBgAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

export function disposeBg() {
  stopBgAnimation();
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  scene = null;
  camera = null;
  currentGroup = null;
  for (const key in groups) delete groups[key];
  document.body.classList.remove('bg-threejs');
}
