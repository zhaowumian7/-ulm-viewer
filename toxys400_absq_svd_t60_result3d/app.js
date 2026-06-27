import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import GUI from "lil-gui";

const MAGIC = 0x554c4d54;

async function loadConfig() {
  const response = await fetch("config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`config.json ${response.status}`);
  return response.json();
}

async function loadTracks(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const buffer = await response.arrayBuffer();
  const header = new DataView(buffer, 0, 64);
  const magic = header.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`bad tracks.bin magic 0x${magic.toString(16)}`);
  const version = header.getUint32(4, true);
  const floatsPerPoint = version >= 3 ? 6 : 5;
  const nTracks = header.getUint32(8, true);
  const totalPoints = header.getUint32(12, true);
  const maxSpeed = header.getFloat32(16, true);
  const boundsMin = [header.getFloat32(20, true), header.getFloat32(24, true), header.getFloat32(28, true)];
  const boundsMax = [header.getFloat32(32, true), header.getFloat32(36, true), header.getFloat32(40, true)];
  const table = new DataView(buffer, 64, nTracks * 8);
  const tracks = [];
  for (let i = 0; i < nTracks; i++) {
    tracks.push({ offset: table.getUint32(i * 8, true), length: table.getUint32(i * 8 + 4, true) });
  }
  const pointOffset = 64 + nTracks * 8;
  const points = new Float32Array(buffer, pointOffset, totalPoints * floatsPerPoint);
  return { version, floatsPerPoint, nTracks, totalPoints, maxSpeed, boundsMin, boundsMax, tracks, points };
}

function turbo(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, [37, 50, 186]],
    [0.22, [0, 178, 222]],
    [0.48, [34, 214, 108]],
    [0.73, [240, 216, 76]],
    [1.00, [209, 45, 36]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [at, a] = stops[i - 1], [bt, b] = stops[i];
      const f = (t - at) / (bt - at);
      return new THREE.Color(
        (a[0] + (b[0] - a[0]) * f) / 255,
        (a[1] + (b[1] - a[1]) * f) / 255,
        (a[2] + (b[2] - a[2]) * f) / 255,
      );
    }
  }
  return new THREE.Color(0xd12d24);
}

function magma(t) {
  t = Math.max(0, Math.min(1, t));
  const c = new THREE.Color();
  if (t < 0.34) return c.lerpColors(new THREE.Color(0x05000b), new THREE.Color(0x5d1a72), t / 0.34);
  if (t < 0.68) return c.lerpColors(new THREE.Color(0x5d1a72), new THREE.Color(0xe45a31), (t - 0.34) / 0.34);
  return c.lerpColors(new THREE.Color(0xe45a31), new THREE.Color(0xfff2a1), (t - 0.68) / 0.32);
}

function percentile(values, q) {
  const copy = Array.from(values).sort((a, b) => a - b);
  return copy[Math.min(copy.length - 1, Math.max(0, Math.floor(copy.length * q)))] || 0;
}

