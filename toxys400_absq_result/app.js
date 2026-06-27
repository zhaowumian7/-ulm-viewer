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
  const tableView = new DataView(buffer, 64, nTracks * 8);
  const tracks = [];
  for (let i = 0; i < nTracks; i++) {
    tracks.push({
      offset: tableView.getUint32(i * 8, true),
      length: tableView.getUint32(i * 8 + 4, true),
    });
  }
  const pointOffset = 64 + nTracks * 8;
  const points = new Float32Array(buffer, pointOffset, totalPoints * floatsPerPoint);
  return { version, floatsPerPoint, nTracks, totalPoints, maxSpeed, boundsMin, boundsMax, tracks, points };
}

function resizeCanvas(canvas, scale = 1) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.round(rect.width * dpr * scale));
  const height = Math.max(260, Math.round(rect.height * dpr * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function jet(t) {
  t = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function densityColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, [0, 0, 0]],
    [0.25, [28, 70, 140]],
    [0.55, [25, 190, 160]],
    [0.82, [240, 224, 94]],
    [1.00, [255, 250, 220]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [aT, a] = stops[i - 1];
      const [bT, b] = stops[i];
      const f = (t - aT) / (bT - aT);
      const c = a.map((v, j) => Math.round(v + (b[j] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(255,250,220)";
}

function axisMapper(data, canvas, ax0, ax1, pad = 30) {
  const min0 = data.boundsMin[ax0], max0 = data.boundsMax[ax0];
  const min1 = data.boundsMin[ax1], max1 = data.boundsMax[ax1];
  const w = canvas.width - 2 * pad;
  const h = canvas.height - 2 * pad;
  return (p0, p1) => [
    pad + (p0 - min0) / Math.max(max0 - min0, 1e-6) * w,
    canvas.height - pad - (p1 - min1) / Math.max(max1 - min1, 1e-6) * h,
  ];
}

function drawVelocity(data) {
  const canvas = document.getElementById("velocity");
  resizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";
  const map = axisMapper(data, canvas, 0, 1);
  const fpp = data.floatsPerPoint;
  const speedMax = Math.max(data.maxSpeed || 0, percentileSpeed(data, 0.98), 1e-6);
  for (const track of data.tracks) {
    if (track.length < 2) continue;
    for (let i = 1; i < track.length; i++) {
      const a = (track.offset + i - 1) * fpp;
      const b = (track.offset + i) * fpp;
      const p0 = map(data.points[a], data.points[a + 1]);
      const p1 = map(data.points[b], data.points[b + 1]);
      const speed = data.points[b + 4] / speedMax;
      ctx.strokeStyle = jet(speed);
      ctx.globalAlpha = 0.25 + 0.55 * Math.min(1, speed);
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawDepth(data) {
  const canvas = document.getElementById("depth");
  resizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  const map = axisMapper(data, canvas, 0, 2);
  const fpp = data.floatsPerPoint;
  const z0 = data.boundsMin[2], z1 = data.boundsMax[2];
  for (const track of data.tracks) {
    if (track.length < 2) continue;
    for (let i = 1; i < track.length; i++) {
      const a = (track.offset + i - 1) * fpp;
      const b = (track.offset + i) * fpp;
      const p0 = map(data.points[a], data.points[a + 2]);
      const p1 = map(data.points[b], data.points[b + 2]);
      const depth = (data.points[b + 2] - z0) / Math.max(z1 - z0, 1e-6);
      ctx.strokeStyle = jet(depth);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawDensity(data) {
  const canvas = document.getElementById("density");
  resizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const width = canvas.width, height = canvas.height;
  const bins = new Uint16Array(width * height);
  const map = axisMapper(data, canvas, 0, 1, 20);
  const fpp = data.floatsPerPoint;
  for (let i = 0; i < data.totalPoints; i++) {
    const o = i * fpp;
    const [x, y] = map(data.points[o], data.points[o + 1]);
    const ix = Math.round(x), iy = Math.round(y);
    if (ix >= 0 && ix < width && iy >= 0 && iy < height) {
      const idx = iy * width + ix;
      bins[idx] = Math.min(65535, bins[idx] + 1);
    }
  }
  let max = 1;
  for (const v of bins) if (v > max) max = v;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < bins.length; i++) {
    if (!bins[i]) continue;
    const t = Math.log1p(bins[i]) / Math.log1p(max);
    const rgb = densityRgb(t);
    const j = i * 4;
    image.data[j] = rgb[0];
    image.data[j + 1] = rgb[1];
    image.data[j + 2] = rgb[2];
    image.data[j + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function densityRgb(t) {
  const c = densityColor(t).match(/\d+/g).map(Number);
  return c;
}

function percentileSpeed(data, q) {
  const speeds = [];
  const fpp = data.floatsPerPoint;
  const step = Math.max(1, Math.floor(data.totalPoints / 100000));
  for (let i = 0; i < data.totalPoints; i += step) speeds.push(data.points[i * fpp + 4]);
  speeds.sort((a, b) => a - b);
  return speeds[Math.min(speeds.length - 1, Math.max(0, Math.floor(speeds.length * q)))] || 0;
}

function renderStats(data) {
  const lengths = data.tracks.map((t) => t.length).sort((a, b) => a - b);
  const meanLen = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const p95 = lengths[Math.floor(lengths.length * 0.95)] || 0;
  document.getElementById("stats").innerHTML = `
    <span>tracks</span><b>${data.nTracks.toLocaleString()}</b>
    <span>points</span><b>${data.totalPoints.toLocaleString()}</b>
    <span>mean length</span><b>${meanLen.toFixed(1)}</b>
    <span>p95 length</span><b>${p95}</b>
    <span>max speed</span><b>${data.maxSpeed.toFixed(4)} mm/frame</b>
    <span>bounds</span><b>${data.boundsMin.map(v => v.toFixed(1)).join(", ")} to ${data.boundsMax.map(v => v.toFixed(1)).join(", ")}</b>
  `;
}

async function main() {
  const cfg = await loadConfig();
  document.title = cfg.title || "ULM Result Map";
  document.getElementById("title").textContent = cfg.title || "ULM Result Map";
  const desc = document.getElementById("description");
  desc.textContent = cfg.description || "";
  if (!cfg.description) desc.style.display = "none";
  const data = await loadTracks(cfg.tracks || "data/tracks.bin");
  renderStats(data);
  drawVelocity(data);
  drawDensity(data);
  drawDepth(data);
  window.addEventListener("resize", () => {
    drawVelocity(data);
    drawDensity(data);
    drawDepth(data);
  });
}

main().catch((err) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#ffb4b4">${err.stack || err}</pre>`;
});
