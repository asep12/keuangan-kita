/**
 * Keuangan.gs — SEMUA kode server Keuangan Kita dalam satu file, untuk ditempel ke editor Apps Script.
 * Dibuat otomatis oleh dev/bundel.js dari file sumber di repo; jangan diedit langsung.
 * Panduan pemasangan: README.md › "Pasang tanpa terminal".
 */
// ===================================================================== Code.js

/**
 * Code.js — pintu masuk Web App, menu Spreadsheet, dan pembungkus API.
 * Semua fungsi internal berakhiran "_" agar tidak bisa dipanggil lewat google.script.run.
 */

// File HTML yang boleh di-include; mencegah include() dipakai membaca file lain.
const FILE_INCLUDE = Object.freeze(['Css', 'Js']);

function doGet() {
  let judul = 'Keuangan Kita';
  try {
    judul = bacaPengaturan_().NAMA_APLIKASI || judul;
  } catch (e) {
    // Sheet belum di-setup: tetap tampilkan aplikasi, pesan muncul saat masuk.
  }
  const templat = HtmlService.createTemplateFromFile('Index');
  // Dicetak lewat tag <?= ?> yang otomatis meng-escape HTML.
  templat.namaAplikasi = String(judul);
  return templat
    .evaluate()
    .setTitle(String(judul))
    // Tag meta viewport di dalam HTML diabaikan HtmlService, jadi wajib lewat addMetaTag.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(nama) {
  if (FILE_INCLUDE.indexOf(nama) === -1) return '';
  return HtmlService.createHtmlOutputFromFile(nama).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Keuangan')
    .addItem('Setup Awal', 'setupAwal')
    .addItem('Impor dari Template Lama', 'imporTemplateLama')
    .addItem('Reset PIN', 'resetPin')
    .addItem('Hubungkan Bot Telegram', 'hubungkanBotTelegram')
    .addItem('Status Bot Telegram', 'statusBotTelegram')
    .addSeparator()
    .addItem('Jalankan Tes Logika', 'jalankanTes')
    .addToUi();
}

/**
 * Pembungkus semua API publik: cek sesi, tangkap semua error.
 * token === null berarti API publik tanpa sesi (masuk, daftar nama).
 * opsi.bolehGantiPin: fungsi tetap boleh dipanggil saat pengguna wajib ganti PIN.
 */
function jalankan_(token, fn, opsi) {
  try {
    pastikanFileAsli_();
    const sesi = token === null ? null : cekSesi_(token, opsi && opsi.bolehGantiPin);
    return { ok: true, data: fn(sesi) };
  } catch (e) {
    return responsGalat_(e);
  }
}

function galat_(kode, pesan) {
  const e = new Error(pesan);
  e.kode = kode;
  e.bisnis = true;
  return e;
}

function responsGalat_(e) {
  if (e && e.bisnis) return { ok: false, kode: e.kode, pesan: e.message };
  // Detail teknis hanya ke log server; klien cukup pesan umum.
  console.error('Galat server: ' + (e && e.stack ? e.stack : e));
  return { ok: false, kode: 'SERVER', pesan: 'Terjadi kesalahan di server. Silakan coba lagi.' };
}

/** Jalankan fn di dalam script lock. Dipakai semua operasi yang menulis data. */
function denganKunci_(fn) {
  const kunci = LockService.getScriptLock();
  if (!kunci.tryLock(10000)) {
    throw galat_('SIBUK', 'Sedang ada penyimpanan lain. Silakan coba lagi.');
  }
  try {
    const hasil = fn();
    SpreadsheetApp.flush();
    return hasil;
  } finally {
    kunci.releaseLock();
  }
}

/** Menolak pemanggilan dari Web App: getUi() hanya tersedia bila dijalankan dari Spreadsheet. */
function pastikanDariSpreadsheet_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('Fungsi ini hanya bisa dijalankan dari menu Keuangan di Spreadsheet.');
  }
}

function zonaWaktu_() {
  return Session.getScriptTimeZone() || 'Asia/Jakarta';
}

/** 'yyyy-MM-dd' hari ini menurut zona waktu skrip. */
function hariIni_() {
  return Utilities.formatDate(new Date(), zonaWaktu_(), 'yyyy-MM-dd');
}

/** Cap waktu teks untuk kolom Dibuat/Diubah (bukan Date, aman dikirim ke klien). */
function cap_() {
  return Utilities.formatDate(new Date(), zonaWaktu_(), "yyyy-MM-dd'T'HH:mm:ss");
}

/** Sel tanggal bisa berisi Date bila diketik manual di sheet; samakan menjadi 'yyyy-MM-dd'. */
function teksTanggal_(v) {
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, zonaWaktu_(), 'yyyy-MM-dd');
  }
  return String(v === null || v === undefined ? '' : v).trim().slice(0, 10);
}

function teksWaktu_(v) {
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, zonaWaktu_(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(v === null || v === undefined ? '' : v);
}

// ===================================================================== Db.js

/**
 * Db.js — satu-satunya tempat yang menyentuh sheet dan cache.
 * Kolom dipetakan berdasarkan nama header, bukan nomor kolom.
 */

const VERSI = '1.1.0';

const SHEET = Object.freeze({
  TRANSAKSI: 'Transaksi',
  AKUN: 'Akun',
  KATEGORI: 'Kategori',
  ANGGARAN: 'Anggaran',
  PENGGUNA: 'Pengguna',
  PENGATURAN: 'Pengaturan',
});

// Sumber kebenaran header. Urutan hanya berlaku untuk sheet baru; kolom baru ditambah di ujung kanan.
const SKEMA = Object.freeze({
  Transaksi: ['ID', 'Tanggal', 'Jenis', 'Pemilik', 'Kategori ID', 'Akun ID', 'Akun Tujuan ID', 'Nominal', 'Keterangan',
    'Dicatat Oleh', 'Dibuat', 'Diubah', 'Status'],
  Akun: ['ID', 'Nama', 'Jenis', 'Pemilik', 'Saldo Awal', 'Aktif', 'Urutan'],
  Kategori: ['ID', 'Kelompok', 'Nama', 'Keterangan', 'Aktif', 'Urutan'],
  Anggaran: ['Bulan', 'Pemilik', 'Kategori ID', 'Nominal', 'Diubah Oleh', 'Diubah'],
  Pengguna: ['Nama', 'Hash PIN', 'Salt', 'Ganti PIN', 'Diubah', 'Peran', 'Aktif'],
  Pengaturan: ['Kunci', 'Nilai'],
});

const CACHE_TTL = 600; // 10 menit
const CACHE_POTONGAN = 50000; // karakter per kunci, aman di bawah batas 100 KB

// ---------- Baca / tulis tabel ----------

function ambilSheet_(nama) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(nama);
  if (!sheet) throw galat_('BELUM_SETUP', 'Sheet "' + nama + '" belum ada. Jalankan menu Keuangan › Setup Awal.');
  return sheet;
}

/** Susun objek tabel dari baris header + data; memastikan semua kolom SKEMA ada. */
function susunTabel_(nama, sheet, barisHeader, baris) {
  const header = barisHeader.map(function (h) { return String(h).trim(); });
  const kol = {};
  header.forEach(function (h, i) { if (h && !(h in kol)) kol[h] = i; });
  SKEMA[nama].forEach(function (h) {
    if (!(h in kol)) throw galat_('BELUM_SETUP', 'Kolom "' + h + '" tidak ada di sheet ' + nama + '. Jalankan menu Keuangan › Setup Awal.');
  });
  return { nama: nama, sheet: sheet, header: header, kol: kol, baris: baris, lebar: header.length };
}

/**
 * Baca seluruh sheet sekali. baris[i] berada di baris sheet ke-(i + 2).
 * Baris kosong TIDAK dibuang agar indeks tetap sama dengan nomor baris sheet.
 */
function bacaTabel_(nama) {
  const sheet = ambilSheet_(nama);
  const nilai = sheet.getDataRange().getValues();
  return susunTabel_(nama, sheet, nilai[0] || [], nilai.slice(1));
}

/** Hanya baca header, untuk menambah baris tanpa membaca seluruh data. */
function bacaHeader_(nama) {
  const sheet = ambilSheet_(nama);
  const lebar = Math.max(sheet.getLastColumn(), 1);
  return susunTabel_(nama, sheet, sheet.getRange(1, 1, 1, lebar).getValues()[0], []);
}

/**
 * Susun array baris sesuai urutan header sheet dari objek {namaKolom: nilai}.
 * Teks lama dari `dasar` dibaca tanpa apostrof, jadi dilindungi ulang dengan amanSel_
 * agar tidak berubah menjadi formula/angka/tanggal saat ditulis kembali.
 */
function keBaris_(tabel, obj, dasar) {
  const row = dasar
    ? dasar.map(function (v) { return typeof v === 'string' ? amanSel_(v) : v; })
    : new Array(tabel.lebar).fill('');
  Object.keys(obj).forEach(function (k) {
    if (k in tabel.kol) row[tabel.kol[k]] = obj[k];
  });
  return row;
}

function tambahBaris_(tabel, rows) {
  if (!rows.length) return;
  const awal = tabel.sheet.getLastRow() + 1;
  tabel.sheet.getRange(awal, 1, rows.length, tabel.lebar).setValues(rows);
}

/** Tambah baris dari objek {namaKolom: nilai}; aman walau urutan kolom sheet berbeda. */
function tambahObjek_(tabel, objek) {
  tambahBaris_(tabel, objek.map(function (o) { return keBaris_(tabel, o); }));
}

function tulisBaris_(tabel, idx, row) {
  tabel.sheet.getRange(idx + 2, 1, 1, tabel.lebar).setValues([row]);
}

/** Timpa sebagian kolom satu baris (baris lain tidak tersentuh). */
function timpaObjek_(tabel, idx, obj) {
  tulisBaris_(tabel, idx, keBaris_(tabel, obj, tabel.baris[idx]));
}

/** Ganti seluruh isi data (tanpa header) dalam satu panggilan. Untuk tabel kecil seperti Anggaran. */
function gantiIsiTabel_(tabel, rows) {
  const lama = tabel.baris.length;
  if (rows.length) tabel.sheet.getRange(2, 1, rows.length, tabel.lebar).setValues(rows);
  if (lama > rows.length) {
    tabel.sheet.getRange(2 + rows.length, 1, lama - rows.length, tabel.lebar).clearContent();
  }
}

function tulisSel_(tabel, idx, namaKolom, nilai) {
  tabel.sheet.getRange(idx + 2, tabel.kol[namaKolom] + 1).setValue(nilai);
}

/**
 * Teks dari pengguna diberi awalan apostrof: Sheets menyimpannya sebagai teks apa adanya.
 * Mencegah formula injection (=IMPORTXML...) dan konversi otomatis ("2026-01-02" jadi Date).
 */
function amanSel_(teks) {
  const s = teks === null || teks === undefined ? '' : String(teks);
  return s === '' ? '' : "'" + s;
}

function cariIndeks_(tabel, namaKolom, nilai) {
  const k = tabel.kol[namaKolom];
  return tabel.baris.findIndex(function (r) { return String(r[k]).trim() === nilai; });
}

// ---------- Pemetaan baris -> objek aplikasi ----------

function trxDariBaris_(t, r) {
  const k = t.kol;
  return {
    id: String(r[k.ID]).trim(),
    tanggal: teksTanggal_(r[k.Tanggal]),
    jenis: String(r[k.Jenis]),
    pemilik: String(r[k.Pemilik]),
    kategoriId: String(r[k['Kategori ID']] || ''),
    akunId: String(r[k['Akun ID']] || ''),
    akunTujuanId: String(r[k['Akun Tujuan ID']] || ''),
    nominal: Number(r[k.Nominal]) || 0,
    keterangan: String(r[k.Keterangan] || ''),
    dicatatOleh: String(r[k['Dicatat Oleh']] || ''),
    dibuat: teksWaktu_(r[k.Dibuat]),
    diubah: teksWaktu_(r[k.Diubah]),
    status: String(r[k.Status] || 'Aktif'),
  };
}

function akunDariBaris_(t, r) {
  const k = t.kol;
  return {
    id: String(r[k.ID]).trim(),
    nama: String(r[k.Nama]),
    jenis: String(r[k.Jenis]),
    pemilik: String(r[k.Pemilik]),
    saldoAwal: Number(r[k['Saldo Awal']]) || 0,
    aktif: r[k.Aktif] !== 'Tidak',
    urutan: Number(r[k.Urutan]) || 0,
  };
}

function kategoriDariBaris_(t, r) {
  const k = t.kol;
  return {
    id: String(r[k.ID]).trim(),
    kelompok: String(r[k.Kelompok]),
    nama: String(r[k.Nama]),
    keterangan: String(r[k.Keterangan] || ''),
    aktif: r[k.Aktif] !== 'Tidak',
    urutan: Number(r[k.Urutan]) || 0,
  };
}

function anggaranDariBaris_(t, r) {
  const k = t.kol;
  return {
    bulan: String(r[k.Bulan]).trim().slice(0, 7),
    pemilik: String(r[k.Pemilik]),
    kategoriId: String(r[k['Kategori ID']]),
    nominal: Number(r[k.Nominal]) || 0,
  };
}

function urutkan_(a, b) {
  return a.urutan - b.urutan || a.nama.localeCompare(b.nama);
}

// ---------- Pembaca bercache (dibuang saat versi naik) ----------

function bacaTransaksi_() {
  return denganCache_('trx', function () {
    const t = bacaTabel_(SHEET.TRANSAKSI);
    return t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); })
      .map(function (r) { return trxDariBaris_(t, r); });
  });
}

function bacaAkun_() {
  return denganCache_('akun', function () {
    const t = bacaTabel_(SHEET.AKUN);
    return t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); })
      .map(function (r) { return akunDariBaris_(t, r); }).sort(urutkan_);
  });
}

function bacaKategori_() {
  return denganCache_('kat', function () {
    const t = bacaTabel_(SHEET.KATEGORI);
    return t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); })
      .map(function (r) { return kategoriDariBaris_(t, r); }).sort(urutkan_);
  });
}

function bacaAnggaran_() {
  return denganCache_('agr', function () {
    const t = bacaTabel_(SHEET.ANGGARAN);
    return t.baris.filter(function (r) { return String(r[t.kol.Bulan]).trim(); })
      .map(function (r) { return anggaranDariBaris_(t, r); });
  });
}

/**
 * Daftar pengguna (tanpa hash/salt), sesuai urutan sheet: { nama, gantiPin, peran, aktif }.
 * Data lama tanpa kolom Peran: orang pertama dianggap Pengelola agar selalu ada yang bisa mengelola anggota.
 */
function bacaPengguna_() {
  return denganCache_('user', function () {
    const t = bacaTabel_(SHEET.PENGGUNA);
    const daftar = t.baris.filter(function (r) { return String(r[t.kol.Nama]).trim(); }).map(function (r) {
      return {
        nama: String(r[t.kol.Nama]).trim(),
        gantiPin: r[t.kol['Ganti PIN']] === 'Ya',
        peran: r[t.kol.Peran] === PERAN.PENGELOLA ? PERAN.PENGELOLA : PERAN.ANGGOTA,
        aktif: r[t.kol.Aktif] !== 'Tidak',
      };
    });
    if (daftar.length && !daftar.some(function (p) { return p.peran === PERAN.PENGELOLA; })) daftar[0].peran = PERAN.PENGELOLA;
    return daftar;
  });
}

function bacaPengaturan_() {
  return denganCache_('atur', function () {
    const t = bacaTabel_(SHEET.PENGATURAN);
    const o = {};
    t.baris.forEach(function (r) {
      const k = String(r[t.kol.Kunci]).trim();
      if (k) o[k] = String(r[t.kol.Nilai]);
    });
    return o;
  });
}

function petaId_(daftar) {
  const m = {};
  daftar.forEach(function (x) { m[x.id] = x; });
  return m;
}

/** ID pendek acak dengan awalan, dijamin belum dipakai di daftar `sudah`. */
function buatId_(awalan, panjang, sudah) {
  for (;;) {
    const id = awalan + Utilities.getUuid().replace(/-/g, '').slice(0, panjang).toUpperCase();
    if (!sudah || !sudah[id]) return id;
  }
}

// ---------- Cache berversi ----------

function props_() {
  return PropertiesService.getScriptProperties();
}

function versiCache_(nama) {
  return props_().getProperty('VER_' + nama) || '1';
}

/** Invalidasi: naikkan versi, kunci lama kedaluwarsa sendiri. */
function naikkanVersi_(nama) {
  props_().setProperty('VER_' + nama, String(Number(versiCache_(nama)) + 1));
}

function cacheAmbilJson_(kunci) {
  const cache = CacheService.getScriptCache();
  const jumlah = cache.get(kunci + ':n');
  if (!jumlah) return null;
  const kunciPotongan = [];
  for (let i = 0; i < Number(jumlah); i++) kunciPotongan.push(kunci + ':' + i);
  const potongan = cache.getAll(kunciPotongan);
  let teks = '';
  for (let i = 0; i < kunciPotongan.length; i++) {
    if (potongan[kunciPotongan[i]] === undefined) return null;
    teks += potongan[kunciPotongan[i]];
  }
  return JSON.parse(teks);
}

function cacheSimpanJson_(kunci, obj) {
  const teks = JSON.stringify(obj);
  const isi = {};
  let n = 0;
  for (let i = 0; i < teks.length; i += CACHE_POTONGAN) {
    isi[kunci + ':' + n] = teks.slice(i, i + CACHE_POTONGAN);
    n++;
  }
  isi[kunci + ':n'] = String(n);
  try {
    CacheService.getScriptCache().putAll(isi, CACHE_TTL);
  } catch (e) {
    // Cache hanya percepatan; gagal simpan tidak boleh menggagalkan permintaan.
    console.warn('Gagal menyimpan cache ' + kunci);
  }
}

/** Ambil dari cache berversi, atau hitung dengan fnMuat lalu simpan. */
function denganCache_(nama, fnMuat) {
  const kunci = nama + ':v' + versiCache_(nama);
  const ada = cacheAmbilJson_(kunci);
  if (ada !== null) return ada;
  const baru = fnMuat();
  cacheSimpanJson_(kunci, baru);
  return baru;
}

// ===================================================================== Logika.js

/**
 * Logika.js — fungsi murni (tanpa SpreadsheetApp/CacheService) agar bisa diuji di Tes.js.
 * Uang selalu bilangan bulat rupiah; tanggal teks 'yyyy-MM-dd', bulan 'yyyy-MM'.
 */

const KELOMPOK = Object.freeze(['Penghasilan', 'Pengeluaran', 'Tagihan', 'Hutang', 'Tabungan', 'Investasi']);
const JENIS = Object.freeze({ MASUK: 'Masuk', KELUAR: 'Keluar', TRANSFER: 'Transfer' });
const JENIS_AKUN = Object.freeze(['Tunai', 'Bank', 'E-Wallet']);
const BERSAMA = 'Bersama';
const PERAN = Object.freeze({ PENGELOLA: 'Pengelola', ANGGOTA: 'Anggota' });
const NAMA_TERLARANG = Object.freeze(['bersama', 'gabungan', 'semua']);
const GABUNGAN = 'Gabungan';
const BATAS_NOMINAL = 1000000000000; // 1 triliun: cukup untuk rumah tangga, menangkap salah ketik ekstrem
const PANJANG_KETERANGAN = 200;
const PANJANG_NAMA = 60;