class StaticTrackScene {
  constructor(data) {
    this.data = data;
    this.params = {
      colorBy: "speed",
      minTrackLength: 15,
      maxSpeedPercentile: 98,
      lineOpacity: 0.82,
      lineWidth: 2.6,
      pointOpacity: 0.16,
      pointSize: 1.8,
      showPoints: false,
      showBox: true,
      rotate: false,
      background: "#030507",
    };
    this.canvas = document.getElementById("scene");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(this.params.background, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.build();
    this.addGui();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate();
  }

  centerPoint(x, y, z) {
    return [
      x - this.center[0],
      y - this.center[1],
      z - this.center[2],
    ];
  }

  build() {
    this.root.clear();
    const d = this.data;
    this.center = [
      0.5 * (d.boundsMin[0] + d.boundsMax[0]),
      0.5 * (d.boundsMin[1] + d.boundsMax[1]),
      0.5 * (d.boundsMin[2] + d.boundsMax[2]),
    ];
    this.size = [
      d.boundsMax[0] - d.boundsMin[0],
      d.boundsMax[1] - d.boundsMin[1],
      d.boundsMax[2] - d.boundsMin[2],
    ];
    this.scale = 120 / Math.max(...this.size.map(v => Math.abs(v)), 1e-6);
    this.speedScale = this.computeSpeedScale();
    this.addLines();
    if (this.params.showPoints) this.addPoints();
    if (this.params.showBox) this.addBox();
  }

  computeSpeedScale() {
    const d = this.data, fpp = d.floatsPerPoint;
    const samples = [];
    const step = Math.max(1, Math.floor(d.totalPoints / 120000));
    for (let i = 0; i < d.totalPoints; i += step) samples.push(d.points[i * fpp + 4]);
    const q = percentile(samples, this.params.maxSpeedPercentile / 100);
    return Math.max(q, d.maxSpeed * 0.5, 1e-6);
  }

  colorFor(x, y, z, speed) {
    if (this.params.colorBy === "depth") {
      const t = (z - this.data.boundsMin[2]) / Math.max(this.data.boundsMax[2] - this.data.boundsMin[2], 1e-6);
      return turbo(t);
    }
    if (this.params.colorBy === "time") {
      return magma((y - this.data.boundsMin[1]) / Math.max(this.data.boundsMax[1] - this.data.boundsMin[1], 1e-6));
    }
    return turbo(speed / this.speedScale);
  }

  addLines() {
    const d = this.data, fpp = d.floatsPerPoint;
    const tracks = d.tracks.filter(t => t.length >= this.params.minTrackLength);
    const segmentCount = tracks.reduce((sum, t) => sum + Math.max(0, t.length - 1), 0);
    const positions = new Float32Array(segmentCount * 2 * 3);
    const colors = new Float32Array(segmentCount * 2 * 3);
    let p = 0, c = 0;
    for (const track of tracks) {
      for (let i = 1; i < track.length; i++) {
        const a = (track.offset + i - 1) * fpp;
        const b = (track.offset + i) * fpp;
        const pa = this.centerPoint(d.points[a], d.points[a + 1], d.points[a + 2]).map(v => v * this.scale);
        const pb = this.centerPoint(d.points[b], d.points[b + 1], d.points[b + 2]).map(v => v * this.scale);
        positions.set(pa, p); p += 3;
        positions.set(pb, p); p += 3;
        const ca = this.colorFor(d.points[a], d.points[a + 1], d.points[a + 2], d.points[a + 4]);
        const cb = this.colorFor(d.points[b], d.points[b + 1], d.points[b + 2], d.points[b + 4]);
        colors.set([ca.r, ca.g, ca.b], c); c += 3;
        colors.set([cb.r, cb.g, cb.b], c); c += 3;
      }
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: this.params.lineWidth,
      transparent: true,
      opacity: this.params.lineOpacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);
    this.lines = new LineSegments2(geometry, material);
    this.lines.computeLineDistances();
    this.root.add(this.lines);
  }

  addPoints() {
    const d = this.data, fpp = d.floatsPerPoint;
    const maxPoints = 180000;
    const tracks = d.tracks.filter(t => t.length >= this.params.minTrackLength);
    const visiblePoints = tracks.reduce((sum, t) => sum + t.length, 0);
    const step = Math.max(1, Math.ceil(visiblePoints / maxPoints));
    const count = Math.ceil(visiblePoints / step);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let p = 0, c = 0;
    let visibleIndex = 0;
    for (const track of tracks) {
      for (let i = 0; i < track.length; i++) {
        if (visibleIndex % step !== 0) {
          visibleIndex++;
          continue;
        }
        const o = (track.offset + i) * fpp;
        const pos = this.centerPoint(d.points[o], d.points[o + 1], d.points[o + 2]).map(v => v * this.scale);
        positions.set(pos, p); p += 3;
        const col = this.colorFor(d.points[o], d.points[o + 1], d.points[o + 2], d.points[o + 4]);
        colors.set([col.r, col.g, col.b], c); c += 3;
        visibleIndex++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: this.params.pointSize,
      vertexColors: true,
      transparent: true,
      opacity: this.params.pointOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.root.add(this.points);
  }

  addBox() {
    const box = new THREE.BoxGeometry(this.size[0] * this.scale, this.size[1] * this.scale, this.size[2] * this.scale);
    const edges = new THREE.EdgesGeometry(box);
    const material = new THREE.LineBasicMaterial({ color: 0x6f7f93, transparent: true, opacity: 0.28 });
    this.box = new THREE.LineSegments(edges, material);
    this.root.add(this.box);
  }

  addGui() {
    const gui = new GUI({ title: "3D Result" });
    gui.add(this.params, "colorBy", ["speed", "depth", "time"]).name("Color").onChange(() => this.build());
    gui.add(this.params, "minTrackLength", 2, 200, 1).name("Min track length").onChange(() => {
      this.build();
      renderStats(this.data, this.params.minTrackLength);
    });
    gui.add(this.params, "lineOpacity", 0.05, 1.0, 0.01).name("Line opacity").onChange(v => { if (this.lines) this.lines.material.opacity = v; });
    gui.add(this.params, "lineWidth", 0.4, 6.0, 0.1).name("Line width").onChange(v => { if (this.lines) this.lines.material.linewidth = v; });
    gui.add(this.params, "showPoints").name("Show points").onChange(() => this.build());
    gui.add(this.params, "pointOpacity", 0.0, 0.8, 0.01).name("Point opacity").onChange(v => { if (this.points) this.points.material.opacity = v; });
    gui.add(this.params, "pointSize", 0.4, 8, 0.1).name("Point size").onChange(v => { if (this.points) this.points.material.size = v; });
    gui.add(this.params, "showBox").name("Show box").onChange(() => this.build());
    gui.add(this.params, "rotate").name("Auto rotate");
  }

  resize() {
    const width = window.innerWidth, height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    if (this.lines?.material?.resolution) this.lines.material.resolution.set(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const radius = Math.max(160, Math.max(...this.size) * this.scale * 1.55);
    if (!this.cameraReady) {
      this.camera.position.set(radius * 0.85, -radius * 1.1, radius * 0.78);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.cameraReady = true;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.params.rotate) this.root.rotation.z += 0.0018;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function renderStats(data, minTrackLength = 15) {
  const lengths = data.tracks.map(t => t.length).sort((a, b) => a - b);
  const visibleTracks = data.tracks.filter(t => t.length >= minTrackLength);
  const visiblePoints = visibleTracks.reduce((sum, t) => sum + t.length, 0);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const p95 = lengths[Math.floor(lengths.length * 0.95)] || 0;
  document.getElementById("stats").innerHTML = `
    <span>tracks</span><b>${data.nTracks.toLocaleString()}</b>
    <span>points</span><b>${data.totalPoints.toLocaleString()}</b>
    <span>shown tracks</span><b>${visibleTracks.length.toLocaleString()}</b>
    <span>shown points</span><b>${visiblePoints.toLocaleString()}</b>
    <span>min length</span><b>${minTrackLength}</b>
    <span>mean length</span><b>${mean.toFixed(1)}</b>
    <span>p95 length</span><b>${p95}</b>
    <span>max speed</span><b>${data.maxSpeed.toFixed(4)} mm/frame</b>
    <span>x range</span><b>${data.boundsMin[0].toFixed(1)} to ${data.boundsMax[0].toFixed(1)}</b>
    <span>y range</span><b>${data.boundsMin[1].toFixed(1)} to ${data.boundsMax[1].toFixed(1)}</b>
    <span>z range</span><b>${data.boundsMin[2].toFixed(1)} to ${data.boundsMax[2].toFixed(1)}</b>
  `;
}

async function main() {
  const cfg = await loadConfig();
  document.title = cfg.title || "3D ULM Connected Tracks";
  document.getElementById("title").textContent = cfg.title || "3D ULM Connected Tracks";
  const desc = document.getElementById("description");
  desc.textContent = cfg.description || "";
  if (!cfg.description) desc.style.display = "none";
  const data = await loadTracks(cfg.tracks || "data/tracks.bin");
  const scene = new StaticTrackScene(data);
  renderStats(data, scene.params.minTrackLength);
}

main().catch((err) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#ffb4b4">${err.stack || err}</pre>`;
});
