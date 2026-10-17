/* =====================================================
   SHEIS Dashboard
   ===================================================== */

/* ---------- Helpers and constants ---------- */
const $ = s => document.querySelector(s);
const K = (x, d = 2) => x.toFixed(d);          // number formatter
const RATE = 8.5;                               // cost per kWh in rupees
const SN = ['ESP32', 'Energy sensor', 'PIR', 'mmWave', 'Temperature'];
const bad = x => !['Online', 'Healthy'].includes(x);

// Typical shape of a day (24 hourly weights)
const PR = [.3, .25, .2, .2, .2, .25, .4, .6, .7, .5, .4, .4, .5, .5, .5, .6, .8, .9, 1, 1.1, 1.3, 1.4, 1.1, .6];
const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Hostel ranking: [room, excess kWh]
const RK = [['216', .72], ['214', .31], ['219', .22], ['218', .11], ['215', .05]];

const OK = ['Online', 'Healthy', 'Healthy', 'Healthy', 'Healthy'];


/* ---------- Room data (replace with your real API data) ----------
   occ: occupied (1/0)      oc: occupancy confidence %
   p: actual power (W)      e: expected power (W)
   kwh: today's energy      ex: excess energy today (kWh)
   ev: waste events         lvl: 0 normal, 1 warning, 2 urgent
   wc: waste confidence %   dur: waste duration (min)
   dq: data quality %       hs: sensor status list
   fp: fingerprint values   tl: event timeline
   ----------------------------------------------------------- */
const RM = {
  214: {
    occ: 0, oc: 91, p: 220, e: 25, t: 28.4, hu: 62,
    kwh: 3.2, ex: .31, ev: 3,
    st: 'Empty · cooling on',
    lvl: 1, wc: 87, dur: 34, cause: 'Cooling', dq: 96,
    hs: ['Online', 'Healthy', 'Healthy', 'Healthy', 'Delayed 3 min'],
    fp: [25, 35, 120, 250, 28, '7–11 PM', 'High', '+12%'],
    hd: 'Room is empty, but cooling is still running',
    sum: 'Nobody seems to be in Room 214, but the cooling is still on. An empty room like this normally uses about 25 W. Right now it uses 220 W, roughly 9 times more. About 0.11 kWh has been wasted so far.',
    why: [
      'Two motion sensors (PIR and mmWave) have seen nobody for 34 minutes.',
      'Power stayed high the whole time, so this is not a short spike.',
      'The key sensors are healthy, so we trust this reading.'
    ],
    fix: [
      'Switch off the AC or fan if the room will stay empty.',
      'If the student is only away briefly, no action is needed.',
      'Consider an auto-off after 30 minutes of no presence.'
    ],
    tl: [
      ['9:02 PM', 'Student is in the room'],
      ['9:48 PM', 'Student leaves'],
      ['9:52 PM', 'Room marked empty'],
      ['9:53 PM', 'Cooling keeps running'],
      ['10:26 PM', 'Power still high · waste event detected']
    ]
  },

  215: {
    occ: 1, oc: 94, p: 208, e: 200, t: 27.6, hu: 58,
    kwh: 2.7, ex: .05, ev: 1,
    st: 'Occupied · normal use',
    lvl: 0, wc: 96, dur: 0, cause: 'None', dq: 99,
    hs: OK,
    fp: [22, 32, 110, 230, 26, '8–11 PM', 'Medium', '+8%'],
    hd: 'All good: usage matches what we expect',
    sum: 'Everything is normal. Someone is in the room and the power use matches what we expect for an occupied room. There is nothing to fix.',
    why: [
      'Presence is confirmed by two separate sensors.',
      'Power is within 5% of the expected level.'
    ],
    fix: ['Nothing to do right now.'],
    tl: [
      ['8:10 PM', 'Student arrives'],
      ['8:12 PM', 'Room marked occupied (94%)'],
      ['9:30 PM', 'Usage steady'],
      ['Now', 'Power matches expectation']
    ]
  },

  216: {
    occ: 0, oc: 96, p: 380, e: 30, t: 30.1, hu: 66,
    kwh: 4.1, ex: .72, ev: 5,
    st: 'Empty · heavy load on',
    lvl: 2, wc: 96, dur: 105, cause: 'Cooling + plug load', dq: 97,
    hs: OK,
    fp: [28, 40, 150, 320, 32, '6–11 PM', 'Very high', '+15%'],
    hd: 'Empty for 105 min and still drawing 380 W',
    sum: 'Urgent: Room 216 has been empty for about 105 minutes, yet it is using 380 W. It should use about 30 W. That is over 12 times the normal level, and about 0.61 kWh has been wasted so far.',
    why: [
      'Both presence sensors agree the room is empty.',
      'Power is far above this room’s normal empty level (28–40 W).',
      'This is the 5th waste event for this room today.'
    ],
    fix: [
      'Ask hostel staff to check Room 216 now.',
      'Turn off the heavy appliance (likely cooling or a heater).',
      'Consider an automatic cut-off for this room.'
    ],
    tl: [
      ['8:05 PM', 'Student leaves'],
      ['8:12 PM', 'Room marked empty'],
      ['8:15 PM', 'Cooling and plug load stay on'],
      ['9:57 PM', 'Power still 380 W · urgent waste event']
    ]
  }
};


