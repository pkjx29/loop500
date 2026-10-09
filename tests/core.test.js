// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('plan: direct registrations follow reach x click x registration', () => {
  const f = C.forecast();
  near(f.capDirect, 24 * 300 * 0.12 * 0.40, 1e-9);   // 345.6
  near(f.parDirect, 8 * 250 * 0.08 * 0.35, 1e-9);    // 56
  near(f.perCaptainDirect, 14.4, 1e-9);
});
test('plan: schedules sum to 1 and the daily rows add up', () => {
  near(C.sum(C.CAP_SCHED), 1, 1e-9); near(C.sum(C.PAR_SCHED), 1, 1e-9);
  const f = C.forecast();
  near(C.sum(f.days.map(d => d.total)), f.total, 1e-9);
  near(f.days[6].cum, f.total, 1e-9);
  near(f.capDirect + f.parDirect + f.referred, f.total, 1e-9);
  near(f.capTreeTotal + f.parTreeTotal, f.total, 1e-9);
});
test('plan: headline numbers used in the deck', () => {
  const f = C.forecast();
  assert.equal(Math.round(f.total), 592);
  assert.equal(Math.round(f.capTreeTotal), 508);
  assert.equal(Math.round(f.parTreeTotal), 84);
  assert.equal(Math.round(f.referred), 190);
  assert.equal(f.crossDay, 6);
  assert.equal(f.perCaptain.toFixed(1), '21.1');
  assert.deepEqual(f.days.map(d => Math.round(d.cum)), [7, 85, 260, 382, 484, 543, 592]);
  assert.equal(C.captainsNeeded(), 20);
  assert.equal(Math.round(C.forecast(C.scaleRates(null, 0.8)).total), 347);
  assert.equal(Math.round(C.forecast(C.scaleRates(null, 1.2)).total), 936);
  assert.equal(C.captainsNeeded(C.scaleRates(null, 0.8)), 37);
  assert.equal(C.captainsNeeded(C.scaleRates(null, 1.2)), 11);
  assert.equal(C.sum(C.BUDGET_LINES.map(b => b.amount)), C.BUDGET);
});
test('plan: no referrals means total equals direct; more K means more', () => {
  const f0 = C.forecast({ k: 0 }); near(f0.total, f0.direct, 1e-9);
  assert.ok(C.forecast({ k: 0.5 }).total > C.forecast({ k: 0.35 }).total);
});
test('stats: two-proportion z-test matches a hand calculation', () => {
  const s = C.twoProp(40, 100, 55, 100);       // z = 0.15 / sqrt(0.475*0.525*0.02) = 2.124
  near(s.z, 2.124, 0.002); near(s.pValue, 0.0337, 0.001); near(s.lift, 0.375, 1e-9);
  near(C.normCdf(1.96), 0.975, 0.0005);
  assert.equal(C.twoProp(1, 0, 1, 10), null);
});
test('tokens and phone numbers', () => {
  assert.deepEqual(C.parseToken('#r-sneh4kq'), { kind: 'ref', code: 'SNEH4KQ' });
  assert.deepEqual(C.parseToken('#c-K07-batch'), { kind: 'captain', capId: 'K07', grp: 'batch' });
  assert.deepEqual(C.parseToken('c-k07'), { kind: 'captain', capId: 'K07', grp: 'class' });
  assert.deepEqual(C.parseToken('#p-P3'), { kind: 'partner', partnerId: 'P3' });
  assert.deepEqual(C.parseToken('#mission'), { kind: 'tab', tab: 'mission' });
  assert.equal(C.parseToken('#<script>'), null); assert.equal(C.parseToken(''), null);
  assert.ok(C.validPhone('98765 43210')); assert.ok(C.validPhone('+91 9876543210')); assert.ok(C.validPhone('09876543210'));
  assert.ok(!C.validPhone('12345')); assert.ok(!C.validPhone('5876543210')); assert.ok(!C.validPhone('98765432101'));
  assert.equal(C.maskPhone('9876543210'), '98•••••210');
  assert.equal(C.displayName('  sneha   reddy '), 'Sneha R.'); assert.equal(C.displayName('arjun'), 'Arjun'); assert.equal(C.displayName(''), '');
});
test('replay: deterministic, and the counterfactual only removes the nominated captains', () => {
  const a = C.simulate(), b = C.simulate(), off = C.simulate({ lever: false });
  assert.equal(a.regs.length, b.regs.length); assert.equal(a.visits.length, b.visits.length);
  assert.deepEqual(a.regs.map(r => r.code).slice(0, 50), b.regs.map(r => r.code).slice(0, 50));
  assert.equal(a.captains.length, 39); assert.equal(off.captains.length, 30);
  const d4on = C.analyze(a, 96), d4off = C.analyze(off, 96);
  assert.equal(d4on.total, d4off.total);                       // identical until the decision
  assert.equal(new Set(a.regs.map(r => r.code)).size, a.regs.length);   // referral codes are unique
});
test('replay: every view of the same log agrees', () => {
  const sim = C.simulate();
  for (let d = 1; d <= 7; d++) {
    const a = C.analyze(sim, d * 24);
    assert.equal(C.sum(a.byDay.map(x => x.total)), a.total);
    assert.equal(C.sum(a.channels.map(c => c.fy)), a.total);
    assert.equal(C.sum(a.channels.map(c => c.regs)), a.all);
    assert.equal(C.sum(a.channels.map(c => c.visits)), a.funnel.visits);
    assert.equal(a.total + a.nonFy, a.all);
    assert.equal(C.sum(a.colleges.map(c => c.fy)), a.total);
    assert.ok(a.funnel.visits >= a.funnel.started && a.funnel.started >= a.funnel.registered && a.funnel.registered >= a.funnel.shared && a.funnel.shared >= a.funnel.referrers);
    assert.equal(a.byDay[d - 1].cum, a.total);
    assert.equal(C.sum(a.captains.map(c => c.direct)), a.direct.cap);
  }
});
test('replay: the story the deck and video tell', () => {
  const on = C.simulate(), off = C.simulate({ lever: false });
  const cum = [1, 2, 3, 4, 5, 6, 7].map(d => C.analyze(on, d * 24).total);
  assert.deepEqual(cum, [9, 43, 192, 281, 429, 512, 578]);
  const d4 = C.analyze(on, 96);
  assert.equal(d4.activeCaptains, 19); assert.equal(d4.onboarding, 9); assert.equal(Math.round(d4.planCum), 382);
  assert.equal(Math.round(d4.projection.total), 452); assert.equal(Math.round(d4.projection.withLever), 575);
  assert.equal(d4.diagnosis.status, 'behind'); assert.equal(d4.diagnosis.worst.key, 'captains');
  const end = C.analyze(on, 168), endOff = C.analyze(off, 168);
  assert.equal(end.total, 578); assert.equal(endOff.total, 454); assert.equal(end.colleges.length, 34);
  assert.equal(C.dayOf(end.crossedAt), 6); assert.equal(endOff.crossedAt, null);
  assert.equal(end.diagnosis.status, 'hit'); assert.equal(endOff.diagnosis.status, 'missed');
  const [hook] = C.experiments(on, C.T_SHIP_HOOK); assert.ok(hook.stat.confidence >= 0.95 && hook.arms[1].rate > hook.arms[0].rate);
  const inc = C.experiments(on, C.T_SHIP_INC)[1]; assert.ok(inc.stat.confidence >= 0.95 && inc.arms[1].rate > inc.arms[0].rate);
  const snd = C.experiments(on, 96)[2]; assert.ok(snd.stat.confidence >= 0.95 && snd.arms[1].rate > snd.arms[0].rate * 1.5);
});
test('live registrations are counted on top of the replay and attributed', () => {
  const sim = C.simulate(), base = C.analyze(sim, 96), cap = base.captains[0];
  const live = { visits: [{ id: 'L.v1', t: 95.9, src: 'captain', grp: 'class', capId: cap.id, hook: 'B', started: true, regId: 'L.r1', live: true }],
    regs: [{ id: 'L.r1', t: 95.9, name: 'Test U.', college: cap.college, fy: true, code: 'TESTAAA', refBy: null, src: 'captain', grp: 'class', capId: cap.id, rootType: 'captain', rootId: cap.id, hook: 'B', inc: 'B', shared: true, depth: 0, live: true },
           { id: 'L.r2', t: 95.9, name: 'Friend F.', college: cap.college, fy: true, code: 'FRIEBBB', refBy: 'TESTAAA', src: 'referral', rootType: 'captain', rootId: cap.id, hook: 'B', inc: 'B', shared: false, depth: 1, live: true }] };
  const a = C.analyze(sim, 96, live);
  assert.equal(a.total, base.total + 2);
  assert.equal(a.children.TESTAAA, 1);
  assert.equal(a.captains.find(c => c.id === cap.id).tree, cap.tree + 2);
  assert.equal(a.captains.find(c => c.id === cap.id).direct, cap.direct + 1);
  assert.equal(a.byDay[3].total, base.byDay[3].total + 2);
});