// ---------- Tanggal ----------

function tanggalValid_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function tambahHari_(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bulanValid_(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Geser bulan 'yyyy-MM' sebanyak n (boleh negatif). */
function geserBulan_(bulan, n) {
  const th = Number(bulan.slice(0, 4));
  const bl = Number(bulan.slice(5, 7)) - 1 + n;
  const t = th + Math.floor(bl / 12);
  const b = ((bl % 12) + 12) % 12;
  return t + '-' + String(b + 1).padStart(2, '0');
}

/** Tanggal terakhir bulan 'yyyy-MM'. */
function akhirBulan_(bulan) {
  return tambahHari_(geserBulan_(bulan, 1) + '-01', -1);
}

// ---------- PIN ----------

function validPin_(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

/** PIN yang mudah ditebak: semua digit sama, berurutan naik/turun, atau pola umum. */
function pinLemah_(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const naik = '01234567890', turun = '09876543210';
  if (naik.indexOf(pin) !== -1 || turun.indexOf(pin) !== -1) return true;
  return ['123123', '112233', '121212', '111222', '101010', '102030'].indexOf(pin) !== -1;
}

// ---------- Validasi input ----------

function teksBersih_(v, maks, label) {
  const s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > maks) throw galat_('VALIDASI', label + ' maksimal ' + maks + ' karakter.');
  return s;
}

function tolakFieldAsing_(data, izin) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw galat_('VALIDASI', 'Data tidak valid.');
  Object.keys(data).forEach(function (k) {
    if (izin.indexOf(k) === -1) throw galat_('VALIDASI', 'Field tidak dikenal: ' + k);
  });
}

function nominalValid_(v, bolehNol) {
  const n = Number(v);
  if (typeof v === 'boolean' || v === '' || v === null || !Number.isFinite(n) || Math.floor(n) !== n) return false;
  return (bolehNol ? n >= 0 : n > 0) && n <= BATAS_NOMINAL;
}

/**
 * Validasi & normalisasi input transaksi dari klien.
 * k = { akun: petaId, kategori: petaId, pemilik: [nama...], hariIni, lama: trx lama | null }
 * Akun/kategori nonaktif ditolak, kecuali memang sudah dipakai transaksi lama (mengedit keterangan saja tetap bisa).
 */
function normalisasiTransaksi_(data, k) {
  tolakFieldAsing_(data, ['id', 'tanggal', 'jenis', 'pemilik', 'kategoriId', 'akunId', 'akunTujuanId', 'nominal', 'keterangan']);
  const lama = k.lama || {};
  const jenis = String(data.jenis || '');
  if ([JENIS.MASUK, JENIS.KELUAR, JENIS.TRANSFER].indexOf(jenis) === -1) throw galat_('VALIDASI', 'Jenis transaksi tidak valid.');

  const tanggal = String(data.tanggal || '');
  if (!tanggalValid_(tanggal) || tanggal < '2000-01-01') throw galat_('VALIDASI', 'Tanggal tidak valid.');
  if (tanggal > tambahHari_(k.hariIni, 1)) throw galat_('VALIDASI', 'Tanggal tidak boleh di masa depan.');

  if (!nominalValid_(data.nominal)) throw galat_('VALIDASI', 'Nominal harus angka bulat lebih dari 0.');

  const pemilik = String(data.pemilik || '');
  if (k.pemilik.indexOf(pemilik) === -1) throw galat_('VALIDASI', 'Pemilik tidak valid.');

  const akunBoleh = function (id, label) {
    const a = k.akun[id];
    if (!a) throw galat_('VALIDASI', label + ' belum dipilih.');
    if (!a.aktif && id !== lama.akunId && id !== lama.akunTujuanId) throw galat_('VALIDASI', label + ' ' + a.nama + ' sudah nonaktif.');
    return a;
  };
  const akunId = String(data.akunId || '');
  akunBoleh(akunId, jenis === JENIS.TRANSFER ? 'Akun asal' : 'Akun');

  let kategoriId = '';
  let akunTujuanId = '';
  if (jenis === JENIS.TRANSFER) {
    akunTujuanId = String(data.akunTujuanId || '');
    akunBoleh(akunTujuanId, 'Akun tujuan');
    if (akunTujuanId === akunId) throw galat_('VALIDASI', 'Akun asal dan tujuan tidak boleh sama.');
  } else {
    kategoriId = String(data.kategoriId || '');
    const kat = k.kategori[kategoriId];
    if (!kat) throw galat_('VALIDASI', 'Kategori belum dipilih.');
    if (!kat.aktif && kategoriId !== lama.kategoriId) throw galat_('VALIDASI', 'Kategori ' + kat.nama + ' sudah nonaktif.');
    const harusPenghasilan = jenis === JENIS.MASUK;
    if ((kat.kelompok === 'Penghasilan') !== harusPenghasilan) {
      throw galat_('VALIDASI', harusPenghasilan ? 'Uang masuk harus memakai kategori Penghasilan.' : 'Uang keluar tidak boleh memakai kategori Penghasilan.');
    }
  }

  return {
    tanggal: tanggal,
    jenis: jenis,
    pemilik: pemilik,
    kategoriId: kategoriId,
    akunId: akunId,
    akunTujuanId: akunTujuanId,
    nominal: Number(data.nominal),
    keterangan: teksBersih_(data.keterangan, PANJANG_KETERANGAN, 'Keterangan'),
  };
}

function normalisasiAkun_(data, pemilikBoleh) {
  tolakFieldAsing_(data, ['id', 'nama', 'jenis', 'pemilik', 'saldoAwal', 'aktif', 'urutan']);
  const nama = teksBersih_(data.nama, PANJANG_NAMA, 'Nama akun');
  if (!nama) throw galat_('VALIDASI', 'Nama akun wajib diisi.');
  if (JENIS_AKUN.indexOf(data.jenis) === -1) throw galat_('VALIDASI', 'Jenis akun tidak valid.');
  if (pemilikBoleh.indexOf(data.pemilik) === -1) throw galat_('VALIDASI', 'Pemilik akun tidak valid.');
  const saldo = Number(data.saldoAwal || 0);
  // Saldo awal boleh negatif (mis. kartu kredit) tetapi harus bulat & wajar.
  if (!Number.isFinite(saldo) || Math.floor(saldo) !== saldo || Math.abs(saldo) > BATAS_NOMINAL) {
    throw galat_('VALIDASI', 'Saldo awal harus angka bulat.');
  }
  return { nama: nama, jenis: data.jenis, pemilik: data.pemilik, saldoAwal: saldo, aktif: data.aktif !== false, urutan: Number(data.urutan) || 0 };
}

function normalisasiKategori_(data) {
  tolakFieldAsing_(data, ['id', 'kelompok', 'nama', 'keterangan', 'aktif', 'urutan']);
  const nama = teksBersih_(data.nama, PANJANG_NAMA, 'Nama kategori');
  if (!nama) throw galat_('VALIDASI', 'Nama kategori wajib diisi.');
  if (KELOMPOK.indexOf(data.kelompok) === -1) throw galat_('VALIDASI', 'Kelompok kategori tidak valid.');
  return {
    kelompok: data.kelompok, nama: nama, keterangan: teksBersih_(data.keterangan, PANJANG_KETERANGAN, 'Keterangan'),
    aktif: data.aktif !== false, urutan: Number(data.urutan) || 0,
  };
}

/**
 * Nama anggota baru: 2–30 huruf/angka/spasi/titik/tanda hubung, tidak kembar, bukan kata khusus laporan.
 * Nama dipakai sebagai kunci (kolom Pemilik & Dicatat Oleh), jadi tidak bisa diganti setelah dibuat.
 */
function validNamaAnggota_(nama, daftarNama) {
  const n = String(nama || '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 30) throw galat_('VALIDASI', 'Nama harus 2–30 karakter.');
  if (!/^[\p{L}0-9 .'-]+$/u.test(n)) throw galat_('VALIDASI', 'Nama hanya boleh huruf, angka, spasi, titik, atau tanda hubung.');
  if (NAMA_TERLARANG.indexOf(n.toLowerCase()) !== -1) throw galat_('VALIDASI', 'Nama "' + n + '" dipakai sistem. Pilih nama lain.');
  if (daftarNama.some(function (x) { return x.toLowerCase() === n.toLowerCase(); })) throw galat_('VALIDASI', 'Nama "' + n + '" sudah terdaftar.');
  return n;
}

/** Nama tidak boleh kembar (tanpa beda huruf besar/kecil) dalam satu daftar, kecuali dirinya sendiri. */
function cekNamaUnik_(daftar, nama, idSendiri, cocok) {
  const n = nama.toLowerCase();
  const kembar = daftar.some(function (x) {
    return x.id !== idSendiri && x.nama.toLowerCase() === n && (!cocok || cocok(x));
  });
  if (kembar) throw galat_('VALIDASI', 'Nama "' + nama + '" sudah dipakai.');
}

// ---------- Perhitungan ----------

/** Transaksi masuk laporan pemilik? Gabungan = semua; selain itu harus persis sama. */
function cocokPemilik_(pemilikTrx, filter) {
  return filter === GABUNGAN || pemilikTrx === filter;
}

/** Saldo setiap akun per akhir tanggal `sampai` (inklusif). Hanya transaksi Aktif. */
function hitungSaldo_(akunList, trxList, sampai) {
  const saldo = {};
  akunList.forEach(function (a) { saldo[a.id] = a.saldoAwal; });
  trxList.forEach(function (t) {
    if (t.status !== 'Aktif' || (sampai && t.tanggal > sampai)) return;
    if (t.jenis === JENIS.MASUK) {
      if (t.akunId in saldo) saldo[t.akunId] += t.nominal;
    } else if (t.jenis === JENIS.KELUAR) {
      if (t.akunId in saldo) saldo[t.akunId] -= t.nominal;
    } else if (t.jenis === JENIS.TRANSFER) {
      if (t.akunId in saldo) saldo[t.akunId] -= t.nominal;
      if (t.akunTujuanId in saldo) saldo[t.akunTujuanId] += t.nominal;
    }
  });
  return saldo;
}

/** Transaksi Aktif non-transfer pada bulan & pemilik tertentu. */
function saringBulan_(trxList, bulan, pemilik) {
  return trxList.filter(function (t) {
    return t.status === 'Aktif' && t.jenis !== JENIS.TRANSFER && t.tanggal.slice(0, 7) === bulan && cocokPemilik_(t.pemilik, pemilik);
  });
}

/**
 * Ringkasan satu bulan. Transfer tidak dihitung (hanya menggeser saldo).
 * Tabungan & Investasi dipisah dari pengeluaran, tetapi tetap mengurangi sisa uang.
 */
function ringkasBulan_(trxList, petaKategori, bulan, pemilik) {
  const per = {};
  KELOMPOK.forEach(function (g) { per[g] = 0; });
  let jumlah = 0;
  saringBulan_(trxList, bulan, pemilik).forEach(function (t) {
    const kat = petaKategori[t.kategoriId];
    const g = kat ? kat.kelompok : (t.jenis === JENIS.MASUK ? 'Penghasilan' : 'Pengeluaran');
    per[g] += t.nominal;
    jumlah++;
  });
  const keluar = per.Pengeluaran + per.Tagihan + per.Hutang + per.Tabungan + per.Investasi;
  return {
    penghasilan: per.Penghasilan,
    pengeluaran: per.Pengeluaran + per.Tagihan,
    hutang: per.Hutang,
    tabungan: per.Tabungan + per.Investasi,
    keluar: keluar,
    sisa: per.Penghasilan - keluar,
    perKelompok: per,
    jumlahTransaksi: jumlah,
  };
}

/** Peta kategoriId -> total nominal pada bulan & pemilik. */
function realisasiKategori_(trxList, bulan, pemilik) {
  const m = {};
  saringBulan_(trxList, bulan, pemilik).forEach(function (t) {
    m[t.kategoriId] = (m[t.kategoriId] || 0) + t.nominal;
  });
  return m;
}

/** Peta kategoriId -> anggaran pada bulan & pemilik (Gabungan menjumlahkan semua pemilik). */
function anggaranKategori_(anggaranList, bulan, pemilik) {
  const m = {};
  anggaranList.forEach(function (a) {
    if (a.bulan !== bulan || !cocokPemilik_(a.pemilik, pemilik)) return;
    m[a.kategoriId] = (m[a.kategoriId] || 0) + a.nominal;
  });
  return m;
}

/** aman < 80% <= waspada <= 100% < lewat. Tanpa anggaran: 'tanpa' bila ada realisasi, 'kosong' bila tidak. */
function statusProgres_(realisasi, anggaran) {
  if (!(anggaran > 0)) return realisasi > 0 ? 'tanpa' : 'kosong';
  const p = realisasi / anggaran;
  if (p > 1) return 'lewat';
  if (p >= 0.8) return 'waspada';
  return 'aman';
}

/**
 * Kelompok yang angkanya adalah target (makin tercapai makin baik), bukan batas belanja:
 * penghasilan, setoran tabungan/investasi, dan cicilan hutang sesuai rencana.
 */
const KELOMPOK_TARGET = Object.freeze(['Penghasilan', 'Hutang', 'Tabungan', 'Investasi']);

/**
 * Baris anggaran vs realisasi per kategori. Kategori nonaktif tetap muncul bila punya angka.
 * Kelompok target berstatus 'target' (tanpa warna peringatan); Pengeluaran & Tagihan memakai statusProgres_.
 */
function bandingAnggaran_(kategoriList, petaAnggaran, petaRealisasi) {
  return kategoriList.filter(function (k) {
    return k.aktif || petaAnggaran[k.id] || petaRealisasi[k.id];
  }).map(function (k) {
    const a = petaAnggaran[k.id] || 0;
    const r = petaRealisasi[k.id] || 0;
    return {
      kategoriId: k.id, nama: k.nama, kelompok: k.kelompok, anggaran: a, realisasi: r,
      sisa: a - r, progres: a > 0 ? r / a : null,
      status: KELOMPOK_TARGET.indexOf(k.kelompok) !== -1 ? (a > 0 || r > 0 ? 'target' : 'kosong') : statusProgres_(r, a),
    };
  });
}

/** Selisih nilai kini terhadap bulan lalu; persen null bila bulan lalu 0. */
function selisih_(kini, lalu) {
  return { nilai: kini - lalu, persen: lalu ? (kini - lalu) / Math.abs(lalu) : null };
}

/** Komposisi pengeluaran (Pengeluaran + Tagihan) per kategori, terbesar dulu. */
function komposisiPengeluaran_(petaRealisasi, petaKategori) {
  const baris = [];
  Object.keys(petaRealisasi).forEach(function (id) {
    const k = petaKategori[id];
    if (!k || (k.kelompok !== 'Pengeluaran' && k.kelompok !== 'Tagihan')) return;
    baris.push({ kategoriId: id, nama: k.nama, kelompok: k.kelompok, nominal: petaRealisasi[id] });
  });
  const total = baris.reduce(function (s, b) { return s + b.nominal; }, 0);
  baris.forEach(function (b) { b.porsi = total ? b.nominal / total : 0; });
  return baris.sort(function (a, b) { return b.nominal - a.nominal; });
}

/**
 * Baris anggaran bulan sumber yang belum ada di bulan target (per kategori).
 * Tidak menimpa angka yang sudah diisi di bulan target.
 */
function barisSalinAnggaran_(anggaranList, sumber, target, pemilik) {
  const sudah = {};
  anggaranList.forEach(function (a) {
    if (a.bulan === target && a.pemilik === pemilik) sudah[a.kategoriId] = true;
  });
  return anggaranList.filter(function (a) {
    return a.bulan === sumber && a.pemilik === pemilik && a.nominal > 0 && !sudah[a.kategoriId];
  }).map(function (a) {
    return { bulan: target, pemilik: pemilik, kategoriId: a.kategoriId, nominal: a.nominal };
  });
}

/**
 * Kategori yang paling sering dipakai seseorang (untuk ditaruh paling atas di form Catat).
 * Mengambil transaksi `sejak` tanggal tertentu; hasil: { Masuk: [id...], Keluar: [id...] }.
 */
function kategoriSering_(trxList, nama, sejak, maks) {
  const hitung = { Masuk: {}, Keluar: {} };
  trxList.forEach(function (t) {
    if (t.status !== 'Aktif' || t.dicatatOleh !== nama || t.tanggal < sejak || !hitung[t.jenis]) return;
    hitung[t.jenis][t.kategoriId] = (hitung[t.jenis][t.kategoriId] || 0) + 1;
  });
  const urut = function (m) {
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, maks);
  };
  return { Masuk: urut(hitung.Masuk), Keluar: urut(hitung.Keluar) };
}

// ---------- Bot Telegram: mengurai pesan teks ----------

/** "Rp 1.250.000" tanpa bergantung pada data locale Intl di server. */
function formatRupiah_(n) {
  const x = Math.round(Number(n) || 0);
  return (x < 0 ? '-' : '') + 'Rp ' + String(Math.abs(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Pengali satuan nominal. "m" sengaja tidak dikenali: ambigu (juta/miliar). */
function satuanNominal_(s) {
  return { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 }[String(s || '').toLowerCase()] || 1;
}

/**
 * Ubah satu kandidat angka ("25.000", "1,5", "30") + satuan jadi rupiah bulat, atau null bila tidak masuk akal.
 * Tanpa satuan, titik/koma dianggap pemisah ribuan hanya bila berpola ribuan ("1.250.000"); "25,5" ditolak.
 */
function nilaiNominal_(angka, satuan) {
  const ribuan = /^\d{1,3}([.,]\d{3})+$/.test(angka);
  let n;
  if (ribuan && !(satuan && /^\d{1,3}[.,]\d{3}$/.test(angka) && satuanNominal_(satuan) >= 1e6)) {
    n = Number(angka.replace(/[.,]/g, ''));
  } else if (/^\d+([.,]\d+)?$/.test(angka)) {
    if (!satuan && /[.,]/.test(angka)) return null;
    n = Number(angka.replace(',', '.'));
  } else {
    return null;
  }
  const hasil = Math.round(n * satuanNominal_(satuan));
  return hasil > 0 && hasil <= BATAS_NOMINAL ? hasil : null;
}

/** Kamus kata umum -> nama kategori bawaan. Hanya dipakai bila kategori bernama itu ada. */
function kamusKategoriBot_() {
  return {
    'Makanan & Minuman': ['makan', 'minum', 'kopi', 'jajan', 'nasi', 'sarapan', 'bakso', 'snack', 'cemilan', 'resto', 'warung', 'gofood', 'grabfood', 'belanja dapur', 'sayur'],
    Transportasi: ['bensin', 'bbm', 'pertalite', 'pertamax', 'ojek', 'ojol', 'gojek', 'grab', 'parkir', 'tol', 'angkot', 'kereta', 'krl', 'busway', 'taksi'],
    'Rumah Tangga': ['sabun', 'deterjen', 'galon', 'gas', 'elpiji', 'lpg'],
    Kesehatan: ['obat', 'dokter', 'apotek', 'vitamin', 'klinik', 'rumah sakit'],
    'Tempat Tinggal': ['kos', 'kost', 'sewa', 'kontrakan', 'kpr'],
    Listrik: ['listrik', 'pln', 'token'],
    'Pulsa & Paket Data': ['pulsa', 'kuota', 'paket data', 'internet', 'wifi'],
    'Perawatan Diri': ['salon', 'skincare', 'potong rambut', 'barbershop', 'cukur'],
    'Pakaian & Aksesori': ['baju', 'celana', 'sepatu', 'kaos', 'jaket'],
    Gaji: ['gaji', 'gajian', 'salary'],
    'Bonus & THR': ['bonus', 'thr'],
  };
}

function kataPesan_(teks) {
  return String(teks || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; });
}

/**
 * Urai pesan bebas dari bot menjadi draf transaksi. Fungsi murni.
 * k = { nama, banyakAnggota, kategori[], akun[], riwayat[] (transaksi Aktif yang dicatat orang ini), akunTerakhir }
 * Hasil: { ok:true, jenis, nominal, kategoriId|null, akunId|null, pemilik, keterangan } atau { ok:false, alasan }.
 * Transfer tidak diurai (Fase 2a): dikembalikan dengan alasan TRANSFER agar bot mengarahkan ke aplikasi.
 */
function uraiPesanBot_(teks, k) {
  const asli = String(teks || '').replace(/\s+/g, ' ').trim();
  if (!asli) return { ok: false, alasan: 'KOSONG' };
  const kecil = asli.toLowerCase();
  if (/\b(transfer|tf|pindah dana|tarik tunai)\b/.test(kecil)) return { ok: false, alasan: 'TRANSFER' };

  // 1. Nominal: kumpulkan kandidat, pilih satu.
  const re = /(^|[\s+])((?:rp\.?\s?)?)(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta)?(?![\p{L}\d])/giu;
  const kandidat = [];
  let m;
  while ((m = re.exec(asli))) {
    const n = nilaiNominal_(m[3], m[4]);
    if (n) kandidat.push({ nilai: n, bersatuan: !!(m[4] || m[2]), teks: m[0].slice(m[1].length), awal: m.index + m[1].length });
  }
  let pilih = kandidat;
  if (pilih.length > 1) pilih = kandidat.filter(function (c) { return c.bersatuan; });
  if (pilih.length !== 1) pilih = kandidat.filter(function (c) { return c.nilai >= 1000; });
  if (!kandidat.length) return { ok: false, alasan: 'NOMINAL_TIDAK_ADA' };
  if (pilih.length !== 1) return { ok: false, alasan: 'NOMINAL_GANDA' };
  const nominal = pilih[0];

  let sisa = (asli.slice(0, nominal.awal) + ' ' + asli.slice(nominal.awal + nominal.teks.length)).replace(/\s+/g, ' ').trim();
  const kata = kataPesan_(sisa);
  const ada = function (frasa) { return (' ' + kata.join(' ') + ' ').indexOf(' ' + frasa + ' ') !== -1; };

  // 2. Pemilik: kata "bersama" (hanya bila ada lebih dari satu anggota).
  let pemilik = k.nama;
  if (k.banyakAnggota && ada('bersama')) {
    pemilik = BERSAMA;
    sisa = sisa.replace(/\bbersama\b/i, '');
  }

  // 3. Akun: nama akun disebut, "tunai/cash" = tunai milik sendiri, selain itu akun terakhir / pertama milik sendiri.
  const aktif = k.akun.filter(function (a) { return a.aktif; });
  // Kata umum tidak menandai akun tertentu ("bersama" = pemilik, bukan akun "Bank Bersama").
  const umum = ['tunai', 'bank', 'akun', 'wallet', 'bersama'].concat([k.nama.toLowerCase()]);
  let akun = null;
  aktif.forEach(function (a) {
    if (akun) return;
    const nama = a.nama.toLowerCase();
    const khas = kataPesan_(nama).filter(function (w) { return umum.indexOf(w) === -1; });
    if (kecil.indexOf(nama) !== -1 || khas.some(function (w) { return ada(w); })) akun = a;
  });
  if (akun) {
    kataPesan_(akun.nama).forEach(function (w) { sisa = sisa.replace(new RegExp('\\b' + w + '\\b', 'i'), ''); });
  } else if (ada('tunai') || ada('cash')) {
    akun = aktif.find(function (a) { return a.jenis === 'Tunai' && a.pemilik === k.nama; }) || null;
    sisa = sisa.replace(/\b(tunai|cash)\b/i, '');
  }
  if (!akun) akun = aktif.find(function (a) { return a.id === k.akunTerakhir; }) || aktif.find(function (a) { return a.pemilik === k.nama; }) || aktif[0] || null;

  // 4. Jenis & kategori.
  const tandaMasuk = /^\+/.test(asli) || /\b(masuk|terima|diterima|pemasukan)\b/.test(kecil);
  // Kata penanda jenis tidak perlu masuk keterangan ("bayar"/"beli" tetap, karena bermakna).
  sisa = sisa.replace(/^\+\s*/, '').replace(/\b(masuk|terima|diterima|pemasukan|keluar)\b\s*/i, '');
  const kat = k.kategori.filter(function (x) { return x.aktif; });
  const cocokNama = function (x) {
    const namaKat = x.nama.toLowerCase();
    if (kecil.indexOf(namaKat) !== -1) return 3;
    const kataKat = kataPesan_(namaKat).filter(function (w) { return w.length >= 4; });
    return kataKat.some(function (w) { return kata.some(function (p) { return p.length >= 4 && (w.indexOf(p) === 0 || p.indexOf(w) === 0); }); }) ? 2 : 0;
  };
  let kategori = null;
  let skor = 0;
  kat.forEach(function (x) {
    const s = cocokNama(x);
    if (s > skor) { skor = s; kategori = x; }
  });
  if (!kategori) {
    // Belajar dari keterangan transaksi orang ini sendiri.
    const hitung = {};
    (k.riwayat || []).forEach(function (t) {
      const kataT = kataPesan_(t.keterangan);
      if (kata.some(function (w) { return kataT.indexOf(w) !== -1; })) hitung[t.kategoriId] = (hitung[t.kategoriId] || 0) + 1;
    });
    const terbaik = Object.keys(hitung).sort(function (a, b) { return hitung[b] - hitung[a]; })[0];
    kategori = kat.find(function (x) { return x.id === terbaik; }) || null;
  }
  if (!kategori) {
    const kamus = kamusKategoriBot_();
    Object.keys(kamus).some(function (namaKat) {
      if (!kamus[namaKat].some(ada)) return false;
      kategori = kat.find(function (x) { return x.nama.toLowerCase() === namaKat.toLowerCase(); }) || null;
      return !!kategori;
    });
  }
  let jenis = tandaMasuk ? JENIS.MASUK : JENIS.KELUAR;
  if (kategori && kategori.kelompok === 'Penghasilan') jenis = JENIS.MASUK;
  if (kategori && (kategori.kelompok === 'Penghasilan') !== (jenis === JENIS.MASUK)) kategori = null;

  const keterangan = sisa.replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '').slice(0, PANJANG_KETERANGAN);
  return {
    ok: true, jenis: jenis, nominal: nominal.nilai, kategoriId: kategori ? kategori.id : null,
    akunId: akun ? akun.id : null, pemilik: pemilik, keterangan: keterangan,
  };
}

/** Pisahkan perintah bot: "/hubung 123456" -> { perintah: 'hubung', argumen: '123456' }; teks biasa -> null. */
function uraiPerintahBot_(teks) {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(String(teks || '').trim());
  return m ? { perintah: m[1].toLowerCase(), argumen: (m[2] || '').trim() } : null;
}

// ---------- Impor template lama ----------

/** Tebak pemilik akun dari namanya ("Tunai Sari" -> Sari); selain itu Bersama. */
function tebakPemilikAkun_(nama, daftarNama) {
  const n = nama.toLowerCase();
  const cocok = daftarNama.filter(function (p) { return n.indexOf(p.toLowerCase()) !== -1; });
  return cocok.length === 1 ? cocok[0] : BERSAMA;
}

function tebakJenisAkun_(nama) {
  const n = nama.toLowerCase();
  if (/tunai|cash|dompet/.test(n)) return 'Tunai';
  if (/gopay|ovo|dana\b|shopeepay|linkaja|e-?wallet/.test(n)) return 'E-Wallet';
  return 'Bank';
}

/**
 * Urai sheet Setting template lama (nilai kolom B, C, D) menjadi daftar akun & kategori.
 * Judul bagian ada di kolom B berhuruf kapital (POSISI KAS, PENGHASILAN, ...); isi di kolom C, keterangan di D.
 * Sub-judul ber-emoji di kolom B (mis. "🏠Kebutuhan Pokok") diabaikan.
 */
function uraiSettingLama_(baris) {
  const hasil = { akun: [], kategori: [] };
  let bagian = '';
  baris.forEach(function (r) {
    const b = String(r[0] || '').trim();
    const c = String(r[1] || '').trim();
    const d = String(r[2] || '').trim();
    if (b && b === b.toUpperCase() && /[A-Z]/.test(b)) bagian = b;
    if (!c) return;
    if (bagian === 'POSISI KAS') {
      hasil.akun.push(c);
      return;
    }
    const g = KELOMPOK.find(function (x) { return x.toUpperCase() === bagian; });
    if (g) hasil.kategori.push({ kelompok: g, nama: c, keterangan: d });
  });
  return hasil;
}

// ===================================================================== Auth.js

/**
 * Auth.js — masuk dengan nama + PIN (tanpa akun Google), sesi, ganti PIN.
 * Peran: satu Pengelola (dibuat Setup Awal) yang mengelola anggota; semua anggota setara dalam data.
 * Sesi disimpan di ScriptProperties (bukan CacheService yang maksimal 6 jam) agar HP tetap masuk
 * sampai 30 hari. Kunci properti = hash token, jadi isi properti tidak membocorkan token.
 * JANGAN menulis PIN, hash, salt, atau token ke log.
 */

const SESI_HARI = 30;
const SESI_PERPANJANG_MS = 86400000; // tulis ulang masa berlaku paling sering sehari sekali
const MAKS_GAGAL_MASUK = 5;
const KUNCI_MASUK_DETIK = 900; // 15 menit

/** Daftar nama anggota aktif untuk layar masuk. Publik: hanya nama, tanpa data lain. */
function daftarNama() {
  return jalankan_(null, function () {
    return bacaPengguna_().filter(function (p) { return p.aktif; }).map(function (p) { return p.nama; });
  });
}

function masuk(nama, pin) {
  return jalankan_(null, function () {
    return prosesMasuk_(String(nama || '').trim(), String(pin || ''));
  });
}

function keluar(token) {
  return jalankan_(token, function (sesi) {
    props_().deleteProperty(kunciSesi_(sesi.token));
    return true;
  }, { bolehGantiPin: true });
}

function infoSesi(token) {
  return jalankan_(token, function (sesi) {
    return dataSesi_(sesi);
  }, { bolehGantiPin: true });
}

function gantiPin(token, pinLama, pinBaru) {
  return jalankan_(token, function (sesi) {
    return prosesGantiPin_(sesi, String(pinLama || ''), String(pinBaru || ''));
  }, { bolehGantiPin: true });
}

// ---------- Internal ----------

function prosesMasuk_(nama, pin) {
  const pesanGagal = 'Nama atau PIN salah.';
  if (!nama || nama.length > PANJANG_NAMA || !validPin_(pin)) throw galat_('VALIDASI', pesanGagal);

  const cache = CacheService.getScriptCache();
  const kunciGagal = 'gagal:' + nama.toLowerCase();
  const gagal = Number(cache.get(kunciGagal) || 0);
  if (gagal >= MAKS_GAGAL_MASUK) {
    throw galat_('TERKUNCI', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
  }

  const user = cariPenggunaLengkap_(nama);
  if (!user || !user.aktif || hashPin_(user.salt, pin) !== user.hash) {
    cache.put(kunciGagal, String(gagal + 1), KUNCI_MASUK_DETIK);
    throw galat_('VALIDASI', pesanGagal);
  }
  cache.remove(kunciGagal);

  bersihkanSesiKedaluwarsa_();
  const token = Utilities.getUuid();
  simpanSesi_(token, { n: user.nama, v: versiSesi_(user.nama), e: Date.now() + SESI_HARI * 86400000, t: Date.now() });
  return Object.assign({ token: token }, dataSesi_({ nama: user.nama, gp: user.gantiPin, peran: user.peran }));
}

function prosesGantiPin_(sesi, pinLama, pinBaru) {
  if (!validPin_(pinBaru)) throw galat_('VALIDASI', 'PIN baru harus tepat 6 digit angka.');
  if (pinBaru === pinLama) throw galat_('VALIDASI', 'PIN baru tidak boleh sama dengan PIN lama.');
  if (pinLemah_(pinBaru)) throw galat_('VALIDASI', 'PIN terlalu mudah ditebak (angka sama/berurutan). Pilih PIN lain.');

  const cache = CacheService.getScriptCache();
  const kunciGagal = 'gagal:' + sesi.nama.toLowerCase();
  if (Number(cache.get(kunciGagal) || 0) >= MAKS_GAGAL_MASUK) {
    throw galat_('TERKUNCI', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
  }

  denganKunci_(function () {
    const t = bacaTabel_(SHEET.PENGGUNA);
    const idx = cariIndeks_(t, 'Nama', sesi.nama);
    if (idx === -1) throw galat_('SESI_HABIS', 'Akun tidak ditemukan. Silakan masuk ulang.');
    const row = t.baris[idx];
    if (hashPin_(String(row[t.kol.Salt]), pinLama) !== String(row[t.kol['Hash PIN']])) {
      cache.put(kunciGagal, String(Number(cache.get(kunciGagal) || 0) + 1), KUNCI_MASUK_DETIK);
      throw galat_('VALIDASI', 'PIN lama salah.');
    }
    const salt = Utilities.getUuid();
    timpaObjek_(t, idx, { 'Hash PIN': hashPin_(salt, pinBaru), Salt: salt, 'Ganti PIN': 'Tidak', Diubah: cap_() });
    naikkanVersi_('user');
  });
  cache.remove(kunciGagal);
  return true;
}

/**
 * Tulis PIN baru untuk satu pengguna (Setup, Reset PIN, tambah anggota). Semua sesinya ikut dicabut.
 * peranBaru hanya dipakai saat baris pengguna belum ada.
 */
function aturPin_(nama, pin, wajibGanti, peranBaru) {
  const t = bacaTabel_(SHEET.PENGGUNA);
  const salt = Utilities.getUuid();
  const isi = { Nama: amanSel_(nama), 'Hash PIN': hashPin_(salt, pin), Salt: salt, 'Ganti PIN': wajibGanti ? 'Ya' : 'Tidak', Diubah: amanSel_(cap_()) };
  const idx = cariIndeks_(t, 'Nama', nama);
  if (idx === -1) tambahObjek_(t, [Object.assign(isi, { Peran: peranBaru || PERAN.ANGGOTA, Aktif: 'Ya' })]);
  else timpaObjek_(t, idx, isi);
  cabutSesi_(nama);
}

/** Naikkan versi sesi: semua perangkat orang itu keluar pada permintaan berikutnya. */
function cabutSesi_(nama) {
  props_().setProperty('SESIVER_' + nama, String(Number(versiSesi_(nama)) + 1));
  naikkanVersi_('user');
}

function hashPin_(salt, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** PIN acak 6 digit yang tidak lemah, dari UUID (lebih acak daripada Math.random). */
function buatPinAcak_() {
  for (;;) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    const pin = String(parseInt(hex.slice(0, 12), 16) % 1000000).padStart(6, '0');
    if (!pinLemah_(pin)) return pin;
  }
}

/** Termasuk hash & salt. Hanya untuk masuk/ganti PIN; tidak pernah di-cache. */
function cariPenggunaLengkap_(nama) {
  const t = bacaTabel_(SHEET.PENGGUNA);
  const idx = cariIndeks_(t, 'Nama', nama);
  if (idx === -1) return null;
  const r = t.baris[idx];
  return {
    nama: String(r[t.kol.Nama]).trim(),
    hash: String(r[t.kol['Hash PIN']]),
    salt: String(r[t.kol.Salt]),
    gantiPin: r[t.kol['Ganti PIN']] === 'Ya',
    aktif: r[t.kol.Aktif] !== 'Tidak',
    peran: (bacaPengguna_().find(function (p) { return p.nama === String(r[t.kol.Nama]).trim(); }) || {}).peran,
  };
}

function versiSesi_(nama) {
  return props_().getProperty('SESIVER_' + nama) || '1';
}

function kunciSesi_(token) {
  return 'SESI_' + hashPin_('sesi', token).slice(0, 40);
}

function simpanSesi_(token, isi) {
  props_().setProperty(kunciSesi_(token), JSON.stringify(isi));
}

/** Buang sesi kedaluwarsa agar ScriptProperties (batas 500 KB) tidak menumpuk. */
function bersihkanSesiKedaluwarsa_() {
  const p = props_();
  const semua = p.getProperties();
  const kini = Date.now();
  Object.keys(semua).forEach(function (k) {
    if (k.indexOf('SESI_') !== 0) return;
    try {
      if (JSON.parse(semua[k]).e < kini) p.deleteProperty(k);
    } catch (e) {
      p.deleteProperty(k);
    }
  });
}

/**
 * Validasi token. Nama selalu dari sesi server; versi sesi naik saat Reset PIN
 * sehingga semua perangkat lama otomatis keluar.
 */
function cekSesi_(token, bolehGantiPin) {
  const habis = 'Sesi berakhir. Silakan masuk kembali.';
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) throw galat_('SESI_HABIS', habis);
  const kunci = kunciSesi_(token);
  const mentah = props_().getProperty(kunci);
  if (!mentah) throw galat_('SESI_HABIS', habis);
  const isi = JSON.parse(mentah);
  const user = bacaPengguna_().find(function (p) { return p.nama === isi.n; });
  if (isi.e < Date.now() || !user || !user.aktif || isi.v !== versiSesi_(isi.n)) {
    props_().deleteProperty(kunci);
    throw galat_('SESI_HABIS', habis);
  }
  const sesi = { token: token, nama: user.nama, gp: user.gantiPin, peran: user.peran };
  if (sesi.gp && !bolehGantiPin) throw galat_('WAJIB_GANTI_PIN', 'Anda harus mengganti PIN terlebih dahulu.');
  if (Date.now() - isi.t > SESI_PERPANJANG_MS) {
    simpanSesi_(token, { n: isi.n, v: isi.v, e: Date.now() + SESI_HARI * 86400000, t: Date.now() });
  }
  return sesi;
}

function dataSesi_(sesi) {
  return { nama: sesi.nama, wajibGantiPin: !!sesi.gp, peran: sesi.peran || PERAN.ANGGOTA };
}

// ===================================================================== Anggota.js

/**
 * Anggota.js — Pengelola menambah anggota (PIN sementara), me-reset PIN, dan menonaktifkan anggota.
 * Semua anggota boleh melihat daftar; hanya Pengelola yang boleh mengubah.
 * Anggota tidak pernah dihapus: nama mereka tetap tercatat di transaksi lama.
 */

function daftarAnggota(token) {
  return jalankan_(token, function () {
    return bacaPengguna_().map(function (p) {
      return { nama: p.nama, peran: p.peran, aktif: p.aktif, wajibGantiPin: p.gantiPin };
    });
  });
}

/** data = { nama } -> { nama, pin } ; PIN sementara tampil sekali kepada Pengelola. */
function tambahAnggota(token, data) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    tolakFieldAsing_(data, ['nama']);
    return denganKunci_(function () {
      const nama = validNamaAnggota_(data.nama, bacaPengguna_().map(function (p) { return p.nama; }));
      const pin = buatPinAcak_();
      aturPin_(nama, pin, true, PERAN.ANGGOTA);
      buatAkunTunai_(nama);
      console.log('Anggota ' + nama + ' ditambahkan oleh ' + sesi.nama);
      return { nama: nama, pin: pin };
    });
  });
}

function resetPinAnggota(token, nama) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    return denganKunci_(function () {
      const p = cariAnggota_(nama);
      if (p.nama === sesi.nama) throw galat_('VALIDASI', 'Untuk PIN sendiri, pakai menu Ganti PIN.');
      const pin = buatPinAcak_();
      aturPin_(p.nama, pin, true);
      return { nama: p.nama, pin: pin };
    });
  });
}