/* ---------- App state ---------- */
let V = 'home';     // current page: home, dash, hist
let RID = '214';    // selected room
let HR = '24h';     // history range
let FP = 0;         // fingerprint page number
let DL = null;      // download helper (set below if available)
const S = {};       // live power series per room


/* ---------- Enable download buttons if saving is allowed ---------- */
(async () => {
  try {
    DL = await window.claude.use('downloads');
  } catch (e) {}
  if (DL) document.body.classList.add('hasdl');
})();


/* ---------- Live data simulation ---------- */
const cur = k => S[k].a[S[k].a.length - 1];

// Adds one new reading. "pre" makes the older points look like normal occupied use.
function push(k, pre) {
  const r = RM[k];
  const s = S[k];
  const j = () => Math.random() - .5;

  s.e.push(pre ? r.p * .9 + j() * 8 : r.e + j() * r.e * .08);
  s.a.push(pre ? r.p * .93 + j() * 10 : r.p + j() * r.p * .08);

  if (s.a.length > 40) {
    s.a.shift();
    s.e.shift();
  }
}

for (const k in RM) {
  S[k] = { a: [], e: [] };
  for (let i = 0; i < 40; i++) push(k, RM[k].lvl && i < 14);
}

// Seeded random number generator (keeps history charts stable)
const sd = a => () => {
  a |= 0;
  a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};


/* ---------- Toast + file saving ---------- */
function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function save(n, d) {
  if (!DL) return toast('Downloads are not available here');
  try {
    await DL.save({ filename: n, data: d });
    toast('Saved ' + n);
  } catch (e) {
    if (e.code !== 'declined') toast('Could not save the file');
  }
}


/* ---------- PDF and PNG export ---------- */
function mkpdf(name, pages) {
  if (!window.jspdf) return toast('PDF engine did not load');

  const d = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });

  pages.forEach((p, i) => {
    if (i) d.addPage();

    // Blue header
    d.setFillColor(29, 78, 216);
    d.rect(0, 0, 595, 92, 'F');
    d.setTextColor(255);
    d.setFontSize(24);
    d.text('SHEIS', 40, 48);
    d.setFontSize(11);
    d.text(p.sub || 'Smart Hostel Energy Intelligence System', 40, 70);

    // Page title
    d.setTextColor(15, 35, 90);
    d.setFontSize(18);
    d.text(p.t, 40, 136);

    // Rows
    let y = 172;
    p.rows.forEach(r => {
      d.setFontSize(12);
      d.setTextColor(90, 110, 150);
      d.text(String(r[0]), 40, y);
      d.setTextColor(15, 35, 90);
      d.text(String(r[1]), 270, y);
      d.setDrawColor(210, 224, 250);
      d.line(40, y + 9, 555, y + 9);
      y += 29;
    });

    // Paragraphs
    if (p.txt) {
      y += 10;
      d.setFontSize(11);
      d.setTextColor(40, 60, 110);
      p.txt.forEach(t => {
        const L = d.splitTextToSize(t, 515);
        d.text(L, 40, y);
        y += L.length * 15 + 8;
      });
    }

    // Footer
    d.setFontSize(9);
    d.setTextColor(140);
    d.text('Page ' + (i + 1) + ' of ' + pages.length + ' · Demo data', 40, 810);
  });

  save(name, d.output('blob'));
}

