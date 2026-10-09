// Scan seeds for a replay whose story reads cleanly (tests significant when they are read, miss without the lever, hit with it).
const C = require('../src/core.js');
const N = Number(process.argv[2] || 2500), rows = [];
for (let i = 1; i <= N; i++) {
  const seed = 'loop500-' + i;
  const on = C.simulate({ seed, lever: true }), off = C.simulate({ seed, lever: false });
  const fOn = C.analyze(on, 168), fOff = C.analyze(off, 168), d4 = C.analyze(on, 96), d1 = C.analyze(on, 24), d2 = C.analyze(on, 48), d3 = C.analyze(on, 72), d5 = C.analyze(on, 120), d6 = C.analyze(on, 144);
  const e1 = C.experiments(on, C.T_SHIP_HOOK)[0], e2 = C.experiments(on, C.T_SHIP_INC)[1], e3 = C.experiments(on, 96)[2];
  const top = fOn.referrers.slice(0, 3).map(r => r.count);
  rows.push({ seed, on: fOn.total, off: fOff.total, d1: d1.total, d2: d2.total, d3: d3.total, d4: d4.total, d5: d5.total, d6: d6.total, proj4: Math.round(d4.projection.total), lev4: Math.round(d4.projection.withLever), need4: d4.projection.need,
    cross: fOn.crossedAt, h: [e1.arms[0].rate, e1.arms[1].rate, e1.stat.confidence, e1.arms[0].n, e1.arms[1].n], inc: [e2.arms[0].rate, e2.arms[1].rate, e2.stat.confidence, e2.arms[0].k, e2.arms[1].k],
    snd: [e3.arms[0].rate, e3.arms[1].rate, e3.stat.confidence], k: fOn.measured.k, k4: d4.measured.k, cvr: fOn.measured.cvr, ci: d4.measured.clickIndex, top, worst4: d4.diagnosis.worst && d4.diagnosis.worst.key,
    par: fOn.direct.par, nonfy: fOn.nonFy, colleges: fOn.colleges.length });
}
const tests = {
  on: r => r.on >= 555 && r.on <= 610, off: r => r.off >= 435 && r.off <= 485, proj4: r => r.proj4 <= 478 && r.proj4 >= 415, lev4: r => r.lev4 >= 515 && r.lev4 <= 640,
  hookConf: r => r.h[2] >= 0.95, hookRates: r => r.h[0] >= 0.28 && r.h[0] <= 0.42 && r.h[1] >= 0.42 && r.h[1] <= 0.56,
  incConf: r => r.inc[2] >= 0.95, incRates: r => r.inc[0] >= 0.15 && r.inc[0] <= 0.30 && r.inc[1] >= 0.30 && r.inc[1] <= 0.44 && r.inc[4] > r.inc[3],
  snd: r => r.snd[2] >= 0.95 && r.snd[1] > r.snd[0], cross: r => r.cross > 132, d1: r => r.d1 >= 5, top: r => r.top[0] >= 6, worst: r => r.worst4 === 'captains'
};
Object.keys(tests).forEach(k => console.log('  pass', k.padEnd(9), rows.filter(tests[k]).length));
const ok = rows.filter(r => Object.keys(tests).every(k => tests[k](r)));
const score = r => Math.abs(r.on - 582) / 20 + Math.abs(r.off - 462) / 20 + Math.abs(r.proj4 - 452) / 20 + Math.abs(r.lev4 - r.on) / 25 + Math.abs(r.h[0] - 0.35) * 10 + Math.abs(r.h[1] - 0.47) * 10 + Math.abs(r.inc[0] - 0.23) * 10 + Math.abs(r.inc[1] - 0.36) * 10 + Math.abs(r.d1 - 8) / 6;
ok.sort((a, b) => score(a) - score(b));
const f = (x, d = 2) => Number(x).toFixed(d);
console.log('candidates', ok.length, 'of', rows.length);
ok.slice(0, 14).forEach(r => console.log(r.seed.padEnd(13), 'on', r.on, 'off', r.off, '| d1-6', r.d1, r.d2, r.d3, r.d4, r.d5, r.d6, '| proj4', r.proj4, 'lev4', r.lev4, 'need', r.need4, 'cross', f(r.cross, 1),
  '| hook', f(r.h[0]), f(r.h[1]), f(r.h[2], 3), 'n', r.h[3], r.h[4], '| inc', f(r.inc[0]), f(r.inc[1]), f(r.inc[2], 3), 'k', f(r.inc[3]), f(r.inc[4]), '| snd', f(r.snd[0], 3), f(r.snd[1], 3), f(r.snd[2], 3),
  '| K', f(r.k), 'k4', f(r.k4), 'cvr', f(r.cvr), 'ci', f(r.ci), 'top', r.top.join('/'), 'par', r.par, 'nonfy', r.nonfy, 'col', r.colleges));
