/* ── CONFIG ──────────────────────────────────────────────── */
let BASE_URL = 'https://web-production-b1df4.up.railway.app';
let POLL_INTERVAL = 1000;

const CFG = {
  warnPower: 900, highPower: 1800, shortPower: 3000,
  didtShort: 50, tw: 10, nmin: 3, don: 50, tfluk: 200
};

/* ── DATA STORES ─────────────────────────────────────────── */
const HISTORY_SIZE = 180; // 6 minutes at 2s intervals
const stores = {
  voltage:   { data: [], labels: [], unit: 'V',    name: 'Tegangan' },
  current:   { data: [], labels: [], unit: 'A',    name: 'Arus' },
  power:     { data: [], labels: [], unit: 'W',    name: 'Daya Aktif' },
  frequency: { data: [], labels: [], unit: 'Hz',   name: 'Frekuensi' },
  pf:        { data: [], labels: [], unit: 'cos φ',name: 'Faktor Daya' },
  kwh:       { data: [], labels: [], unit: 'kWh',  name: 'Energi' },
};

let logEntries = [];
let lastPower = 0;
let cycleHistory = [];
let cycleTransitions = 0;
let activeBeban = null;
let pollTimer = null;
let lastLoggedStatus = '';
/* ── BEBAN DEFINITIONS ───────────────────────────────────── */
const BEBAN_LIST = [
  {
    id: 1, name: 'Lampu LED', icon: '💡',
    nominalPower: 50, nominalCurrent: 0.23,
    type: 'stabil', typeLabel: 'Stabil',
    spec: '50 W · Beban resistif stabil',
    color: '#22c55e',
    simulate: (t) => ({
      power: 50 + Math.sin(t * 0.1) * 1.5,
      current: 0.23 + Math.sin(t * 0.1) * 0.007,
      voltage: 219 + Math.sin(t * 0.05) * 1,
    })
  },
  {
    id: 2, name: 'Kipas Angin', icon: '🌀',
    nominalPower: 57, nominalCurrent: 0.26,
    type: 'fluktuatif', typeLabel: 'Fluktuatif',
    spec: '45–70 W · Beban kontinu variabel',
    color: '#3b82f6',
    simulate: (t) => ({
      power: 57 + Math.sin(t * 0.3) * 12 + (Math.random() - 0.5) * 4,
      current: 0.26 + Math.sin(t * 0.3) * 0.05,
      voltage: 219.5 + (Math.random() - 0.5) * 2,
    })
  },
  {
    id: 3, name: 'Rice Cooker', icon: '🍚',
    nominalPower: 350, nominalCurrent: 1.59,
    type: 'cycling', typeLabel: 'Cycling',
    spec: '300–400 W · Device cycling termostat',
    color: '#f59e0b',
    simulate: (t) => {
      const cycle = Math.floor(t / 40) % 2 === 0;
      const p = cycle ? 350 + (Math.random() - 0.5) * 20 : 8 + Math.random() * 3;
      return { power: p, current: p / 220, voltage: 220 + (Math.random() - 0.5) * 1.5 };
    }
  },
  {
    id: 4, name: 'Setrika Listrik', icon: '🔌',
    nominalPower: 375, nominalCurrent: 1.70,
    type: 'periodik', typeLabel: 'Periodik',
    spec: '300–450 W · Pemanas periodik',
    color: '#f97316',
    simulate: (t) => {
      const cycle = Math.sin(t * 0.15) > 0;
      const p = cycle ? 400 + (Math.random() - 0.5) * 50 : 6 + Math.random() * 2;
      return { power: p, current: p / 220, voltage: 219 + (Math.random() - 0.5) * 2 };
    }
  },
  {
    id: 5, name: 'Power Amplifier', icon: '🔊',
    nominalPower: 350, nominalCurrent: 1.59,
    type: 'fluktuatif', typeLabel: 'Fluktuatif',
    spec: '200–500 W · Beban fluktuatif tinggi',
    color: '#8b5cf6',
    simulate: (t) => {
      const p = 350 + Math.sin(t * 0.8) * 150 + (Math.random() - 0.5) * 60;
      return { power: Math.max(200, p), current: p / 220, voltage: 218 + (Math.random() - 0.5) * 3 };
    }
  },
  {
    id: 6, name: 'Kulkas', icon: '🧊',
    nominalPower: 200, nominalCurrent: 0.91,
    type: 'periodik', typeLabel: 'Periodik',
    spec: '100–300 W · Kompresor periodik',
    color: '#06b6d4',
    simulate: (t) => {
      const period = 60;
      const onPhase = t % period < 30;
      const p = onPhase ? 200 + (Math.random() - 0.5) * 40 : 12 + Math.random() * 3;
      return { power: p, current: p / 220, voltage: 220 + (Math.random() - 0.5) * 1 };
    }
  }
];

