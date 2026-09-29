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