function aturAktifAnggota(token, nama, aktif) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    return denganKunci_(function () {
      const p = cariAnggota_(nama);
      if (p.nama === sesi.nama) throw galat_('VALIDASI', 'Pengelola tidak bisa menonaktifkan dirinya sendiri.');
      const t = bacaTabel_(SHEET.PENGGUNA);
      timpaObjek_(t, cariIndeks_(t, 'Nama', p.nama), { Aktif: aktif ? 'Ya' : 'Tidak', Diubah: amanSel_(cap_()) });
      cabutSesi_(p.nama); // nonaktif = semua perangkatnya langsung keluar
      return bacaPengguna_().map(function (x) { return { nama: x.nama, peran: x.peran, aktif: x.aktif, wajibGantiPin: x.gantiPin }; });
    });
  });
}

// ---------- Internal ----------

function pastikanPengelola_(sesi) {
  if (sesi.peran !== PERAN.PENGELOLA) throw galat_('AKSES_DITOLAK', 'Hanya Pengelola yang bisa mengatur anggota.');
}

function cariAnggota_(nama) {
  const p = bacaPengguna_().find(function (x) { return x.nama === String(nama || ''); });
  if (!p) throw galat_('TIDAK_ADA', 'Anggota tidak ditemukan.');
  return p;
}

