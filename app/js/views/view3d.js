// 3D South Pole: LOLA terrain in WebGL2 with live, physically placed sunlight and ray-marched shadows.
// Shadows use true (unexaggerated) heights over a ±200 km tile, including the Moon's curvature, and a soft
// edge from the Sun's real angular radius, so a partly hidden Sun gives partial light.
import { h, store, getSite, settings, engineOpts, fmtTime, fmtDeg, fmtPct, toInput, fromInput, query, setQuery, isoMin, parseIso, icon, ICONS, toast } from '../ui.js';
import { ephem, SUN_R_KM, R2D } from '../astro.js';
import { snapshot, HOUR, DAY } from '../engine.js';

const R_KM = 1737.4;
const SPEEDS = [[1, '1 h/s'], [6, '6 h/s'], [24, '1 d/s'], [72, '3 d/s']];

// ------------------------------------------------------------------ small math
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}
function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return w <= 0 ? null : [x / w, y / w];
}
/** Body-fixed vector → pole tangent frame (x = 90°E, y = 0° toward Earth, z = up) */
const toPole = (v) => [v[1], v[0], -v[2]];
const llToXYkm = (lat, lon) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; const rho = 2 * R_KM * Math.tan(Math.PI / 4 + la / 2); return [rho * Math.sin(lo), rho * Math.cos(lo)]; };

// float32 → IEEE half
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v; const x = u32[0];
  const sign = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >> 13);
}

