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