/** Setiap orang baru langsung punya akun "Tunai <nama>" agar bisa mencatat tanpa menyiapkan akun dulu. */
function buatAkunTunai_(nama) {
  const t = bacaTabel_(SHEET.AKUN);
  const daftar = t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); }).map(function (r) { return akunDariBaris_(t, r); });
  const namaAkun = 'Tunai ' + nama;
  if (daftar.some(function (a) { return a.nama.toLowerCase() === namaAkun.toLowerCase(); })) return;
  tambahObjek_(t, [{
    ID: buatId_('AK-', 6, petaId_(daftar)), Nama: amanSel_(namaAkun), Jenis: 'Tunai', Pemilik: amanSel_(nama), 'Saldo Awal': 0, Aktif: 'Ya',
    Urutan: daftar.reduce(function (m, a) { return Math.max(m, a.urutan); }, 0) + 1,
  }]);
  naikkanVersi_('akun');
}

// ===================================================================== Master.js

/**
 * Master.js — data awal aplikasi, akun, dan kategori.
 */

function muatAwal(token) {
  return jalankan_(token, function (sesi) {
    const hariIni = hariIni_();
    const akun = bacaAkun_();
    const trx = bacaTransaksi_();
    const atur = bacaPengaturan_();
    return {
      sesi: dataSesi_(sesi),
      aplikasi: { nama: atur.NAMA_APLIKASI || 'Keuangan Kita', versi: VERSI, hariIni: hariIni },
      // Nama anggota aktif (untuk input), dan semua nama termasuk nonaktif (untuk filter laporan/riwayat lama).
      pengguna: bacaPengguna_().filter(function (p) { return p.aktif; }).map(function (p) { return p.nama; }),
      pemilik: daftarPemilik_(),
      semuaPemilik: semuaPemilik_(),
      kelompok: KELOMPOK,
      jenisAkun: JENIS_AKUN,
      akun: akun,
      kategori: bacaKategori_(),
      saldo: hitungSaldo_(akun, trx, null),
      sering: kategoriSering_(trx, sesi.nama, tambahHari_(hariIni, -60), 6),
    };
  });
}

function simpanAkun(token, data) {
  return jalankan_(token, function (sesi) {
    return denganKunci_(function () {
      const bersih = normalisasiAkun_(data, daftarPemilik_());
      const t = bacaTabel_(SHEET.AKUN);
      const daftar = t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); }).map(function (r) { return akunDariBaris_(t, r); });
      const id = data.id ? String(data.id) : '';
      cekNamaUnik_(daftar, bersih.nama, id);
      const isi = {
        Nama: amanSel_(bersih.nama), Jenis: bersih.jenis, Pemilik: amanSel_(bersih.pemilik), 'Saldo Awal': bersih.saldoAwal,
        Aktif: bersih.aktif ? 'Ya' : 'Tidak',
      };
      let idAkhir = id;
      if (id) {
        const idx = cariIndeks_(t, 'ID', id);
        if (idx === -1) throw galat_('TIDAK_ADA', 'Akun tidak ditemukan.');
        timpaObjek_(t, idx, isi);
      } else {
        idAkhir = buatId_('AK-', 6, petaId_(daftar));
        isi.ID = idAkhir;
        isi.Urutan = daftar.reduce(function (m, a) { return Math.max(m, a.urutan); }, 0) + 1;
        tambahObjek_(t, [isi]);
      }
      naikkanVersi_('akun');
      console.log('Akun ' + idAkhir + ' disimpan oleh ' + sesi.nama);
      return { id: idAkhir, akun: bacaAkun_() };
    });
  });
}

function simpanKategori(token, data) {
  return jalankan_(token, function (sesi) {
    return denganKunci_(function () {
      const bersih = normalisasiKategori_(data);
      const t = bacaTabel_(SHEET.KATEGORI);
      const daftar = t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); }).map(function (r) { return kategoriDariBaris_(t, r); });
      const id = data.id ? String(data.id) : '';
      cekNamaUnik_(daftar, bersih.nama, id, function (k) { return k.kelompok === bersih.kelompok; });
      const isi = {
        Kelompok: bersih.kelompok, Nama: amanSel_(bersih.nama), Keterangan: amanSel_(bersih.keterangan),
        Aktif: bersih.aktif ? 'Ya' : 'Tidak',
      };
      let idAkhir = id;
      if (id) {
        const idx = cariIndeks_(t, 'ID', id);
        if (idx === -1) throw galat_('TIDAK_ADA', 'Kategori tidak ditemukan.');
        const lama = kategoriDariBaris_(t, t.baris[idx]);
        // Pindah antara Penghasilan dan kelompok lain akan membuat transaksi lama tidak sah (Masuk vs Keluar).
        if ((lama.kelompok === 'Penghasilan') !== (bersih.kelompok === 'Penghasilan') && kategoriDipakai_(id)) {
          throw galat_('VALIDASI', 'Kategori sudah dipakai; tidak bisa dipindah antara Penghasilan dan kelompok pengeluaran.');
        }
        timpaObjek_(t, idx, isi);
      } else {
        idAkhir = buatId_('KT-', 6, petaId_(daftar));
        isi.ID = idAkhir;
        isi.Urutan = daftar.reduce(function (m, k) { return Math.max(m, k.urutan); }, 0) + 1;
        tambahObjek_(t, [isi]);
      }
      naikkanVersi_('kat');
      console.log('Kategori ' + idAkhir + ' disimpan oleh ' + sesi.nama);
      return { id: idAkhir, kategori: bacaKategori_() };
    });
  });
}

// ---------- Internal ----------

/** Pemilik yang sah untuk transaksi/akun/anggaran baru: setiap anggota aktif + Bersama. */
function daftarPemilik_() {
  return bacaPengguna_().filter(function (p) { return p.aktif; }).map(function (p) { return p.nama; }).concat([BERSAMA]);
}

/** Termasuk anggota nonaktif: data lama mereka tetap bisa dilihat di laporan. */
function semuaPemilik_() {
  return bacaPengguna_().map(function (p) { return p.nama; }).concat([BERSAMA]);
}

function kategoriDipakai_(id) {
  return bacaTransaksi_().some(function (t) { return t.kategoriId === id; });
}

// ===================================================================== Transaksi.js

/**
 * Transaksi.js — catat, ubah, batalkan, dan riwayat transaksi.
 * Hanya pencatat yang boleh mengubah/membatalkan; baris tidak pernah dihapus.
 */

function simpanTransaksi(token, data) {
  return jalankan_(token, function (sesi) {
    return prosesSimpanTransaksi_(sesi, data);
  });
}

/** Inti simpan/ubah transaksi; dipakai API aplikasi dan bot Telegram (aturan & validasi sama persis). */
function prosesSimpanTransaksi_(sesi, data) {
  return denganKunci_(function () {
    const t = bacaTabel_(SHEET.TRANSAKSI);
    const id = data && data.id ? String(data.id) : '';
    let idx = -1;
    let lama = null;
    if (id) {
      idx = cariIndeks_(t, 'ID', id);
      if (idx === -1) throw galat_('TIDAK_ADA', 'Transaksi tidak ditemukan.');
      lama = trxDariBaris_(t, t.baris[idx]);
      pastikanMilikSendiri_(lama, sesi);
    }
    const bersih = normalisasiTransaksi_(data, {
      akun: petaId_(bacaAkun_()), kategori: petaId_(bacaKategori_()), pemilik: daftarPemilik_(), hariIni: hariIni_(), lama: lama,
    });
    const isi = {
      Tanggal: amanSel_(bersih.tanggal), Jenis: bersih.jenis, Pemilik: amanSel_(bersih.pemilik),
      'Kategori ID': bersih.kategoriId, 'Akun ID': bersih.akunId, 'Akun Tujuan ID': bersih.akunTujuanId,
      Nominal: bersih.nominal, Keterangan: amanSel_(bersih.keterangan),
    };
    let idAkhir = id;
    if (lama) {
      isi.Diubah = amanSel_(cap_());
      timpaObjek_(t, idx, isi);
    } else {
      const sudah = {};
      t.baris.forEach(function (r) { sudah[String(r[t.kol.ID])] = true; });
      idAkhir = buatId_('TR-', 10, sudah);
      Object.assign(isi, { ID: idAkhir, 'Dicatat Oleh': amanSel_(sesi.nama), Dibuat: amanSel_(cap_()), Diubah: '', Status: 'Aktif' });
      tambahObjek_(t, [isi]);
    }
    naikkanVersi_('trx');
    return hasilTulis_(idAkhir);
  });
}

function batalkanTransaksi(token, id) {
  return jalankan_(token, function (sesi) {
    return prosesBatalkanTransaksi_(sesi, id);
  });
}

function prosesBatalkanTransaksi_(sesi, id) {
  return denganKunci_(function () {
    const t = bacaTabel_(SHEET.TRANSAKSI);
    const idx = cariIndeks_(t, 'ID', String(id || ''));
    if (idx === -1) throw galat_('TIDAK_ADA', 'Transaksi tidak ditemukan.');
    pastikanMilikSendiri_(trxDariBaris_(t, t.baris[idx]), sesi);
    timpaObjek_(t, idx, { Status: 'Batal', Diubah: amanSel_(cap_()) });
    naikkanVersi_('trx');
    return hasilTulis_(String(id));
  });
}

/** Semua transaksi satu bulan (termasuk Batal), terbaru di atas. Penyaringan lain di klien. */
function riwayat(token, filter) {
  return jalankan_(token, function () {
    const f = filter || {};
    const bulan = String(f.bulan || '');
    if (!bulanValid_(bulan)) throw galat_('VALIDASI', 'Bulan tidak valid.');
    return {
      bulan: bulan,
      transaksi: bacaTransaksi_().filter(function (t) { return t.tanggal.slice(0, 7) === bulan; })
        .sort(function (a, b) { return b.tanggal.localeCompare(a.tanggal) || b.dibuat.localeCompare(a.dibuat); }),
    };
  });
}

// ---------- Internal ----------

function pastikanMilikSendiri_(trx, sesi) {
  if (trx.dicatatOleh !== sesi.nama) {
    throw galat_('AKSES_DITOLAK', 'Transaksi ini dicatat oleh ' + (trx.dicatatOleh || 'orang lain') + '; hanya pencatatnya yang boleh mengubah.');
  }
  if (trx.status !== 'Aktif') throw galat_('VALIDASI', 'Transaksi ini sudah dibatalkan.');
}

/** Setelah menulis: kembalikan transaksi tersebut + saldo terbaru agar klien tidak perlu memuat ulang. */
function hasilTulis_(id) {
  const trx = bacaTransaksi_();
  return {
    transaksi: trx.find(function (x) { return x.id === id; }) || null,
    saldo: hitungSaldo_(bacaAkun_(), trx, null),
  };
}

// ===================================================================== Telegram.js

/**
 * Telegram.js — bot Telegram untuk mencatat lewat chat (Fase 2a, teks). Spesifikasi: docs/TELEGRAM.md.
 *
 * Jalur masuk: webhook `doPost` (URL Web App + ?tg=<kunci>). Inti `prosesUpdate_` terpisah dari jalur agar
 * bisa dipakai mode polling. Tidak ada yang tersimpan tanpa konfirmasi tombol.
 * JANGAN menulis token bot, kunci webhook, atau isi pesan ke log.
 */

const TG_DRAF_DETIK = 900; // draf menunggu konfirmasi 15 menit
const TG_KODE_DETIK = 600; // kode /hubung berlaku 10 menit
const TG_UPDATE_DETIK = 21600; // ingat update_id 6 jam (Telegram bisa mengirim ulang update)

// ======================================================================
// Jalur masuk
// ======================================================================

/** Webhook Telegram. Selalu menjawab cepat; galat hanya dicatat ringkas tanpa isi pesan. */
function doPost(e) {
  try {
    const kunci = props_().getProperty('TG_KUNCI');
    if (!kunci || !e || !e.parameter || e.parameter.tg !== kunci || !e.postData) return jawabWebhook_();
    pastikanFileAsli_();
    if (props_().getProperty('TG_KUNCI') !== kunci) return jawabWebhook_(); // salinan file: kunci lama dibuang
    const update = JSON.parse(e.postData.contents);
    try {
      prosesUpdate_(update);
    } catch (err) {
      laporGalatBot_(update, err);
    }
  } catch (err) {
    console.error('Bot Telegram: ' + (err && err.stack ? err.stack : err));
  }
  return jawabWebhook_();
}

/**
 * Jawaban webhook. ContentService selalu dialihkan (302) ke script.googleusercontent.com; Telegram menganggap 302
 * gagal dan terus mengulang pesan yang sama sehingga pesan berikutnya tertahan. HtmlService dijawab langsung 200.
 */
function jawabWebhook_() {
  return HtmlService.createHtmlOutput('ok');
}

/**
 * Galat tak terduga saat memproses pesan: dicatat (tanpa isi pesan) agar terlihat di menu Status Bot Telegram,
 * dan pengirim diberi tahu supaya bot tidak diam begitu saja.
 */
function laporGalatBot_(update, err) {
  const teks = String(err && err.message ? err.message : err).slice(0, 200);
  console.error('Bot Telegram: ' + (err && err.stack ? err.stack : teks));
  props_().setProperty('TG_GALAT', Utilities.formatDate(new Date(), zonaWaktu_(), 'dd-MM-yyyy HH:mm') + ' — ' + teks);
  const m = update && (update.message || (update.callback_query && update.callback_query.message));
  if (!m || !m.chat) return;
  try {
    kirimPesan_(m.chat.id, err && err.bisnis ? err.message
      : 'Maaf, bot gagal memproses pesan ini (' + teks + '). Coba lagi, atau catat lewat aplikasi.');
  } catch (e) { /* Telegram tidak terjangkau */ }
}

/** Satu update Telegram (pesan atau tekan tombol). Dipakai webhook maupun polling. */
function prosesUpdate_(update) {
  if (!update || typeof update.update_id !== 'number') return;
  const cache = CacheService.getScriptCache();
  const kunciU = 'tgu:' + update.update_id;
  if (cache.get(kunciU)) return;
  cache.put(kunciU, '1', TG_UPDATE_DETIK);

  if (update.callback_query) {
    prosesTombol_(update.callback_query);
    return;
  }
  const pesan = update.message;
  if (!pesan || !pesan.chat || !pesan.from || pesan.from.is_bot) return;
  if (pesan.chat.type !== 'private') {
    kirimPesan_(pesan.chat.id, 'Bot ini hanya melayani chat pribadi. Buka chat langsung dengan bot untuk mencatat.');
    return;
  }
  const teks = typeof pesan.text === 'string' ? pesan.text : '';
  const chatId = String(pesan.chat.id);
  const perintah = uraiPerintahBot_(teks);
  if (perintah && perintah.perintah === 'hubung') { perintahHubung_(pesan, perintah.argumen); return; }
  // Tautan mulai t.me/<bot>?start=KODE dari aplikasi: Telegram mengirim "/start KODE" -> langsung hubungkan.
  if (perintah && perintah.perintah === 'start' && /^\d{6}$/.test(perintah.argumen)) { perintahHubung_(pesan, perintah.argumen); return; }

  const anggota = anggotaChat_(chatId);
  if (!anggota) {
    kirimPesan_(chatId, perintah && perintah.perintah === 'start' ? teksSapaanBaru_(pesan.from) : teksBelumTerhubung_());
    return;
  }
  if (!teks) {
    kirimPesan_(chatId, 'Untuk sekarang bot hanya membaca teks. Contoh: 25rb makan siang');
    return;
  }
  if (perintah) { jalankanPerintah_(chatId, anggota, perintah); return; }
  buatDraf_(chatId, anggota, teks);
}

// ======================================================================
// Kirim ke Telegram
// ======================================================================

function panggilTelegram_(metode, data) {
  const token = props_().getProperty('TG_TOKEN');
  if (!token) throw galat_('BELUM_ADA_BOT', 'Bot Telegram belum dihubungkan.');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + metode, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(data || {}), muteHttpExceptions: true,
  });
  let isi = {};
  try { isi = JSON.parse(res.getContentText()); } catch (e) { isi = { ok: false, description: 'respons tidak valid' }; }
  if (!isi.ok) console.warn('Telegram ' + metode + ' gagal: ' + String(isi.description || res.getResponseCode()).slice(0, 120));
  return isi;
}

/** Teks polos (tanpa parse_mode) agar isi dari pengguna tidak pernah ditafsirkan sebagai markup. */
function kirimPesan_(chatId, teks, tombol) {
  const data = { chat_id: chatId, text: teks };
  if (tombol) data.reply_markup = { inline_keyboard: tombol };
  return panggilTelegram_('sendMessage', data);
}

