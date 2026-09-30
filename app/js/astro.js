// Lunar ephemeris engine. Works in the browser, in Web Workers and in Node.
//
// Geocentric Moon: Meeus, Astronomical Algorithms, ch.47 (truncated ELP-2000/82).
// Geocentric Sun: Meeus ch.25 plus an aberration correction.
// Lunar orientation: IAU WGCCRE 2009 rotation model (Archinal et al. 2011), which
// approximates the Mean-Earth/Polar-Axis frame that the LOLA DEMs use.
// Checked against JPL DE421 with the MOON_ME_DE421 frame (see tools/validate.py).
// Typical error is about 0.005 deg for Sun and Earth directions from the lunar surface.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const MOON_R_KM = 1737.4;
export const AU_KM = 149597870.7;
export const EARTH_R_KM = 6378.137;
export const SUN_R_KM = 695700;
export const TT_MINUS_UTC_S = 69.184; // 37 leap seconds + 32.184 s

const sin = Math.sin, cos = Math.cos;
const norm360 = (x) => ((x % 360) + 360) % 360;

// Moon longitude and distance terms: D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)
const LR = [
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
  [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
  [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
  [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
  [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
  [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
  [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
  [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
  [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
  [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
  [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
  [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
  [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
  [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
  [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
  [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752],
];
// Moon latitude terms: D, M, M', F, Σb (1e-6 deg)
const B = [
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
  [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
  [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
  [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
  [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
  [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
  [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
  [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
  [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
  [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],
  [2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],
  [0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
  [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],
  [0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],
  [4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107],
];

/** Julian date (UTC) from epoch milliseconds */
export const jdUTC = (ms) => ms / 86400000 + 2440587.5;

/** Geocentric Moon, ecliptic of date: [lambda rad, beta rad, dist km] */
function moonEcl(T) {
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * D2R;
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * D2R;
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * D2R;
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * D2R;
  const A1 = (119.75 + 131.849 * T) * D2R, A2 = (53.09 + 479264.29 * T) * D2R, A3 = (313.45 + 481266.484 * T) * D2R;
  const E = 1 - 0.002516 * T - 0.0000074 * T2, E2 = E * E;
  const LpR = Lp * D2R;
  let sl = 0, sr = 0, sb = 0;
  for (let i = 0; i < LR.length; i++) {
    const t = LR[i];
    const arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    const e = t[1] === 0 ? 1 : (t[1] === 1 || t[1] === -1 ? E : E2);
    sl += t[4] * e * sin(arg);
    if (t[5]) sr += t[5] * e * cos(arg);
  }
  for (let i = 0; i < B.length; i++) {
    const t = B[i];
    const arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    const e = t[1] === 0 ? 1 : (t[1] === 1 || t[1] === -1 ? E : E2);
    sb += t[4] * e * sin(arg);
  }
  sl += 3958 * sin(A1) + 1962 * sin(LpR - F) + 318 * sin(A2);
  sb += -2235 * sin(LpR) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(LpR - Mp) - 115 * sin(LpR + Mp);
  return [(Lp + sl / 1e6) * D2R, (sb / 1e6) * D2R, 385000.56 + sr / 1000];
}

/** Geocentric apparent Sun (aberration included, mean equinox of date): [lambda rad, 0, dist km] */
function sunEcl(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const nu = M + C * D2R;
  const Rau = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu));
  const lon = L0 + C - 0.0056914 / Rau; // annual aberration
  return [norm360(lon) * D2R, 0, Rau * AU_KM];
}

function eclToEq(lon, lat, r, eps) {
  const cb = cos(lat);
  const x = r * cb * cos(lon), y = r * cb * sin(lon), z = r * sin(lat);
  const ce = cos(eps), se = sin(eps);
  return [x, y * ce - z * se, y * se + z * ce];
}

/** Precession matrix, mean equator/equinox of date -> J2000 (transpose of IAU 1976 P) */
function precessToJ2000(T) {
  const as = D2R / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  const cz = cos(zeta), sz = sin(zeta), cZ = cos(z), sZ = sin(z), ct = cos(th), st = sin(th);
  // P (J2000 -> date), rows
  const P = [
    [cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ],
    [cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ],
    [cz * st, -sz * st, ct],
  ];
  // transpose
  return [
    [P[0][0], P[1][0], P[2][0]],
    [P[0][1], P[1][1], P[2][1]],
    [P[0][2], P[1][2], P[2][2]],
  ];
}

const mulMV = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/** IAU 2009 lunar orientation: rotation matrix ICRF -> Moon body-fixed (≈ ME frame) */
function moonRotation(d, T) {
  const E1 = (125.045 - 0.0529921 * d) * D2R, E2 = (250.089 - 0.1059842 * d) * D2R;
  const E3 = (260.008 + 13.0120009 * d) * D2R, E4 = (176.625 + 13.3407154 * d) * D2R;
  const E5 = (357.529 + 0.9856003 * d) * D2R, E6 = (311.589 + 26.4057084 * d) * D2R;
  const E7 = (134.963 + 13.064993 * d) * D2R, E8 = (276.617 + 0.3287146 * d) * D2R;
  const E9 = (34.226 + 1.7484877 * d) * D2R, E10 = (15.134 - 0.1589763 * d) * D2R;
  const E11 = (119.743 + 0.0036096 * d) * D2R, E12 = (239.961 + 0.1643573 * d) * D2R;
  const E13 = (25.053 + 12.9590088 * d) * D2R;
  const a0 = (269.9949 + 0.0031 * T - 3.8787 * sin(E1) - 0.1204 * sin(E2) + 0.07 * sin(E3) - 0.0172 * sin(E4)
    + 0.0072 * sin(E6) - 0.0052 * sin(E10) + 0.0043 * sin(E13)) * D2R;
  const d0 = (66.5392 + 0.013 * T + 1.5419 * cos(E1) + 0.0239 * cos(E2) - 0.0278 * cos(E3) + 0.0068 * cos(E4)
    - 0.0029 * cos(E6) + 0.0009 * cos(E7) + 0.0008 * cos(E10) - 0.0009 * cos(E13)) * D2R;
  const W = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * sin(E1) + 0.1208 * sin(E2) - 0.0642 * sin(E3)
    + 0.0158 * sin(E4) + 0.0252 * sin(E5) - 0.0066 * sin(E6) - 0.0047 * sin(E7) - 0.0046 * sin(E8)
    + 0.0028 * sin(E9) + 0.0052 * sin(E10) + 0.004 * sin(E11) + 0.0019 * sin(E12) - 0.0044 * sin(E13)) * D2R;
  // R = Rz(W) * Rx(90° - d0) * Rz(90° + a0), frame rotations
  const ca = cos(a0), sa = sin(a0), cd = cos(d0), sd = sin(d0), cw = cos(W), sw = sin(W);
  // Rz(90+a0): [[-sa, ca, 0], [-ca, -sa, 0], [0,0,1]]
  // Rx(90-d0): [[1,0,0],[0, sd, cd],[0,-cd, sd]]
  const m1 = [
    [-sa, ca, 0],
    [-ca * sd, -sa * sd, cd],
    [ca * cd, sa * cd, sd],
  ];
  return [
    [cw * m1[0][0] + sw * m1[1][0], cw * m1[0][1] + sw * m1[1][1], cw * m1[0][2] + sw * m1[1][2]],
    [-sw * m1[0][0] + cw * m1[1][0], -sw * m1[0][1] + cw * m1[1][1], -sw * m1[0][2] + cw * m1[1][2]],
    m1[2],
  ];
}

/**
 * Full ephemeris at a UTC instant.
 * Returns the Sun and Earth vectors from the Moon's center in the lunar body-fixed frame (km),
 * the geocentric Moon vector in the equator of date (km) for ground-station geometry, and GMST (rad).
 */
export function ephem(ms) {
  const jdu = jdUTC(ms);
  const jdt = jdu + TT_MINUS_UTC_S / 86400;
  const d = jdt - 2451545.0;
  const T = d / 36525;
  const eps = (23.43929111 - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600) * D2R;
  const m = moonEcl(T);
  const s = sunEcl(T);
  const moonDate = eclToEq(m[0], m[1], m[2], eps);
  const sunDate = eclToEq(s[0], s[1], s[2], eps);
  const P = precessToJ2000(T);
  const moonJ = mulMV(P, moonDate);
  const sunJ = mulMV(P, sunDate);
  const R = moonRotation(d, T);
  const sunSel = mulMV(R, [sunJ[0] - moonJ[0], sunJ[1] - moonJ[1], sunJ[2] - moonJ[2]]);
  const earthSel = mulMV(R, [-moonJ[0], -moonJ[1], -moonJ[2]]);
  const Tu = (jdu - 2451545.0) / 36525;
  const gmst = norm360(280.46061837 + 360.98564736629 * (jdu - 2451545.0) + 0.000387933 * Tu * Tu - (Tu * Tu * Tu) / 38710000) * D2R;
  return { sun: sunSel, earth: earthSel, moonEq: moonDate, gmst, sunEq: sunDate };
}

/** Local frame at a lunar surface site. lat/lon in degrees (planetocentric, east-positive), h in meters above 1737.4 km */
export function siteFrame(lat, lon, hMeters = 0) {
  const la = lat * D2R, lo = lon * D2R;
  const r = MOON_R_KM + hMeters / 1000;
  const cla = cos(la), sla = sin(la), clo = cos(lo), slo = sin(lo);
  return {
    lat, lon, h: hMeters,
    p: [r * cla * clo, r * cla * slo, r * sla],
    E: [-slo, clo, 0],
    N: [-sla * clo, -sla * slo, cla],
    U: [cla * clo, cla * slo, sla],
  };
}

/** Topocentric azimuth (deg, clockwise from north) and elevation (deg) of a body-fixed vector (km from Moon center) */
export function topo(f, v) {
  const x = v[0] - f.p[0], y = v[1] - f.p[1], z = v[2] - f.p[2];
  const e = x * f.E[0] + y * f.E[1] + z * f.E[2];
  const n = x * f.N[0] + y * f.N[1] + z * f.N[2];
  const u = x * f.U[0] + y * f.U[1] + z * f.U[2];
  const dist = Math.sqrt(x * x + y * y + z * z);
  let az = Math.atan2(e, n) * R2D;
  if (az < 0) az += 360;
  return { az, el: Math.asin(u / dist) * R2D, dist };
}

/** Sub-point (selenographic lat/lon in degrees) of a body-fixed vector */
export function subPoint(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  let lon = Math.atan2(v[1], v[0]) * R2D;
  if (lon > 180) lon -= 360;
  return { lat: Math.asin(v[2] / r) * R2D, lon };
}

export const DSN = [
  { id: 'gds', name: 'Goldstone', lat: 35.4267, lon: -116.89 },
  { id: 'mad', name: 'Madrid', lat: 40.4314, lon: -4.2481 },
  { id: 'cbr', name: 'Canberra', lat: -35.4014, lon: 148.9817 },
];

/** Elevation (deg) of the Moon above a ground station's horizon (spherical Earth, topocentric) */
export function stationMoonElevation(eph, st) {
  const la = st.lat * D2R;
  const th = eph.gmst + st.lon * D2R;
  const up = [cos(la) * cos(th), cos(la) * sin(th), sin(la)];
  const m = eph.moonEq;
  const x = m[0] - EARTH_R_KM * up[0], y = m[1] - EARTH_R_KM * up[1], z = m[2] - EARTH_R_KM * up[2];
  return Math.asin((x * up[0] + y * up[1] + z * up[2]) / Math.hypot(x, y, z)) * R2D;
}

/** Illuminated fraction of Earth's disk as seen from the Moon (Earth phase) */
export function earthPhase(eph) {
  const s = eph.sun, e = eph.earth;
  // Phase angle at Earth between Sun and Moon directions
  const es = [s[0] - e[0], s[1] - e[1], s[2] - e[2]];
  const em = [-e[0], -e[1], -e[2]];
  const c = (es[0] * em[0] + es[1] * em[1] + es[2] * em[2]) / (Math.hypot(...es) * Math.hypot(...em));
  return (1 + c) / 2;
}

/** Fraction of a disk of angular radius r (deg) whose center is at elevation `h` (deg) above a locally flat horizon line */
export function diskFraction(h, r) {
  if (h >= r) return 1;
  if (h <= -r) return 0;
  const x = h / r; // -1..1
  // Area of circular segment above chord at distance -x from center
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

export { D2R, R2D };
