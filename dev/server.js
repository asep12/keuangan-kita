/**
 * dev/server.js — jalankan Web App secara lokal dengan backend emulator.
 *   node dev/server.js          -> http://localhost:8788
 * Data hanya di memori (hilang saat server berhenti). Akun uji: lihat AKUN_UJI di bawah.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buatProyek } = require('./emulator');

const PORT = Number(process.env.PORT) || 8788;
const JEDA_MS = 300; // meniru latensi google.script.run
const ROOT = path.resolve(__dirname, '..');

// Akun uji fiktif khusus server lokal. Budi = Pengelola; Sari = Anggota yang wajib ganti PIN saat masuk pertama.
// DEMO=1 node dev/server.js -> hanya Pengelola tanpa data contoh (mencoba alur pemakai baru).
const AKUN_UJI = [
  { nama: 'Budi', pin: '482913', gantiPin: false, peran: 'Pengelola' },
  { nama: 'Sari', pin: '730519', gantiPin: true, peran: 'Anggota' },
];
const KOSONG = process.env.DEMO === '1';

const P = buatProyek({ diam: false });
P.jalankan("denganKunci_(function () { return jalankanSetup_('Budi'); })");
P.jalankan(`(function (akun) { akun.forEach(function (a) { aturPin_(a.nama, a.pin, a.gantiPin, a.peran); buatAkunTunai_(a.nama); }); })(${JSON.stringify(KOSONG ? AKUN_UJI.slice(0, 1) : AKUN_UJI)})`);

// Bot Telegram tiruan (token fiktif; UrlFetchApp emulator menjawab seperti Bot API) agar Atur › Telegram bisa dicoba.
P.jalankan("(function(){ const p = props_(); p.setProperty('TG_TOKEN', '123456789:AAEtokenFiktifUntukServerLokal123456'); p.setProperty('TG_BOT', 'KeuanganUjiBot'); p.setProperty('TG_KUNCI', 'lokal'); })()");

// Contoh data fiktif 3 bulan terakhir (deterministik) agar Riwayat, Laporan & Anggaran punya isi.
if (!KOSONG) P.jalankan(`(function () {
  let benih = 11;
  const acak = () => { benih = (benih * 16807) % 2147483647; return (benih - 1) / 2147483646; };
  const tAkun = bacaTabel_('Akun');
  tambahObjek_(tAkun, [
    { ID: 'AK-BRS', Nama: "'Bank Bersama", Jenis: 'Bank', Pemilik: "'Bersama", 'Saldo Awal': 3500000, Aktif: 'Ya', Urutan: 3 },
    { ID: 'AK-TAB', Nama: "'Tabungan Sari", Jenis: 'Bank', Pemilik: "'Sari", 'Saldo Awal': 1200000, Aktif: 'Ya', Urutan: 4 },
    { ID: 'AK-GOP', Nama: "'GoPay Budi", Jenis: 'E-Wallet', Pemilik: "'Budi", 'Saldo Awal': 150000, Aktif: 'Ya', Urutan: 5 },
  ]);
  naikkanVersi_('akun');
  const kat = {};
  bacaKategori_().forEach(function (k) { kat[k.nama] = k.id; });
  const akun = {};
  bacaAkun_().forEach(function (a) { akun[a.nama] = a.id; });
  const hari = hariIni_();
  const bulanIni = hari.slice(0, 7);
  const trx = [];
  let n = 0;
  const catat = function (tgl, jenis, pemilik, kategori, akunNama, nominal, ket, tujuan) {
    if (tgl > hari) return;
    trx.push({ ID: 'TR-CONTOH' + (++n), Tanggal: "'" + tgl, Jenis: jenis, Pemilik: "'" + pemilik, 'Kategori ID': kategori ? kat[kategori] : '',
      'Akun ID': akun[akunNama], 'Akun Tujuan ID': tujuan ? akun[tujuan] : '', Nominal: nominal, Keterangan: ket ? "'" + ket : '',
      'Dicatat Oleh': "'" + (pemilik === 'Bersama' ? (acak() < 0.5 ? 'Budi' : 'Sari') : pemilik), Dibuat: "'" + tgl + 'T08:00:00', Diubah: '', Status: 'Aktif' });
  };
  [-2, -1, 0].forEach(function (geser) {
    const b = geserBulan_(bulanIni, geser);
    catat(b + '-01', 'Masuk', 'Budi', 'Gaji', 'Bank Bersama', 7500000, 'Gaji bulanan');
    catat(b + '-01', 'Masuk', 'Sari', 'Gaji', 'Tabungan Sari', 6800000, 'Gaji bulanan');
    catat(b + '-02', 'Keluar', 'Bersama', 'Tabungan Tujuan', 'Bank Bersama', 3000000, 'Setor tabungan bersama');
    catat(b + '-03', 'Keluar', 'Sari', 'Dana Darurat', 'Tabungan Sari', 500000);
    catat(b + '-05', 'Keluar', 'Budi', 'Cicilan Kendaraan', 'Bank Bersama', 950000, 'Cicilan motor');
    catat(b + '-06', 'Keluar', 'Bersama', 'Listrik', 'Bank Bersama', 280000 + Math.round(acak() * 60) * 1000);
    catat(b + '-06', 'Keluar', 'Sari', 'Pulsa & Paket Data', 'Tabungan Sari', 105000);
    catat(b + '-07', 'Transfer', 'Budi', '', 'Bank Bersama', 1000000, 'Tarik tunai', 'Tunai Budi');
    for (let d = 1; d <= 28; d += 1) {
      const tgl = b + '-' + String(d).padStart(2, '0');
      if (acak() < 0.55) catat(tgl, 'Keluar', acak() < 0.5 ? 'Budi' : 'Sari', 'Makanan & Minuman', acak() < 0.5 ? 'Tunai Budi' : 'Tunai Sari', (15 + Math.round(acak() * 60)) * 1000, acak() < 0.4 ? 'Makan siang' : '');
      if (acak() < 0.25) catat(tgl, 'Keluar', 'Budi', 'Transportasi', 'GoPay Budi', (10 + Math.round(acak() * 40)) * 1000, 'Bensin/ojek');
      if (acak() < 0.08) catat(tgl, 'Keluar', 'Sari', 'Perawatan Diri', 'Tabungan Sari', (50 + Math.round(acak() * 200)) * 1000);
      if (acak() < 0.05) catat(tgl, 'Keluar', 'Bersama', 'Rumah Tangga', 'Tunai Sari', (30 + Math.round(acak() * 120)) * 1000);
    }
    catat(b + '-15', 'Masuk', 'Budi', 'Sampingan', 'GoPay Budi', 400000 + Math.round(acak() * 8) * 100000, 'Desain logo');
  });
  tambahObjek_(bacaHeader_('Transaksi'), trx);
  naikkanVersi_('trx');
  const agr = [];
  [-1, 0].forEach(function (geser) {
    const b = geserBulan_(bulanIni, geser);
    [['Budi', 'Makanan & Minuman', 900000], ['Budi', 'Transportasi', 350000], ['Budi', 'Cicilan Kendaraan', 950000], ['Budi', 'Gaji', 7500000],
      ['Sari', 'Makanan & Minuman', 800000], ['Sari', 'Perawatan Diri', 300000], ['Sari', 'Dana Darurat', 500000], ['Sari', 'Pulsa & Paket Data', 100000], ['Sari', 'Gaji', 6800000],
      ['Bersama', 'Tabungan Tujuan', 3000000], ['Bersama', 'Listrik', 300000], ['Bersama', 'Rumah Tangga', 200000]]
      .forEach(function (x) { agr.push({ Bulan: "'" + b, Pemilik: "'" + x[0], 'Kategori ID': kat[x[1]], Nominal: x[2], 'Diubah Oleh': "'Budi", Diubah: '' }); });
  });
  tambahObjek_(bacaHeader_('Anggaran'), agr);
  naikkanVersi_('agr');
})()`);

const MOCK_RUN = `<script>
(function () {
  function runner(sukses, gagal) {
    return new Proxy({}, { get: function (_, nama, runnerIni) {
      if (nama === 'withSuccessHandler') return function (f) { return runner(f, gagal); };
      if (nama === 'withFailureHandler') return function (f) { return runner(sukses, f); };
      return function () {
        // Seketat runner asli: harus dipanggil sebagai metode runner (this = runner).
        if (this !== runnerIni) throw new TypeError('google.script.run.' + nama + ' dipanggil tanpa this runner');
        var args = Array.prototype.slice.call(arguments);
        fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nama: nama, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.error) { if (gagal) gagal(new Error(j.error)); } else if (sukses) sukses(j.hasil); })
          .catch(function (e) { if (gagal) gagal(e); });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

function renderHalaman() {
  let html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('(\w+)'\);\s*\?>/g, (_, nama) => fs.readFileSync(path.join(ROOT, nama + '.html'), 'utf8'));
  // Tiru <?= var ?> HtmlService (dengan escape HTML) untuk variabel template dari doGet.
  const varTemplat = { namaAplikasi: P.jalankan('String(bacaPengaturan_().NAMA_APLIKASI)') };
  html = html.replace(/<\?=\s*(\w+)\s*\?>/g, (_, nama) => String(varTemplat[nama] ?? '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  // Meniru addMetaTag('viewport') dari doGet.
  html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  return html.replace('<body>', '<body>' + MOCK_RUN);
}

http.createServer((req, res) => {
  // Khusus lokal: /demo?nama=Budi&layar=laporan — langsung masuk & buka layar (untuk screenshot otomatis).
  if (req.method === 'GET' && req.url.startsWith('/demo')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const akun = AKUN_UJI.find((a) => a.nama === q.get('nama')) || AKUN_UJI[0];
    const layar = /^[a-z]+$/.test(q.get('layar') || '') ? q.get('layar') : 'catat';
    const token = P.jalankan(`(function(){ const t = Utilities.getUuid(); simpanSesi_(t, { n: '${akun.nama}', v: versiSesi_('${akun.nama}'), e: Date.now() + 86400000, t: Date.now() }); return t; })()`);
    const sisip = `<script>localStorage.setItem('kk_token', ${JSON.stringify(token)});
      addEventListener('load', function () { setTimeout(function () { var b = document.querySelector('[data-nav=${layar}]') || ('${layar}' === 'atur' && document.querySelector('#chip-pengguna')); if (b) b.click(); }, 900); });</script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHalaman().replace('<body>', '<body>' + sisip));
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHalaman());
    return;
  }
  if (req.method === 'POST' && req.url === '/api') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => setTimeout(() => {
      let keluar;
      try {
        const { nama, args } = JSON.parse(body);
        keluar = { hasil: P.panggilKlien(nama, args) };
        console.log('[api]', nama, keluar.hasil && keluar.hasil.ok === false ? '-> ' + keluar.hasil.kode : '');
      } catch (e) {
        console.error('[api] galat', e.message);
        keluar = { error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(keluar));
    }, JEDA_MS));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log('Keuangan lokal: http://localhost:' + PORT));