function ubahPesan_(chatId, pesanId, teks, tombol) {
  const data = { chat_id: chatId, message_id: pesanId, text: teks };
  data.reply_markup = { inline_keyboard: tombol || [] };
  return panggilTelegram_('editMessageText', data);
}

// ======================================================================
// Menghubungkan anggota
// ======================================================================

/** API aplikasi: kode 6 digit sekali pakai untuk dikirim ke bot sebagai "/hubung KODE". */
function buatKodeTelegram(token) {
  return jalankan_(token, function (sesi) {
    const bot = props_().getProperty('TG_BOT');
    if (!bot) throw galat_('BELUM_ADA_BOT', 'Bot Telegram belum dipasang. Pemilik file: menu Keuangan › Hubungkan Bot Telegram.');
    const kode = buatPinAcak_();
    CacheService.getScriptCache().put('tgkode:' + kode, JSON.stringify({ n: sesi.nama }), TG_KODE_DETIK);
    return { kode: kode, bot: bot, berlakuMenit: TG_KODE_DETIK / 60 };
  });
}

/** API aplikasi: bot terpasang? chat mana saja milik saya yang terhubung. */
function statusTelegram(token) {
  return jalankan_(token, function (sesi) {
    const bot = props_().getProperty('TG_BOT') || null;
    const hasil = { bot: bot, chat: chatMilik_(sesi.nama).map(function (c) { return { label: c.label, sejak: c.sejak }; }) };
    // Pengelola sering hanya memegang HP (menu Spreadsheet tidak tampil di Sheets seluler): diagnosis ada di aplikasi.
    if (bot && sesi.peran === PERAN.PENGELOLA) hasil.diagnosa = diagnosaBot_();
    return hasil;
  });
}

/** Kondisi webhook menurut Telegram + galat skrip terakhir. Tanpa kunci rahasia & tanpa isi pesan. */
function diagnosaBot_() {
  const p = props_();
  const info = panggilTelegram_('getWebhookInfo', {});
  if (!info.ok) return { tokenSah: false, webhookCocok: false, tertahan: 0, galatTelegram: '', galatSkrip: p.getProperty('TG_GALAT') || '' };
  const r = info.result || {};
  const kunci = p.getProperty('TG_KUNCI');
  return {
    tokenSah: true,
    webhookCocok: !!(r.url && kunci && r.url.indexOf(kunci) !== -1),
    tertahan: r.pending_update_count || 0,
    galatTelegram: r.last_error_message ? String(r.last_error_message).slice(0, 150) + ' (' +
      Utilities.formatDate(new Date(r.last_error_date * 1000), zonaWaktu_(), 'dd-MM-yyyy HH:mm') + ')' : '',
    galatSkrip: p.getProperty('TG_GALAT') || '',
  };
}

/** Pasang ulang webhook ke alamat Web App yang tersimpan & terverifikasi, dengan kunci yang sama (sambungan chat tetap). */
function perbaikiWebhookTelegram(token) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    const p = props_();
    if (!p.getProperty('TG_BOT')) throw galat_('BELUM_ADA_BOT', 'Bot Telegram belum dipasang.');
    const url = p.getProperty('TG_URL');
    if (!url || !urlBisaDiakses_(url)) {
      throw galat_('VALIDASI', 'Alamat Web App tersimpan tidak bisa dijangkau. Dari komputer, jalankan menu ' +
        'Keuangan › Hubungkan Bot Telegram (kosongkan token).');
    }
    const wh = panggilTelegram_('setWebhook', {
      url: url + '?tg=' + p.getProperty('TG_KUNCI'), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false,
    });
    if (!wh.ok) throw galat_('VALIDASI', 'Telegram menolak: ' + String(wh.description || '').slice(0, 120));
    p.deleteProperty('TG_GALAT');
    return diagnosaBot_();
  });
}

function putuskanTelegram(token) {
  return jalankan_(token, function (sesi) {
    chatMilik_(sesi.nama).forEach(function (c) { props_().deleteProperty(c.kunci); });
    return true;
  });
}

function perintahHubung_(pesan, kode) {
  const chatId = String(pesan.chat.id);
  const cache = CacheService.getScriptCache();
  const k = String(kode || '').replace(/\D/g, '');
  const isi = k.length === 6 ? cache.get('tgkode:' + k) : null;
  if (!isi) {
    kirimPesan_(chatId, 'Kode tidak valid atau sudah kedaluwarsa. Buat kode baru di aplikasi: Atur › Telegram › Hubungkan.');
    return;
  }
  cache.remove('tgkode:' + k);
  const nama = JSON.parse(isi).n;
  const user = bacaPengguna_().find(function (p) { return p.nama === nama && p.aktif; });
  if (!user) {
    kirimPesan_(chatId, 'Akun tidak aktif.');
    return;
  }
  const label = [pesan.from.first_name, pesan.from.username ? '@' + pesan.from.username : ''].filter(String).join(' ').slice(0, 60);
  props_().setProperty('TGC_' + chatId, JSON.stringify({ n: nama, v: versiSesi_(nama), label: label, sejak: hariIni_() }));
  kirimPesan_(chatId, 'Terhubung sebagai ' + nama + '.\n\n' + teksBantuan_());
}

/** Anggota pemilik chat ini, atau null bila belum terhubung / nonaktif / PIN sudah di-reset. */
function anggotaChat_(chatId) {
  const kunci = 'TGC_' + chatId;
  const mentah = props_().getProperty(kunci);
  if (!mentah) return null;
  const isi = JSON.parse(mentah);
  const user = bacaPengguna_().find(function (p) { return p.nama === isi.n; });
  if (!user || !user.aktif || isi.v !== versiSesi_(isi.n)) {
    props_().deleteProperty(kunci);
    return null;
  }
  return { nama: user.nama, peran: user.peran };
}

function chatMilik_(nama) {
  const semua = props_().getProperties();
  return Object.keys(semua).filter(function (k) { return k.indexOf('TGC_') === 0; }).map(function (k) {
    try {
      const isi = JSON.parse(semua[k]);
      return isi.n === nama ? { kunci: k, label: isi.label || 'Telegram', sejak: isi.sejak || '' } : null;
    } catch (e) { return null; }
  }).filter(Boolean);
}

// ======================================================================
// Draf transaksi -> konfirmasi -> simpan
// ======================================================================

function konteksUrai_(anggota) {
  const semuaTrx = bacaTransaksi_();
  return {
    nama: anggota.nama,
    banyakAnggota: bacaPengguna_().filter(function (p) { return p.aktif; }).length > 1,
    kategori: bacaKategori_(),
    akun: bacaAkun_(),
    riwayat: semuaTrx.filter(function (t) { return t.status === 'Aktif' && t.dicatatOleh === anggota.nama && t.keterangan; }).slice(-300),
    akunTerakhir: props_().getProperty('TGA_' + anggota.nama) || '',
  };
}

function buatDraf_(chatId, anggota, teks) {
  const hasil = uraiPesanBot_(teks, konteksUrai_(anggota));
  if (!hasil.ok) {
    const pesan = {
      NOMINAL_TIDAK_ADA: 'Nominalnya belum ada. Contoh: 25rb makan siang, atau +7,5jt gaji',
      NOMINAL_GANDA: 'Ada lebih dari satu angka. Kirim satu nominal saja, misalnya: 27rb makan & parkir',
      TRANSFER: 'Transfer antar akun dicatat lewat aplikasi (tombol + › Transfer).',
      KOSONG: teksBantuan_(),
    }[hasil.alasan];
    kirimPesan_(chatId, pesan || teksBantuan_());
    return;
  }
  const draf = {
    n: anggota.nama, jenis: hasil.jenis, nominal: hasil.nominal, kategoriId: hasil.kategoriId, akunId: hasil.akunId,
    pemilik: hasil.pemilik, keterangan: hasil.keterangan, tanggal: hariIni_(),
  };
  simpanDraf_(chatId, draf);
  if (!draf.kategoriId) {
    kirimPesan_(chatId, teksDraf_(draf) + '\n\nPilih kategorinya:', tombolKategori_(draf, false));
    return;
  }
  kirimPesan_(chatId, teksDraf_(draf), tombolDraf_());
}

function simpanDraf_(chatId, draf) {
  CacheService.getScriptCache().put('tgd:' + chatId, JSON.stringify(draf), TG_DRAF_DETIK);
}

function ambilDraf_(chatId) {
  const m = CacheService.getScriptCache().get('tgd:' + chatId);
  return m ? JSON.parse(m) : null;
}

function teksDraf_(d) {
  const kat = petaId_(bacaKategori_())[d.kategoriId];
  const akun = petaId_(bacaAkun_())[d.akunId];
  return [
    (d.jenis === JENIS.MASUK ? 'Uang masuk ' : 'Uang keluar ') + formatRupiah_(d.nominal),
    'Kategori: ' + (kat ? kat.nama : '— belum dipilih —'),
    'Akun: ' + (akun ? akun.nama : '— belum dipilih —'),
    d.pemilik !== d.n ? 'Milik: ' + d.pemilik : '',
    d.keterangan ? 'Keterangan: ' + d.keterangan : '',
  ].filter(String).join('\n');
}

function tombolDraf_() {
  return [
    [{ text: '✔ Simpan', callback_data: 'ok' }],
    [{ text: 'Ganti kategori', callback_data: 'kat' }, { text: 'Ganti akun', callback_data: 'akun' }],
    [{ text: '✖ Batal', callback_data: 'x' }],
  ];
}

/** Kategori sering dipakai dulu; `semua` menampilkan seluruh kategori sesuai jenis. Dua per baris. */
function tombolKategori_(draf, semua) {
  const kat = bacaKategori_().filter(function (k) { return k.aktif && (k.kelompok === 'Penghasilan') === (draf.jenis === JENIS.MASUK); });
  const sering = kategoriSering_(bacaTransaksi_(), draf.n, tambahHari_(hariIni_(), -60), 6)[draf.jenis] || [];
  let daftar = kat;
  if (!semua && sering.length >= 2) daftar = sering.map(function (id) { return kat.find(function (k) { return k.id === id; }); }).filter(Boolean);
  const baris = [];
  for (let i = 0; i < daftar.length; i += 2) {
    baris.push(daftar.slice(i, i + 2).map(function (k) { return { text: k.nama, callback_data: 'k:' + k.id }; }));
  }
  if (daftar.length < kat.length) baris.push([{ text: 'Kategori lain…', callback_data: 'katsemua' }]);
  baris.push([{ text: '✖ Batal', callback_data: 'x' }]);
  return baris;
}

function tombolAkun_() {
  const akun = bacaAkun_().filter(function (a) { return a.aktif; });
  const baris = akun.map(function (a) { return [{ text: a.nama, callback_data: 'a:' + a.id }]; });
  baris.push([{ text: '✖ Batal', callback_data: 'x' }]);
  return baris;
}

function prosesTombol_(cb) {
  const chatId = cb.message && cb.message.chat ? String(cb.message.chat.id) : '';
  const pesanId = cb.message ? cb.message.message_id : null;
  panggilTelegram_('answerCallbackQuery', { callback_query_id: cb.id });
  const anggota = chatId ? anggotaChat_(chatId) : null;
  if (!anggota) return;
  const data = String(cb.data || '');

  if (data === 'btl:ya' || data === 'btl:tidak') { konfirmasiBatal_(chatId, pesanId, anggota, data === 'btl:ya'); return; }

  const draf = ambilDraf_(chatId);
  if (!draf || draf.n !== anggota.nama) {
    ubahPesan_(chatId, pesanId, 'Draf ini sudah kedaluwarsa. Kirim ulang pesannya.');
    return;
  }
  if (data === 'x') {
    CacheService.getScriptCache().remove('tgd:' + chatId);
    ubahPesan_(chatId, pesanId, 'Dibatalkan, tidak ada yang dicatat.');
  } else if (data === 'kat' || data === 'katsemua') {
    ubahPesan_(chatId, pesanId, teksDraf_(draf) + '\n\nPilih kategori:', tombolKategori_(draf, data === 'katsemua'));
  } else if (data === 'akun') {
    ubahPesan_(chatId, pesanId, teksDraf_(draf) + '\n\nPilih akun:', tombolAkun_());
  } else if (data.indexOf('k:') === 0) {
    draf.kategoriId = data.slice(2);
    simpanDraf_(chatId, draf);
    ubahPesan_(chatId, pesanId, teksDraf_(draf), tombolDraf_());
  } else if (data.indexOf('a:') === 0) {
    draf.akunId = data.slice(2);
    simpanDraf_(chatId, draf);
    ubahPesan_(chatId, pesanId, teksDraf_(draf), tombolDraf_());
  } else if (data === 'ok') {
    simpanDrafBot_(chatId, pesanId, anggota, draf);
  }
}

function simpanDrafBot_(chatId, pesanId, anggota, draf) {
  let hasil;
  try {
    hasil = prosesSimpanTransaksi_({ nama: anggota.nama }, {
      tanggal: draf.tanggal, jenis: draf.jenis, pemilik: draf.pemilik, kategoriId: draf.kategoriId, akunId: draf.akunId,
      nominal: draf.nominal, keterangan: draf.keterangan,
    });
  } catch (e) {
    if (!e.bisnis) throw e;
    ubahPesan_(chatId, pesanId, teksDraf_(draf) + '\n\nBelum tersimpan: ' + e.message, tombolDraf_());
    return;
  }
  CacheService.getScriptCache().remove('tgd:' + chatId);
  props_().setProperty('TGA_' + anggota.nama, draf.akunId);
  props_().setProperty('TGT_' + chatId, hasil.transaksi.id);
  ubahPesan_(chatId, pesanId, 'Tersimpan ✔\n' + teksDraf_(draf) + teksSisaAnggaran_(draf));
}

/** "Sisa anggaran Makanan & Minuman: Rp 475.000 (53%)" bila kategori itu dianggarkan bulan ini. */
function teksSisaAnggaran_(draf) {
  if (draf.jenis !== JENIS.KELUAR) return '';
  const bulan = draf.tanggal.slice(0, 7);
  const peta = anggaranKategori_(bacaAnggaran_(), bulan, draf.pemilik);
  const agr = peta[draf.kategoriId];
  if (!agr) return '';
  const real = realisasiKategori_(bacaTransaksi_(), bulan, draf.pemilik)[draf.kategoriId] || 0;
  const kat = petaId_(bacaKategori_())[draf.kategoriId];
  const sisa = agr - real;
  return '\n\n' + (sisa >= 0
    ? 'Sisa anggaran ' + kat.nama + ': ' + formatRupiah_(sisa) + ' (' + Math.round(real / agr * 100) + '% terpakai)'
    : 'Anggaran ' + kat.nama + ' lewat ' + formatRupiah_(-sisa) + '.');
}

// ======================================================================
// Perintah
// ======================================================================

/**
 * Sapaan /start untuk chat yang belum terhubung. Sengaja tanpa link aplikasi: username bot bisa ditemukan
 * siapa saja, jadi alamat Web App tidak dibagikan ke orang asing.
 */
function teksSapaanBaru_(dari) {
  const nama = String((dari && dari.first_name) || '').slice(0, 40);
  const aplikasi = bacaPengaturan_().NAMA_APLIKASI || 'Keuangan Kita';
  return [
    'Halo' + (nama ? ', ' + nama : '') + '! 👋',
    '',
    'Saya bot ' + aplikasi + '. Catat pemasukan & pengeluaran cukup dengan chat, misalnya "25rb makan siang". ' +
      'Semua catatan masuk ke Google Sheets milik keluarga Anda sendiri.',
    '',
    'Untuk mulai, hubungkan chat ini dengan akun Anda:',
    '1. Buka aplikasi ' + aplikasi + ' dan masuk dengan PIN.',
    '2. Pilih Atur › Telegram › Hubungkan.',
    '3. Ketuk "Buka di Telegram" lalu tekan Mulai — chat langsung terhubung.',
    '   Atau kirim di sini: /hubung KODE',
    '',
    'Belum punya akun? Minta Pengelola keuangan keluarga menambahkan Anda sebagai anggota.',
  ].join('\n');
}

function teksBelumTerhubung_() {
  return 'Chat ini belum terhubung.\n\nBuka aplikasi › Atur › Telegram › Hubungkan, lalu ketuk "Buka di Telegram" ' +
    'atau kirim di sini:\n/hubung KODE';
}

function jalankanPerintah_(chatId, anggota, p) {
  if (p.perintah === 'start') {
    kirimPesan_(chatId, 'Halo lagi, ' + anggota.nama + '! Chat ini sudah terhubung.\n\n' +
      'Ketik saja transaksinya, misalnya:\n• 25rb makan siang\n• +7,5jt gaji\n\nPanduan lengkap: /bantuan');
  } else if (p.perintah === 'bantuan' || p.perintah === 'help') {
    kirimPesan_(chatId, teksBantuan_());
  } else if (p.perintah === 'saldo') {
    kirimPesan_(chatId, teksSaldo_());
  } else if (p.perintah === 'bulanini') {
    kirimPesan_(chatId, teksBulanIni_());
  } else if (p.perintah === 'batal') {
    mintaBatal_(chatId, anggota);
  } else if (p.perintah === 'putus') {
    props_().deleteProperty('TGC_' + chatId);
    kirimPesan_(chatId, 'Chat ini sudah diputus. Hubungkan lagi kapan saja lewat aplikasi.');
  } else {
    kirimPesan_(chatId, 'Perintah tidak dikenal.\n\n' + teksBantuan_());
  }
}

function teksBantuan_() {
  return [
    'CARA MENCATAT — ketik seperti chat biasa, satu pesan satu transaksi.',
    '',
    'Uang keluar:',
    '• 25rb makan siang',
    '• bensin 30k gopay',
    '• 150rb listrik bersama',
    '',
    'Uang masuk (awali dengan + atau kata "masuk"):',
    '• +7,5jt gaji',
    '• masuk 500rb bonus',
    '',
    'Penulisan nominal yang dikenali:',
    '25000 · 25.000 · Rp25.000 · 25rb · 25k · 1,5jt',
    '',
    'Tips:',
    '• Sebut nama akun (gopay, tunai, nama bank) agar tercatat di akun itu.',
    '• Tulis "bersama" untuk pengeluaran yang ditanggung bersama.',
    '• Kategori ditebak otomatis; bila ragu, bot menanyakannya.',
    '• Semua catatan dikonfirmasi dulu — tekan ✔ Simpan untuk menyimpan.',
    '• Transfer antar akun dicatat lewat aplikasi.',
    '',
    'Perintah:',
    '/saldo — saldo semua akun',
    '/bulanini — ringkasan bulan ini & anggaran',
    '/batal — batalkan catatan terakhir dari bot',
    '/bantuan — tampilkan panduan ini',
    '/putus — putuskan chat ini',
  ].join('\n');
}