function mkpng(name, p) {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1000;

  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 0);

  x.fillStyle = '#fff';
  x.fillRect(0, 0, 900, 1000);

  g.addColorStop(0, '#1d4ed8');
  g.addColorStop(1, '#38bdf8');
  x.fillStyle = g;
  x.fillRect(0, 0, 900, 150);

  x.fillStyle = '#fff';
  x.font = '800 46px sans-serif';
  x.fillText('SHEIS', 50, 80);
  x.font = '20px sans-serif';
  x.fillText(p.sub, 50, 118);

  x.fillStyle = '#0f2a66';
  x.font = '700 32px sans-serif';
  x.fillText(p.t, 50, 225);

  let y = 290;
  p.rows.forEach(r => {
    x.font = '22px sans-serif';
    x.fillStyle = '#5b6f9a';
    x.fillText(r[0], 50, y);

    x.font = '600 22px sans-serif';
    x.fillStyle = '#0f2a66';
    x.fillText(String(r[1]), 520, y);

    x.strokeStyle = '#dbe6fb';
    x.beginPath();
    x.moveTo(50, y + 16);
    x.lineTo(850, y + 16);
    x.stroke();

    y += 56;
  });

  c.toBlob(b => save(name, b), 'image/png');
}


/* ---------- Live graph: actual vs expected power ---------- */
function graph(k) {
  const s = S[k];
  const W = 640, H = 230, P = 40;
  const n = s.a.length;
  const m = Math.max(...s.a, ...s.e) * 1.2;

  const X = i => P + i * (W - P - 8) / (n - 1);
  const Y = v => H - 24 - v / m * (H - 44);
  const pt = a => a.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1));

  const A = pt(s.a);
  const E = pt(s.e);

  let o = `<svg viewBox="0 0 ${W} ${H}">`;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const v = m * i / 4;
    o += `<line class="gl" x1="${P}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/>`;
    o += `<text class="ax" x="${P - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)} W</text>`;
  }

  // Excess area, expected line, actual line, live dot
  return o +
    `<polygon class="xf" points="${A.join(' ')} ${[...E].reverse().join(' ')}"/>` +
    `<polyline class="el" points="${E.join(' ')}"/>` +
    `<polyline class="al" points="${A.join(' ')}"/>` +
    `<circle class="dot" cx="${X(n - 1)}" cy="${Y(s.a[n - 1])}" r="5"/>` +
    `</svg>`;
}


/* ---------- History data (generated from room data) ---------- */
function hd(k, g) {
  const r = RM[k];
  const R = sd(+k * 13 + g.length);
  const n = { '24h': 24, '7d': 7, '30d': 30 }[g];
  const sp = PR.reduce((a, b) => a + b);
  const d = g == '24h';
  const w = [];

  // One bar per hour (24h) or per day (7d / 30d)
  const B = Array.from({ length: n }, (_, i) => {
    const u = r.kwh * (d ? PR[i] / sp : .8 + R() * .4);
    const low = d && (i < 7 || (i > 9 && i < 16));
    w.push(d ? (low ? 1.7 : .4) * (.6 + R()) : .5 + R());
    return { u, em: u * (d ? (low ? .75 : .12) : .25) };
  });

  // Spread the excess energy across the bars
  const T = r.ex * (d ? 1 : n * (.85 + R() * .3));
  const sw = w.reduce((a, b) => a + b);
  B.forEach((b, i) => b.ex = Math.min(T * w[i] / sw, b.em * .9));

  const s = f => B.reduce((a, b) => a + b[f], 0);
  const ex = s('ex');
  const ev = Math.max(1, Math.round(ex / (r.ex / r.ev)));

  return {
    B, n, g,
    u: s('u'),
    em: s('em'),
    ex,
    ev,
    du: ev * Math.max(r.dur, 20),
    pk: B.reduce((m, b, i) => b.u > B[m].u ? i : m, 0)
  };
}

// Labels for bars
const hl = (i, g) =>
  g == '24h' ? ((i % 12) || 12) + (i < 12 ? ' AM' : ' PM')
  : g == '7d' ? DN[i]
  : 'Day ' + (i + 1);

const xl = (i, g) =>
  g == '24h' ? (i % 4 ? '' : hl(i, g).replace(' ', ''))
  : g == '7d' ? DN[i]
  : (i % 5 ? '' : i + 1);

