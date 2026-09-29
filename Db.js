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