// ------------------------------------------------------------------ shaders
const COMMON = `#version 300 es
precision highp float;
uniform sampler2D uFine, uCoarse;
uniform float uFineHalf, uCoarseHalf, uExag;
const float R = ${R_KM.toFixed(1)};
float hTrue(vec2 p) {                          // km, true relief incl. curvature drop, pole tangent frame
  vec2 a = abs(p);
  float m;
  if (max(a.x, a.y) < uFineHalf) m = texture(uFine, vec2(p.x / (2.0 * uFineHalf) + 0.5, 0.5 - p.y / (2.0 * uFineHalf))).r;
  else m = texture(uCoarse, vec2(p.x / (2.0 * uCoarseHalf) + 0.5, 0.5 - p.y / (2.0 * uCoarseHalf))).r;
  return m / 1000.0 - dot(p, p) / (2.0 * R);
}
float hDisp(vec2 p) {                          // displayed relief (exaggerated heights, true curvature)
  vec2 a = abs(p);
  float m;
  if (max(a.x, a.y) < uFineHalf) m = texture(uFine, vec2(p.x / (2.0 * uFineHalf) + 0.5, 0.5 - p.y / (2.0 * uFineHalf))).r;
  else m = texture(uCoarse, vec2(p.x / (2.0 * uCoarseHalf) + 0.5, 0.5 - p.y / (2.0 * uCoarseHalf))).r;
  return m / 1000.0 * uExag - dot(p, p) / (2.0 * R);
}
`;
const VS = COMMON + `
in vec2 aUV;
uniform float uHalf;
uniform mat4 uMVP;
out vec2 vP;
void main() {
  vec2 p = (aUV - 0.5) * 2.0 * uHalf;
  p.y = -p.y;
  vP = p;
  gl_Position = uMVP * vec4(p, hDisp(p), 1.0);
}`;
const FS = COMMON + `
in vec2 vP;
uniform vec3 uSun;
uniform float uSunR, uMode, uSteps, uHole, uSunUp;
uniform sampler2D uOverlay;
uniform float uOverlayHalf;
out vec4 frag;
vec3 ramp(float t, int k) {
  t = clamp(t, 0.0, 1.0);
  if (k == 0) return mix(mix(vec3(0.08,0.06,0.19), vec3(0.9,0.43,0.2), smoothstep(0.0,0.55,t)), vec3(1.0,0.97,0.78), smoothstep(0.55,1.0,t));
  return mix(mix(vec3(0.06,0.08,0.2), vec3(0.23,0.53,0.9), smoothstep(0.0,0.6,t)), vec3(0.85,0.94,1.0), smoothstep(0.6,1.0,t));
}
void main() {
  if (uHole > 0.0 && max(abs(vP.x), abs(vP.y)) < uHole) discard;
  float e = 0.35;
  vec3 n = normalize(vec3(hDisp(vP - vec2(e, 0.0)) - hDisp(vP + vec2(e, 0.0)), hDisp(vP - vec2(0.0, e)) - hDisp(vP + vec2(0.0, e)), 2.0 * e));
  // --- sunlight with ray-marched terrain shadow (true heights) ---
  float light = 0.0;
  vec2 sxy = uSun.xy; float sl = length(sxy);
  if (uSunUp > 0.0 && sl > 1e-6) {
    vec2 dir = sxy / sl;
    float tanB = uSun.z / sl;
    float z0 = hTrue(vP) + 0.002;
    float minM = 1.0, d = 0.06;
    for (int i = 0; i < 200; i++) {
      if (float(i) >= uSteps) break;
      d = d * 1.055 + 0.025;
      vec2 q = vP + dir * d;
      if (max(abs(q.x), abs(q.y)) > uCoarseHalf) break;
      float m = (z0 + tanB * d - hTrue(q)) / d;
      minM = min(minM, m);
      if (minM < -uSunR) break;
    }
    float frac = clamp(0.5 + minM / (2.0 * uSunR), 0.0, 1.0);
    vec3 nT = normalize(vec3(hTrue(vP - vec2(e, 0.0)) - hTrue(vP + vec2(e, 0.0)), hTrue(vP - vec2(0.0, e)) - hTrue(vP + vec2(0.0, e)), 2.0 * e));
    light = max(dot(nT, uSun), 0.0) * frac;
  }
  float relief = clamp(0.35 + 0.65 * dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  vec3 col;
  if (uMode < 0.5) {
    vec3 lit = vec3(0.9, 0.88, 0.84) * (1.0 - exp(-light * 9.0));
    col = lit + vec3(0.035, 0.04, 0.055) * relief;          // faint earthshine/relief in shadow
  } else {
    vec2 uv = vec2(vP.x / (2.0 * uOverlayHalf) + 0.5, 0.5 - vP.y / (2.0 * uOverlayHalf));
    vec4 o = texture(uOverlay, uv);
    bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
    vec3 c = uMode < 1.5 ? ramp(o.r, 0) : ramp(o.g, 1);
    col = inside ? c * (0.45 + 0.75 * relief) + vec3(1.0, 0.95, 0.8) * (1.0 - exp(-light * 9.0)) * 0.3 : vec3(0.3) * relief;
  }
  float fog = smoothstep(120.0, 200.0, length(vP));
  frag = vec4(mix(col, vec3(0.0), fog * 0.6), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function grid(gl, n) {
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { uv[(j * n + i) * 2] = i / (n - 1); uv[(j * n + i) * 2 + 1] = j / (n - 1); }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length };
}
async function loadDem(url, n) {
  const res = await fetch(url);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const i16 = new Int16Array(buf), half = new Uint16Array(n * n), f = new Float32Array(n * n);
  for (let i = 0; i < i16.length; i++) { half[i] = toHalf(i16[i]); f[i] = i16[i]; }
  return { half, f, n };
}
function heightTex(gl, d) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, d.n, d.n, 0, gl.RED, gl.HALF_FLOAT, d.half);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function mount(root) {
  const meta = store.meta || {};
  const q = query();
  const st = {
    t: isFinite(parseIso(q.t)) ? parseIso(q.t) : Math.floor(Date.now() / 600000) * 600000,
    mode: +q.mode || 0, exag: +q.exag || 2, focus: q.site || 'connecting-ridge',
    az: 200, el: 28, dist: 60, target: [0, 0, 0],
    playing: false, speed: 6,
  };

  const box = h('div', { style: { position: 'relative', height: 'clamp(420px, calc(100vh - 230px), 900px)', borderRadius: '14px', overflow: 'hidden', background: '#000', touchAction: 'none' } });
  const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'grab' }, 'aria-label': '3D view of the lunar south pole with live sunlight and shadows', role: 'img' });
  const labels = h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' } });
  const hud = h('div', { style: { position: 'absolute', left: '10px', top: '10px', right: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', pointerEvents: 'none' } });
  const info = h('div', { style: { position: 'absolute', left: '10px', bottom: '10px', background: 'rgba(6,9,20,.85)', color: '#dfe5f3', borderRadius: '10px', padding: '8px 12px', fontSize: '13px', maxWidth: 'calc(100% - 20px)', pointerEvents: 'none' } });
  const busy = h('div.busy', { style: { position: 'absolute', inset: 0, justifyContent: 'center', color: '#dfe5f3' } }, h('div.spinner'), h('span', 'Loading LOLA terrain…'));
  box.append(cv, labels, hud, info, busy);

  const modeSeg = h('div.seg.dark', { style: { pointerEvents: 'auto' } },
    [['Live sunlight', 0], ['Yearly sunlight %', 1], ['Yearly Earth view %', 2]].map(([l, m]) => h('button', { class: st.mode === m ? 'on' : '', onclick: (e) => { st.mode = m; [...modeSeg.children].forEach((b) => b.classList.toggle('on', b === e.target)); save(); draw(); } }, l)));
  const siteSel = h('select', { style: { width: 'auto', pointerEvents: 'auto' }, 'aria-label': 'Focus on site', onchange: () => { st.focus = siteSel.value; focusSite(true); save(); } },
    h('option', { value: 'pole' }, 'South Pole'), store.sites.filter((s) => s.lat <= -84).map((s) => h('option', { value: s.id, selected: s.id === st.focus }, s.name)));
  const exSel = h('select', { style: { width: 'auto', pointerEvents: 'auto' }, 'aria-label': 'Vertical exaggeration', onchange: () => { st.exag = +exSel.value; save(); draw(); } },
    [1, 2, 3, 5].map((v) => h('option', { value: v, selected: v === st.exag }, `Relief ×${v}`)));
  hud.append(modeSeg, siteSel, exSel);

  const dtIn = h('input', { type: 'datetime-local', step: 600, 'aria-label': 'Date and time', onchange: () => { const v = fromInput(dtIn.value); if (isFinite(v)) { st.t = v; update(); } } });
  const whenEl = h('div.when');
  const playBtn = h('button.btn.primary.small', { onclick: togglePlay, 'aria-label': 'Play/pause' }, icon(ICONS.play));
  const speedSel = h('select', { style: { width: 'auto' }, onchange: (e) => { st.speed = +e.target.value; } }, SPEEDS.map(([v, l]) => h('option', { value: v, selected: v === st.speed }, l)));
  const stepB = (ms, ic, l) => h('button.btn.small', { onclick: () => { st.t += ms; update(); }, 'aria-label': l, title: l }, icon(ic));
  const timebar = h('div.timebar', { style: { borderRadius: '0 0 14px 14px' } },
    h('div.grp', stepB(-DAY, ICONS.back2, 'Back 1 day'), stepB(-HOUR, ICONS.back, 'Back 1 hour'), playBtn, stepB(HOUR, ICONS.fwd, 'Forward 1 hour'), stepB(DAY, ICONS.fwd2, 'Forward 1 day')),
    speedSel, dtIn, h('button.btn.small', { onclick: () => { st.t = Date.now(); update(); } }, icon(ICONS.now), 'Now'), h('div.spacer'), whenEl);

  root.append(
    h('div.pagehead', h('div', h('h1', '3D South Pole'), h('p', 'Real LOLA terrain lit by the Sun at the chosen moment. Shadows are traced toward the Sun through ±200 km of terrain, including the Moon\'s curvature and the Sun\'s disk size. Detail is highest within 80 km of the pole (312 m cells), coarser beyond (800 m). Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan.'))),
    h('div.card.flush', h('div', { style: { padding: '0' } }, box), timebar));

  // ------------------------------------------------------------------ WebGL
  const gl = cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) { box.replaceChildren(h('div.empty', { style: { color: '#dfe5f3' } }, 'This device does not support WebGL2, which the 3D view needs. The Explorer and Site Map work everywhere.')); return {}; }
  let prog, fine, coarse, overlayTex, ready = false, fineData, coarseData;
  const U = {};
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aUV'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    for (const n of ['uFine', 'uCoarse', 'uFineHalf', 'uCoarseHalf', 'uExag', 'uHalf', 'uMVP', 'uSun', 'uSunR', 'uMode', 'uSteps', 'uHole', 'uSunUp', 'uOverlay', 'uOverlayHalf']) U[n] = gl.getUniformLocation(prog, n);
  } catch (e) { box.replaceChildren(h('div.empty', { style: { color: '#dfe5f3' } }, '3D shaders failed to compile on this device: ' + e.message)); return {}; }
  const mobile = matchMedia('(pointer: coarse)').matches;
  const fineMesh = grid(gl, mobile ? 384 : 512), coarseMesh = grid(gl, 200);
  const fm = meta.dem3d_fine || { half_m: 80e3, n: 512 }, cm = meta.dem3d_coarse || { half_m: 200e3, n: 500 };

  Promise.all([loadDem('data/dem3d_fine.bin.gz', fm.n), loadDem('data/dem3d_coarse.bin.gz', cm.n)]).then(([f, c]) => {
    fineData = f; coarseData = c;
    fine = heightTex(gl, f); coarse = heightTex(gl, c);
    const img = new Image();
    img.onload = () => {
      overlayTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, overlayTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      draw();
    };
    img.src = 'data/overlay.png';
    ready = true; busy.remove();
    focusSite(false); update();
  }).catch((e) => { busy.replaceChildren(h('span', 'Terrain failed to load: ' + e.message)); });

  function surfaceZ(x, y) {           // displayed height at (x, y) km: fine tile, else the wide coarse tile
    if (!fineData) return 0;
    const inFine = Math.max(Math.abs(x), Math.abs(y)) < fm.half_m / 1000;
    const D = inFine ? fineData : coarseData, half = (inFine ? fm.half_m : cm.half_m) / 1000, n = D.n;
    // texel centres: sample i covers [(i)..(i+1)] cells, matching the shader's texture lookup
    const c = (x + half) / (2 * half) * n - 0.5, r = (half - y) / (2 * half) * n - 0.5;
    if (c < 0 || r < 0 || c > n - 1 || r > n - 1) return -(x * x + y * y) / (2 * R_KM);
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, a = D.f;
    const g = (i, j) => a[Math.min(n - 1, j) * n + Math.min(n - 1, i)];
    const hm = g(c0, r0) * (1 - fc) * (1 - fr) + g(c0 + 1, r0) * fc * (1 - fr) + g(c0, r0 + 1) * (1 - fc) * fr + g(c0 + 1, r0 + 1) * fc * fr;
    return hm / 1000 * st.exag - (x * x + y * y) / (2 * R_KM);
  }
  function focusSite(animate) {
    const s = getSite(st.focus);
    const [x, y] = s ? llToXYkm(s.lat, s.lon) : [0, 0];
    st.target = [x, y, surfaceZ(x, y)];
    st.dist = s ? 26 : 70;
    draw();
  }

  let mvp = null;
  function draw() {
    if (!ready || raf) return;
    raf = requestAnimationFrame(render);
  }
  let raf = 0;
  function render() {
    raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.004, 0.006, 0.016, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    st.target[2] = surfaceZ(st.target[0], st.target[1]);
    const el = st.el * Math.PI / 180, az = st.az * Math.PI / 180;
    const eye = [st.target[0] + st.dist * Math.cos(el) * Math.sin(az), st.target[1] + st.dist * Math.cos(el) * Math.cos(az), st.target[2] + st.dist * Math.sin(el)];
    const proj = perspective(50 * Math.PI / 180, W / H, 0.05, 3000);
    const view = lookAt(eye, st.target, [0, 0, 1]);
    mvp = mul(proj, view);
    const e = ephem(st.t);
    const sun = norm(toPole(e.sun));
    const sunR = Math.asin(SUN_R_KM / Math.hypot(...e.sun));
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fine); gl.uniform1i(U.uFine, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coarse); gl.uniform1i(U.uCoarse, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, overlayTex || fine); gl.uniform1i(U.uOverlay, 2);
    gl.uniform1f(U.uFineHalf, fm.half_m / 1000); gl.uniform1f(U.uCoarseHalf, cm.half_m / 1000);
    gl.uniform1f(U.uOverlayHalf, (meta.overlay?.half_m || 200e3) / 1000);
    gl.uniform1f(U.uExag, st.exag); gl.uniformMatrix4fv(U.uMVP, false, mvp);
    gl.uniform3fv(U.uSun, sun); gl.uniform1f(U.uSunR, sunR); gl.uniform1f(U.uSunUp, 1);
    gl.uniform1f(U.uMode, overlayTex ? st.mode : 0); gl.uniform1f(U.uSteps, window.__lh3dSteps || (mobile ? 110 : 170));
    // coarse ring first (with a hole where the fine tile is), then the fine tile
    gl.uniform1f(U.uHalf, cm.half_m / 1000); gl.uniform1f(U.uHole, fm.half_m / 1000 - 0.4);
    gl.bindVertexArray(coarseMesh.vao); gl.drawElements(gl.TRIANGLES, coarseMesh.count, gl.UNSIGNED_INT, 0);
    gl.uniform1f(U.uHalf, fm.half_m / 1000); gl.uniform1f(U.uHole, 0);
    gl.bindVertexArray(fineMesh.vao); gl.drawElements(gl.TRIANGLES, fineMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    placeLabels(eye, e, sun);
  }

  function placeLabels(eye, e, sun) {
    const W = cv.clientWidth, H = cv.clientHeight;
    const out = [], boxes = [];
    const put = (p3, html, cls, label) => {
      const p = project(mvp, p3);
      if (!p || Math.abs(p[0]) > 1.05 || Math.abs(p[1]) > 1.05) return;
      const x = (p[0] + 1) / 2 * W, y = (1 - p[1]) / 2 * H;
      if (label) {                       // skip a site label that would overlap one already placed, or the control bar
        if (y < 64) return;
        const w = 16 + label.length * 7.2, bx = x - 6, by = y - 9;
        if (boxes.some((q) => bx < q[0] + q[2] && bx + w > q[0] && by < q[1] + 18 && by + 18 > q[1])) return;
        boxes.push([bx, by, w]);
      }
      out.push(`<div class="${cls}" style="position:absolute;left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${html}</div>`);
    };
    // Sun and Earth far along their directions
    put([eye[0] + sun[0] * 1500, eye[1] + sun[1] * 1500, eye[2] + sun[2] * 1500], '<span class="g3-sun"></span><b>Sun</b>', 'g3');
    const ed = norm(toPole(e.earth));
    put([eye[0] + ed[0] * 1500, eye[1] + ed[1] * 1500, eye[2] + ed[2] * 1500], '<span class="g3-earth"></span><b>Earth</b>', 'g3');
    const order = [...store.sites].sort((a, b) => (b.id === st.focus) - (a.id === st.focus));   // focused site wins
    for (const s of order) {
      if (s.lat > -84) continue;
      const [x, y] = llToXYkm(s.lat, s.lon);
      if (Math.max(Math.abs(x), Math.abs(y)) > cm.half_m / 1000) continue;
      put([x, y, surfaceZ(x, y) + 0.05], `<span class="g3-pin"></span>${s.name}`, 'g3 g3-site' + (s.id === st.focus ? ' on' : ''), s.name);
    }
    labels.innerHTML = out.join('');
  }

  function update() {
    whenEl.textContent = fmtTime(st.t);
    if (document.activeElement !== dtIn) dtIn.value = toInput(st.t);
    const s = getSite(st.focus);
    if (s) {
      const sn = snapshot(s, st.t, engineOpts());
      info.innerHTML = `<b>${s.name}</b> · Sun ${fmtDeg(sn.sun.el, 2)} (${fmtPct(sn.sun.frac * 100)} of disk visible) · Earth ${fmtDeg(sn.earth.el, 2)} ${sn.earthVis ? 'in view' : 'hidden'}`;
    } else {
      const e = ephem(st.t);
      const sEl = Math.asin(-e.sun[2] / Math.hypot(...e.sun)) * R2D;
      info.innerHTML = `<b>South Pole</b> · Sun ${fmtDeg(sEl, 2)} above the ideal horizon`;
    }
    save(); draw();
  }
  let saveT;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => setQuery({ t: isoMin(st.t), mode: st.mode || null, exag: st.exag, site: st.focus }), 300); }

  // ------------------------------------------------------------------ controls
  const pts = new Map();
  let drag = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); cv.style.cursor = 'grabbing';
    const pan = e.button === 2 || e.shiftKey;
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, az: st.az, el: st.el, pan, tgt: st.target.slice() };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: st.dist, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tgt: st.target.slice() }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !drag) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const panBy = (dx, dy, base) => {
      const az = st.az * Math.PI / 180, k = st.dist / cv.clientHeight * 0.95;
      const right = [Math.cos(az), -Math.sin(az)], fwd = [-Math.sin(az), -Math.cos(az)];
      st.target = [base[0] - (dx * right[0] - dy * fwd[0]) * k, base[1] - (dx * right[1] - dy * fwd[1]) * k, 0];
    };
    if (drag.pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      st.dist = Math.max(1.5, Math.min(500, drag.dist * drag.pinch / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1]))));
      panBy((a[0] + b[0]) / 2 - drag.mid[0], (a[1] + b[1]) / 2 - drag.mid[1], drag.tgt);
    } else if (!drag.pinch) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) panBy(dx, dy, drag.tgt);
      else { st.az = (drag.az - dx * 0.3 + 360) % 360; st.el = Math.max(2, Math.min(88, drag.el + dy * 0.25)); }
    }
    draw();
  });
  const up = (e) => { pts.delete(e.pointerId); if (!pts.size) { drag = null; cv.style.cursor = 'grab'; } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.dist = Math.max(1.5, Math.min(500, st.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); draw(); }, { passive: false });

  let praf = 0, last = 0;
  function togglePlay() {
    st.playing = !st.playing;
    playBtn.replaceChildren(icon(st.playing ? ICONS.pause : ICONS.play));
    if (st.playing) { last = performance.now(); praf = requestAnimationFrame(tick); } else cancelAnimationFrame(praf);
  }
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    st.t += dt * st.speed * HOUR; update();
    if (st.playing) praf = requestAnimationFrame(tick);
  }
  const onKey = (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { st.t += e.shiftKey ? DAY : HOUR; update(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { st.t -= e.shiftKey ? DAY : HOUR; update(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => draw()); ro.observe(box);
  // Scripting hook (demo recording, automated tests): read/set view state and render synchronously
  window.__view3d = { st, update, renderNow: () => { if (ready) { cancelAnimationFrame(raf); raf = 0; update(); cancelAnimationFrame(raf); raf = 0; render(); gl.finish(); } return ready && !!overlayTex; } };

  return {
    unmount() {
      cancelAnimationFrame(praf); cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('keydown', onKey); delete window.__view3d;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