/* ── CHART INSTANCES ─────────────────────────────────────── */
const charts = {};
const sparklines = {};

/* ── CHART DEFAULTS ──────────────────────────────────────── */
Chart.defaults.color = '#64748b';
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size = 10;

function chartDefaults(color = '#00d4aa') {
  return {
    borderColor: color,
    backgroundColor: color + '18',
    borderWidth: 1.5,
    pointRadius: 0,
    fill: true,
    tension: 0.4,
  };
}

function axisStyle() {
  return {
    x: {
      display: false,
      grid: { color: 'rgba(255,255,255,0.04)' }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { maxTicksLimit: 4 }
    }
  };
}

/* ── INIT CHARTS ─────────────────────────────────────────── */
function initMainChart() {
  const ctx = document.getElementById('mainChart').getContext('2d');
  charts.main = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Daya (W)',
        ...chartDefaults('#00d4aa'),
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { display: false },
        y: {
          min: 0,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b', maxTicksLimit: 5, font: { size: 10 } }
        }
      }
    }
  });
}

function initHistChart() {

  const canvas = document.getElementById('histChart');

  if (!canvas) {
    console.log("Canvas histChart tidak ditemukan");
    return;
  }

  const ctx = canvas.getContext('2d');

  charts.hist = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Daya (W)',
          ...chartDefaults('#00d4aa'),
          data: []
        },
        {
          label: 'Arus (A)×100',
          ...chartDefaults('#3b82f6'),
          data: []
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: {
          ticks: {
            color: '#3d4a60',
            font: { size: 9 }
          },
          grid: {
            color: 'rgba(255,255,255,0.04)'
          }
        },
        y: {
          grid: {
            color: 'rgba(255,255,255,0.05)'
          },
          ticks: {
            color: '#64748b',
            maxTicksLimit: 5
          }
        }
      }
    }
  });
  console.log("Hist chart initialized");
}

function generateHistData(base = 80, variance = 60) {
  return Array.from({ length: 48 }, () => Math.max(0, base + (Math.random() - 0.3) * variance));
}

function initSparkline(param, color = '#00d4aa') {
  const canvas = document.getElementById('spk' + paramKey(param));
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  sparklines[param] = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ ...chartDefaults(color), data: [] }] },
    options: {
      responsive: false, maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { point: { radius: 0 } }
    }
  });
}

function paramKey(param) {
  return { voltage: 'V', current: 'A', power: 'W', frequency: 'Hz', pf: 'PF', kwh: 'Kwh' }[param] || 'V';
}

const spkColors = {
  voltage: '#00d4aa', current: '#3b82f6', power: '#f97316',
  frequency: '#8b5cf6', pf: '#22c55e', kwh: '#f59e0b'
};

function initAllSparklines() {
  Object.keys(stores).forEach(p => initSparkline(p, spkColors[p]));
}

/* ── DATA PUSH ───────────────────────────────────────────── */
function pushData(param, value, label) {
  const s = stores[param];
  s.data.push(value);
  s.labels.push(label);
  if (s.data.length > HISTORY_SIZE) { s.data.shift(); s.labels.shift(); }
}

function updateSparkline(param) {
  const sp = sparklines[param];
  if (!sp) return;
  const s = stores[param];
  const last30 = s.data.slice(-30);
  sp.data.labels = last30.map(() => '');
  sp.data.datasets[0].data = last30;
  sp.update('none');
}