// KPI tiles for the History page and PDF
const kp = (D, c) => [
  ['Total consumption', K(D.u) + ' kWh'],
  ['Occupied-room use', K(D.u - D.em) + ' kWh'],
  ['Empty-room use', K(D.em) + ' kWh'],
  ['Wasted energy (est.)', K(D.ex) + ' kWh'],
  ['Waste events', D.ev],
  ['Total waste duration', Math.floor(D.du / 60) + ' h ' + D.du % 60 + ' min'],
  ['Estimated cost of waste', c + K(D.ex * RATE, 1)],
  ['Peak usage', hl(D.pk, D.g)]
];

// Stacked bar chart: occupied / empty (normal) / excess
function chart(D) {
  const W = 640, H = 250, P = 36;
  const m = Math.max(...D.B.map(b => b.u)) * 1.1;
  const bw = (W - P) / D.n;
  const y = v => H - 26 - v / m * (H - 46);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Consumption chart">`;

  for (let i = 0; i <= 4; i++) {
    const v = m * i / 4;
    s += `<line class="gl" x1="${P}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="ax" x="${P - 6}" y="${y(v) + 4}" text-anchor="end">${K(v, 1)}</text>`;
  }

  D.B.forEach((b, i) => {
    const x = P + i * bw + bw * .19;
    const w = bw * .62;
    let c = y(0);

    const seg = (v, cl) => {
      const h = Math.max(0, v) / m * (H - 46);
      c -= h;
      return `<rect class="${cl}" x="${x}" y="${c}" width="${w}" height="${h}" rx="2"/>`;
    };

    s += `<g class="bar" style="--d:${i * 18}ms">` +
         `<title>${hl(i, D.g)} · ${K(b.u)} kWh · excess ${K(b.ex)} kWh</title>` +
         seg(b.u - b.em, 's1') +
         seg(b.em - b.ex, 's2') +
         seg(b.ex, 's3') +
         `</g>`;

    s += `<text class="ax" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${xl(i, D.g)}</text>`;
  });

  return s + '</svg>';
}


/* ---------- Energy Fingerprint (multi-page) ---------- */
function fpP(k) {
  const r = RM[k];
  const f = r.fp;
  const sub = 'Energy Fingerprint · Room ' + k;

  // Expected load for each of the 24 hours
  const W = PR.map(p => f[4] + (f[3] - f[4]) * Math.max(0, p - .2) / 1.2);
  const av = (a, b) => Math.round(W.slice(a, b).reduce((x, y) => x + y) / (b - a));

  return [
    {
      t: 'What is normal for this room',
      sub,
      rows: [
        ['Normal empty load', f[0] + '–' + f[1] + ' W'],
        ['Typical occupied load', f[2] + '–' + f[3] + ' W'],
        ['Night baseline', f[4] + ' W'],
        ['Peak usage', f[5]],
        ['Typical cooling usage', f[6]],
        ['Weekend consumption', f[7]]
      ]
    },
    {
      t: 'Daily rhythm (expected load)',
      sub,
      bars: W,
      rows: [
        ['Night · 12–6 AM', av(0, 6) + ' W'],
        ['Morning · 6 AM–12 PM', av(6, 12) + ' W'],
        ['Afternoon · 12–6 PM', av(12, 18) + ' W'],
        ['Evening · 6 PM–12 AM', av(18, 24) + ' W']
      ]
    },
    {
      t: 'What SHEIS has learned',
      sub,
      rows: [
        ['Compared against', 'This room’s own history'],
        ['Waste events today', r.ev],
        ['Data quality', r.dq + '%'],
        ['Cost of waste today', 'Rs ' + K(r.ex * RATE, 1)]
      ],
      txt: [
        `SHEIS does not use one fixed limit. It compares every reading with what is normal for Room ${k}: about ${f[0]}–${f[1]} W when empty and ${f[2]}–${f[3]} W when occupied.`,
        'Anything far above that for a sustained time becomes a waste event, with a probable cause, the excess in kWh and the cost.'
      ]
    }
  ];
}