/** Teks profil bot (dipasang otomatis dari menu). Batas Telegram: deskripsi 512, deskripsi singkat 120 karakter. */
function profilBot_() {
  const nama = (bacaPengaturan_().NAMA_APLIKASI || 'Keuangan Kita').slice(0, 40);
  return {
    deskripsi: ('Catat keuangan pribadi & keluarga langsung dari chat. Ketik seperti biasa — "25rb makan siang" atau ' +
      '"+7,5jt gaji" — lalu konfirmasi dengan satu ketukan. Data tersimpan di Google Sheets milik Anda sendiri.\n\n' +
      'Mulai: buka aplikasi ' + nama + ' › Atur › Telegram › Hubungkan, lalu kirim /hubung KODE di sini.').slice(0, 512),
    singkat: ('Catat pemasukan & pengeluaran lewat chat. Data di Google Sheets milik Anda sendiri.').slice(0, 120),
    perintah: [
      { command: 'bantuan', description: 'Cara mencatat & daftar perintah' },
      { command: 'saldo', description: 'Saldo semua akun' },
      { command: 'bulanini', description: 'Ringkasan bulan ini & anggaran' },
      { command: 'batal', description: 'Batalkan catatan terakhir dari bot' },
      { command: 'hubung', description: 'Hubungkan chat: /hubung KODE dari aplikasi' },
      { command: 'putus', description: 'Putuskan chat ini' },
    ],
  };
}

/** Pasang deskripsi, deskripsi singkat, dan menu perintah bot. Gagal di sini tidak menggagalkan pemasangan. */
function pasangProfilBot_() {
  const p = profilBot_();
  panggilTelegram_('setMyDescription', { description: p.deskripsi });
  panggilTelegram_('setMyShortDescription', { short_description: p.singkat });
  panggilTelegram_('setMyCommands', { commands: p.perintah });
}

function teksSaldo_() {
  const akun = bacaAkun_().filter(function (a) { return a.aktif; });
  const saldo = hitungSaldo_(akun, bacaTransaksi_(), null);
  const total = akun.reduce(function (s, a) { return s + saldo[a.id]; }, 0);
  return ['Saldo akun:'].concat(akun.map(function (a) { return '• ' + a.nama + ': ' + formatRupiah_(saldo[a.id]); }))
    .concat(['', 'Total: ' + formatRupiah_(total)]).join('\n');
}

function teksBulanIni_() {
  const bulan = hariIni_().slice(0, 7);
  const trx = bacaTransaksi_();
  const kategori = bacaKategori_();
  const r = ringkasBulan_(trx, petaId_(kategori), bulan, GABUNGAN);
  const baris = bandingAnggaran_(kategori, anggaranKategori_(bacaAnggaran_(), bulan, GABUNGAN), realisasiKategori_(trx, bulan, GABUNGAN))
    .filter(function (b) { return b.status === 'waspada' || b.status === 'lewat'; });
  return [
    'Bulan ini:',
    '• Masuk: ' + formatRupiah_(r.penghasilan),
    '• Terpakai: ' + formatRupiah_(r.pengeluaran + r.hutang),
    '• Ditabung: ' + formatRupiah_(r.tabungan),
    '• Sisa: ' + formatRupiah_(r.sisa),
  ].concat(baris.length ? ['', 'Perlu diperhatikan:'].concat(baris.map(function (b) {
    return '• ' + b.nama + (b.status === 'lewat' ? ' — lewat ' + formatRupiah_(-b.sisa) : ' — ' + Math.round(b.progres * 100) + '% terpakai');
  })) : []).join('\n');
}

function mintaBatal_(chatId, anggota) {
  const id = props_().getProperty('TGT_' + chatId);
  const t = id ? bacaTransaksi_().find(function (x) { return x.id === id; }) : null;
  if (!t || t.status !== 'Aktif' || t.dicatatOleh !== anggota.nama) {
    kirimPesan_(chatId, 'Tidak ada catatan dari bot yang bisa dibatalkan. Transaksi lain dibatalkan lewat aplikasi › Riwayat.');
    return;
  }
  const kat = petaId_(bacaKategori_())[t.kategoriId];
  kirimPesan_(chatId, 'Batalkan catatan ini?\n' + t.jenis + ' ' + formatRupiah_(t.nominal) + (kat ? ' · ' + kat.nama : '') + (t.keterangan ? ' · ' + t.keterangan : ''),
    [[{ text: 'Ya, batalkan', callback_data: 'btl:ya' }, { text: 'Tidak', callback_data: 'btl:tidak' }]]);
}

function konfirmasiBatal_(chatId, pesanId, anggota, ya) {
  if (!ya) { ubahPesan_(chatId, pesanId, 'Tidak jadi dibatalkan.'); return; }
  const id = props_().getProperty('TGT_' + chatId);
  try {
    prosesBatalkanTransaksi_({ nama: anggota.nama }, id);
  } catch (e) {
    if (!e.bisnis) throw e;
    ubahPesan_(chatId, pesanId, 'Gagal membatalkan: ' + e.message);
    return;
  }
  props_().deleteProperty('TGT_' + chatId);
  ubahPesan_(chatId, pesanId, 'Catatan dibatalkan. Riwayatnya tetap tersimpan sebagai "Dibatalkan".');
}

// ======================================================================
// Pemasangan bot (menu Spreadsheet) & pengaman salinan file
// ======================================================================

function hubungkanBotTelegram() {
  const ui = pastikanDariSpreadsheet_();
  pastikanFileAsli_();
  const p = props_();
  const botLama = p.getProperty('TG_BOT');
  const jawab = ui.prompt('Bot Telegram',
    (botLama ? 'Terpasang: @' + botLama + '.\n• Kosongkan lalu OK untuk memeriksa & memperbaiki webhook.\n' +
      '• Tempel token baru untuk mengganti bot.\n• Ketik PUTUS untuk melepas bot.\n\n' : '') +
    'Token dari @BotFather (contoh 123456789:AAE...):', ui.ButtonSet.OK_CANCEL);
  if (jawab.getSelectedButton() !== ui.Button.OK) return;
  const teks = jawab.getResponseText().trim();
  if (botLama && teks.toUpperCase() === 'PUTUS') {
    try { panggilTelegram_('deleteWebhook', { drop_pending_updates: true }); } catch (e) { /* token mungkin sudah dicabut */ }
    hapusBotTelegram_();
    ui.alert('Bot dilepas. Semua chat yang terhubung ikut diputus.');
    return;
  }
  const perbaiki = botLama && teks === '';
  if (!perbaiki && !/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(teks)) {
    ui.alert('Format token tidak dikenali. Salin utuh dari pesan @BotFather.');
    return;
  }
  const url = tentukanUrlWebApp_(ui);
  if (!url) return;

  const tokenLama = p.getProperty('TG_TOKEN');
  if (!perbaiki) p.setProperty('TG_TOKEN', teks);
  const me = panggilTelegram_('getMe', {});
  if (!me.ok) {
    if (!perbaiki) { if (tokenLama) p.setProperty('TG_TOKEN', tokenLama); else p.deleteProperty('TG_TOKEN'); }
    ui.alert(perbaiki ? 'Token tersimpan sudah tidak berlaku (mungkin di-/revoke). Tempel token baru dari @BotFather.'
      : 'Token ditolak Telegram. Periksa lagi token dari @BotFather.');
    return;
  }
  // Perbaikan memakai kunci lama agar sambungan chat anggota tetap berlaku.
  const kunci = (perbaiki && p.getProperty('TG_KUNCI')) || Utilities.getUuid().replace(/-/g, '');
  const wh = panggilTelegram_('setWebhook', {
    url: url + '?tg=' + kunci, allowed_updates: ['message', 'callback_query'], drop_pending_updates: !perbaiki,
  });
  if (!wh.ok) {
    ui.alert('Webhook gagal dipasang: ' + String(wh.description || '').slice(0, 150));
    return;
  }
  p.setProperty('TG_KUNCI', kunci);
  p.setProperty('TG_BOT', me.result.username);
  p.setProperty('TG_URL', url);
  pasangProfilBot_();
  ui.alert(perbaiki ? 'Webhook diperbaiki' : 'Bot Telegram terpasang', 'Bot: @' + me.result.username +
    '\nAlamat Web App terverifikasi bisa menerima pesan.' +
    (perbaiki ? '\n\nCoba kirim /start ke bot. Bila masih diam, buka menu Keuangan › Status Bot Telegram.'
      : '\n\nDeskripsi & menu perintah bot sudah dipasang. Foto profil diatur lewat @BotFather › /setuserpic.' +
        '\n\nSetiap anggota: aplikasi › Atur › Telegram › Hubungkan, lalu ketuk "Buka di Telegram".'), ui.ButtonSet.OK);
}

/**
 * Alamat Web App yang benar-benar menerima kiriman tanpa login. ScriptApp.getService().getUrl() bisa mengembalikan
 * alamat deployment @HEAD (mode uji) yang menolak Telegram dengan 401, jadi setiap kandidat diuji dulu.
 */
function tentukanUrlWebApp_(ui) {
  const kandidat = [props_().getProperty('TG_URL'), ScriptApp.getService().getUrl()]
    .filter(function (u) { return u && /^https:\/\/script\.google\.com\/.+\/exec$/.test(u); });
  for (let i = 0; i < kandidat.length; i++) {
    if (urlBisaDiakses_(kandidat[i])) return kandidat[i];
  }
  const j = ui.prompt('URL Web App',
    'Tempel URL aplikasi web yang sudah diterbitkan (berakhiran /exec):\n' +
    'Editor Apps Script › Terapkan › Kelola deployment › pilih deployment Aplikasi web › salin URL.', ui.ButtonSet.OK_CANCEL);
  if (j.getSelectedButton() !== ui.Button.OK) return null;
  const url = j.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    ui.alert('URL harus berawalan https://script.google.com/ dan berakhiran /exec.');
    return null;
  }
  if (!urlBisaDiakses_(url)) {
    ui.alert('URL itu belum bisa menerima pesan tanpa login.\n\nPastikan deployment berjenis Aplikasi web dengan ' +
      '"Jalankan sebagai: Saya" dan "Yang memiliki akses: Siapa saja", lalu salin URL dari deployment tersebut.');
    return null;
  }
  return url;
}

/** Uji kiriman anonim seperti Telegram: 302 (echo) atau 200 berarti doPost terjangkau; 401/403/404 berarti tidak. */
function urlBisaDiakses_(url) {
  try {
    const kode = UrlFetchApp.fetch(url + '?tg=cek', {
      method: 'post', contentType: 'application/json', payload: '{}', followRedirects: false, muteHttpExceptions: true,
    }).getResponseCode();
    return kode === 302 || kode === 200;
  } catch (e) {
    return false;
  }
}

/** Menu diagnosis: apa kata Telegram tentang webhook bot ini. Kunci rahasia di URL disamarkan. */
function statusBotTelegram() {
  const ui = pastikanDariSpreadsheet_();
  pastikanFileAsli_();
  if (!props_().getProperty('TG_TOKEN')) {
    ui.alert('Bot Telegram belum dipasang. Pakai menu Keuangan › Hubungkan Bot Telegram.');
    return;
  }
  const info = panggilTelegram_('getWebhookInfo', {});
  if (!info.ok) {
    ui.alert('Telegram menolak token tersimpan (mungkin sudah di-/revoke). Pasang ulang lewat Hubungkan Bot Telegram.');
    return;
  }
  const r = info.result || {};
  const tanggal = function (t) { return t ? Utilities.formatDate(new Date(t * 1000), zonaWaktu_(), 'dd-MM-yyyy HH:mm') : '—'; };
  const galat = r.last_error_message ? r.last_error_message + ' (' + tanggal(r.last_error_date) + ')' : 'tidak ada';
  const url = String(r.url || '').replace(/tg=[0-9a-f]+/, 'tg=••••');
  const cocok = r.url && props_().getProperty('TG_KUNCI') && r.url.indexOf(props_().getProperty('TG_KUNCI')) !== -1;
  ui.alert('Status Bot Telegram', [
    'Bot: @' + (props_().getProperty('TG_BOT') || '?'),
    'Webhook: ' + (url || '(belum terpasang)'),
    'Kunci webhook cocok: ' + (cocok ? 'ya' : 'TIDAK — jalankan Hubungkan Bot Telegram (kosongkan token) untuk memperbaiki'),
    'Pesan tertahan di Telegram: ' + (r.pending_update_count || 0),
    'Galat terakhir (Telegram): ' + galat,
    'Galat terakhir (skrip): ' + (props_().getProperty('TG_GALAT') || 'tidak ada'),
    '',
    /401|403|404/.test(galat) ? 'Galat ini berarti alamat Web App salah atau tidak terbuka untuk "Siapa saja". ' +
      'Jalankan Hubungkan Bot Telegram, kosongkan token, lalu tempel URL /exec dari Terapkan › Kelola deployment.'
      : /302/.test(galat) ? 'Galat "302" berasal dari kode versi lama (Telegram menahan pesan). Perbarui kode, terbitkan ' +
        'versi baru deployment, lalu jalankan Hubungkan Bot Telegram (kosongkan token).'
        : '',
  ].join('\n'), ui.ButtonSet.OK);
}

function hapusBotTelegram_() {
  const p = props_();
  ['TG_TOKEN', 'TG_KUNCI', 'TG_BOT', 'TG_GALAT'].forEach(function (k) { p.deleteProperty(k); });
  Object.keys(p.getProperties()).forEach(function (k) {
    if (/^(TGC_|TGT_|TGA_)/.test(k)) p.deleteProperty(k);
  });
}

/**
 * ScriptProperties bisa ikut tersalin saat file dibuat salinannya. Catat ID Spreadsheet pemilik; bila skrip ternyata
 * berjalan di file lain, buang token bot, sambungan chat, dan semua sesi warisan file asal.
 */
function pastikanFileAsli_() {
  const id = SpreadsheetApp.getActive().getId();
  const p = props_();
  const tercatat = p.getProperty('FILE_ID');
  if (tercatat === id) return;
  if (tercatat) {
    hapusBotTelegram_();
    Object.keys(p.getProperties()).forEach(function (k) { if (k.indexOf('SESI_') === 0) p.deleteProperty(k); });
    console.warn('Berjalan di salinan file: token bot & sesi dari file asal dibuang.');
  }
  p.setProperty('FILE_ID', id);
}

// ===================================================================== Laporan.js

/**
 * Laporan.js — laporan bulanan dan anggaran.
 */

function laporanBulanan(token, filter) {
  return jalankan_(token, function () {
    const f = cekFilterBulan_(filter, true);
    const trx = bacaTransaksi_();
    const kategori = bacaKategori_();
    const petaKat = petaId_(kategori);
    const anggaran = bacaAnggaran_();
    const lalu = geserBulan_(f.bulan, -1);

    const realisasi = realisasiKategori_(trx, f.bulan, f.pemilik);
    const ringkasan = ringkasBulan_(trx, petaKat, f.bulan, f.pemilik);
    const ringkasLalu = ringkasBulan_(trx, petaKat, lalu, f.pemilik);

    const akun = bacaAkun_().filter(function (a) { return cocokPemilik_(a.pemilik, f.pemilik); });
    const saldo = hitungSaldo_(akun, trx, akhirBulan_(f.bulan));
    const daftarSaldo = akun
      .filter(function (a) { return a.aktif || saldo[a.id] !== 0; })
      .map(function (a) { return { id: a.id, nama: a.nama, jenis: a.jenis, pemilik: a.pemilik, saldo: saldo[a.id] }; });

    return {
      bulan: f.bulan,
      pemilik: f.pemilik,
      ringkasan: ringkasan,
      lalu: ringkasLalu,
      selisih: {
        penghasilan: selisih_(ringkasan.penghasilan, ringkasLalu.penghasilan),
        pengeluaran: selisih_(ringkasan.pengeluaran, ringkasLalu.pengeluaran),
        hutang: selisih_(ringkasan.hutang, ringkasLalu.hutang),
        tabungan: selisih_(ringkasan.tabungan, ringkasLalu.tabungan),
        sisa: selisih_(ringkasan.sisa, ringkasLalu.sisa),
      },
      anggaran: bandingAnggaran_(kategori, anggaranKategori_(anggaran, f.bulan, f.pemilik), realisasi),
      komposisi: komposisiPengeluaran_(realisasi, petaKat),
      saldo: daftarSaldo,
      totalSaldo: daftarSaldo.reduce(function (s, a) { return s + a.saldo; }, 0),
      sampai: akhirBulan_(f.bulan),
    };
  });
}

function getAnggaran(token, filter) {
  return jalankan_(token, function () {
    const f = cekFilterBulan_(filter, false);
    const semua = bacaAnggaran_();
    const lalu = geserBulan_(f.bulan, -1);
    const nominal = {};
    semua.forEach(function (a) {
      if (a.bulan === f.bulan && a.pemilik === f.pemilik) nominal[a.kategoriId] = a.nominal;
    });
    return {
      bulan: f.bulan,
      pemilik: f.pemilik,
      nominal: nominal,
      realisasi: realisasiKategori_(bacaTransaksi_(), f.bulan, f.pemilik),
      bisaSalin: barisSalinAnggaran_(semua, lalu, f.bulan, f.pemilik).length > 0,
    };
  });
}

/** data = { bulan, pemilik, nominal: { kategoriId: angka } } — hanya kategori yang dikirim yang diubah. */
function simpanAnggaran(token, data) {
  return jalankan_(token, function (sesi) {
    tolakFieldAsing_(data, ['bulan', 'pemilik', 'nominal']);
    const f = cekFilterBulan_(data, false);
    const peta = data.nominal;
    if (!peta || typeof peta !== 'object' || Array.isArray(peta)) throw galat_('VALIDASI', 'Data anggaran tidak valid.');
    const kat = petaId_(bacaKategori_());
    Object.keys(peta).forEach(function (id) {
      if (!kat[id]) throw galat_('VALIDASI', 'Kategori tidak dikenal.');
      if (!nominalValid_(peta[id], true)) throw galat_('VALIDASI', 'Anggaran ' + kat[id].nama + ' harus angka bulat ≥ 0.');
    });
    return denganKunci_(function () {
      const t = bacaTabel_(SHEET.ANGGARAN);
      const k = t.kol;
      const sisa = Object.assign({}, peta);
      const cap = amanSel_(cap_());
      const rows = [];
      t.baris.forEach(function (r) {
        if (!String(r[k.Bulan]).trim()) return; // buang baris kosong sekalian
        const a = anggaranDariBaris_(t, r);
        const row = keBaris_(t, {}, r);
        if (a.bulan === f.bulan && a.pemilik === f.pemilik && a.kategoriId in sisa) {
          const n = Number(sisa[a.kategoriId]);
          delete sisa[a.kategoriId];
          if (n === 0) return; // 0 = hapus anggaran kategori itu
          row[k.Nominal] = n;
          row[k['Diubah Oleh']] = amanSel_(sesi.nama);
          row[k.Diubah] = cap;
        }
        rows.push(row);
      });
      Object.keys(sisa).forEach(function (id) {
        if (Number(sisa[id]) === 0) return;
        rows.push(keBaris_(t, {
          Bulan: amanSel_(f.bulan), Pemilik: amanSel_(f.pemilik), 'Kategori ID': id, Nominal: Number(sisa[id]),
          'Diubah Oleh': amanSel_(sesi.nama), Diubah: cap,
        }));
      });
      gantiIsiTabel_(t, rows);
      naikkanVersi_('agr');
      return true;
    });
  });
}

