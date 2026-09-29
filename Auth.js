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