function fpHTML(p) {
  let b = '';

  if (p.bars) {
    const m = Math.max(...p.bars);
    const t = [...p.bars].sort((a, b) => b - a)[3];   // top 4 hours = peak

    b = `
      <div class="hb">
        ${p.bars.map((w, i) =>
          `<i class="${w >= t ? 'pk' : ''}" style="--h:${w / m * 100}%;--d:${i * 25}ms" title="${i}:00 · ${Math.round(w)} W"></i>`
        ).join('')}
      </div>
      <div class="hbl">
        <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span>
      </div>`;
  }

  return `
    <div class="pg">
      <h2>${p.t}</h2>
      ${b}
      <div class="tiles big">
        ${p.rows.map(([a, c]) => `<div><small>${a}</small><b>${c}</b></div>`).join('')}
      </div>
      ${(p.txt || []).map(t => `<p class="sm">${t}</p>`).join('')}
    </div>`;
}

function fpDraw() {
  const P = fpP(RID);

  $('#sheet').innerHTML = `
    <div class="fh">
      <div>
        <small>Room ${RID}</small>
        <h3>Energy Fingerprint</h3>
      </div>
      <button class="x" onclick="closeFP()" aria-label="Close">✕</button>
    </div>

    ${fpHTML(P[FP])}

    <div class="fn">
      <button ${FP ? '' : 'disabled'} onclick="FP--;fpDraw()">← Back</button>
      <span>Page ${FP + 1} of ${P.length}</span>
      <button ${FP < P.length - 1 ? '' : 'disabled'} onclick="FP++;fpDraw()">Next →</button>
    </div>

    <div class="fa">
      <button class="dl pdf" onclick="mkpdf('SHEIS-fingerprint-room-${RID}.pdf', fpP(RID))">Download PDF</button>
      <button class="dl png" onclick="mkpng('SHEIS-fingerprint-room-${RID}-p${FP + 1}.png', fpP(RID)[FP])">Download PNG</button>
    </div>`;
}

const openFP = () => {
  FP = 0;
  $('#ovl').classList.add('on');
  fpDraw();
};

const closeFP = () => $('#ovl').classList.remove('on');


/* ---------- PDF reports ---------- */
function dashPdf() {
  const r = RM[RID];
  const sub = 'Dashboard report · Room ' + RID;

  mkpdf('SHEIS-dashboard-report.pdf', [
    {
      t: 'Sensor and data health',
      sub,
      rows: [
        ...SN.map((n, i) => [n, r.hs[i]]),
        ['Data quality', r.dq + '%']
      ]
    },
    {
      t: 'Room comparison',
      sub,
      rows: Object.entries(RM).map(([k, x]) => [
        'Room ' + k,
        `${K(x.kwh, 1)} kWh · excess ${K(x.ex)} kWh · ${x.ev} events`
      ]),
      txt: ['Rooms are compared by excess relative to their own expected use, not by raw consumption.']
    },
    {
      t: 'Hostel energy overview',
      sub,
      rows: [
        ['Total consumption today', '186 kWh'],
        ['Potential excess', '14.2 kWh'],
        ['Rooms monitored', '48'],
        ['Rooms currently occupied', '31'],
        ['Active waste events', '4'],
        ...RK.map(([k, v], i) => ['#' + (i + 1) + ' excess · Room ' + k, v + ' kWh'])
      ]
    }
  ]);
}

function histPdf() {
  const D = hd(RID, HR);
  const label = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' }[HR];

  mkpdf('SHEIS-history-room-' + RID + '.pdf', [
    {
      t: 'Historical analysis · ' + label,
      sub: 'History report · Room ' + RID,
      rows: kp(D, 'Rs ')
    }
  ]);
}


/* ---------- Pages ---------- */

// Top navigation (Dashboard / History / room switcher)
const nav = () => `
  <header class="nav">
    <button class="brand" onclick="go('home')"><i></i>SHEIS</button>

    <div class="tabs">
      <button class="${V == 'dash' ? 'on' : ''}" onclick="go('dash')">Dashboard</button>
      <button class="${V == 'hist' ? 'on' : ''}" onclick="go('hist')">History</button>
    </div>

    <div class="rooms">
      ${Object.keys(RM).map(k =>
        `<button class="${k == RID ? 'on' : ''}" onclick="room('${k}')">Room ${k}</button>`
      ).join('')}
    </div>
  </header>`;