/* ── SIMULATION DATA ─────────────────────────────────────── */
let simTick = 0;
function generateSimData() {
  simTick++;
  if (activeBeban !== null) {
    const b = BEBAN_LIST[activeBeban];
    const raw = b.simulate(simTick);
    const p = +raw.power.toFixed(1);
    const a = +raw.current.toFixed(3);
    const v = +raw.voltage.toFixed(1);
    const status = classifyStatus(p, a);
    return {
      voltage: v, current: a, power: p,
      frequency: +(50 + (Math.random() - 0.5) * 0.15).toFixed(2),
      pf: +(0.94 + Math.random() * 0.05).toFixed(2),
      kwh: +(0.42 + simTick * 0.00003).toFixed(4),
      status, ai: status === 'NORMAL' || status === 'NO_LOAD' ? 'AMAN' : 'WASPADA',
      pln: true, relay: status !== 'SHORT_CIRCUIT',
      deltaP: +(p - lastPower).toFixed(2),
      cycling: b.type === 'cycling' || b.type === 'periodik',
      cycleCount: b.type === 'cycling' ? Math.floor(simTick / 40) % 10 : 0,
      cyclePeriod: b.type === 'cycling' ? 40 : null,
      cycleDevice: b.type === 'cycling' || b.type === 'periodik' ? b.name : null,
    };
  }

  // Idle simulation
  const p = +(14.8 + Math.sin(simTick * 0.08) * 3 + (Math.random() - 0.5) * 2).toFixed(1);
  const v = +(219.2 + (Math.random() - 0.5) * 1.5).toFixed(1);
  return {
    voltage: v, current: +(p / v).toFixed(3), power: p,
    frequency: +(50 + (Math.random() - 0.5) * 0.1).toFixed(2),
    pf: +(0.97 + Math.random() * 0.02).toFixed(2),
    kwh: +(0.42 + simTick * 0.00001).toFixed(4),
    status: 'NORMAL', ai: 'AMAN', pln: true, relay: true,
    deltaP: +(p - lastPower).toFixed(2),
    cycling: false, cycleCount: 0, cyclePeriod: null, cycleDevice: null,
  };
}
function detectCycling(power) {

  // simpan histori daya
  cycleHistory.push(power);

  // maksimal 20 data
  if (cycleHistory.length > 20) {
    cycleHistory.shift();
  }

  // reset transisi
  let transitions = 0;

  // cek perubahan ON/OFF
  for (let i = 1; i < cycleHistory.length; i++) {

    const prev = cycleHistory[i - 1];
    const curr = cycleHistory[i];

    // jika perubahan daya besar
    if (
   (prev < 20 && curr > 100) ||
   (prev > 100 && curr < 20)
) {
   transitions++;
}
  }

  cycleTransitions = transitions;

  // minimal 3 transisi dianggap cycling
  return transitions >= 3;
}
function classifyStatus(p, a) {

  // Deteksi lonjakan daya mendadak
  if (Math.abs(p - lastPower) > 2000 && a > 10) {
    return 'SHORT_CIRCUIT';
  }
  if (p > CFG.highPower) {
    return 'HIGH_CONSUMPTION';
  }
  if (p > CFG.warnPower) {
    return 'WARNING';
  }
  if (p < 5 && a < 0.05) {
    return 'NO_LOAD';
  }
  return 'NORMAL';
}
/* ── FETCH / POLL ────────────────────────────────────────── */
async function fetchLatest() {
  try {
    const res = await fetch(`${BASE_URL}/api/latest`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const result = await res.json();

    // format API railway:
    // { success:true, data:{...} }
    const data = result.data || result;
    const cyclingDetected =
  detectCycling(data.power || 0);
    let finalStatus = data.status || 'NORMAL';

if (cyclingDetected) {
  finalStatus = 'CYCLING_DETECTED';
}
    return {
      voltage: data.voltage || 0,
      current: data.current || 0,
      power: data.power || 0,
      frequency: data.frequency || 0,
      pf: data.pf || 0,
      kwh: data.kwh || 0,
      status: finalStatus,
      relay: data.relay ?? true,
      pln: data.pln ?? true,
      deltaP: Number(((data.power || 0) - lastPower).toFixed(2)),
      cycling: cyclingDetected,
      cycleCount: cycleTransitions,
      cyclePeriod: data.cyclePeriod || null
    };

  } catch (err) {
    console.error('API Error:', err);

    return {
      voltage: 0,
      current: 0,
      power: 0,
      frequency: 0,
      pf: 0,
      kwh: 0,
      status: 'OFFLINE',
      relay: false,
      pln: false,
      deltaP: 0
    };
  }
}

/* ── RENDER ──────────────────────────────────────────────── */
function render(data) {
  updateTimestamp();
  updateLastUpdate();

  updateMetricCards(data);
  updateStatusBadge(data);
  updateMainChart(data.power);
  updateDetectionPanel(data);
  updateCostPanel(data);
  checkAlerts(data);

  lastPower = data.power;
}

function updateTimestamp() {
  const now = new Date();
  document.getElementById('tsDate').textContent =
    now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('tsTime').textContent =
    now.toLocaleTimeString('id-ID', { hour12: false });
}
/* ── UPDATE LAST UPDATE ───────────────────────────── */
function updateLastUpdate() {

  const el = document.getElementById('lastUpdate');
  if (!el) return;
  el.textContent =
    'Last update: ' + new Date().toLocaleTimeString();
}
function updateMetricCards(data) {
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const params = [
    { key: 'voltage',   val: data.voltage,   elId: 'mV',   minId: 'mVmin',   maxId: 'mVmax' },
    { key: 'current',   val: data.current,   elId: 'mA',   minId: 'mAmin',   maxId: 'mAmax' },
    { key: 'power',     val: data.power,     elId: 'mW',   minId: 'mWmin',   maxId: 'mWmax' },
    { key: 'frequency', val: data.frequency, elId: 'mHz',  minId: 'mHzmin',  maxId: 'mHzmax' },
    { key: 'pf',        val: data.pf,        elId: 'mPF',  minId: 'mPFmin',  maxId: 'mPFmax' },
    { key: 'kwh',       val: data.kwh,       elId: 'mKwh', minId: 'mKwhmin', maxId: 'mKwhmax' },
  ];

  params.forEach(({ key, val, elId, minId, maxId }) => {
    pushData(key, val, now);
    const el = document.getElementById(elId);
    if (el) el.textContent = val;

    const s = stores[key];
    if (s.data.length > 1) {
      const mn = Math.min(...s.data).toFixed(key === 'pf' ? 2 : 1);
      const mx = Math.max(...s.data).toFixed(key === 'pf' ? 2 : 1);
      const minEl = document.getElementById(minId);
      const maxEl = document.getElementById(maxId);
      if (minEl) minEl.textContent = `Min: ${mn}`;
      if (maxEl) maxEl.textContent = `Max: ${mx}`;
    }
    updateSparkline(key);
  });
}

function updateStatusBadge(data) {

  const deviceStatus = document.getElementById('statusLabel');
  const statusDot = document.getElementById('statusDot');

  // ===== STATUS ESP32 =====
  const isOffline =
    data.status === 'OFFLINE' ||
    data.voltage <= 0;

  if (isOffline) {
    deviceStatus.textContent = 'ESP32 Offline';
    statusDot.style.background = 'red';
  } else {
    deviceStatus.textContent = 'ESP32 Online';
    statusDot.style.background = '#22c55e';
  }

  // ===== STATUS BADGE =====
const s = data.status || 'NORMAL';
const badge = document.getElementById('topBadge');
const badgeText = document.getElementById('topBadgeText');
badge.className = 'status-badge-top';
if (s === 'WARNING') {
  badge.classList.add('warning');
}
else if (s === 'HIGH_CONSUMPTION') {
  badge.classList.add('high');
}
else if (s === 'SHORT_CIRCUIT') {
  badge.classList.add('danger');
}
else if (s === 'CYCLING_DETECTED') {
  badge.classList.add('warning');
}

badgeText.textContent =
  s.replaceAll('_', ' ');

  // ===== RELAY =====
  const relayDot = document.getElementById('relayDot');
  const relayLabel = document.getElementById('relayLabel');

  if (data.relay) {
    relayDot.className = 'relay-dot on';
    relayLabel.textContent = 'ON';
  } else {
    relayDot.className = 'relay-dot off';
    relayLabel.textContent = 'OFF';
  }

  // ===== PLN =====
  const plnPill = document.getElementById('plnPill');

  if (data.pln && !isOffline) {
    plnPill.textContent = 'PLN MENYALA';
    plnPill.className = 'pln-pill';
  } else {
    plnPill.textContent = 'PLN MATI';
    plnPill.className = 'pln-pill off';
  }
}

function updateMainChart(power) {
  if (!charts.main) return;
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const maxPts = 90;
  if (charts.main.data.labels.length >= maxPts) {
    charts.main.data.labels.shift();
    charts.main.data.datasets[0].data.shift();
  }
  charts.main.data.labels.push(now);
  charts.main.data.datasets[0].data.push(power);
  charts.main.update('none');
}

function updateDetectionPanel(data) {
  const dp = data.deltaP || 0;
  setEl('detRule', data.status || 'NORMAL');
  setEl(
  'detDelta',
  (dp >= 0 ? '+' : '') + dp.toFixed(2) + ' W/s'
);
  const abnormal = Math.abs(dp) > CFG.tfluk;
  setElClass('detFluk', abnormal ? 'red' : 'green', abnormal ? 'Ya' : 'Tidak');
  setElClass('detCycle', data.cycling ? 'amber' : '', data.cycling ? 'Terdeteksi' : 'Tidak ada');
  setEl('detCycleCount', data.cycleCount || 0);
  setEl('detCyclePeriod', data.cyclePeriod ? data.cyclePeriod + ' detik' : '— detik');
}

function updateCostPanel(data) {

  // Tarif PLN
  const tarif = 1444.7;

  // Biaya realtime
  const biayaPerJam =
    (data.power / 1000) * tarif;

  const biayaPerDetik =
    biayaPerJam / 3600;

  // kWh realtime dari ESP
  const kwh = data.kwh || 0;

  // Perhitungan biaya
  const totalBiaya = kwh * tarif;
  const bulanIni = totalBiaya * 0.3;
  const prediksi = totalBiaya * 1.2;

  // Format rupiah
  const rupiah = (n) =>
    'Rp ' + Math.round(n).toLocaleString('id-ID');

  // ===== UPDATE HTML =====
  document.getElementById('costTotal').textContent =
    rupiah(totalBiaya);

  document.getElementById('costMonth').textContent =
    rupiah(bulanIni);

  document.getElementById('costPredict').textContent =
    rupiah(prediksi);

  // ===== REALTIME =====
  const realtimeEl = document.getElementById('costRealtime');

if (realtimeEl) {
  realtimeEl.textContent =
    'Rp ' + biayaPerDetik.toFixed(6) + '/detik';
}
  // ===== AI CONFIDENCE =====
  let confidence = 95;

  if (data.status === 'WARNING') {
    confidence = 75;
  }

  if (data.status === 'HIGH_CONSUMPTION') {
    confidence = 60;
  }

  if (data.status === 'SHORT_CIRCUIT') {
    confidence = 20;
  }

  document.getElementById('costConf').textContent =
    confidence + '%';

  // ===== TREND =====
  const trendBadge = document.getElementById('trendBadge');

  if (data.power > 1500) {
    trendBadge.textContent = 'TINGGI';
    trendBadge.className = 'trend-badge danger';
  }
  else if (data.power > 800) {
    trendBadge.textContent = 'NAIK';
    trendBadge.className = 'trend-badge warning';
  }
  else {
    trendBadge.textContent = 'STABIL';
    trendBadge.className = 'trend-badge';
  }
}
function checkAlerts(data) {
  const s = data.status || 'NORMAL';

  const bar = document.getElementById('alertBar');
  const msg = document.getElementById('alertMsg');

  if (s === 'SHORT_CIRCUIT') {

    msg.textContent =
      '⚡ SHORT CIRCUIT terdeteksi — relay diputus otomatis! dI/dt > 50 A/s';

    bar.classList.add('show');
    addLog(data);

  } else if (s === 'HIGH_CONSUMPTION') {

    msg.textContent =
      '⚠ HIGH CONSUMPTION — daya melebihi 1.800 W, periksa beban!';

    bar.classList.add('show');
    addLog(data);

  } else if (s === 'WARNING') {

    msg.textContent =
      '⚡ WARNING — daya mendekati batas aman (900–1800 W)';

    bar.classList.add('show');
    addLog(data);

  } else if (s === 'CYCLING_DETECTED') {

    msg.textContent =
      '🔄 DEVICE CYCLING terdeteksi — pola ON/OFF berulang';

    bar.classList.add('show');
    addLog(data);

  } else {

    bar.classList.remove('show');

    if (s === 'NORMAL') {
      lastLoggedStatus = '';
    }
  }
}
function addLog(data) {
  const s = data.status;
  if (lastLoggedStatus === s) return;
lastLoggedStatus = s;
  if (!s || s === 'NORMAL' || s === 'NO_LOAD') return;
  const now = new Date();
  logEntries.unshift({
    time: now.toLocaleString('id-ID'),
    status: s,
    power: data.power,
    current: data.current,
    voltage: data.voltage,
    ai: data.ai || '—'
  });
  if (logEntries.length > 200) logEntries.pop();
  renderLogs('ALL');
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setElClass(id, cls, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = 'det-val' + (cls ? ' ' + cls : '');
}

/* ── LOG TABLE ───────────────────────────────────────────── */
let currentFilter = 'ALL';

function renderLogs(filter) {
  currentFilter = filter;
  const tbody = document.getElementById('logBody');
  if (!tbody) return;
  const filtered = filter === 'ALL' ? logEntries : logEntries.filter(l => l.status === filter);
  tbody.innerHTML = filtered.length ? filtered.map(l => `
    <tr>
      <td>${l.time}</td>
      <td><span class="cond-pill cond-${l.status}">${l.status.replace('_', ' ')}</span></td>
      <td>${l.power}</td>
      <td>${l.current}</td>
      <td>${l.voltage}</td>
      <td>${l.ai}</td>
    </tr>
  `).join('') : `<tr><td colspan="6" style="text-align:center;color:#3d4a60;padding:20px">Belum ada data</td></tr>`;
}

function filterLogs(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLogs(filter);
}

/* ── BEBAN PAGE ──────────────────────────────────────────── */
let bebanPowerChart = null;
let bebanCurrentChart = null;

function initBebanPage() {
  const grid = document.getElementById('bebanGrid');
  if (!grid) return;
  grid.innerHTML = BEBAN_LIST.map((b, i) => {
    const pPct = Math.min(100, (b.nominalPower / 500) * 100);
    const aPct = Math.min(100, (b.nominalCurrent / 3) * 100);
    return `
      <div class="beban-card" id="beban-card-${i}" onclick="selectBeban(${i})">
        <span class="beban-type-badge type-${b.type}">${b.typeLabel}</span>
        <div class="beban-num">BEBAN ${b.id}</div>
        <div class="beban-icon">${b.icon}</div>
        <div class="beban-name">${b.name}</div>
        <div class="beban-spec">${b.spec}</div>
        <div class="beban-bars">
          <div class="beban-bar-row">
            <span class="beban-bar-label">Daya</span>
            <div class="beban-bar-track"><div class="beban-bar-fill" style="width:${pPct}%;background:${b.color}"></div></div>
            <span class="beban-bar-val">${b.nominalPower}W</span>
          </div>
          <div class="beban-bar-row">
            <span class="beban-bar-label">Arus</span>
            <div class="beban-bar-track"><div class="beban-bar-fill" style="width:${aPct}%;background:${b.color}"></div></div>
            <span class="beban-bar-val">${b.nominalCurrent}A</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function selectBeban(idx) {
  document.querySelectorAll('.beban-card').forEach(c => c.classList.remove('active-beban'));
  const card = document.getElementById(`beban-card-${idx}`);
  if (card) card.classList.add('active-beban');

  activeBeban = idx;
  showBebanChart(idx);
  updateBebanRealtime();
  showToast(`Simulasi Beban ${idx + 1}: ${BEBAN_LIST[idx].name} diaktifkan`);
}

function showBebanChart(idx) {
  const b = BEBAN_LIST[idx];
  const panel = document.getElementById('bebanChartPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('bebanChartTitle').textContent = `Beban ${b.id} — ${b.name} · Historis Pengujian`;

  // Data realtime dari monitoring utama
const pwrData = stores.power.data.slice(-60);
const currData = stores.current.data.slice(-60);
const labels = stores.power.labels.slice(-60);

  // Power chart
  if (bebanPowerChart) bebanPowerChart.destroy();
  const pCtx = document.getElementById('bebanPowerChart').getContext('2d');
  bebanPowerChart = new Chart(pCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Daya (W)', ...chartDefaults(b.color), data: pwrData }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        title: { display: true, text: 'Daya (W)', color: '#94a3b8', font: { size: 11 } }
      },
      scales: {
        x: { ticks: { color: '#3d4a60' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
      }
    }
  });

  // Current chart
  if (bebanCurrentChart) bebanCurrentChart.destroy();
  const cCtx = document.getElementById('bebanCurrentChart').getContext('2d');
  bebanCurrentChart = new Chart(cCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Arus (A)', ...chartDefaults('#3b82f6'), data: currData }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        title: { display: true, text: 'Arus (A)', color: '#94a3b8', font: { size: 11 } }
      },
      scales: {
        x: { ticks: { color: '#3d4a60' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
      }
    }
  });

  // Stats
  const avgP = pwrData.length
  ? (pwrData.reduce((a, b) => a + b, 0) / pwrData.length).toFixed(1)
  : 0;
 const maxP = pwrData.length
  ? Math.max(...pwrData).toFixed(1)
  : 0;
const minP = pwrData.length
  ? Math.min(...pwrData).toFixed(1)
  : 0;
const avgA = currData.length
  ? (currData.reduce((a, b) => a + b, 0) / currData.length).toFixed(3)
  : 0;

  document.getElementById('bebanStats').innerHTML = `
    <div class="bstat"><div class="bstat-label">Daya Rata-rata</div><div class="bstat-val">${avgP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Maks</div><div class="bstat-val">${maxP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Min</div><div class="bstat-val">${minP} W</div></div>
    <div class="bstat"><div class="bstat-label">Arus Rata-rata</div><div class="bstat-val">${avgA} A</div></div>
    <div class="bstat"><div class="bstat-label">Tipe Beban</div><div class="bstat-val">${b.typeLabel}</div></div>
    <div class="bstat"><div class="bstat-label">Kondisi</div><div class="bstat-val">${classifyStatus(+avgP, +avgA)}</div></div>
  `;
}
function updateBebanRealtime() {

  if (!bebanPowerChart || !bebanCurrentChart) return;

  const pwrData = stores.power.data.slice(-60);
  const currData = stores.current.data.slice(-60);
  const labels = stores.power.labels.slice(-60);

  // update chart daya
  bebanPowerChart.data.labels = labels;
  bebanPowerChart.data.datasets[0].data = pwrData;
  bebanPowerChart.update('none');

  // update chart arus
  bebanCurrentChart.data.labels = labels;
  bebanCurrentChart.data.datasets[0].data = currData;
  bebanCurrentChart.update('none');
}
function closeBebanChart() {
  document.getElementById('bebanChartPanel').style.display = 'none';
  document.querySelectorAll('.beban-card').forEach(c => c.classList.remove('active-beban'));
  activeBeban = null;
  showToast('Simulasi beban dihentikan — kembali ke data idle');
}

/* ── MODAL ───────────────────────────────────────────────── */
let modalChart = null;

function openModal(param) {
  const s = stores[param];
  if (!s) return;

  document.getElementById('modalTitle').textContent = s.name;
  document.getElementById('modalBigVal').textContent = s.data.length ? s.data[s.data.length - 1] : '—';
  document.getElementById('modalBigUnit').textContent = s.unit;

  if (s.data.length > 0) {
    const mn = Math.min(...s.data);
    const mx = Math.max(...s.data);
    const avg = (s.data.reduce((a, b) => a + b, 0) / s.data.length).toFixed(2);
    document.getElementById('modalMin').textContent = mn.toFixed(2);
    document.getElementById('modalMax').textContent = mx.toFixed(2);
    document.getElementById('modalAvg').textContent = avg;
    document.getElementById('modalLast').textContent = s.data[s.data.length - 1];
  }

  // Modal chart
  if (modalChart) modalChart.destroy();
  const ctx = document.getElementById('modalChart').getContext('2d');
  modalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: s.labels,
      datasets: [{ label: s.name, ...chartDefaults(spkColors[param] || '#00d4aa'), data: [...s.data] }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { ticks: { color: '#3d4a60', maxTicksLimit: 8, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', maxTicksLimit: 5 } }
      }
    }
  });

  // Table: last 30 entries
  const tbody = document.getElementById('modalTableBody');
  const last30 = s.data.slice(-30).reverse();
  const last30L = s.labels.slice(-30).reverse();
  tbody.innerHTML = last30.map((v, i) => `<tr><td>${last30L[i]}</td><td>${v} ${s.unit}</td></tr>`).join('');

  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  if (modalChart) { modalChart.destroy(); modalChart = null; }
}

/* ── PAGE NAVIGATION ─────────────────────────────────────── */
const pageTitles = {
  dashboard: 'Dashboard',
  beban: 'Pengujian Beban',
  history: 'Riwayat Kejadian',
  settings: 'Pengaturan',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[page] || page;

  if (page === 'history') renderLogs(currentFilter);
  if (page === 'beban') initBebanPage();

  // Close sidebar on mobile
  if (window.innerWidth <= 900) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

/* ── CHART RANGE ─────────────────────────────────────────── */
function setChartRange(btn, range) {
  document.querySelectorAll('.toggle-group .tgl').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/* ── SETTINGS ────────────────────────────────────────────── */
function saveSettings() {
  BASE_URL = document.getElementById('cfgUrl').value;
  POLL_INTERVAL = parseInt(document.getElementById('cfgInterval').value) * 1000;
  CFG.warnPower = parseInt(document.getElementById('cfgWarn').value);
  CFG.highPower = parseInt(document.getElementById('cfgHigh').value);
  CFG.shortPower = parseInt(document.getElementById('cfgShort').value);
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_INTERVAL);
  showToast('Pengaturan disimpan');
}

/* ── TOAST ───────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── MAIN LOOP ───────────────────────────────────────────── */
async function tick() {

  const data = await fetchLatest();

  console.log("DATA API:", data);

  try {
  render(data);

// realtime history page
if (document.getElementById('page-history')?.classList.contains('active')) {
  renderLogs(currentFilter);

  // update chart histori realtime
  if (charts.hist) {
    const now = new Date().toLocaleTimeString('id-ID', {
      hour12: false
    });

    if (charts.hist.data.labels.length >= 48) {
      charts.hist.data.labels.shift();

      charts.hist.data.datasets[0].data.shift();
      charts.hist.data.datasets[1].data.shift();
    }

    charts.hist.data.labels.push(now);

    charts.hist.data.datasets[0].data.push(data.power);
    charts.hist.data.datasets[1].data.push(data.current * 100);

    charts.hist.update('none');
  }
}

if (activeBeban !== null) {
  updateBebanRealtime();
}
  }
catch(err) {
  console.error("Render error:", err);
}
}

/* ── SIDEBAR TOGGLE ──────────────────────────────────────── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  document.getElementById('mobMenu').addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });
}

/* ── SEED SOME LOGS ──────────────────────────────────────── */
function seedDemoLogs() {
  const now = new Date();
  const demoLogs = [
    { status: 'WARNING', power: 1250, current: 5.68, voltage: 220.1, ai: 'WASPADA' },
    { status: 'HIGH_CONSUMPTION', power: 2100, current: 9.55, voltage: 219.8, ai: 'WASPADA' },
    { status: 'WARNING', power: 1050, current: 4.77, voltage: 220.3, ai: 'WASPADA' },
  ];
  demoLogs.forEach((l, i) => {
    const t = new Date(now.getTime() - (i + 1) * 300000);
    logEntries.push({ ...l, time: t.toLocaleString('id-ID') });
  });
}
// TEST API
fetch(`${BASE_URL}/api/latest`)
  .then(res => res.json())
  .then(data => console.log("API CONNECT:", data))
  .catch(err => console.log("API ERROR:", err));
/* ── BOOT ────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initMainChart();
  initAllSparklines();
  initBebanPage();
  seedDemoLogs();
  renderLogs('ALL');
  setTimeout(initHistChart, 100);

  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL);
});