/** Salin anggaran bulan lalu ke bulan ini untuk kategori yang belum diisi. */
function salinAnggaran(token, filter) {
  return jalankan_(token, function (sesi) {
    const f = cekFilterBulan_(filter, false);
    return denganKunci_(function () {
      const baru = barisSalinAnggaran_(bacaAnggaran_(), geserBulan_(f.bulan, -1), f.bulan, f.pemilik);
      const cap = amanSel_(cap_());
      tambahObjek_(bacaHeader_(SHEET.ANGGARAN), baru.map(function (a) {
        return {
          Bulan: amanSel_(a.bulan), Pemilik: amanSel_(a.pemilik), 'Kategori ID': a.kategoriId, Nominal: a.nominal,
          'Diubah Oleh': amanSel_(sesi.nama), Diubah: cap,
        };
      }));
      naikkanVersi_('agr');
      return { disalin: baru.length };
    });
  });
}

// ---------- Internal ----------

/** Filter {bulan, pemilik}. Laporan boleh "Gabungan"; anggaran selalu milik satu pemilik. */
function cekFilterBulan_(filter, bolehGabungan) {
  const f = filter || {};
  const bulan = String(f.bulan || '');
  const pemilik = String(f.pemilik || '');
  if (!bulanValid_(bulan)) throw galat_('VALIDASI', 'Bulan tidak valid.');
  const boleh = semuaPemilik_().concat(bolehGabungan ? [GABUNGAN] : []);
  if (boleh.indexOf(pemilik) === -1) throw galat_('VALIDASI', 'Pilihan pemilik tidak valid.');
  return { bulan: bulan, pemilik: pemilik };
}

// ===================================================================== Setup.js

/**
 * Setup.js — fungsi menu Spreadsheet: Setup Awal, Impor dari Template Lama, Reset PIN.
 * Semua diawali pastikanDariSpreadsheet_() agar tidak bisa dipicu dari Web App.
 */

/** Kategori bawaan untuk rumah tangga; bebas diubah/dinonaktifkan di menu Atur. */
function kategoriAwal_() {
  return [
    ['Penghasilan', 'Gaji', 'Gaji bulanan'], ['Penghasilan', 'Bonus & THR', ''], ['Penghasilan', 'Sampingan', 'Usaha atau kerja lepas'],
    ['Pengeluaran', 'Makanan & Minuman', 'Belanja bahan makanan, makan di luar, minum, camilan'],
    ['Pengeluaran', 'Tempat Tinggal', 'Sewa rumah, KPR, kos, renovasi kecil'],
    ['Pengeluaran', 'Transportasi', 'Ongkos harian, bensin, parkir, ojek, kendaraan pribadi'],
    ['Pengeluaran', 'Rumah Tangga', 'Alat kebersihan, peralatan rumah, kebutuhan harian rumah'],
    ['Pengeluaran', 'Kesehatan', 'Obat, vitamin, periksa dokter, rawat inap'],
    ['Pengeluaran', 'Pajak', 'PPh, PBB, pajak kendaraan, usaha'],
    ['Pengeluaran', 'Perawatan Diri', 'Salon, skincare, barbershop, kosmetik'],
    ['Pengeluaran', 'Pakaian & Aksesori', 'Baju, sepatu, tas, pakaian kerja atau acara'],
    ['Pengeluaran', 'Biaya Tak Terduga', 'Pengeluaran mendadak, kejadian darurat'],
    ['Pengeluaran', 'Anak & Keluarga', 'Biaya anak, orang tua, keluarga'],
    ['Tagihan', 'Listrik', 'Tagihan PLN'],
    ['Tagihan', 'Pulsa & Paket Data', 'Pulsa reguler & langganan seluler'],
    ['Tagihan', 'BPJS Kesehatan', ''],
    ['Hutang', 'Cicilan Kendaraan', 'Kredit mobil atau motor'],
    ['Tabungan', 'Dana Darurat', 'Kondisi darurat seperti kehilangan pekerjaan, sakit'],
    ['Tabungan', 'Tabungan Tujuan', 'Menabung untuk tujuan tertentu (menikah, rumah, pendidikan)'],
    ['Investasi', 'Logam Mulia', 'Emas batangan atau logam mulia lainnya'],
  ];
}

function setupAwal() {
  const ui = pastikanDariSpreadsheet_();
  let namaPengelola = null;
  // Pemasangan pertama: tanyakan nama orang pertama (Pengelola). Anggota lain ditambahkan Pengelola dari aplikasi.
  if (!adaPengguna_()) {
    const jawab = ui.prompt('Setup Awal', 'Nama Anda (Pengelola aplikasi, 2–30 huruf):', ui.ButtonSet.OK_CANCEL);
    if (jawab.getSelectedButton() !== ui.Button.OK) return;
    try {
      namaPengelola = validNamaAnggota_(jawab.getResponseText(), []);
    } catch (e) {
      ui.alert(e.message);
      return;
    }
  }
  const hasil = denganKunci_(function () { return jalankanSetup_(namaPengelola); });
  const baris = ['Setup selesai (versi ' + VERSI + ').', ''];
  if (hasil.pinBaru.length) {
    baris.push('PIN sementara (catat sekarang, tidak ditampilkan lagi):');
    hasil.pinBaru.forEach(function (p) { baris.push('  ' + p.nama + ': ' + p.pin); });
    baris.push('', 'PIN wajib diganti saat pertama masuk. Anggota lain ditambahkan dari aplikasi: Atur › Anggota.');
  } else {
    baris.push('Pengguna sudah ada; PIN tidak diubah. Pakai menu Reset PIN bila lupa.');
  }
  baris.push('', 'Langkah berikutnya: Deploy › New deployment › Web app (Execute as: Me, Who has access: Anyone).');
  ui.alert('Keuangan', baris.join('\n'), ui.ButtonSet.OK);
}

function adaPengguna_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.PENGGUNA);
  return !!sheet && sheet.getLastRow() > 1;
}

/**
 * Buat/lengkapi sheet & data awal. Aman dijalankan berulang (tidak menimpa data).
 * namaPengelola wajib saat belum ada pengguna sama sekali.
 */
