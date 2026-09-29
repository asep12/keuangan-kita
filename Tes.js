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
