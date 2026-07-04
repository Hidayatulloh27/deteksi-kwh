/* ── CONFIG ──────────────────────────────────────────────── */
let BASE_URL = 'https://web-production-b1df4.up.railway.app';
let POLL_INTERVAL = 1000;

const CFG = {
  warnPower: 1000, highPower: 2200, shortPower: 3000,
  didtShort: 50, tw: 10, nmin: 3, don: 50, tfluk: 200
};

/* ── DATA STORES ─────────────────────────────────────────── */
const HISTORY_SIZE = 180;
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
let activeAlat = null;
let testingActive = false;
let pengujianAktif = false;
let lastDataTime = Date.now();
let namaAlatAktif = "";

const alatStore = {};

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

/* ── PER-BEBAN ISOLATED STORE ────────────────────────────── */
// Setiap beban punya data history & nama alat sendiri
// Data beban lain TIDAK ikut berubah saat salah satu diuji
const bebanStore = {};
function getAlatStore(namaAlat) {

  if (!alatStore[namaAlat]) {

    alatStore[namaAlat] = {
      power: [],
      current: [],
      voltage: [],
      labels: []
    };

  }

  return alatStore[namaAlat];
}

function getBebanStore(idx) {
  if (!bebanStore[idx]) {
    bebanStore[idx] = {
      power:    [],
      current:  [],
      voltage:  [],
      labels:   [],
      namaAlat: BEBAN_LIST[idx].name,
    };
  }
  return bebanStore[idx];
}

// Dipanggil setiap tick — hanya simpan ke beban aktif
function recordToActiveBeban(data) {

    // hanya saat pengujian aktif
    if (!pengujianAktif) return;

    // harus ada beban yang dipilih
    if (activeBeban === null) return;

    // jangan simpan jika ESP offline
    if (data.status === "ESP_OFFLINE") return;

    const store = getBebanStore(activeBeban);

    const now = new Date().toLocaleTimeString(
        "id-ID",
        { hour12: false }
    );

    store.power.push(Number(data.power));
    store.current.push(Number(data.current));
    store.voltage.push(Number(data.voltage));
    store.labels.push(now);

    if (store.power.length > 180) {
        store.power.shift();
        store.current.shift();
        store.voltage.shift();
        store.labels.shift();
    }

}

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

/* ── INIT CHARTS ─────────────────────────────────────────── */
function initMainChart() {
  const ctx = document.getElementById('mainChart').getContext('2d');
  charts.main = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Daya (W)', ...chartDefaults('#00d4aa') }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { display: false },
        y: { min: 0, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', maxTicksLimit: 5, font: { size: 10 } } }
      }
    }
  });
}

function initHistChart() {
  const canvas = document.getElementById('histChart');
  if (!canvas) { console.log("Canvas histChart tidak ditemukan"); return; }
  const ctx = canvas.getContext('2d');
  charts.hist = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Daya (W)', ...chartDefaults('#00d4aa'), data: [] },
        { label: 'Arus (A)×100', ...chartDefaults('#3b82f6'), data: [] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { ticks: { color: '#3d4a60', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', maxTicksLimit: 5 } }
      }
    }
  });
  console.log("Hist chart initialized");
}

function initSparkline(param, color = '#00d4aa') {
  const canvas = document.getElementById('spk' + paramKey(param));
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  sparklines[param] = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ ...chartDefaults(color), data: [] }] },
    options: {
      responsive: false, maintainAspectRatio: false, animation: false,
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
    const status = classifyStatus(p, a, v);
    return {
      voltage: v, current: a, power: p,
      frequency: +(50 + (Math.random() - 0.5) * 0.15).toFixed(2),
      pf: +(0.94 + Math.random() * 0.05).toFixed(2),
      kwh: +(0.42 + simTick * 0.00003).toFixed(4),
      status, ai: status === 'NORMAL' || status === 'NO_LOAD' ? 'AMAN' : 'WASPADA',
      pln: true, relay: status !== 'SHORT_CIRCUIT' && status !== 'HIGH_CONSUMPTION',
      deltaP: +(p - lastPower).toFixed(2),
      cycling: b.type === 'cycling' || b.type === 'periodik',
      cycleCount: b.type === 'cycling' ? Math.floor(simTick / 40) % 10 : 0,
      cyclePeriod: b.type === 'cycling' ? 40 : null,
      cycleDevice: b.type === 'cycling' || b.type === 'periodik' ? b.name : null,
    };
  }
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
  cycleHistory.push(power);
  if (cycleHistory.length > 8) cycleHistory.shift();
  let transitions = 0;
  for (let i = 1; i < cycleHistory.length; i++) {
    const prev = cycleHistory[i - 1];
    const curr = cycleHistory[i];
    if (Math.abs(curr - prev) > 150) transitions++;
    if (prev > 100 && curr < 20) transitions++;
  }
  cycleTransitions = transitions;
  return transitions >= 3;
}

