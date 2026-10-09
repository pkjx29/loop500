/* Loop500 core: forecast model, campaign replay and analytics.
   Pure functions, no DOM. Runs in the browser (window.LoopCore) and in Node (tests, deck numbers). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoopCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GOAL = 500, DAYS = 7, BUDGET = 2000;
  var T_CLOSE = 162;      // Day 7, 18:00: registration closes
  var T_SHIP_HOOK = 60;   // Day 3, 12:00: hook test is read
  var T_SHIP_INC = 90;    // Day 4, 18:00: incentive test is read
  var T_LEVER = 95;       // Day 4, 23:00: checkpoint decision
  var T_SENDER_END = 96;  // sender test window: Days 2-4
  var SEED = 'loop500-1308';

  /* ---------- the plan (base case) ---------- */
  var PLAN = {
    captains: 24, recruited: 30, reach: 300, ctr: 0.12, cvr: 0.40,
    partners: 8, partnerReach: 250, partnerCtr: 0.08, partnerCvr: 0.35, k: 0.35
  };
  // share of a channel's direct registrations landing on each day (posting calendar)
  var CAP_SCHED = [0.02, 0.22, 0.36, 0.12, 0.14, 0.06, 0.08];
  var PAR_SCHED = [0, 0, 0.40, 0.35, 0.20, 0.05, 0];
  var BUDGET_LINES = [
    { key: 'captains', label: 'Campus Captain prizes', detail: 'Top 3 by verified final-year registrations: ₹500, ₹300, ₹200', amount: 1000 },
    { key: 'referrers', label: 'Top student referrers', detail: 'Top 5 squads: ₹100 each', amount: 500 },
    { key: 'reserve', label: 'Reserve, released on Day 4 data', detail: 'Goes to whichever lever the tracker says is short', amount: 500 }
  ];

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }

  function runLoop(direct, k) {
    var out = [], prev = 0;
    for (var d = 0; d < DAYS; d++) { var ref = k * prev, n = direct[d] + ref; out.push({ direct: direct[d], ref: ref, total: n }); prev = n; }
    return out;
  }

  /* Expected-value model. Referrals land with a one-day lag; anything after Day 7 does not count. */
  function forecast(params) {
    var p = assign({}, PLAN, params || {});
    var capDirect = p.captains * p.reach * p.ctr * p.cvr;
    var parDirect = p.partners * p.partnerReach * p.partnerCtr * p.partnerCvr;
    var capTree = runLoop(CAP_SCHED.map(function (s) { return s * capDirect; }), p.k);
    var parTree = runLoop(PAR_SCHED.map(function (s) { return s * parDirect; }), p.k);
    var days = [], cum = 0, crossDay = null;
    for (var d = 0; d < DAYS; d++) {
      var cap = capTree[d].direct, par = parTree[d].direct, ref = capTree[d].ref + parTree[d].ref;
      var total = cap + par + ref; cum += total;
      if (crossDay === null && cum >= GOAL) crossDay = d + 1;
      days.push({ day: d + 1, cap: cap, par: par, ref: ref, total: total, cum: cum });
    }
    var capTreeTotal = sum(capTree.map(function (x) { return x.total; }));
    var parTreeTotal = sum(parTree.map(function (x) { return x.total; }));
    var direct = capDirect + parDirect;
    return {
      params: p, capDirect: capDirect, parDirect: parDirect, direct: direct,
      referred: cum - direct, total: cum, days: days, crossDay: crossDay,
      capTreeTotal: capTreeTotal, parTreeTotal: parTreeTotal,
      perCaptainDirect: p.captains ? capDirect / p.captains : 0,
      perCaptain: p.captains ? capTreeTotal / p.captains : 0,
      multiplier: direct ? cum / direct : 0,
      costPerReg: cum ? BUDGET / cum : null
    };
  }
  function scaleRates(params, f) {
    var p = assign({}, PLAN, params || {});
    p.ctr *= f; p.cvr *= f; p.partnerCtr *= f; p.partnerCvr *= f; p.k *= f;
    return p;
  }
  function captainsNeeded(params, goal) {
    goal = goal || GOAL;
    for (var n = 0; n <= 400; n++) if (forecast(assign({}, params, { captains: n })).total >= goal) return n;
    return null;
  }

  /* ---------- statistics ---------- */
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  /* two-proportion z-test, arm 2 against arm 1 */
  function twoProp(x1, n1, x2, n2) {
    if (!n1 || !n2) return null;
    var p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
    var se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    var z = se ? (p2 - p1) / se : 0;
    var pv = 2 * (1 - normCdf(Math.abs(z)));
    return { p1: p1, p2: p2, lift: p1 ? (p2 - p1) / p1 : null, z: z, pValue: pv, confidence: 1 - pv };
  }

  /* ---------- seeded randomness ---------- */
  function hashStr(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rngFrom(s) { return mulberry32(hashStr(String(s))); }
  function rU(r, a, b) { return a + (b - a) * r(); }
  function rExp(r, mean) { return -mean * Math.log(1 - r() * 0.999999); }
  function rNorm(r) { var u = 1 - r() * 0.999999, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function rPoisson(r, lam) { var L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
  function rBinom(r, n, p) { var x = 0; p = clamp(p, 0, 1); for (var i = 0; i < n; i++) if (r() < p) x++; return x; }
  function rPick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function rWeighted(r, items, weights) {
    var tot = sum(weights), u = r() * tot, acc = 0;
    for (var i = 0; i < items.length; i++) { acc += weights[i]; if (u < acc) return items[i]; }
    return items[items.length - 1];
  }

  /* ---------- sample universe (fictional people at real campuses) ---------- */
  var COLLEGES = [
    'RIT Bengaluru', 'CBIT Hyderabad', 'VNR VJIET Hyderabad', 'BMSCE Bengaluru', 'Vasavi CE Hyderabad',
    'GRIET Hyderabad', 'VR Siddhartha Vijayawada', 'MGIT Hyderabad', 'DSCE Bengaluru', 'CVR CE Hyderabad',
    'KMIT Hyderabad', 'SIT Tumakuru', 'SNIST Hyderabad', 'GMRIT Rajam', 'Vardhaman CE Hyderabad',
    'NMIT Bengaluru', 'KL University Vijayawada', 'MVSR Hyderabad', 'BVRIT Narsapur', 'NIE Mysuru',
    'Anurag University Hyderabad', 'Vignan Guntur', 'MLRIT Hyderabad', 'KITS Warangal', 'BMSIT Bengaluru',
    'RVR & JC Guntur', 'CMRCET Hyderabad', 'GVPCE Visakhapatnam', 'JSS STU Mysuru', 'Vishnu IT Bhimavaram',
    'Sairam Chennai', 'KCT Coimbatore', 'PCCOE Pune', 'KIET Ghaziabad', 'AKGEC Ghaziabad',
    'GL Bajaj Greater Noida', 'KIIT Bhubaneswar', 'Sathyabama Chennai', 'MIT-WPU Pune'
  ];
  var FIRST = ['Sai', 'Ananya', 'Rohit', 'Sneha', 'Karthik', 'Divya', 'Harsha', 'Meghana', 'Vamsi', 'Pooja', 'Nikhil', 'Lavanya',
    'Arjun', 'Keerthi', 'Tarun', 'Bhavana', 'Rahul', 'Shreya', 'Manoj', 'Deepika', 'Akhil', 'Nandini', 'Varun', 'Swathi',
    'Abhishek', 'Ishita', 'Pranav', 'Sahithi', 'Yash', 'Tanvi', 'Aditya', 'Kavya', 'Vikram', 'Mounika', 'Siddharth', 'Anusha',
    'Charan', 'Ritika', 'Naveen', 'Teja', 'Aishwarya', 'Gautham', 'Sravani', 'Rakesh', 'Ajay', 'Pallavi', 'Suraj', 'Niharika'];
  var LAST = 'KRSMPVNBGDTAJC'.split('');
  var BRANCHES = ['CSE', 'IT', 'ECE', 'EEE', 'Mech', 'Civil', 'AI & DS', 'Other'];
  var BRANCH_W = [34, 8, 22, 10, 10, 6, 6, 4];
  var CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  var PARTNER_DEF = [
    { id: 'P1', type: 'placement', label: 'Placement cell mail', college: 'GRIET Hyderabad', day: 3, h: 10.5 },
    { id: 'P2', type: 'club', label: 'GDG on Campus', college: 'VNR VJIET Hyderabad', day: 3, h: 12 },
    { id: 'P3', type: 'club', label: 'IEEE student branch', college: 'BMSCE Bengaluru', day: 3, h: 17 },
    { id: 'P4', type: 'club', label: 'Coding club', college: 'CBIT Hyderabad', day: 4, h: 10 },
    { id: 'P5', type: 'club', label: 'CSI student chapter', college: 'VR Siddhartha Vijayawada', day: 4, h: 13 },
    { id: 'P6', type: 'club', label: 'GDG on Campus', college: 'KL University Vijayawada', day: 4, h: 18 },
    { id: 'P7', type: 'placement', label: 'Placement cell mail', college: 'Vardhaman CE Hyderabad', day: 5, h: 10 },
    { id: 'P8', type: 'club', label: 'E-Cell', college: 'DSCE Bengaluru', day: 5, h: 15 }
  ];
  var IDLE = { 4: 1, 8: 1, 11: 1, 13: 1, 16: 1, 19: 1, 21: 1, 23: 1, 26: 1, 28: 1, 30: 1 };   // 11 of 30 never post
  var LATE = { 6: 1, 10: 1, 15: 1, 20: 1, 25: 1 };                                             // 5 post a day late
  // click rate the plan expects from each post (first exposure, then reposts); sums to about 36 clicks per captain
  var CTR = { class: 0.135, batch: 0.062, other: 0.045, repClass1: 0.03, repBatch: 0.03, repClass2: 0.025, last: 0.012 };
  // the replay's world is deliberately a little worse than the plan on clicks and partner response
  var WORLD_CLICK = 0.92, PARTNER_CTR = { club: 0.055, placement: 0.07 };
  var P_START = { A: 0.56, B: 0.64 }, P_DONE = { A: 0.60, B: 0.68 };
  var WARM_S = { captain: 1, partner: 0.80, referral: 1.10, direct: 0.9 }, WARM_D = { captain: 1, partner: 0.85, referral: 1.05, direct: 0.95 };
  var P_SHARE = { A: 0.22, B: 0.36 }, LAMBDA = { A: 1.65, B: 1.85 }, CONNECTOR = { share: 0.06, boost: 3.5 };
  var FY_SHARE = { class: 0.98, batch: 0.97, other: 0.80, club: 0.42, placement: 0.97, referral: 0.93, direct: 0.85 };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayAt(d, h) { return (d - 1) * 24 + h; }
  function dayOf(t) { return clamp(Math.floor(t / 24) + 1, 1, DAYS); }
  function personName(r) { return rPick(r, FIRST) + ' ' + rPick(r, LAST) + '.'; }
  function makeCode(name, taken, r) {
    var base = String(name || 'X').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    while (base.length < 4) base += 'X';
    for (var tries = 0; tries < 200; tries++) {
      var c = base;
      for (var i = 0; i < 3; i++) c += CODE_CHARS[Math.floor(r() * CODE_CHARS.length)];
      if (!taken[c]) { taken[c] = 1; return c; }
    }
    var f = base + String(Date.now()).slice(-3); taken[f] = 1; return f;
  }

  function buildCaptains(seed, lever) {
    var r = rngFrom(seed + ':captains'), out = [];
    for (var i = 1; i <= 39; i++) {
      var late = i > 30;
      var c = {
        id: 'K' + pad2(i), name: personName(r), college: COLLEGES[i - 1], branch: rWeighted(r, BRANCHES, BRANCH_W),
        via: i <= 9 ? 'Own network' : (i <= 24 ? 'Club-lead DM' : (i <= 30 ? 'Captain referral' : 'Captain-get-captain')),
        hook: i % 2 ? 'B' : 'A', lever: late, recruitedAt: late ? T_LEVER : 0, activeFrom: null
      };
      var q = clamp(Math.exp(0.33 * rNorm(r) - 0.05), 0.5, 1.75), j = rU(r, -1, 1), j2 = rU(r, 8.5, 13);
      c.q = late ? q * 0.85 : q;
      if (i === 1) c.activeFrom = 17;                    // Day 1, 5 PM: soft launch on my own campus
      else if (late) { c.activeFrom = 96 + j2; c.hook = 'B'; }
      else if (IDLE[i]) c.activeFrom = null;
      else if (LATE[i]) c.activeFrom = dayAt(3, 19) + j;
      else c.activeFrom = dayAt(2, 19) + j;
      if (late && !lever) continue;
      out.push(c);
    }
    return out;
  }

  function captainPosts(c, r) {
    var cls = Math.round(rU(r, 58, 72)), bat = Math.round(rU(r, 150, 230)), oth = Math.round(rU(r, 40, 70));
    var a = c.activeFrom, d0 = dayOf(a), jit = function () { return rU(r, -0.6, 0.6); }, list = [];
    if (!c.lever) {
      list.push({ grp: 'class', t: a, reach: cls, base: cls, ctr: CTR.class, kind: 'first' });
      list.push({ grp: 'batch', t: (c.id === 'K01' ? dayAt(1, 20.5) : dayAt(d0 + 1, 13)) + jit(), reach: bat, base: bat, ctr: CTR.batch, kind: 'first' });
      list.push({ grp: 'other', t: dayAt(d0 + 2, 13) + jit(), reach: oth, base: oth, ctr: CTR.other, kind: 'first' });
      list.push({ grp: 'class', t: dayAt(d0 + 2, 20) + jit(), reach: 0, base: cls, ctr: CTR.repClass1, kind: 'repost' });
      list.push({ grp: 'batch', t: Math.max(dayAt(5, 19), dayAt(d0 + 3, 19)) + jit(), reach: 0, base: bat, ctr: CTR.repBatch, kind: 'repost' });
      if (a < 72) list.push({ grp: 'class', t: dayAt(6, 19) + jit(), reach: 0, base: cls, ctr: CTR.repClass2, kind: 'repost' });
      list.push({ grp: 'class', t: dayAt(7, 10) + jit(), reach: 0, base: cls + bat, ctr: CTR.last, kind: 'last call' });
    } else {
      list.push({ grp: 'class', t: a, reach: cls, base: cls, ctr: CTR.class, kind: 'first' });
      list.push({ grp: 'batch', t: a + 6 + jit(), reach: bat, base: bat, ctr: CTR.batch, kind: 'first' });
      list.push({ grp: 'other', t: dayAt(6, 13) + jit(), reach: oth, base: oth, ctr: CTR.other, kind: 'first' });
      list.push({ grp: 'class', t: dayAt(7, 10) + jit(), reach: 0, base: cls + bat, ctr: CTR.last, kind: 'last call' });
    }
    return list.filter(function (p) { return p.t < T_CLOSE; });
  }

  /* Deterministic replay of a 7-day campaign that follows the plan's playbook.
     lever=false is the counterfactual: no Day-4 decision. */
  function simulate(opts) {
    opts = opts || {};
    var seed = opts.seed || SEED, lever = opts.lever !== false;
    var visits = [], regs = [], posts = [], taken = {};
    var captains = buildCaptains(seed, lever);
    var partners = PARTNER_DEF.map(function (p) { return assign({}, p); });

    function convert(r, hook, warm) {
      var started = r() < P_START[hook] * WARM_S[warm];
      var done = started && r() < P_DONE[hook] * WARM_D[warm];
      return { started: started, done: done };
    }
    function hookAt(t, r, fixed) { return t >= T_SHIP_HOOK ? 'B' : (fixed || (r() < 0.5 ? 'A' : 'B')); }

    function register(visit, r, ctx) {
      var name = personName(r);
      var reg = {
        id: visit.id, t: visit.t + 0.02, name: name, college: ctx.college, branch: ctx.branch || rWeighted(r, BRANCHES, BRANCH_W),
        fy: r() < ctx.fyShare, code: makeCode(name, taken, r), refBy: ctx.refBy || null, parentId: ctx.parentId || null,
        src: visit.src, grp: visit.grp || null, capId: visit.capId || null, partnerId: visit.partnerId || null,
        rootType: ctx.rootType, rootId: ctx.rootId || null, hook: visit.hook,
        inc: visit.t < T_SHIP_INC ? (r() < 0.5 ? 'A' : 'B') : 'B', shared: false, depth: ctx.depth || 0, live: false
      };
      reg.year = reg.fy ? 2027 : 2028;
      visit.regId = reg.id;
      regs.push(reg);
      spawn(reg);
      return reg;
    }
    function spawn(reg) {
      var r = rngFrom(seed + ':reg:' + reg.id);
      var pShare = P_SHARE[reg.inc] * Math.pow(0.88, reg.depth) * (reg.fy ? 1 : 0.8);
      if (r() >= pShare) return;
      reg.shared = true;
      if (reg.depth >= 4) return;
      var n = rPoisson(r, LAMBDA[reg.inc] * (r() < CONNECTOR.share ? CONNECTOR.boost : 1));
      for (var i = 0; i < n; i++) {
        var t = reg.t + 0.3 + Math.min(rExp(r, 9), 48);
        if (t >= T_CLOSE) { r(); r(); r(); continue; }
        var v = { id: reg.id + '>' + i, t: t, src: 'referral', grp: null, capId: null, partnerId: null, ref: reg.code, hook: hookAt(t, r), started: false, regId: null, live: false };
        var c = convert(r, v.hook, 'referral'); v.started = c.started;
        visits.push(v);
        if (c.done) register(v, r, { college: r() < 0.85 ? reg.college : rPick(r, COLLEGES), fyShare: FY_SHARE.referral, refBy: reg.code, parentId: reg.id, rootType: reg.rootType, rootId: reg.rootId, depth: reg.depth + 1 });
      }
    }

    captains.forEach(function (c) {
      if (c.activeFrom === null) return;
      var r = rngFrom(seed + ':cap:' + c.id);
      captainPosts(c, r).forEach(function (p, pi) {
        var msg = p.t < T_SHIP_HOOK ? c.hook : 'B';
        var post = { id: c.id + '.' + pi, capId: c.id, grp: p.grp, t: p.t, reach: p.reach, base: p.base, ctr: p.ctr, kind: p.kind, msg: msg };
        posts.push(post);
        var n = rBinom(r, p.base, p.ctr * WORLD_CLICK * c.q * (msg === 'B' ? 1.07 : 0.93));
        for (var i = 0; i < n; i++) {
          var t = p.t + Math.min(rExp(r, 2.5), 30), u1 = r(), u2 = r();
          if (t >= T_CLOSE) continue;
          var hook = t >= T_SHIP_HOOK ? 'B' : c.hook;
          var v = { id: post.id + '.' + i, t: t, src: 'captain', grp: p.grp, capId: c.id, partnerId: null, ref: null, hook: hook, started: false, regId: null, live: false };
          v.started = u1 < P_START[hook]; visits.push(v);
          if (v.started && u2 < P_DONE[hook]) {
            var rr = rngFrom(seed + ':v:' + v.id);
            register(v, rr, { college: (p.grp === 'other' && rr() < 0.1) ? rPick(rr, COLLEGES) : c.college, branch: p.grp === 'class' ? c.branch : null, fyShare: FY_SHARE[p.grp], rootType: 'captain', rootId: c.id, depth: 0 });
          }
        }
      });
    });

    partners.forEach(function (p) {
      var r = rngFrom(seed + ':par:' + p.id);
      p.t = dayAt(p.day, p.h);
      p.reachTotal = Math.round(p.type === 'club' ? rU(r, 380, 620) : rU(r, 280, 420));
      p.reachFY = Math.round(p.reachTotal * (p.type === 'club' ? 0.42 : 1));
      var n = rBinom(r, p.reachTotal, PARTNER_CTR[p.type]);
      for (var i = 0; i < n; i++) {
        var t = p.t + Math.min(rExp(r, 6), 40);
        if (t >= T_CLOSE) { r(); r(); r(); continue; }
        var v = { id: p.id + '.' + i, t: t, src: 'partner', grp: p.type, capId: null, partnerId: p.id, ref: null, hook: hookAt(t, r), started: false, regId: null, live: false };
        var c = convert(r, v.hook, 'partner'); v.started = c.started; visits.push(v);
        if (c.done) register(v, rngFrom(seed + ':v:' + v.id), { college: p.college, fyShare: FY_SHARE[p.type], rootType: 'partner', rootId: p.id, depth: 0 });
      }
    });

    var rd = rngFrom(seed + ':direct');
    for (var i = 0; i < 28; i++) {
      var t = rU(rd, 30, 160);
      var v = { id: 'D.' + i, t: t, src: 'direct', grp: null, capId: null, partnerId: null, ref: null, hook: hookAt(t, rd), started: false, regId: null, live: false };
      var c = convert(rd, v.hook, 'direct'); v.started = c.started; visits.push(v);
      if (c.done) register(v, rngFrom(seed + ':v:' + v.id), { college: rPick(rd, COLLEGES), fyShare: FY_SHARE.direct, rootType: 'direct', rootId: null, depth: 0 });
    }

    visits.sort(function (a, b) { return a.t - b.t; });
    regs.sort(function (a, b) { return a.t - b.t; });
    posts.sort(function (a, b) { return a.t - b.t; });
    return { seed: seed, lever: lever, captains: captains, partners: partners, posts: posts, visits: visits, regs: regs, taken: taken };
  }

  /* ---------- analytics over the event log ---------- */
  function channelKey(x) {
    if (x.src === 'captain') return 'wa-' + (x.grp || 'class');
    if (x.src === 'partner') return x.grp === 'placement' ? 'placement' : 'club';
    if (x.src === 'referral') return 'referral';
    return 'direct';
  }
  var CHANNELS = [
    { key: 'wa-class', label: 'Class WhatsApp group', owner: 'Captain' },
    { key: 'wa-batch', label: 'Batch / branch WhatsApp group', owner: 'Captain' },
    { key: 'wa-other', label: 'Hostel / project groups', owner: 'Captain' },
    { key: 'referral', label: 'Squad referral link', owner: 'Student' },
    { key: 'placement', label: 'Placement-cell mail', owner: 'Partner' },
    { key: 'club', label: 'Club broadcast', owner: 'Partner' },
    { key: 'direct', label: 'Direct / unattributed', owner: 'None' }
  ];

  function analyze(sim, tEnd, live) {
    live = live || { visits: [], regs: [] };
    var day = clamp(Math.ceil(tEnd / 24), 1, DAYS);
    var V = sim.visits.filter(function (v) { return v.t < tEnd; }).concat(live.visits || []);
    var R = sim.regs.filter(function (r) { return r.t < tEnd; }).concat(live.regs || []);
    var P = sim.posts.filter(function (p) { return p.t < tEnd; });
    var capById = {}; sim.captains.forEach(function (c) { capById[c.id] = c; });
    var regByCode = {}; R.forEach(function (r) { regByCode[r.code] = r; });
    var bucket = function (x) { return x.live ? day : dayOf(x.t); };

    var byDay = []; for (var d = 0; d < DAYS; d++) byDay.push({ day: d + 1, cap: 0, par: 0, ref: 0, dir: 0, total: 0, cum: 0 });
    var total = 0, nonFy = 0, direct = { cap: 0, par: 0, dir: 0 }, children = {}, childrenFy = {};
    R.forEach(function (r) {
      if (r.refBy) { children[r.refBy] = (children[r.refBy] || 0) + 1; if (r.fy) childrenFy[r.refBy] = (childrenFy[r.refBy] || 0) + 1; }
      if (!r.fy) { nonFy++; return; }
      total++;
      var b = byDay[bucket(r) - 1];
      if (r.src === 'referral') b.ref++;
      else if (r.src === 'captain') { b.cap++; direct.cap++; }
      else if (r.src === 'partner') { b.par++; direct.par++; }
      else { b.dir++; direct.dir++; }
      b.total++;
    });
    var cum = 0; byDay.forEach(function (b) { cum += b.total; b.cum = cum; });

    // funnel
    var funnel = { visits: V.length, started: 0, registered: R.length, shared: 0, referrers: 0 };
    V.forEach(function (v) { if (v.started) funnel.started++; });
    R.forEach(function (r) { if (r.shared) funnel.shared++; if (children[r.code]) funnel.referrers++; });

    // channels
    var chMap = {}; CHANNELS.forEach(function (c) { chMap[c.key] = assign({ visits: 0, started: 0, regs: 0, fy: 0, shared: 0 }, c); });
    V.forEach(function (v) { var c = chMap[channelKey(v)]; c.visits++; if (v.started) c.started++; });
    R.forEach(function (r) { var c = chMap[channelKey(r)]; c.regs++; if (r.fy) c.fy++; if (r.shared) c.shared++; });
    var channels = CHANNELS.map(function (c) { var x = chMap[c.key]; x.cvr = x.visits ? x.regs / x.visits : null; x.fyPct = x.regs ? x.fy / x.regs : null; x.shareRate = x.regs ? x.shared / x.regs : null; return x; });

    // captains
    var capStat = {};
    sim.captains.forEach(function (c) {
      if (c.recruitedAt >= tEnd) return;
      capStat[c.id] = { id: c.id, name: c.name, college: c.college, via: c.via, lever: c.lever, posts: 0, reach: 0, visits: 0, direct: 0, tree: 0,
        status: c.activeFrom !== null && c.activeFrom < tEnd ? 'active' : (c.lever ? 'onboarding' : (tEnd <= 43 ? 'scheduled' : 'idle')) };
    });
    P.forEach(function (p) { var s = capStat[p.capId]; if (s) { s.posts++; s.reach += p.reach; } });
    V.forEach(function (v) { if (v.capId && capStat[v.capId]) capStat[v.capId].visits++; });
    R.forEach(function (r) {
      if (!r.fy) return;
      if (r.src === 'captain' && capStat[r.capId]) capStat[r.capId].direct++;
      if (r.rootType === 'captain' && capStat[r.rootId]) capStat[r.rootId].tree++;
    });
    var captains = Object.keys(capStat).map(function (k) { return capStat[k]; });
    captains.sort(function (a, b) { return b.tree - a.tree || b.visits - a.visits || (a.id < b.id ? -1 : 1); });
    var activeCaptains = captains.filter(function (c) { return c.status === 'active'; }).length;
    var onboarding = captains.filter(function (c) { return c.status === 'onboarding'; }).length;
    var idle = captains.filter(function (c) { return c.status === 'idle'; }).length;

    // partners
    var partners = sim.partners.filter(function (p) { return p.t < tEnd; }).map(function (p) {
      var s = { id: p.id, label: p.label, college: p.college, type: p.type, reachTotal: p.reachTotal, reachFY: p.reachFY, visits: 0, regs: 0, fy: 0, tree: 0 };
      V.forEach(function (v) { if (v.partnerId === p.id) s.visits++; });
      R.forEach(function (r) { if (r.partnerId === p.id) { s.regs++; if (r.fy) s.fy++; } if (r.fy && r.rootType === 'partner' && r.rootId === p.id) s.tree++; });
      return s;
    });

    // colleges and referrers
    var colMap = {};
    R.forEach(function (r) { if (r.fy) colMap[r.college] = (colMap[r.college] || 0) + 1; });
    var colleges = Object.keys(colMap).map(function (k) { return { college: k, fy: colMap[k] }; }).sort(function (a, b) { return b.fy - a.fy || (a.college < b.college ? -1 : 1); });
    var referrers = Object.keys(children).map(function (code) {
      var r = regByCode[code]; return r ? { code: code, name: r.name, college: r.college, count: children[code], fy: childrenFy[code] || 0, live: !!r.live } : null;
    }).filter(Boolean).sort(function (a, b) { return b.count - a.count || (a.code < b.code ? -1 : 1); });

    // measured rates (captain traffic)
    var capVisits = 0, capRegs = 0, capVisitsRecent = 0, capRegsRecent = 0;
    V.forEach(function (v) { if (v.src !== 'captain' || v.live) return; capVisits++; if (v.regId) capRegs++; if (v.t >= tEnd - 48) { capVisitsRecent++; if (v.regId) capRegsRecent++; } });
    var expVisits = 0, uniqueReach = 0;
    P.forEach(function (p) { expVisits += p.base * p.ctr * (1 - Math.exp(-(tEnd - p.t) / 2.5)); uniqueReach += p.reach; });
    var cohort = 0, cohortKids = 0;
    sim.regs.forEach(function (r) { if (r.t < tEnd - 24) { cohort++; cohortKids += children[r.code] || 0; } });
    var measured = {
      clickIndex: expVisits > 5 ? capVisits / expVisits : null,
      ctr: uniqueReach ? capVisits / uniqueReach : null,
      cvr: capVisits >= 20 ? capRegs / capVisits : null,
      cvrRecent: capVisitsRecent >= 20 ? capRegsRecent / capVisitsRecent : (capVisits >= 20 ? capRegs / capVisits : null),
      k: cohort >= 20 ? cohortKids / cohort : null,
      capFyShare: capRegs ? direct.cap / capRegs : null, uniqueReach: uniqueReach, capVisits: capVisits
    };

    var plan = forecast(PLAN);
    var planCum = plan.days[day - 1].cum;
    var a = {
      day: day, tEnd: tEnd, total: total, nonFy: nonFy, all: R.length, byDay: byDay, direct: direct, today: byDay[day - 1].total,
      funnel: funnel, channels: channels, captains: captains, activeCaptains: activeCaptains, onboarding: onboarding, idleCaptains: idle,
      partners: partners, colleges: colleges, referrers: referrers, children: children, measured: measured,
      plan: plan, planCum: planCum, gap: total - planCum, daysLeft: DAYS - day,
      required: day < DAYS ? Math.max(0, GOAL - total) / (DAYS - day) : null,
      costPerReg: total ? BUDGET / total : null,
      crossedAt: null
    };
    // when did the count cross the goal?
    var n = 0;
    for (var i = 0; i < R.length; i++) { if (R[i].fy && !R[i].live) { n++; if (n === GOAL) { a.crossedAt = R[i].t; break; } } }
    a.experiments = experiments(sim, tEnd);
    a.projection = project(sim, a);
    a.diagnosis = diagnose(a);
    return a;
  }

  function experiments(sim, tEnd) {
    // Test 1: hook. All visits before the read time.
    var tw = Math.min(tEnd, T_SHIP_HOOK), h = { A: { n: 0, x: 0 }, B: { n: 0, x: 0 } };
    sim.visits.forEach(function (v) { if (v.t < tw) { h[v.hook].n++; if (v.regId) h[v.hook].x++; } });
    var s1 = twoProp(h.A.x, h.A.n, h.B.x, h.B.n);
    // Test 2: incentive framing. Registrants before the read time; referred sign-ups counted up to now.
    var ti = Math.min(tEnd, T_SHIP_INC), inc = { A: { n: 0, x: 0, kids: 0 }, B: { n: 0, x: 0, kids: 0 } }, codeArm = {};
    sim.regs.forEach(function (r) { if (r.t < ti) { inc[r.inc].n++; if (r.shared) inc[r.inc].x++; codeArm[r.code] = r.inc; } });
    sim.regs.forEach(function (r) { if (r.t < tEnd && r.refBy && codeArm[r.refBy]) inc[codeArm[r.refBy]].kids++; });
    var s2 = twoProp(inc.A.x, inc.A.n, inc.B.x, inc.B.n);
    // Test 3: sender. Final-year registrations per 100 final-years reached, Days 2-4.
    var ts = Math.min(tEnd, T_SENDER_END), cap = { n: 0, x: 0, all: 0 }, par = { n: 0, x: 0, all: 0 };
    sim.posts.forEach(function (p) { if (p.t < ts) cap.n += p.reach; });
    sim.partners.forEach(function (p) { if (p.t < ts) par.n += p.reachFY; });
    sim.regs.forEach(function (r) {
      if (r.t >= ts) return;
      if (r.src === 'captain') { cap.all++; if (r.fy) cap.x++; }
      if (r.src === 'partner') { par.all++; if (r.fy) par.x++; }
    });
    var s3 = twoProp(par.x, par.n, cap.x, cap.n);
    function st(read, s, minN, n1, n2) {
      if (tEnd >= read) return 'decided';
      if (!s || n1 < minN || n2 < minN) return 'collecting';
      return 'running';
    }
    return [
      { id: 'hook', title: 'Test 1 · Hook', lever: 'Visit → registration', readAt: T_SHIP_HOOK, status: st(T_SHIP_HOOK, s1, 30, h.A.n, h.B.n), stat: s1, metric: 'Visit → registration',
        arms: [{ key: 'A', label: 'Learning hook', sub: '“Learn to build with AI in 60 minutes”', n: h.A.n, x: h.A.x, rate: h.A.n ? h.A.x / h.A.n : null, unit: 'visits' },
               { key: 'B', label: 'Outcome hook', sub: '“Build the AI project your resume is missing”', n: h.B.n, x: h.B.x, rate: h.B.n ? h.B.x / h.B.n : null, unit: 'visits' }] },
      { id: 'incentive', title: 'Test 2 · Referral framing', lever: 'Referrals per registrant (K)', readAt: T_SHIP_INC, status: st(T_SHIP_INC, s2, 30, inc.A.n, inc.B.n), stat: s2, metric: 'Share rate',
        arms: [{ key: 'A', label: 'Invite 3 friends', sub: 'Generic unlock', n: inc.A.n, x: inc.A.x, rate: inc.A.n ? inc.A.x / inc.A.n : null, k: inc.A.n ? inc.A.kids / inc.A.n : null, unit: 'registrants' },
               { key: 'B', label: 'Bring your project squad', sub: 'Team of 4 unlocks together', n: inc.B.n, x: inc.B.x, rate: inc.B.n ? inc.B.x / inc.B.n : null, k: inc.B.n ? inc.B.kids / inc.B.n : null, unit: 'registrants' }] },
      { id: 'sender', title: 'Test 3 · Sender', lever: 'Where Days 5-7 effort goes', readAt: T_SENDER_END, status: st(T_SENDER_END, s3, 200, par.n, cap.n), stat: s3, metric: 'Final-year registrations per 100 reached',
        arms: [{ key: 'partner', label: 'Official blast', sub: 'Club broadcast or placement-cell mail', n: par.n, x: par.x, rate: par.n ? par.x / par.n : null, fyPct: par.all ? par.x / par.all : null, unit: 'final-years reached' },
               { key: 'captain', label: 'Classmate post', sub: 'Campus Captain in a class or batch group', n: cap.n, x: cap.x, rate: cap.n ? cap.x / cap.n : null, fyPct: cap.all ? cap.x / cap.all : null, unit: 'final-years reached' }] }
    ];
  }

  /* Where does the count land if nothing changes? Scheduled posts of captains who are already active,
     at measured click and registration rates, plus the referral loop at measured K. */
  function project(sim, a) {
    var d = a.day, tEnd = a.tEnd, m = a.measured, out = { days: [], total: a.total, perNewCaptain: null, newCaptains: 0, withLever: null, need: 0 };
    var capById = {}; sim.captains.forEach(function (c) { capById[c.id] = c; });
    var clickIdx = m.clickIndex === null ? 1 : m.clickIndex;
    var cvr = m.cvrRecent === null ? PLAN.cvr : m.cvrRecent;
    var fyShare = m.capFyShare === null ? 0.96 : m.capFyShare;
    var k = m.k === null ? PLAN.k : m.k;
    out.rates = { clickIdx: clickIdx, cvr: cvr, k: k };
    var perNew = (CTR.class * 65 + CTR.batch * 190 + CTR.other * 55 + CTR.last * 255) * clickIdx * cvr * fyShare;
    var left = DAYS - d;
    var lateFactor = left >= 3 ? 1 : (left === 2 ? 0.8 : (left === 1 ? 0.45 : 0));
    out.perNewCaptain = perNew * lateFactor * (1 + k * (left >= 2 ? 1 : 0.5));
    if (d >= DAYS) { out.need = 0; return out; }
    if (d === 1) { out.total = a.plan.total; out.launchDay = true; out.need = 0; return out; }   // nothing to read before Wave 1
    var fut = []; for (var i = 0; i < DAYS; i++) fut.push(0);
    sim.posts.forEach(function (p) {
      var c = capById[p.capId]; if (!c || c.activeFrom === null || c.activeFrom >= tEnd) return;
      var e = p.base * p.ctr * clickIdx * cvr * fyShare;
      if (p.t >= tEnd) fut[dayOf(p.t) - 1] += e;
      else fut[d] += e * Math.exp(-(tEnd - p.t) / 2.5);        // clicks still to arrive from tonight's posts
    });
    var parIdx = 1, parExp = 0, parGot = a.direct.par;
    sim.partners.forEach(function (p) { if (p.t < tEnd) parExp += p.reachFY * PLAN.partnerCtr * PLAN.partnerCvr; });
    if (parExp > 5) parIdx = parGot / parExp;
    out.rates.parIdx = parExp > 5 ? parIdx : null;
    sim.partners.forEach(function (p) { if (p.t >= tEnd) fut[dayOf(p.t) - 1] += p.reachFY * PLAN.partnerCtr * PLAN.partnerCvr * parIdx; });
    var prev = a.byDay[d - 1].total, add = 0;
    for (var dd = d; dd < DAYS; dd++) { var n = fut[dd] + k * prev; out.days.push({ day: dd + 1, direct: fut[dd], ref: k * prev, total: n }); add += n; prev = n; }
    out.total = a.total + add;
    out.newCaptains = a.onboarding;
    out.withLever = a.onboarding ? out.total + a.onboarding * out.perNewCaptain : null;
    out.need = out.total >= GOAL || !out.perNewCaptain ? 0 : Math.ceil((GOAL - out.total) / out.perNewCaptain);
    return out;
  }

  function impactOf(key, index) {
    var p = assign({}, PLAN);
    if (key === 'captains') p.captains *= index;
    if (key === 'clicks') p.ctr *= index;
    if (key === 'cvr') p.cvr *= index;
    if (key === 'k') p.k *= index;
    if (key === 'partners') p.partnerCtr *= index;
    return forecast(p).total / forecast(PLAN).total - 1;
  }
  /* Which input explains the gap? Each driver is compared with the plan, then ranked by what that
     shortfall does to the week's total in the model (a 20% miss on captains costs more than a 20% miss on K). */
  function diagnose(a) {
    var m = a.measured, launch = a.day === 1, parIdx = a.projection.rates ? a.projection.rates.parIdx : null;
    var drivers = [
      { key: 'captains', label: 'Active captains', plan: PLAN.captains, actual: a.activeCaptains, index: launch ? null : a.activeCaptains / PLAN.captains, fmt: 'int' },
      { key: 'clicks', label: 'Clicks per post', plan: 1, actual: launch ? null : m.clickIndex, index: launch ? null : m.clickIndex, fmt: 'index' },
      { key: 'cvr', label: 'Registration rate', plan: PLAN.cvr, actual: m.cvr, index: m.cvr === null ? null : m.cvr / PLAN.cvr, fmt: 'pct' },
      { key: 'k', label: 'Referral K', plan: PLAN.k, actual: m.k, index: m.k === null ? null : m.k / PLAN.k, fmt: 'k' },
      { key: 'partners', label: 'Partner response', plan: 1, actual: parIdx === undefined ? null : parIdx, index: parIdx === undefined ? null : parIdx, fmt: 'index' }
    ];
    var worst = null;
    drivers.forEach(function (x) {
      x.impact = x.index === null ? null : impactOf(x.key, x.index);
      if (x.impact !== null && x.impact < -0.03 && (!worst || x.impact < worst.impact)) worst = x;
    });
    var status = a.total >= GOAL ? 'hit' : (a.day >= DAYS ? 'missed' : (a.projection.total >= GOAL ? 'ontrack' : 'behind'));
    return { drivers: drivers, worst: worst, status: status };
  }

  /* One recommended action for today, chosen from the diagnosis. */
  function recommend(a) {
    var p = a.projection, dg = a.diagnosis, w = dg.worst, r0 = Math.round;
    var pctOf = function (x) { return r0(x * 100) + '%'; };
    if (a.day === 1) return { tone: 'info', title: 'Launch day: nothing to read yet', text: 'Only the soft launch on my own campus is live. Wave 1 goes out tomorrow at 7 PM, and the first real read on clicks and registrations comes tomorrow night.' };
    if (dg.status === 'hit') return { tone: 'good', title: 'Goal banked: ' + a.total + ' final-year registrations', text: a.day < DAYS ? 'Keep the last-call post and the reminders running. From here every hour goes into show-up: calendar adds, the WhatsApp group and the T-24h, T-1h and T-10min reminders.' : 'Registration is closed. Next: attendance, feedback and the project showcase that seeds the next workshop.' };
    if (dg.status === 'missed') return { tone: 'bad', title: 'Closed ' + (GOAL - a.total) + ' short at ' + a.total, text: 'Registration is closed. Rates held at plan all week; the gap is the captains who never posted. Day 4 was the last point where adding captains could still close it.' };
    if (dg.status === 'ontrack') return { tone: 'good', title: 'On track to finish near ' + r0(p.total), text: w ? 'Behind the plan line but ahead of the goal. Weakest input: ' + (w.key === 'k' ? 'referral K' : w.label.toLowerCase()) + '. Hold the posting calendar and keep the reserve unspent.' : 'Every input is at or above plan. Hold the posting calendar and keep the reserve unspent.' };
    var short = GOAL - r0(p.total);
    if (!w || w.key === 'captains') {
      if (a.onboarding) return { tone: 'action', title: a.onboarding + ' new captains go live tomorrow', text: 'Left alone the week ends near ' + r0(p.total) + ', ' + short + ' short. With the ' + a.onboarding + ' captains nominated tonight it ends near ' + r0(p.withLever) + '.' };
      if (a.day <= 3 && a.idleCaptains) return { tone: 'action', title: 'Chase the ' + a.idleCaptains + ' captains who have not posted', text: 'Rates are fine; supply is short (' + a.activeCaptains + ' of ' + PLAN.captains + ' planned captains active). Each new active captain is worth about ' + r0(p.perNewCaptain) + ' registrations, so ' + p.need + ' more posting by tomorrow closes the gap. Send the nudge tonight.', nudge: true };
      return { tone: 'action', title: 'Add ' + p.need + ' captains to close the gap', text: 'Left alone the week ends near ' + r0(p.total) + ', ' + short + ' short. Rates are at plan; supply is short (' + a.activeCaptains + ' of ' + PLAN.captains + ' captains). Ask every active captain to nominate one friend at another college and release the ₹500 reserve as a bounty. Each new captain is worth about ' + r0(p.perNewCaptain) + ' registrations.' };
    }
    if (w.key === 'clicks') return { tone: 'action', title: 'Message problem: posts get ' + pctOf(w.index) + ' of expected clicks', text: 'Projected finish ' + r0(p.total) + '. Switch every post to the outcome hook, ask captains to add one personal line above the link and pin the post for 24 hours.' };
    if (w.key === 'cvr') return { tone: 'action', title: 'Landing problem: ' + pctOf(w.actual) + ' of visitors register', text: 'Projected finish ' + r0(p.total) + '. Ship the winning headline to everyone and check the form on a low-end Android phone before touching anything else.' };
    if (w.key === 'k') return { tone: 'action', title: 'Loop problem: K is ' + w.actual.toFixed(2) + ' against a plan of ' + PLAN.k.toFixed(2), text: 'Projected finish ' + r0(p.total) + '. Ship the squad framing to everyone and send the one-more-to-unlock nudge to everyone sitting at 2 of 3.' };
    return { tone: 'action', title: 'Partner blasts are under-delivering', text: 'Projected finish ' + r0(p.total) + '. Stop pitching new clubs and put the hours into captains, who convert better per student reached.' };
  }

  /* The campaign's decision log: every entry is computed from the event log at that moment. */
  function decisionLog(sim, tEnd) {
    var log = [], pct = function (x) { return Math.round(x * 100) + '%'; };
    var conf = function (x) { return x > 0.99 ? 'over 99%' : pct(x); };
    function at(t) { return analyze(sim, t); }
    if (tEnd >= 24) { var a1 = at(24); log.push({ t: 17, title: 'Soft launch on my own campus', text: 'Posted in my own class and batch groups to test the funnel end to end before any captain goes live. ' + a1.total + ' final-year registrations by midnight, no broken steps.' }); }
    if (tEnd >= 48) { var a2 = at(48); log.push({ t: dayAt(2, 19), title: 'Wave 1: class groups', text: a2.activeCaptains + ' of 30 captains posted in their class groups at 7 PM. Half sent the learning hook, half the outcome hook.' }); }
    if (tEnd >= T_SHIP_HOOK) {
      var e = experiments(sim, T_SHIP_HOOK)[0], won = e.stat && e.stat.p2 > e.stat.p1;
      log.push({ t: T_SHIP_HOOK, title: 'Hook test read', text: 'Outcome hook converts ' + pct(e.arms[1].rate) + ' of visits against ' + pct(e.arms[0].rate) + ' for the learning hook (' + (e.arms[0].n + e.arms[1].n) + ' visits, ' + conf(e.stat.confidence) + ' confidence). ' + (won ? 'Shipped the outcome hook to every captain and the landing page.' : 'No clear winner; kept both.') });
    }
    if (tEnd >= 72) { log.push({ t: dayAt(3, 10.5), title: 'Partner blasts start', text: sim.partners.filter(function (p) { return p.t < 72; }).length + ' clubs and placement cells sent the invite today, each on its own tracked link.' }); }
    if (tEnd >= T_SHIP_INC) {
      var e2 = experiments(sim, T_SHIP_INC)[1];
      log.push({ t: T_SHIP_INC, title: 'Referral framing test read', text: '“Bring your project squad” gets ' + pct(e2.arms[1].rate) + ' of registrants sharing against ' + pct(e2.arms[0].rate) + ' for “Invite 3 friends” (' + conf(e2.stat.confidence) + ' confidence). Shipped the squad framing to everyone.' });
    }
    if (tEnd >= 96) {
      var a4 = at(96), gap = Math.round(a4.planCum) - a4.total;
      log.push({ t: T_LEVER, title: 'Day 4 checkpoint: ' + a4.total + ' against a plan of ' + Math.round(a4.planCum),
        text: gap + ' behind. ' + a4.activeCaptains + ' of ' + PLAN.captains + ' planned captains are active, while click and registration rates are at plan. Left alone, the week ends near ' + Math.round(a4.projection.total) + '. ' +
          (sim.lever ? 'Decision: captain-get-captain. Every active captain nominates one friend at another college, and the ₹500 reserve becomes a 48-hour bounty for new captains. ' + a4.onboarding + ' signed up tonight.' : 'No action taken: this is the what-if view with the Day 4 decision switched off.'), key: true });
    }
    if (tEnd >= 120 && sim.lever) {
      var a5 = at(120), nNew = a5.captains.filter(function (c) { return c.lever && c.status === 'active'; }).length;
      log.push({ t: dayAt(5, 9), title: nNew + ' new captains live', text: 'Nominated captains posted in their class and batch groups from Day 5 morning. Wave 2 went out at 7 PM with the live count as social proof.' });
    }
    var fin = analyze(sim, Math.min(tEnd, 168));
    if (fin.crossedAt !== null && fin.crossedAt < tEnd) {
      var cd = dayOf(fin.crossedAt), hh = Math.floor(fin.crossedAt % 24);
      log.push({ t: fin.crossedAt, title: 'Crossed 500', text: 'The 500th final-year registration came in on Day ' + cd + ' at about ' + ((hh % 12) || 12) + (hh < 12 ? ' AM' : ' PM') + '.', key: true });
    }
    if (tEnd >= 168) {
      log.push({ t: T_CLOSE, title: 'Registration closed', text: fin.total + ' final-year registrations from ' + fin.colleges.length + ' colleges. ₹' + (BUDGET / fin.total).toFixed(2) + ' per registration.' + (fin.total < GOAL ? ' ' + (GOAL - fin.total) + ' short of the goal.' : '') });
    }
    log.sort(function (x, y) { return x.t - y.t; });
    log.forEach(function (x) { x.day = dayOf(x.t); });
    return log;
  }

  /* ---------- link tokens, validation, helpers shared with the UI ---------- */
  function parseToken(hash) {
    var h = String(hash || '').replace(/^#/, ''), m;
    if ((m = /^r-([A-Za-z0-9]{5,10})$/.exec(h))) return { kind: 'ref', code: m[1].toUpperCase() };
    if ((m = /^c-(K\d{2})(?:-(class|batch|other))?$/i.exec(h))) return { kind: 'captain', capId: m[1].toUpperCase(), grp: (m[2] || 'class').toLowerCase() };
    if ((m = /^p-(P\d)$/i.exec(h))) return { kind: 'partner', partnerId: m[1].toUpperCase() };
    if (/^(student|mission|forecast|kit)$/.test(h)) return { kind: 'tab', tab: h };
    return null;
  }
  function normalizePhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 12 && d.slice(0, 2) === '91') d = d.slice(2);
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    return d;
  }
  function validPhone(raw) { return /^[6-9]\d{9}$/.test(normalizePhone(raw)); }
  function maskPhone(raw) { var d = normalizePhone(raw); return d.length === 10 ? d.slice(0, 2) + '•••••' + d.slice(7) : ''; }
  function displayName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    return parts.length === 1 ? cap(parts[0]) : cap(parts[0]) + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  }
  var TIERS = [
    { at: 3, name: 'Final-Year Project Idea Pack', detail: '25 AI project briefs with problem statements and starter prompts' },
    { at: 5, name: 'Placement Pack', detail: 'Resume bullets and a LinkedIn post for your project, plus 30 AI interview questions' },
    { at: 10, name: 'Front row', detail: 'Your project reviewed live in the session, and first call as Campus Captain next time' }
  ];

  return {
    GOAL: GOAL, DAYS: DAYS, BUDGET: BUDGET, PLAN: PLAN, CAP_SCHED: CAP_SCHED, PAR_SCHED: PAR_SCHED, BUDGET_LINES: BUDGET_LINES,
    T_CLOSE: T_CLOSE, T_SHIP_HOOK: T_SHIP_HOOK, T_SHIP_INC: T_SHIP_INC, T_LEVER: T_LEVER, SEED: SEED,
    COLLEGES: COLLEGES, BRANCHES: BRANCHES, CHANNELS: CHANNELS, TIERS: TIERS, FIRST: FIRST, LAST: LAST,
    forecast: forecast, scaleRates: scaleRates, captainsNeeded: captainsNeeded, impactOf: impactOf, twoProp: twoProp, normCdf: normCdf,
    simulate: simulate, analyze: analyze, experiments: experiments, decisionLog: decisionLog, recommend: recommend, channelKey: channelKey,
    parseToken: parseToken, normalizePhone: normalizePhone, validPhone: validPhone, maskPhone: maskPhone, displayName: displayName,
    makeCode: makeCode, rngFrom: rngFrom, dayOf: dayOf, dayAt: dayAt, sum: sum, clamp: clamp, assign: assign
  };
});