// Home page
const pHome = () => `
  <main class="hero">
    <div class="live"><i></i>Live · simulated stream</div>
    <h1>SHEIS</h1>
    <p>
      Smart Hostel Energy Intelligence System<br>
      <span>See what every room is doing, what it should be doing, and what the gap costs.</span>
    </p>

    <div class="entry">
      <button class="box" style="--i:1" onclick="go('dash')">
        <small>Room overview</small>
        <h2>Dashboard</h2>
        <em>Current status</em>
        <span class="go">→</span>
      </button>

      <button class="box hist" style="--i:2" onclick="go('hist')">
        <small>Historical analysis</small>
        <h2>History</h2>
        <em>Trends, waste &amp; cost</em>
        <span class="go">→</span>
      </button>
    </div>
  </main>`;

// Dashboard page
function pDash() {
  const r = RM[RID];
  const L = r.lvl;
  const a = cur(RID);
  const e = S[RID].e.at(-1);
  const ex = (r.p - r.e) * r.dur / 60000;      // excess energy of the event (kWh)
  const w = r.hs.filter(bad).length;            // number of sensor warnings

  return `
  <main>
    <div class="g2">

      <!-- LEFT: white room overview box -->
      <section class="box" style="--i:0">
        <div class="bt">
          <h3>Room ${RID} · Overview</h3>
          <span class="pill ${r.occ ? 'ok' : ''}">${r.occ ? 'Occupied' : 'Empty'}</span>
        </div>

        <div class="ovw">
          <div class="ring" style="--p:${r.oc}">
            <b>${r.oc}%</b>
            <small>occupancy<br>confidence</small>
          </div>

          <div class="tiles">
            <div><small>Current power</small><b><span id="pw">${Math.round(a)}</span> W</b></div>
            <div><small>Today</small><b>${K(r.kwh)} kWh</b></div>
            <div><small>Temperature</small><b>${r.t}°C</b></div>
            <div><small>Humidity</small><b>${r.hu}%</b></div>
            <div><small>Behaviour</small><b>${r.st}</b></div>
            <div><small>Data health</small><b>${r.dq}%</b></div>
          </div>
        </div>
      </section>

      <!-- RIGHT: coloured alert box (blue / amber / red) -->
      <section class="box alert l${L}" style="--i:1">
        <div class="bt">
          <span class="tag">${['Normal', 'Possible energy waste', 'Urgent · energy waste'][L]}</span>
          <span class="cf">Confidence ${r.wc}%</span>
        </div>

        <h2>${r.hd}</h2>

        <div class="cmp">
          <div><small>Actual</small><b><span id="pa">${Math.round(a)}</span> W</b></div>
          <div><small>Expected</small><b><span id="pe">${Math.round(e)}</span> W</b></div>
          <div><small>Excess</small><b><span id="px">${Math.max(0, Math.round(a - e))}</span> W</b></div>
        </div>

        <div class="meter"><i style="width:${r.wc}%"></i></div>

        <p class="facts">
          ${L
            ? `Duration ${r.dur} min · ~${K(ex)} kWh excess · Probable cause: ${r.cause}`
            : `Usage matches this room’s normal pattern · ${r.ev} minor event today`}
        </p>

        <button class="ex" onclick="this.closest('.alert').classList.toggle('open')">Explain in simple terms ⌄</button>

        <div class="xp">
          <div class="in">
            <p class="sm">${r.sum}</p>

            <h4>How we know</h4>
            <ul>${r.why.map(x => `<li>${x}</li>`).join('')}</ul>

            <h4>What to do</h4>
            <ul>${r.fix.map(x => `<li>${x}</li>`).join('')}</ul>

            <h4>What happened</h4>
            <ol class="tl">${r.tl.map(([t, x]) => `<li><b>${t}</b>${x}</li>`).join('')}</ol>
          </div>
        </div>
      </section>
    </div>

    <!-- Live graph -->
    <section class="box" style="--i:2;margin-bottom:18px">
      <div class="bt">
        <h3>Live power · actual vs expected</h3>
        <span class="lg"><i class="a"></i>Actual<i class="e"></i>Expected<i class="x"></i>Excess</span>
      </div>
      <div id="g">${graph(RID)}</div>
    </section>

    <!-- Energy fingerprint button -->
    <button class="box cta" style="--i:3" onclick="openFP()">
      <span>
        <small>What SHEIS has learned about Room ${RID}</small>
        <b>Click to see your Energy Fingerprint</b>
      </span>
      <span class="go">→</span>
    </button>

    <!-- Sensor health + room comparison + hostel view -->
    <div class="bt sec">
      <h3>Sensor health · Room comparison · Hostel view</h3>
      <button class="dl pdf" onclick="dashPdf()">Download PDF</button>
    </div>

    <div class="g3">

      <section class="box" style="--i:4">
        <div class="bt">
          <h3>Sensor &amp; data health</h3>
          <span class="pill ${w ? '' : 'ok'}">${w ? w + ' warning' : 'All healthy'}</span>
        </div>

        <ul class="hl">
          ${SN.map((n, i) => `
            <li class="${bad(r.hs[i]) ? 'w' : ''}">
              <span><i></i>${n}</span>
              <b>${r.hs[i]}</b>
            </li>`).join('')}
        </ul>

        <div class="bar2" style="margin:14px 0 6px"><i style="width:${r.dq}%"></i></div>
        <small>Data quality ${r.dq}% · waste decisions pause if key sensors drop out</small>
      </section>

      <section class="box" style="--i:5">
        <div class="bt"><h3>Room comparison</h3></div>

        <table class="ct">
          <tr>
            <th>Room
            <th>Energy
            <th>Excess
            <th>Events
            <th>vs expected
          </tr>
          ${Object.entries(RM).map(([k, x]) => {
            const p = x.ex / (x.kwh - x.ex) * 100;   // excess relative to expected use
            return `
          <tr class="${k == RID ? 'me' : ''}">
            <td><b>${k}</b>
            <td>${K(x.kwh, 1)} kWh
            <td>${K(x.ex)}
            <td>${x.ev}
            <td>
              <div class="bar2"><i style="width:${Math.min(100, p * 4)}%"></i></div>
              <small>${K(p, 1)}%</small>
          </tr>`;
          }).join('')}
        </table>

        <small style="margin-top:10px">Ranked by excess against each room’s own expected use, not raw consumption.</small>
      </section>

      <section class="box" style="--i:6">
        <div class="bt"><h3>Hostel energy overview</h3></div>

        <div class="tiles">
          <div><small>Today</small><b>186 kWh</b></div>
          <div><small>Potential excess</small><b>14.2 kWh</b></div>
          <div><small>Rooms occupied</small><b>31 / 48</b></div>
          <div><small>Active waste events</small><b>4</b></div>
        </div>

        <h4 class="rt">Highest excess energy (kWh)</h4>
        ${RK.map(([k, v]) => `
          <div class="rk">
            <span>${k}</span>
            <div class="bar2"><i style="width:${v / .72 * 100}%"></i></div>
            <b>${v}</b>
          </div>`).join('')}
      </section>

    </div>
  </main>`;
}