let shortCounter = 0;
function classifyStatus(p, a, v) {
  if (v <= 10) return 'PLN_OFFLINE';
  const shortDetected = p > CFG.shortPower || (Math.abs(p - lastPower) > 800 && a > 5 && v < 200);
  if (shortDetected) shortCounter++; else shortCounter = 0;
  if (shortCounter >= 2) return 'SHORT_CIRCUIT';
  if (p > CFG.highPower) return 'HIGH_CONSUMPTION';
  if (p > CFG.warnPower) return 'WARNING';
  if (p < 5 && a < 0.05) return 'NO_LOAD';
  return 'NORMAL';
}

/* ── FETCH / POLL ────────────────────────────────────────── */
async function fetchLatest() {
  try {
    const res = await fetch(`${BASE_URL}/api/latest?t=${Date.now()}`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (!result) throw new Error("Response kosong");
    const data = result.data || result;
    lastDataTime = data.status !== 'ESP_OFFLINE'
    ? Date.now()
    : 0;

const power = Number(data.power || 0);
const current = Number(data.current || 0);
const voltage = Number(data.voltage || 0);

let frequency = Number(data.frequency || 0);
let pf = Number(data.pf || 0);
let kwh = Number(data.kwh || 0);

if (voltage < 10) {
    frequency = 0;
    pf = 0;
}

    const cyclingDetected = detectCycling(power);

    // Gunakan status dari ESP32
    let finalStatus = data.status || "NORMAL";

    // Jika Javascript mendeteksi cycling sementara status masih NORMAL
    if (cyclingDetected && finalStatus === "NORMAL") {
        finalStatus = "CYCLING_DETECTED";
    }

    // Gunakan status relay dari ESP32
    const relayState = data.relay;
    return {
      voltage,
      current,
      power,
      frequency: frequency,
      pf: pf,
      kwh: kwh,
      status: finalStatus,
      relay: relayState,
      pln: data.pln,
      deltaP: Number(data.deltaPower || 0),
      cycling: data.deviceCycling || cyclingDetected,
      cycleCount: cycleTransitions,
      cyclePeriod: data.cyclePeriod || null
    };
  } catch (err) {
    console.error("FETCH ERROR:", err);
    return { voltage: 0, current: 0, power: 0, frequency: 0, pf: 0, kwh: 0,
      status: 'ESP_OFFLINE', relay: false, pln: false, deltaP: 0,
      cycling: false, cycleCount: 0, cyclePeriod: null };
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

function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (!el) return;
  el.textContent = 'Last update: ' + new Date().toLocaleTimeString();
}

function updateMetricCards(data) {
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
  if (data.voltage < 10) {
    data.frequency = 0;
    data.pf = 0;
}
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

  // ===== CEK ESP ONLINE/OFFLINE =====
  const espOnline =
    (Date.now() - lastDataTime) < 10000; // offline jika tidak ada data >10 detik

  if (espOnline) {
    deviceStatus.textContent = 'ESP32 Online';
    statusDot.style.background = '#22c55e';
  } else {
    deviceStatus.textContent = 'ESP32 Offline';
    statusDot.style.background = 'red';
  }

  // ===== KODE LAMA TETAP =====
  const s = data.status || 'NORMAL';
  const badge = document.getElementById('topBadge');
  const badgeText = document.getElementById('topBadgeText');

  badge.className = 'status-badge-top';

  if (s === 'WARNING') badge.classList.add('warning');
  else if (s === 'HIGH_CONSUMPTION') badge.classList.add('high');
  else if (s === 'SHORT_CIRCUIT') badge.classList.add('danger');
  else if (s === 'CYCLING_DETECTED') badge.classList.add('warning');
  else if (s === 'ESP_OFFLINE') badge.classList.add('danger');
  else if (s === 'PLN_OFFLINE') badge.classList.add('warning');

  badgeText.textContent = s.replaceAll('_', ' ');

  const relayDot = document.getElementById('relayDot');
  const relayLabel = document.getElementById('relayLabel');
  const relayTitle = document.getElementById('relayTitle');

  if (data.relay === true) {
    relayDot.className = 'relay-dot protect';
    relayLabel.textContent = 'PROTECT';
    relayTitle.textContent = 'LISTRIK DIPUTUS';
  } else {
    relayDot.className = 'relay-dot normal';
    relayLabel.textContent = 'NORMAL';
    relayTitle.textContent = 'LISTRIK NORMAL';
  }

  const plnPill = document.getElementById('plnPill');
  const plnActive = data.pln;

  if (plnActive) {
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

  const dp = Number(data.deltaP || 0);

  setEl('detRule', data.status || 'NORMAL');

  setEl(
    'detDelta',
    (dp >= 0 ? '+' : '') + dp.toFixed(2) + ' W'
  );

  const abnormal = Math.abs(dp) > CFG.tfluk;

  setElClass(
    'detFluk',
    abnormal ? 'red' : 'green',
    abnormal ? 'Ya' : 'Tidak'
  );

  setElClass(
    'detCycle',
    data.cycling ? 'amber' : '',
    data.cycling ? 'Terdeteksi' : 'Tidak ada'
  );

  setEl(
    'detCycleCount',
    data.cycleCount ?? '-'
  );

  setEl(
    'detCyclePeriod',
    data.cyclePeriod
      ? data.cyclePeriod + ' detik'
      : '-'
  );

}

function updateCostPanel(data) {
  const tarif = 1444.7;
  const biayaPerJam = (data.power / 1000) * tarif;
  const biayaPerDetik = biayaPerJam / 3600;
  const kwh = data.kwh || 0;
  const totalBiaya = kwh * tarif;
  const bulanIni = totalBiaya * 0.3;
  const prediksi = totalBiaya * 1.2;
  const rupiah = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  document.getElementById('costTotal').textContent = rupiah(totalBiaya);
  document.getElementById('costMonth').textContent = rupiah(bulanIni);
  document.getElementById('costPredict').textContent = rupiah(prediksi);
  const realtimeEl =
  document.getElementById('costRealtimeText');
  const confidence = Number(data.confidence || 0);
  document.getElementById('costConf').textContent =
"Tidak tersedia";
    confidence + '%';
  const trendBadge = document.getElementById('trendBadge');
  if (data.power > 1500) { trendBadge.textContent = 'TINGGI'; trendBadge.className = 'trend-badge danger'; }
  else if (data.power > 800) { trendBadge.textContent = 'NAIK'; trendBadge.className = 'trend-badge warning'; }
  else { trendBadge.textContent = 'STABIL'; trendBadge.className = 'trend-badge'; }
}

let lastNotifStatus = '';
let lastNotifTime = 0;
let notifLock = false;

function sendNotification(title, body) {

  if (Notification.permission !== "granted") return;

  navigator.serviceWorker.ready
    .then(reg => {

      return reg.showNotification(title, {
        body: body,
        requireInteraction: true,
        renotify: true,
        tag: Date.now().toString(),
        vibrate: [300, 200, 300]
      });

    })
    .catch(err => console.error(err));

}

function checkAlerts(data) {

  const s = data.status;

  // HANYA KIRIM JIKA STATUS BERUBAH
  if (s === lastNotifStatus) return;

  switch (s) {

    case "WARNING":
      sendNotification(
        "⚠️ SmartKWH Warning",
        `Daya melebihi batas warning (${data.power} W)`
      );
      break;

    case "HIGH_CONSUMPTION":
      sendNotification(
        "🔥 Konsumsi Tinggi",
        `Pemakaian listrik tinggi (${data.power} W)`
      );
      break;

    case "SHORT_CIRCUIT":
      sendNotification(
        "🚨 Hubung Singkat",
        "Terdeteksi kemungkinan korsleting"
      );
      break;

    case "PLN_OFFLINE":
      sendNotification(
        "🔌 PLN Mati",
        "Tegangan PLN terputus"
      );
      break;

    case "ESP_OFFLINE":
      sendNotification(
        "📡 ESP32 Offline",
        "Perangkat tidak terhubung"
      );
      break;

    case "NORMAL":
      sendNotification(
        "✅ SmartKWH",
        "Kondisi listrik kembali normal"
      );
      break;
  }

  lastNotifStatus = s;
}

function addLog(data) {
  const s = data.status;
  if (!s || s === 'NORMAL' || s === 'NO_LOAD') return;
  const now = new Date();
  const lastLog = logEntries[0];
  if (lastLog) {
    const lastTime = new Date(lastLog.rawTime || 0);
    const diffSec = (now - lastTime) / 1000;
    if (lastLog.status === s && diffSec < 5) return;
  }
  logEntries.unshift({
    rawTime: now, time: now.toLocaleString('id-ID'),
    status: s, power: data.power, current: data.current,
    voltage: data.voltage, ai: data.ai || '—'
  });
  if (logEntries.length > 200) logEntries.pop();
  renderLogs(currentFilter);
}

function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
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
      <td>${l.power}</td><td>${l.current}</td><td>${l.voltage}</td><td>${l.ai}</td>
    </tr>`).join('') :
    `<tr><td colspan="6" style="text-align:center;color:#3d4a60;padding:20px">Belum ada data</td></tr>`;
}

function filterLogs(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLogs(filter);
}

/* ── BEBAN PAGE ──────────────────────────────────────────── */
let bebanPowerChart = null;
let bebanCurrentChart = null;

/* ── [DIUBAH] initBebanPage — tampilkan nama custom jika ada ─ */
function initBebanPage() {
  const grid = document.getElementById('bebanGrid');
  if (!grid) return;
  grid.innerHTML = BEBAN_LIST.map((b, i) => {
    const pPct = Math.min(100, (b.nominalPower / 500) * 100);
    const aPct = Math.min(100, (b.nominalCurrent / 3) * 100);
    const store = getBebanStore(i);
    const namaCustom = store.namaAlat !== b.name
      ? `<div class="beban-nama-custom">${store.namaAlat}</div>` : '';
    const hasData = store.power.length > 0;
    const dataBadge = hasData
      ? `<span class="beban-data-badge">${store.power.length} data</span>` : '';
    return `
      <div class="beban-card" id="beban-card-${i}" onclick="selectBeban(${i})">
        <span class="beban-type-badge type-${b.type}">${b.typeLabel}</span>
        ${dataBadge}
        <div class="beban-num">BEBAN ${b.id}</div>
        <div class="beban-icon">${b.icon}</div>
        <div class="beban-name">${b.name}</div>
        ${namaCustom}
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
      </div>`;
  }).join('');
}

/* ── [DIUBAH] selectBeban — set nama alat, gunakan data isolated ─ */
function selectBeban(idx) {
  document.querySelectorAll('.beban-card').forEach(c => c.classList.remove('active-beban'));
  const card = document.getElementById(`beban-card-${idx}`);
  if (card) card.classList.add('active-beban');
  activeBeban = idx;

  // Tampilkan input nama alat
  showNamaInput(idx);
  showBebanChart(idx);
  showToast(`Silakan masukkan nama alat lalu klik Mulai Pengujian`);
}

function mulaiPengujian() {

  const nama = document
      .getElementById("namaAlatInput")
      .value
      .trim();

  if (!nama) {
      alert("Masukkan nama alat terlebih dahulu!");
      return;
  }

  namaAlatAktif = nama;

  activeAlat = nama;
  testingActive = true;

  const store = getBebanStore(activeBeban);

  store.power = [];
  store.current = [];
  store.voltage = [];
  store.labels = [];
  pengujianAktif = true;

  if (activeBeban !== null) {
      getBebanStore(activeBeban).namaAlat = nama;
  }

  showToast("Pengujian dimulai: " + nama);
}
/* ── [BARU] Input nama alat custom ──────────────────────── */
function showNamaInput(idx) {
  const existing = document.getElementById('namaAlatPanel');
  if (existing) existing.remove();

  const store = getBebanStore(idx);
  const b = BEBAN_LIST[idx];

  const panel = document.createElement('div');
  panel.id = 'namaAlatPanel';
  panel.style.cssText = `
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);
    padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;
    gap:12px;flex-wrap:wrap;
  `;
  panel.innerHTML = `
    <span style="font-size:12px;color:var(--text2);font-family:var(--font-mono);">
      Nama alat yang diuji (Beban ${b.id}):
    </span>
    <input id="namaAlatInput" type="text" placeholder="contoh: Kipas Angin Cosmos"
      value="${store.namaAlat}"
      style="flex:1;min-width:180px;padding:7px 12px;background:var(--bg3);
             border:1px solid var(--border2);border-radius:var(--radius-xs);
             color:var(--text0);font-family:var(--font-mono);font-size:13px;
             outline:none;" />
    <button onclick="mulaiPengujian(); simpanNamaAlat(${idx})"
      style="padding:7px 16px;background:var(--accent-dim);border:1px solid var(--accent-glow);
             color:var(--accent);border-radius:var(--radius-xs);font-size:12px;
             font-weight:700;cursor:pointer;white-space:nowrap;">
      Simpan Nama
    </button>
    <button onclick="clearBebanData(${idx})"
      style="padding:7px 12px;background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);
             color:var(--red);border-radius:var(--radius-xs);font-size:12px;
             font-weight:700;cursor:pointer;">
      Reset Data
    </button>`;

  const grid = document.getElementById('bebanGrid');
  grid.parentNode.insertBefore(panel, grid.nextSibling);
}

function simpanNamaAlat(idx) {
  const input = document.getElementById('namaAlatInput');
  if (!input) return;
  const nama = input.value.trim() || BEBAN_LIST[idx].name;
  getBebanStore(idx).namaAlat = nama;
  showToast(`Nama alat disimpan: ${nama}`);
  initBebanPage(); // refresh kartu
  selectBeban(idx); // pilih lagi agar panel tetap terbuka
}

function clearBebanData(idx) {
  const store = getBebanStore(idx);
  store.power = []; store.current = [];
  store.voltage = []; store.labels = [];
  showToast(`Data Beban ${idx+1} direset`);
  showBebanChart(idx);
  initBebanPage();
}

/* ── [DIUBAH] showBebanChart — baca dari bebanStore[idx] ─── */
function showBebanChart(idx) {
  const b = BEBAN_LIST[idx];
  const panel = document.getElementById('bebanChartPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const store = getBebanStore(idx);
  const namaLabel = store.namaAlat !== b.name ? ` (${store.namaAlat})` : '';
  document.getElementById('bebanChartTitle').textContent =
    `Beban ${b.id} — ${b.name}${namaLabel} · Data Pengujian`;

  // Ambil data dari store beban ini — BUKAN dari stores global
  const pwrData  = [...store.power];
  const currData = [...store.current];
  const labels   = [...store.labels];

  if (bebanPowerChart) bebanPowerChart.destroy();
  const pCtx = document.getElementById('bebanPowerChart').getContext('2d');
  bebanPowerChart = new Chart(pCtx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Daya (W)', ...chartDefaults(b.color), data: pwrData }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        title: { display: true, text: 'Daya (W)', color: '#94a3b8', font: { size: 11 } } },
      scales: {
        x: { ticks: { color: '#3d4a60' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
      }
    }
  });

  if (bebanCurrentChart) bebanCurrentChart.destroy();
  const cCtx = document.getElementById('bebanCurrentChart').getContext('2d');
  bebanCurrentChart = new Chart(cCtx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Arus (A)', ...chartDefaults('#3b82f6'), data: currData }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        title: { display: true, text: 'Arus (A)', color: '#94a3b8', font: { size: 11 } } },
      scales: {
        x: { ticks: { color: '#3d4a60' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
      }
    }
  });

  // Stats dari data beban ini saja
  const avgP = pwrData.length ? (pwrData.reduce((a,v)=>a+v,0)/pwrData.length).toFixed(1) : 0;
  const maxP = pwrData.length ? Math.max(...pwrData).toFixed(1) : 0;
  const minP = pwrData.length ? Math.min(...pwrData).toFixed(1) : 0;
  const avgA = currData.length ? (currData.reduce((a,v)=>a+v,0)/currData.length).toFixed(3) : 0;

  document.getElementById('bebanStats').innerHTML = `
    <div class="bstat"><div class="bstat-label">Nama Alat</div><div class="bstat-val">${store.namaAlat}</div></div>
    <div class="bstat"><div class="bstat-label">Daya Rata-rata</div><div class="bstat-val">${avgP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Maks</div><div class="bstat-val">${maxP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Min</div><div class="bstat-val">${minP} W</div></div>
    <div class="bstat"><div class="bstat-label">Arus Rata-rata</div><div class="bstat-val">${avgA} A</div></div>
    <div class="bstat"><div class="bstat-label">Jumlah Data</div><div class="bstat-val">${pwrData.length} titik</div></div>
    <div class="bstat"><div class="bstat-label">Tipe Beban</div><div class="bstat-val">${b.typeLabel}</div></div>
    <div class="bstat"><div class="bstat-label">Kondisi</div><div class="bstat-val">${classifyStatus(+avgP, +avgA, 220)}</div></div>`;
}

/* ── [DIUBAH] updateBebanRealtime — update chart dari bebanStore ─ */
function updateBebanRealtime() {

  if (!bebanPowerChart || !bebanCurrentChart) return;

  if (activeBeban === null) return;

  const store = getBebanStore(activeBeban);

  const b = BEBAN_LIST[activeBeban];

  /* update chart */
  bebanPowerChart.data.labels = [...store.labels];
  bebanPowerChart.data.datasets[0].data = [...store.power];
  bebanPowerChart.update('none');

  bebanCurrentChart.data.labels = [...store.labels];
  bebanCurrentChart.data.datasets[0].data = [...store.current];
  bebanCurrentChart.update('none');

  /* update statistik realtime */
  const pwrData  = store.power;
  const currData = store.current;

  const avgP = pwrData.length
    ? (pwrData.reduce((a,v)=>a+v,0)/pwrData.length).toFixed(1)
    : 0;

  const maxP = pwrData.length
    ? Math.max(...pwrData).toFixed(1)
    : 0;

  const minP = pwrData.length
    ? Math.min(...pwrData).toFixed(1)
    : 0;

  const avgA = currData.length
    ? (currData.reduce((a,v)=>a+v,0)/currData.length).toFixed(3)
    : 0;

  document.getElementById('bebanStats').innerHTML = `
    <div class="bstat"><div class="bstat-label">Nama Alat</div><div class="bstat-val">${store.namaAlat}</div></div>
    <div class="bstat"><div class="bstat-label">Daya Rata-rata</div><div class="bstat-val">${avgP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Maks</div><div class="bstat-val">${maxP} W</div></div>
    <div class="bstat"><div class="bstat-label">Daya Min</div><div class="bstat-val">${minP} W</div></div>
    <div class="bstat"><div class="bstat-label">Arus Rata-rata</div><div class="bstat-val">${avgA} A</div></div>
    <div class="bstat"><div class="bstat-label">Jumlah Data</div><div class="bstat-val">${pwrData.length} titik</div></div>
    <div class="bstat"><div class="bstat-label">Tipe Beban</div><div class="bstat-val">${b.typeLabel}</div></div>
    <div class="bstat"><div class="bstat-label">Kondisi</div><div class="bstat-val">${classifyStatus(+avgP, +avgA, 220)}</div></div>
  `;
}

function closeBebanChart() {

    selesaiPengujian();

    document.getElementById('bebanChartPanel').style.display = 'none';

    document
        .querySelectorAll('.beban-card')
        .forEach(c => c.classList.remove('active-beban'));

    const namaPanel =
        document.getElementById('namaAlatPanel');

    if (namaPanel)
        namaPanel.remove();

    activeBeban = null;

    showToast("Pengujian beban dihentikan");

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
  if (modalChart) modalChart.destroy();
  const ctx = document.getElementById('modalChart').getContext('2d');
  modalChart = new Chart(ctx, {
    type: 'line',
    data: { labels: s.labels, datasets: [{ label: s.name, ...chartDefaults(spkColors[param] || '#00d4aa'), data: [...s.data] }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { ticks: { color: '#3d4a60', maxTicksLimit: 8, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', maxTicksLimit: 5 } }
      }
    }
  });
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
const pageTitles = { dashboard: 'Dashboard', beban: 'Pengujian Beban', history: 'Riwayat Kejadian', settings: 'Pengaturan' };

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
  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
}

function setChartRange(btn, range) {
  document.querySelectorAll('.toggle-group .tgl').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function saveSettings() {
  console.log("TOMBOL SIMPAN DIKLIK");
  BASE_URL = document.getElementById('cfgUrl').value;
  POLL_INTERVAL = parseInt(document.getElementById('cfgInterval').value) * 1000;

  CFG.warnPower  = parseInt(document.getElementById('cfgWarn').value);
  CFG.highPower  = parseInt(document.getElementById('cfgHigh').value);
  CFG.shortPower = parseInt(document.getElementById('cfgShort').value);

  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_INTERVAL);

  try {

    const res = await fetch(`${BASE_URL}/api/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        warnPower: CFG.warnPower,
        highPower: CFG.highPower,
        shortPower: CFG.shortPower
      })
    });

    const result = await res.json();

    console.log("SETTINGS SAVED:", result);

    showToast("Pengaturan tersimpan ke server");

  } catch(err) {

    console.error(err);

    showToast("Gagal simpan ke server");

  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── MAIN LOOP ───────────────────────────────────────────── */
async function tick() {
  const data = await fetchLatest();
  console.log("RELAY STATUS:", data.relay);
  recordToActiveBeban(data);

  try {

    render(data);
    addLog(data);
    renderLogs(currentFilter);

    if (charts.hist) {

      const now = new Date().toLocaleTimeString(
        'id-ID',
        { hour12:false }
      );

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

    if (activeBeban !== null) {

      updateBebanRealtime();

    }

  } catch(err) {

    console.error("Render error:", err);

  }

}

/* ── SIDEBAR ─────────────────────────────────────────────── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const mobMenu = document.getElementById('mobMenu');
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (mobMenu && sidebar) mobMenu.addEventListener('click', () => sidebar.classList.toggle('open'));
  if (sidebarToggle && sidebar) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

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

fetch(`${BASE_URL}/api/latest`)
  .then(res => res.json())
  .then(data => console.log("API CONNECT:", data))
  .catch(err => console.log("API ERROR:", err));

function selesaiPengujian() {

    pengujianAktif = false;

    testingActive = false;

    activeAlat = null;

    namaAlatAktif = "";

    showToast("Pengujian selesai");

}
async function resetProteksi() {

    if (!confirm("Reset proteksi dan hidupkan relay kembali?")) {
        return;
    }

    try {

        const res = await fetch("/api/reset-proteksi", {
            method: "POST"
        });

        const data = await res.json();

        if (data.success) {

            alert("✅ Reset proteksi berhasil dikirim");

        } else {

            alert("❌ Reset gagal");

        }

    } catch (err) {

        console.error(err);
        alert("❌ Gagal koneksi ke server");

    }
}

window.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initMainChart();
  initAllSparklines();
  initBebanPage();

  if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/static/sw.js')
      .then(reg => {
          console.log('SW REGISTERED');
      })
      .catch(err => {
          console.log('SW FAILED', err);
      });
  }

  if (Notification.permission !== "granted") {
      Notification.requestPermission()
      .then(permission => {
          console.log("NOTIFICATION:", permission);
      });
  }

  fetch(`${BASE_URL}/api/settings`)
    .then(res => res.json())
    .then(cfg => {

      CFG.warnPower = cfg.warnPower;
      CFG.highPower = cfg.highPower;
      CFG.shortPower = cfg.shortPower;

      document.getElementById('cfgWarn').value = cfg.warnPower;
      document.getElementById('cfgHigh').value = cfg.highPower;
      document.getElementById('cfgShort').value = cfg.shortPower;

      console.log("SETTINGS LOADED:", cfg);

    })

  .catch(err => console.error(err));
  renderLogs('ALL');
  setTimeout(initHistChart, 100);
  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL);
  sendNotification(
   "TEST NOTIF",
   "Notifikasi Railway berhasil"
);
});