function jalankanSetup_(namaPengelola) {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SKEMA).forEach(function (nama) { siapkanSheet_(ss, nama); });
  // Sheet bawaan file baru ("Sheet1"/"Sheet 1") yang masih kosong hanya mengganggu.
  ss.getSheets().forEach(function (s) {
    if (/^sheet ?1$/i.test(s.getName()) && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  const atur = bacaTabel_(SHEET.PENGATURAN);
  const ada = {};
  atur.baris.forEach(function (r) { ada[String(r[atur.kol.Kunci]).trim()] = true; });
  const aturBaru = [['NAMA_APLIKASI', 'Keuangan Kita'], ['MATA_UANG', 'Rp']]
    .filter(function (x) { return !ada[x[0]]; })
    .map(function (x) { return { Kunci: x[0], Nilai: amanSel_(x[1]) }; });
  tambahObjek_(atur, aturBaru);
  const iVersi = cariIndeks_(bacaTabel_(SHEET.PENGATURAN), 'Kunci', 'VERSI');
  if (iVersi === -1) tambahObjek_(atur, [{ Kunci: 'VERSI', Nilai: amanSel_(VERSI) }]);
  else tulisSel_(bacaTabel_(SHEET.PENGATURAN), iVersi, 'Nilai', amanSel_(VERSI));

  const kat = bacaTabel_(SHEET.KATEGORI);
  if (!kat.baris.some(function (r) { return String(r[kat.kol.ID]).trim(); })) {
    const sudah = {};
    tambahObjek_(kat, kategoriAwal_().map(function (k, i) {
      const id = buatId_('KT-', 6, sudah);
      sudah[id] = true;
      return { ID: id, Kelompok: k[0], Nama: amanSel_(k[1]), Keterangan: amanSel_(k[2]), Aktif: 'Ya', Urutan: i + 1 };
    }));
  }

  lengkapiPengguna_();
  const pinBaru = [];
  const pengguna = bacaTabel_(SHEET.PENGGUNA);
  if (!pengguna.baris.some(function (r) { return String(r[pengguna.kol.Nama]).trim(); })) {
    if (!namaPengelola) throw galat_('VALIDASI', 'Nama Pengelola wajib diisi saat Setup pertama.');
    const pin = buatPinAcak_();
    aturPin_(namaPengelola, pin, true, PERAN.PENGELOLA);
    buatAkunTunai_(namaPengelola);
    pinBaru.push({ nama: namaPengelola, pin: pin });
  }

  ['user', 'akun', 'kat', 'agr', 'trx', 'atur'].forEach(naikkanVersi_);
  return { pinBaru: pinBaru };
}

/**
 * Migrasi data pengguna versi lama (tanpa kolom Peran/Aktif): isi Aktif = Ya,
 * dan jadikan orang pertama Pengelola bila belum ada Pengelola.
 */
function lengkapiPengguna_() {
  const t = bacaTabel_(SHEET.PENGGUNA);
  const k = t.kol;
  const isi = t.baris.filter(function (r) { return String(r[k.Nama]).trim(); });
  if (!isi.length) return;
  const adaPengelola = isi.some(function (r) { return r[k.Peran] === PERAN.PENGELOLA; });
  let berubah = false;
  const rows = t.baris.map(function (r, i) {
    const row = keBaris_(t, {}, r);
    if (!String(r[k.Nama]).trim()) return row;
    if (r[k.Aktif] !== 'Ya' && r[k.Aktif] !== 'Tidak') { row[k.Aktif] = 'Ya'; berubah = true; }
    if (r[k.Peran] !== PERAN.PENGELOLA && r[k.Peran] !== PERAN.ANGGOTA) {
      row[k.Peran] = !adaPengelola && r === isi[0] ? PERAN.PENGELOLA : PERAN.ANGGOTA;
      berubah = true;
    }
    return row;
  });
  if (berubah) gantiIsiTabel_(t, rows);
}

/** Buat sheet bila belum ada; tambahkan kolom SKEMA yang hilang di ujung kanan. */
function siapkanSheet_(ss, nama) {
  let sheet = ss.getSheetByName(nama);
  if (!sheet) sheet = ss.insertSheet(nama);
  const lebar = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lebar).getValues()[0].map(function (h) { return String(h).trim(); });
  const kurang = SKEMA[nama].filter(function (h) { return header.indexOf(h) === -1; });
  if (!kurang.length) return sheet;
  const kosong = header.every(function (h) { return !h; });
  const mulai = kosong ? 1 : header.length + 1;
  sheet.getRange(1, mulai, 1, kurang.length).setValues([kurang]);
  sheet.getRange(1, 1, 1, mulai + kurang.length - 1).setFontWeight('bold').setBackground('#ccfbf1');
  sheet.setFrozenRows(1);
  return sheet;
}

function resetPin() {
  const ui = pastikanDariSpreadsheet_();
  const nama = bacaPengguna_().map(function (p) { return p.nama; });
  const jawab = ui.prompt('Reset PIN', 'Ketik nama pengguna (' + nama.join(' / ') + '):', ui.ButtonSet.OK_CANCEL);
  if (jawab.getSelectedButton() !== ui.Button.OK) return;
  const dipilih = nama.find(function (n) { return n.toLowerCase() === jawab.getResponseText().trim().toLowerCase(); });
  if (!dipilih) {
    ui.alert('Nama tidak ditemukan.');
    return;
  }
  const pin = buatPinAcak_();
  denganKunci_(function () { aturPin_(dipilih, pin, true); });
  ui.alert('Reset PIN', 'PIN sementara ' + dipilih + ': ' + pin + '\n\nSemua perangkat ' + dipilih +
    ' sudah dikeluarkan. PIN wajib diganti saat masuk.', ui.ButtonSet.OK);
}

// ---------- Impor dari template lama ----------

function imporTemplateLama() {
  const ui = pastikanDariSpreadsheet_();
  const h = denganKunci_(imporDariSheetLama_);
  if (!h.sheetDibaca.length) {
    ui.alert('Impor', 'Sheet template lama tidak ditemukan.\n\nBuka file lama, klik kanan tab "⚙️Setting ..." dan "📋Transaksi ..." › ' +
      'Salin ke › Spreadsheet yang ada › pilih file ini, lalu jalankan menu ini lagi.', ui.ButtonSet.OK);
    return;
  }
  ui.alert('Impor selesai', [
    'Sheet dibaca: ' + h.sheetDibaca.join(', '),
    'Akun baru: ' + h.akunBaru,
    'Kategori baru: ' + h.kategoriBaru,
    'Transaksi diimpor: ' + h.transaksi + (h.dilewati ? ' (' + h.dilewati + ' sudah pernah diimpor, dilewati)' : ''),
    '',
    'Anggaran lama tidak diimpor; isi ulang di layar Anggaran (bisa disalin antarbulan).',
    'Setelah dicek, sheet salinan template lama boleh dihapus.',
  ].join('\n'), ui.ButtonSet.OK);
}

/**
 * Baca sheet salinan template lama di file ini (nama berisi "Setting" / "Transaksi <Nama>").
 * Idempoten: ID transaksi impor dibuat dari nama pemilik + nomor baris, jadi impor ulang tidak menggandakan.
 */
function imporDariSheetLama_() {
  const ss = SpreadsheetApp.getActive();
  const pengguna = bacaPengguna_().map(function (p) { return p.nama; });
  const hasil = { sheetDibaca: [], akunBaru: 0, kategoriBaru: 0, transaksi: 0, dilewati: 0 };
  const milikKita = Object.keys(SKEMA);
  const lama = ss.getSheets().filter(function (s) { return milikKita.indexOf(s.getName()) === -1; });

  // 1. Akun & kategori dari sheet Setting.
  const tAkun = bacaTabel_(SHEET.AKUN);
  const tKat = bacaTabel_(SHEET.KATEGORI);
  const akun = tAkun.baris.filter(function (r) { return String(r[tAkun.kol.ID]).trim(); }).map(function (r) { return akunDariBaris_(tAkun, r); });
  const kat = tKat.baris.filter(function (r) { return String(r[tKat.kol.ID]).trim(); }).map(function (r) { return kategoriDariBaris_(tKat, r); });
  const akunBaru = [];
  const katBaru = [];

  const pastikanAkun = function (nama) {
    const n = nama.trim();
    let a = akun.find(function (x) { return x.nama.toLowerCase() === n.toLowerCase(); });
    if (a) return a;
    a = { id: buatId_('AK-', 6, petaId_(akun)), nama: n, jenis: tebakJenisAkun_(n), pemilik: tebakPemilikAkun_(n, pengguna), saldoAwal: 0, aktif: true, urutan: akun.length + 1 };
    akun.push(a);
    akunBaru.push(a);
    return a;
  };
  const pastikanKategori = function (kelompok, nama, keterangan) {
    const n = nama.trim();
    let k = kat.find(function (x) { return x.kelompok === kelompok && x.nama.toLowerCase() === n.toLowerCase(); });
    if (k) return k;
    k = { id: buatId_('KT-', 6, petaId_(kat)), kelompok: kelompok, nama: n, keterangan: keterangan || '', aktif: true, urutan: kat.length + 1 };
    kat.push(k);
    katBaru.push(k);
    return k;
  };

  lama.filter(function (s) { return /setting/i.test(s.getName()); }).forEach(function (s) {
    const n = s.getLastRow();
    if (n < 1) return;
    const urai = uraiSettingLama_(s.getRange(1, 2, n, 3).getValues());
    urai.akun.forEach(pastikanAkun);
    urai.kategori.forEach(function (k) { pastikanKategori(k.kelompok, k.nama, k.keterangan); });
    hasil.sheetDibaca.push(s.getName());
  });

  // 2. Transaksi dari sheet "Transaksi <Nama>".
  const tTrx = bacaTabel_(SHEET.TRANSAKSI);
  const sudah = {};
  tTrx.baris.forEach(function (r) { sudah[String(r[tTrx.kol.ID])] = true; });
  const trxBaru = [];
  lama.filter(function (s) { return /transaksi/i.test(s.getName()); }).forEach(function (s) {
    const pemilik = pengguna.find(function (p) { return s.getName().toLowerCase().indexOf(p.toLowerCase()) !== -1; });
    const n = s.getLastRow();
    if (!pemilik || n < 1) return;
    hasil.sheetDibaca.push(s.getName());
    // Kolom B..J: Tanggal, Kategori, Sub Kategori, (Rp), Masuk, (Rp), Keluar, Posisi Kas, Keterangan.
    const nilai = s.getRange(1, 2, n, 9).getValues();
    const iHeader = nilai.findIndex(function (r) { return String(r[0]).trim().toUpperCase() === 'TANGGAL'; });
    nilai.forEach(function (r, i) {
      if (i <= iHeader) return;
      const tanggal = teksTanggal_(r[0]);
      const masuk = Number(r[4]) || 0;
      const keluarNominal = Number(r[6]) || 0;
      if (!tanggalValid_(tanggal) || (!masuk && !keluarNominal)) return;
      const id = 'TR-IMP-' + pemilik.toUpperCase() + '-' + (i + 1);
      if (sudah[id]) {
        hasil.dilewati++;
        return;
      }
      const jenis = masuk ? JENIS.MASUK : JENIS.KELUAR;
      const kelompokLama = KELOMPOK.find(function (g) { return g.toLowerCase() === String(r[1]).trim().toLowerCase(); });
      const kelompok = jenis === JENIS.MASUK ? 'Penghasilan' : (kelompokLama && kelompokLama !== 'Penghasilan' ? kelompokLama : 'Pengeluaran');
      const k = pastikanKategori(kelompok, String(r[2]).trim() || 'Lain-lain', '');
      const a = pastikanAkun(String(r[7]).trim() || ('Tunai ' + pemilik));
      trxBaru.push({
        ID: id, Tanggal: amanSel_(tanggal), Jenis: jenis, Pemilik: amanSel_(pemilik), 'Kategori ID': k.id, 'Akun ID': a.id,
        'Akun Tujuan ID': '', Nominal: Math.round(masuk || keluarNominal), Keterangan: amanSel_(String(r[8] || '').trim().slice(0, PANJANG_KETERANGAN)),
        'Dicatat Oleh': amanSel_(pemilik), Dibuat: amanSel_(cap_()), Diubah: '', Status: 'Aktif',
      });
      sudah[id] = true;
    });
  });

  tambahObjek_(tAkun, akunBaru.map(function (a) {
    return { ID: a.id, Nama: amanSel_(a.nama), Jenis: a.jenis, Pemilik: amanSel_(a.pemilik), 'Saldo Awal': 0, Aktif: 'Ya', Urutan: a.urutan };
  }));
  tambahObjek_(tKat, katBaru.map(function (k) {
    return { ID: k.id, Kelompok: k.kelompok, Nama: amanSel_(k.nama), Keterangan: amanSel_(k.keterangan), Aktif: 'Ya', Urutan: k.urutan };
  }));
  tambahObjek_(tTrx, trxBaru);
  hasil.akunBaru = akunBaru.length;
  hasil.kategoriBaru = katBaru.length;
  hasil.transaksi = trxBaru.length;
  ['akun', 'kat', 'trx'].forEach(naikkanVersi_);
  return hasil;
}

// ===================================================================== Tes.js

/**
 * Tes.js — tes fungsi murni Logika.js. Jalankan dari menu Keuangan › Jalankan Tes Logika
 * atau `jalankanTes` di editor. Tidak menulis sheet.
 */

function jalankanTes() {
  const hasil = [];
  const uji = function (nama, fn) {
    try {
      fn();
      hasil.push('✔ ' + nama);
    } catch (e) {
      hasil.push('✘ ' + nama + ' — ' + e.message);
    }
  };
  const sama = function (a, b, pesan) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error((pesan || '') + ' diharapkan ' + jb + ', didapat ' + ja);
  };
  const gagalDengan = function (fn, kode) {
    try {
      fn();
    } catch (e) {
      if (e.kode === kode) return;
      throw new Error('kode galat ' + e.kode + ' (' + e.message + '), diharapkan ' + kode);
    }
    throw new Error('seharusnya gagal dengan ' + kode);
  };

  // --- Data contoh ---
  const kat = {
    GJ: { id: 'GJ', kelompok: 'Penghasilan', nama: 'Gaji', aktif: true },
    MK: { id: 'MK', kelompok: 'Pengeluaran', nama: 'Makan', aktif: true },
    LS: { id: 'LS', kelompok: 'Tagihan', nama: 'Listrik', aktif: true },
    HT: { id: 'HT', kelompok: 'Hutang', nama: 'Cicilan', aktif: true },
    TB: { id: 'TB', kelompok: 'Tabungan', nama: 'Nikah', aktif: true },
    LM: { id: 'LM', kelompok: 'Pengeluaran', nama: 'Lama', aktif: false },
  };
  const akunList = [
    { id: 'A1', nama: 'Tunai Budi', pemilik: 'Budi', saldoAwal: 100000, aktif: true },
    { id: 'A2', nama: 'BRI', pemilik: 'Bersama', saldoAwal: 0, aktif: true },
    { id: 'A3', nama: 'Tutup', pemilik: 'Sari', saldoAwal: 0, aktif: false },
  ];
  const akun = {};
  akunList.forEach(function (a) { akun[a.id] = a; });
  const trx = function (o) {
    return Object.assign({ status: 'Aktif', pemilik: 'Budi', akunTujuanId: '', kategoriId: '', dicatatOleh: 'Budi' }, o);
  };
  const daftar = [
    trx({ tanggal: '2026-01-05', jenis: 'Masuk', kategoriId: 'GJ', akunId: 'A2', nominal: 10000000 }),
    trx({ tanggal: '2026-01-06', jenis: 'Keluar', kategoriId: 'MK', akunId: 'A1', nominal: 50000 }),
    trx({ tanggal: '2026-01-07', jenis: 'Keluar', kategoriId: 'LS', akunId: 'A2', nominal: 200000, pemilik: 'Bersama' }),
    trx({ tanggal: '2026-01-08', jenis: 'Keluar', kategoriId: 'TB', akunId: 'A2', nominal: 1000000, pemilik: 'Sari', dicatatOleh: 'Sari' }),
    trx({ tanggal: '2026-01-09', jenis: 'Keluar', kategoriId: 'HT', akunId: 'A2', nominal: 300000 }),
    trx({ tanggal: '2026-01-10', jenis: 'Transfer', akunId: 'A2', akunTujuanId: 'A1', nominal: 500000 }),
    trx({ tanggal: '2026-01-11', jenis: 'Keluar', kategoriId: 'MK', akunId: 'A1', nominal: 999, status: 'Batal' }),
    trx({ tanggal: '2026-02-01', jenis: 'Keluar', kategoriId: 'MK', akunId: 'A1', nominal: 70000 }),
  ];

  // --- Tanggal ---
  uji('tanggalValid_ menolak tanggal mustahil', function () {
    sama([tanggalValid_('2026-02-29'), tanggalValid_('2028-02-29'), tanggalValid_('2026-1-5'), tanggalValid_(20260105)], [false, true, false, false]);
  });
  uji('geserBulan_ melewati batas tahun', function () {
    sama([geserBulan_('2026-01', -1), geserBulan_('2026-12', 1), geserBulan_('2026-03', -15)], ['2025-12', '2027-01', '2024-12']);
  });
  uji('akhirBulan_ termasuk kabisat', function () {
    sama([akhirBulan_('2026-02'), akhirBulan_('2028-02'), akhirBulan_('2026-12')], ['2026-02-28', '2028-02-29', '2026-12-31']);
  });

  // --- PIN ---
  uji('validPin_ tepat 6 digit', function () {
    sama([validPin_('123456'), validPin_('12345'), validPin_('12345a'), validPin_(123456)], [true, false, false, false]);
  });
  uji('pinLemah_ menangkap pola umum', function () {
    sama([pinLemah_('111111'), pinLemah_('345678'), pinLemah_('987654'), pinLemah_('112233'), pinLemah_('482913')], [true, true, true, true, false]);
  });

  // --- Validasi transaksi ---
  const konteks = { akun: akun, kategori: kat, pemilik: ['Budi', 'Sari', 'Bersama'], hariIni: '2026-01-15', lama: null };
  const dasar = { tanggal: '2026-01-15', jenis: 'Keluar', pemilik: 'Budi', kategoriId: 'MK', akunId: 'A1', nominal: 25000, keterangan: '  bakso   ' };
  uji('normalisasiTransaksi_ merapikan keterangan & mengosongkan akun tujuan', function () {
    const b = normalisasiTransaksi_(Object.assign({}, dasar, { akunTujuanId: 'A2' }), konteks);
    sama([b.keterangan, b.akunTujuanId, b.nominal], ['bakso', '', 25000]);
  });
  uji('Transaksi: field asing ditolak', function () {
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { dicatatOleh: 'Sari' }), konteks); }, 'VALIDASI');
  });
  uji('Transaksi: nominal pecahan/nol/negatif/teks ditolak', function () {
    [0, -5, 1.5, 'abc', '', true, NaN, Infinity].forEach(function (n) {
      gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { nominal: n }), konteks); }, 'VALIDASI');
    });
  });
  uji('Transaksi: tanggal besok boleh, lusa ditolak', function () {
    normalisasiTransaksi_(Object.assign({}, dasar, { tanggal: '2026-01-16' }), konteks);
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { tanggal: '2026-01-17' }), konteks); }, 'VALIDASI');
  });
  uji('Transaksi: Masuk wajib kategori Penghasilan, Keluar sebaliknya', function () {
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { jenis: 'Masuk' }), konteks); }, 'VALIDASI');
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { kategoriId: 'GJ' }), konteks); }, 'VALIDASI');
    normalisasiTransaksi_(Object.assign({}, dasar, { jenis: 'Masuk', kategoriId: 'GJ' }), konteks);
  });
  uji('Transaksi: Transfer tanpa kategori, akun berbeda', function () {
    const b = normalisasiTransaksi_(Object.assign({}, dasar, { jenis: 'Transfer', akunTujuanId: 'A2' }), konteks);
    sama([b.kategoriId, b.akunTujuanId], ['', 'A2']);
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { jenis: 'Transfer', akunTujuanId: 'A1' }), konteks); }, 'VALIDASI');
  });
  uji('Transaksi: akun/kategori nonaktif ditolak kecuali milik transaksi lama', function () {
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { akunId: 'A3' }), konteks); }, 'VALIDASI');
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { kategoriId: 'LM' }), konteks); }, 'VALIDASI');
    const k2 = Object.assign({}, konteks, { lama: { akunId: 'A3', kategoriId: 'LM', akunTujuanId: '' } });
    normalisasiTransaksi_(Object.assign({}, dasar, { akunId: 'A3', kategoriId: 'LM' }), k2);
  });
  uji('Transaksi: pemilik di luar daftar ditolak', function () {
    gagalDengan(function () { normalisasiTransaksi_(Object.assign({}, dasar, { pemilik: 'Gabungan' }), konteks); }, 'VALIDASI');
  });

  // --- Saldo & ringkasan ---
  uji('hitungSaldo_: transfer menggeser saldo, batal diabaikan', function () {
    const s = hitungSaldo_(akunList, daftar, '2026-01-31');
    // A1: 100.000 - 50.000 + 500.000 ; A2: 10jt - 200rb - 1jt - 300rb - 500rb
    sama([s.A1, s.A2, s.A3], [550000, 8000000, 0]);
  });
  uji('hitungSaldo_ tanpa batas tanggal ikut bulan berikutnya', function () {
    sama(hitungSaldo_(akunList, daftar, null).A1, 480000);
  });
  uji('ringkasBulan_ Gabungan: transfer tidak dihitung, tabungan terpisah', function () {
    const r = ringkasBulan_(daftar, kat, '2026-01', 'Gabungan');
    sama([r.penghasilan, r.pengeluaran, r.hutang, r.tabungan, r.keluar, r.sisa, r.jumlahTransaksi],
      [10000000, 250000, 300000, 1000000, 1550000, 8450000, 5]);
  });
  uji('ringkasBulan_ per pemilik hanya miliknya', function () {
    const a = ringkasBulan_(daftar, kat, '2026-01', 'Budi');
    const b = ringkasBulan_(daftar, kat, '2026-01', 'Bersama');
    sama([a.penghasilan, a.pengeluaran, a.hutang, a.tabungan, b.pengeluaran], [10000000, 50000, 300000, 0, 200000]);
  });

  // --- Anggaran ---
  const agr = [
    { bulan: '2026-01', pemilik: 'Budi', kategoriId: 'MK', nominal: 40000 },
    { bulan: '2026-01', pemilik: 'Sari', kategoriId: 'MK', nominal: 60000 },
    { bulan: '2026-01', pemilik: 'Budi', kategoriId: 'LS', nominal: 0 },
    { bulan: '2026-02', pemilik: 'Budi', kategoriId: 'MK', nominal: 45000 },
  ];
  uji('anggaranKategori_ Gabungan menjumlahkan semua pemilik', function () {
    sama([anggaranKategori_(agr, '2026-01', 'Gabungan').MK, anggaranKategori_(agr, '2026-01', 'Budi').MK], [100000, 40000]);
  });
  uji('statusProgres_ ambang 80% dan 100%', function () {
    sama([statusProgres_(79, 100), statusProgres_(80, 100), statusProgres_(100, 100), statusProgres_(101, 100), statusProgres_(5, 0), statusProgres_(0, 0)],
      ['aman', 'waspada', 'waspada', 'lewat', 'tanpa', 'kosong']);
  });
  uji('bandingAnggaran_: kelompok target tanpa peringatan, nonaktif tanpa angka disembunyikan', function () {
    const b = bandingAnggaran_([kat.GJ, kat.MK, kat.TB, kat.HT, kat.LS, kat.LM], { GJ: 5000000, MK: 40000, TB: 100 }, { GJ: 10000000, MK: 50000, TB: 100 });
    sama(b.map(function (x) { return x.kategoriId + ':' + x.status; }), ['GJ:target', 'MK:lewat', 'TB:target', 'HT:kosong', 'LS:kosong']);
  });
  uji('barisSalinAnggaran_ tidak menimpa yang sudah diisi', function () {
    const x = barisSalinAnggaran_(agr.concat([{ bulan: '2026-01', pemilik: 'Budi', kategoriId: 'HT', nominal: 300000 }]), '2026-01', '2026-02', 'Budi');
    sama(x.map(function (a) { return a.kategoriId; }), ['HT']); // MK sudah ada di Feb, LS bernilai 0
  });
  uji('selisih_ dan persen', function () {
    sama([selisih_(150, 100), selisih_(50, 0)], [{ nilai: 50, persen: 0.5 }, { nilai: 50, persen: null }]);
  });
  uji('komposisiPengeluaran_ hanya Pengeluaran & Tagihan, terurut', function () {
    const k = komposisiPengeluaran_({ MK: 50000, LS: 200000, TB: 1000000, GJ: 1 }, kat);
    sama(k.map(function (x) { return x.kategoriId; }), ['LS', 'MK']);
    sama(Math.round(k[0].porsi * 100), 80);
  });
  uji('kategoriSering_ per pencatat & jenis', function () {
    const s = kategoriSering_(daftar, 'Budi', '2026-01-01', 3);
    sama([s.Keluar[0], s.Masuk[0], s.Keluar.indexOf('TB')], ['MK', 'GJ', -1]);
  });

  // --- Anggota ---
  uji('validNamaAnggota_: rapikan spasi, tolak kembar/kata sistem/simbol/panjang', function () {
    sama(validNamaAnggota_('  Dewi   Lestari ', ['Budi']), 'Dewi Lestari');
    sama(validNamaAnggota_('Ñoño', []), 'Ñoño');
    ['budi', 'Bersama', 'gabungan', 'X', '=SUM(1)', 'a'.repeat(31)].forEach(function (n) {
      gagalDengan(function () { validNamaAnggota_(n, ['Budi']); }, 'VALIDASI');
    });
  });

  // --- Bot Telegram: pengurai pesan ---
  const katBot = [
    { id: 'MK', kelompok: 'Pengeluaran', nama: 'Makanan & Minuman', aktif: true },
    { id: 'TR', kelompok: 'Pengeluaran', nama: 'Transportasi', aktif: true },
    { id: 'LS', kelompok: 'Tagihan', nama: 'Listrik', aktif: true },
    { id: 'PD', kelompok: 'Tagihan', nama: 'Pulsa & Paket Data', aktif: true },
    { id: 'GJ', kelompok: 'Penghasilan', nama: 'Gaji', aktif: true },
    { id: 'BN', kelompok: 'Penghasilan', nama: 'Bonus & THR', aktif: true },
    { id: 'HB', kelompok: 'Pengeluaran', nama: 'Hobi', aktif: true },
  ];
  const akunBot = [
    { id: 'T1', nama: 'Tunai Budi', jenis: 'Tunai', pemilik: 'Budi', aktif: true },
    { id: 'G1', nama: 'GoPay Budi', jenis: 'E-Wallet', pemilik: 'Budi', aktif: true },
    { id: 'B1', nama: 'Bank Bersama', jenis: 'Bank', pemilik: 'Bersama', aktif: true },
  ];
  const kBot = { nama: 'Budi', banyakAnggota: true, kategori: katBot, akun: akunBot, riwayat: [], akunTerakhir: '' };
  const urai = function (t, tambahan) { return uraiPesanBot_(t, Object.assign({}, kBot, tambahan || {})); };
  const ringkasUrai = function (r) { return r.ok ? [r.jenis, r.nominal, r.kategoriId, r.akunId, r.pemilik, r.keterangan] : r.alasan; };

  uji('nilaiNominal_: satuan, ribuan, desimal', function () {
    sama([nilaiNominal_('25', 'rb'), nilaiNominal_('25.000', ''), nilaiNominal_('1,5', 'jt'), nilaiNominal_('1.5', 'juta'),
      nilaiNominal_('2,5', 'k'), nilaiNominal_('1.250.000', ''), nilaiNominal_('25,5', ''), nilaiNominal_('0', 'rb')],
    [25000, 25000, 1500000, 1500000, 2500, 1250000, null, null]);
  });
  uji('uraiPesanBot_: "25rb makan siang" -> Keluar, Makanan, akun sendiri', function () {
    sama(ringkasUrai(urai('25rb makan siang')), ['Keluar', 25000, 'MK', 'T1', 'Budi', 'makan siang']);
  });
  uji('uraiPesanBot_: akun disebut & kamus kategori ("bensin 30k gopay")', function () {
    sama(ringkasUrai(urai('bensin 30k gopay')), ['Keluar', 30000, 'TR', 'G1', 'Budi', 'bensin']);
  });
  uji('uraiPesanBot_: uang masuk dengan "+" dan desimal juta', function () {
    sama(ringkasUrai(urai('+7,5jt gaji')), ['Masuk', 7500000, 'GJ', 'T1', 'Budi', 'gaji']);
    sama(ringkasUrai(urai('masuk 500rb bonus')).slice(0, 3), ['Masuk', 500000, 'BN']);
  });
  uji('uraiPesanBot_: "bersama" = pemilik, bukan akun Bank Bersama', function () {
    sama(ringkasUrai(urai('Rp1.250.000 listrik bersama')), ['Keluar', 1250000, 'LS', 'T1', 'Bersama', 'listrik']);
    sama(urai('50rb listrik bersama', { banyakAnggota: false }).pemilik, 'Budi', 'sendirian: bersama diabaikan');
  });
  uji('uraiPesanBot_: memilih nominal bersatuan/terbesar, tolak ganda & kosong', function () {
    sama(urai('beli 2 kopi 30rb').nominal, 30000);
    sama(urai('makan 25000 parkir 2000').alasan, 'NOMINAL_GANDA');
    sama(urai('makan siang').alasan, 'NOMINAL_TIDAK_ADA');
    sama(urai('tf 100rb ke gopay').alasan, 'TRANSFER');
  });
  uji('uraiPesanBot_: belajar dari keterangan lama & kategori tak dikenal = null', function () {
    const riwayat = [{ keterangan: 'futsal mingguan', kategoriId: 'HB' }];
    sama(urai('40rb futsal', { riwayat: riwayat }).kategoriId, 'HB');
    sama(urai('40rb futsal').kategoriId, null);
    sama(urai('40rb futsal', { akunTerakhir: 'G1' }).akunId, 'G1', 'akun terakhir dipakai');
  });
  uji('uraiPerintahBot_', function () {
    sama([uraiPerintahBot_('/hubung 482913'), uraiPerintahBot_('/saldo@KeuanganBot'), uraiPerintahBot_('25rb kopi')],
      [{ perintah: 'hubung', argumen: '482913' }, { perintah: 'saldo', argumen: '' }, null]);
  });

  // --- Impor ---
  uji('uraiSettingLama_ membaca akun & kategori, abaikan sub-judul', function () {
    const u = uraiSettingLama_([
      ['POSISI KAS', '', ''], ['', 'Tunai Sari', ''], ['', 'TabunganBudi', ''],
      ['LIST', '', ''], ['', 'Penghasilan', ''],
      ['PENGELUARAN', '', ''], ['🏠Kebutuhan Pokok (Living Essentials)', '', ''], ['', 'Makan', 'Belanja'],
      ['TABUNGAN', '', ''], ['', 'Dana Darurat', 'Darurat'],
    ]);
    sama(u.akun, ['Tunai Sari', 'TabunganBudi']);
    sama(u.kategori.map(function (k) { return k.kelompok + '/' + k.nama; }), ['Pengeluaran/Makan', 'Tabungan/Dana Darurat']);
  });
  uji('tebak pemilik & jenis akun', function () {
    const p = ['Budi', 'Sari'];
    sama([tebakPemilikAkun_('TabunganSari', p), tebakPemilikAkun_('Bank Bersama', p), tebakJenisAkun_('Tunai Budi'), tebakJenisAkun_('GoPay'), tebakJenisAkun_('Bank BRI')],
      ['Sari', 'Bersama', 'Tunai', 'E-Wallet', 'Bank']);
  });

  const gagal = hasil.filter(function (h) { return h.indexOf('✘') === 0; }).length;
  const ringkas = (hasil.length - gagal) + '/' + hasil.length + ' lulus';
  console.log(hasil.join('\n') + '\n' + ringkas);
  try {
    SpreadsheetApp.getUi().alert('Tes Logika', ringkas + (gagal ? '\n\n' + hasil.filter(function (h) { return h.indexOf('✘') === 0; }).join('\n') : ''), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Dijalankan dari editor/emulator: cukup log.
  }
  return { lulus: hasil.length - gagal, gagal: gagal, detail: hasil };
}
