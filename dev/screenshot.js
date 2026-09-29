/**
 * dev/screenshot.js — potret setiap layar dalam ukuran HP (390px, 2x) memakai Chrome DevTools Protocol.
 * Syarat: `node dev/server.js` sedang berjalan. Jalankan: node dev/screenshot.js [folder-keluaran]
 * Tanpa npm: memakai WebSocket bawaan Node >= 22 dan Chrome yang terpasang.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASIS = process.env.BASIS || 'http://localhost:8788';
const KELUAR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'screenshot'));
// Port DevTools acak: port tetap bisa bentrok dengan Chrome headless milik proses lain (hasil potret tertukar).
const PORT = Number(process.env.CDP_PORT) || 9400 + Math.floor(Math.random() * 500);
const LAYAR = [
  { file: 'masuk', url: '/' },
  { file: 'beranda', url: '/demo?nama=Budi&layar=beranda' },
  { file: 'catat', url: '/demo?nama=Budi&layar=catat' },
  { file: 'riwayat', url: '/demo?nama=Budi&layar=riwayat' },
  { file: 'laporan', url: '/demo?nama=Budi&layar=laporan' },
  { file: 'anggaran', url: '/demo?nama=Budi&layar=anggaran' },
  { file: 'atur', url: '/demo?nama=Budi&layar=atur' },
];
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(KELUAR, { recursive: true });
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await tunggu(250);
      try { target = (await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()).find((t) => t.type === 'page'); } catch (e) { /* belum siap */ }
    }
    if (!target) throw new Error('Chrome DevTools tidak merespons');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const menunggu = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && menunggu.has(m.id)) { menunggu.get(m.id)(m); menunggu.delete(m.id); }
    });
    const kirim = (method, params) => new Promise((r) => { const n = ++id; menunggu.set(n, r); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });

    await kirim('Page.enable');
    // TEMA=dark node dev/screenshot.js … -> potret mode gelap.
    if (process.env.TEMA === 'dark') await kirim('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await kirim('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const l of LAYAR) {
      // Setiap layar mulai dari penyimpanan bersih agar token demo tidak tertukar.
      await kirim('Storage.clearDataForOrigin', { origin: BASIS, storageTypes: 'local_storage' });
      await kirim('Page.navigate', { url: BASIS + l.url });
      await tunggu(3500);
      const tinggi = (await kirim('Runtime.evaluate', { expression: 'Math.max(document.documentElement.scrollHeight, 844)', returnByValue: true })).result.result.value;
      await kirim('Emulation.setDeviceMetricsOverride', { width: 390, height: tinggi, deviceScaleFactor: 2, mobile: true });
      await tunggu(300);
      const gambar = await kirim('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(KELUAR, l.file + '.png'), Buffer.from(gambar.result.data, 'base64'));
      await kirim('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      console.log('✔ ' + l.file + '.png (' + tinggi + 'px)');
    }
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
