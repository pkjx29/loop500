// Tuning aid: prints the plan and the replay so the numbers can be read side by side.
const C = require('../src/core.js');
const f = (x, d = 1) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(d));
const seed = process.argv[2] || C.SEED;

const plan = C.forecast();
console.log('PLAN  capDirect', f(plan.capDirect), 'parDirect', f(plan.parDirect), 'referred', f(plan.referred), 'total', f(plan.total),
  '| perCaptainDirect', f(plan.perCaptainDirect), 'perCaptain', f(plan.perCaptain, 2), 'capTree', f(plan.capTreeTotal), 'parTree', f(plan.parTreeTotal),
  'mult', f(plan.multiplier, 3), 'cross', plan.crossDay, 'cpr', f(plan.costPerReg, 2));
console.log('PLAN cum ', plan.days.map(d => Math.round(d.cum)).join(' / '));
for (const s of [0.8, 1, 1.2]) {
  const p = C.scaleRates(null, s), r = C.forecast(p);
  console.log('  rates x' + s, 'total', f(r.total), 'perCaptain', f(r.perCaptain, 1), 'captains needed', C.captainsNeeded(p));
}

for (const lever of [true, false]) {
  const sim = C.simulate({ seed, lever });
  console.log('\nREPLAY seed', seed, 'lever', lever, 'visits', sim.visits.length, 'regs', sim.regs.length);
  for (let d = 1; d <= 7; d++) {
    const a = C.analyze(sim, d * 24), m = a.measured, b = a.byDay[d - 1];
    console.log(' D' + d, 'FY', String(a.total).padStart(3), 'plan', String(Math.round(a.planCum)).padStart(3), 'gap', String(Math.round(a.gap)).padStart(4),
      '| new', b.total, '(cap', b.cap, 'par', b.par, 'ref', b.ref, 'dir', b.dir + ')',
      '| capt', a.activeCaptains + '+' + a.onboarding, 'clickIdx', f(m.clickIndex, 2), 'cvr', f(m.cvr, 3), 'cvrR', f(m.cvrRecent, 3), 'K', f(m.k, 3),
      '| proj', f(a.projection.total, 0), 'withLever', f(a.projection.withLever, 0), 'need', a.projection.need, 'perNew', f(a.projection.perNewCaptain, 1),
      '| worst', a.diagnosis.worst ? a.diagnosis.worst.key : '-', a.diagnosis.status, 'nonFY', a.nonFy);
  }
  const a = C.analyze(sim, 168);
  console.log(' funnel', JSON.stringify(a.funnel), 'crossedAt', a.crossedAt && f(a.crossedAt, 1), 'colleges', a.colleges.length);
  console.log(' channels', a.channels.map(c => `${c.key}: v${c.visits} r${c.regs} fy${c.fy} cvr${f(c.cvr, 2)}`).join(' | '));
  for (const t of [C.T_SHIP_HOOK, C.T_SHIP_INC, 96, 168]) {
    const ex = C.experiments(sim, t);
    console.log(' EXP@' + t, ex.map(e => `${e.id}[${e.status}] ` + e.arms.map(x => `${x.key}:${x.x}/${x.n}=${f(x.rate, 3)}${x.k !== undefined ? ' k' + f(x.k, 2) : ''}`).join(' vs ') + ` conf ${f(e.stat && e.stat.confidence, 3)} lift ${f(e.stat && e.stat.lift, 2)}`).join('\n        '));
  }
  console.log(' top captains', a.captains.slice(0, 5).map(c => `${c.id} ${c.tree}`).join(', '), '| top referrers', a.referrers.slice(0, 4).map(r => `${r.code} ${r.count}`).join(', '));
  if (lever) C.decisionLog(sim, 168).forEach(l => console.log('  LOG D' + l.day, l.title, '::', l.text));
}