// History page
function pHist() {
  const D = hd(RID, HR);

  return `
  <main>
    <div class="hh">
      <h2>Historical analysis · Room ${RID}</h2>

      <div class="chips">
        ${[['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']].map(([k, l]) =>
          `<button class="${k == HR ? 'on' : ''}" onclick="HR='${k}';render()">${l}</button>`
        ).join('')}
      </div>

      <button class="dl pdf" onclick="histPdf()">Download PDF</button>
    </div>

    <div class="kp">
      ${kp(D, '₹').map(([a, b], i) => `
        <div class="box" style="--i:${i}">
          <small>${a}</small>
          <b>${b}</b>
        </div>`).join('')}
    </div>

    <section class="box" style="--i:8">
      <div class="bt">
        <h3>Energy use by hour or day</h3>
        <span class="lg"><i class="a"></i>Occupied<i class="e" style="background:var(--b2)"></i>Empty (normal)<i class="x"></i>Excess · kWh</span>
      </div>
      ${chart(D)}
    </section>
  </main>`;
}


/* ---------- Rendering and navigation ---------- */
function render() {
  $('#app').innerHTML = V == 'home' ? pHome() : nav() + (V == 'dash' ? pDash() : pHist());
  window.scrollTo(0, 0);
}

const go = v => {
  V = v;
  render();
};

const room = k => {
  RID = k;
  render();
};


/* ---------- Live update every 1.8 seconds ---------- */
setInterval(() => {
  for (const k in RM) push(k);

  const g = $('#g');
  if (V == 'dash' && g) {
    const a = cur(RID);
    const e = S[RID].e.at(-1);

    g.innerHTML = graph(RID);
    $('#pw').textContent = $('#pa').textContent = Math.round(a);
    $('#pe').textContent = Math.round(e);
    $('#px').textContent = Math.max(0, Math.round(a - e));
  }
}, 1800);


/* ---------- Start ---------- */
render();
