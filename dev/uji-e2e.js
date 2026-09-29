/**
 * dev/uji-e2e.js — uji ujung-ke-ujung backend Fase 1 memakai emulator.
 * Jalankan: node dev/uji-e2e.js
 */
const { buatProyek } = require('./emulator');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try {
    fn();
    lulus++;
    console.log('✔ ' + nama);
  } catch (e) {
    gagal.push(nama);
    console.log('✘ ' + nama + '\n    ' + e.message);
  }
}
function pastikan(kondisi, pesan) { if (!kondisi) throw new Error(pesan); }
function sama(a, b, pesan) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((pesan || '') + ' dapat ' + JSON.stringify(a) + ', harap ' + JSON.stringify(b));
}

const P = buatProyek({ diam: true });
const api = (nama, ...args) => P.panggilKlien(nama, args);
const ok = (res, pesan) => { pastikan(res && res.ok, (pesan || 'harus ok') + ': ' + JSON.stringify(res)); return res.data; };
const galat = (res, kode) => { pastikan(res && !res.ok && res.kode === kode, 'harap kode ' + kode + ', dapat ' + JSON.stringify(res)); return res; };
const barisData = (nama) => P.sheet(nama).getDataRange().getValues().slice(1).filter((r) => r.some((v) => v !== ''));
const kolom = (nama, kol) => P.sheet(nama).getRange(1, 1, 1, P.sheet(nama).getLastColumn()).getValues()[0].indexOf(kol);

const hariIni = P.jalankan('hariIni_()');
const bulan = hariIni.slice(0, 7);
const bulanDepan = P.jalankan(`geserBulan_('${bulan}', 1)`);
const bulanLalu = P.jalankan(`geserBulan_('${bulan}', -1)`);
const pin = {};
const tok = {};
let awal; // muatAwal Budi
const katNama = (n) => awal.kategori.find((k) => k.nama === n).id;
const akunNama = (n) => awal.akun.find((a) => a.nama === n).id;

// ---------------------------------------------------------------- Setup & auth
uji('Setup Awal tanpa nama Pengelola ditolak', () => {
  let gagal = false;
  try { P.jalankan('denganKunci_(function () { return jalankanSetup_(null); })'); } catch (e) { gagal = /Pengelola/.test(e.message); }
  pastikan(gagal, 'harus minta nama Pengelola');
});

uji('Setup Awal membuat semua sheet, master bawaan, dan satu Pengelola ber-PIN sementara', () => {
  const h = P.jalankan("denganKunci_(function () { return jalankanSetup_('Budi'); })");
  sama(h.pinBaru.map((p) => p.nama), ['Budi']);
  h.pinBaru.forEach((p) => { pastikan(/^\d{6}$/.test(p.pin), 'PIN 6 digit'); pin[p.nama] = p.pin; });
  ['Transaksi', 'Akun', 'Kategori', 'Anggaran', 'Pengguna', 'Pengaturan'].forEach((n) => pastikan(P.sheet(n), 'sheet ' + n));
  pastikan(!P.sheet('Sheet1'), 'Sheet1 kosong dihapus');
  pastikan(barisData('Kategori').length >= 15, 'kategori bawaan');
  sama(barisData('Akun').length, 1, 'akun Tunai Budi');
  const u = barisData('Pengguna');
  sama([u[0][kolom('Pengguna', 'Peran')], u[0][kolom('Pengguna', 'Aktif')]], ['Pengelola', 'Ya']);
  pastikan(u.every((r) => r[kolom('Pengguna', 'Hash PIN')] !== pin.Budi && r[kolom('Pengguna', 'Ganti PIN')] === 'Ya'), 'PIN tidak disimpan polos');
});

uji('Setup Awal aman dijalankan ulang', () => {
  const nKat = barisData('Kategori').length;
  const h = P.jalankan('denganKunci_(function () { return jalankanSetup_(null); })');
  sama(h.pinBaru, []);
  sama(barisData('Kategori').length, nKat);
  sama(barisData('Pengguna').length, 1);
});

uji('Setup Awal menambah kolom yang hilang (migrasi)', () => {
  P.sheet('Transaksi').getRange(1, kolom('Transaksi', 'Status') + 1).setValue('');
  P.jalankan('denganKunci_(function () { return jalankanSetup_(null); })');
  pastikan(kolom('Transaksi', 'Status') !== -1, 'kolom Status kembali');
});

uji('Fungsi menu & internal tidak bisa dipakai dari Web App', () => {
  let ditolak = 0;
  ['setupAwal', 'resetPin', 'imporTemplateLama'].forEach((f) => { try { api(f); } catch (e) { ditolak++; } });
  ['jalankanSetup_', 'aturPin_', 'hashPin_'].forEach((f) => { try { api(f); } catch (e) { ditolak++; } });
  sama(ditolak, 6);
});

uji('daftarNama hanya mengembalikan nama', () => {
  sama(ok(api('daftarNama')), ['Budi']);
});

uji('Masuk: PIN salah ditolak dengan pesan sama, 5x gagal -> TERKUNCI', () => {
  const a = galat(api('masuk', 'Budi', '000001'), 'VALIDASI');
  const b = galat(api('masuk', 'Siapa', pin.Budi), 'VALIDASI');
  sama(a.pesan, b.pesan);
  for (let i = 0; i < 4; i++) api('masuk', 'Budi', '000001');
  galat(api('masuk', 'Budi', pin.Budi), 'TERKUNCI');
  P.cache.remove('gagal:budi');
});

uji('Masuk pertama wajib ganti PIN; PIN lemah/sama ditolak', () => {
  const m = ok(api('masuk', 'Budi', pin.Budi));
  tok.Budi = m.token;
  sama(m.wajibGantiPin, true);
  galat(api('muatAwal', tok.Budi), 'WAJIB_GANTI_PIN');
  galat(api('gantiPin', tok.Budi, pin.Budi, '123456'), 'VALIDASI');
  galat(api('gantiPin', tok.Budi, pin.Budi, pin.Budi), 'VALIDASI');
  galat(api('gantiPin', tok.Budi, '999999', '482913'), 'VALIDASI');
  ok(api('gantiPin', tok.Budi, pin.Budi, '482913'));
  pin.Budi = '482913';
  awal = ok(api('muatAwal', tok.Budi));
  sama(awal.sesi, { nama: 'Budi', wajibGantiPin: false, peran: 'Pengelola' });
  sama(awal.pemilik, ['Budi', 'Bersama']);
});

uji('Pengelola menambah anggota: nama divalidasi, PIN sementara, akun tunai otomatis', () => {
  galat(api('tambahAnggota', tok.Budi, { nama: 'Bersama' }), 'VALIDASI');
  galat(api('tambahAnggota', tok.Budi, { nama: 'budi' }), 'VALIDASI');
  galat(api('tambahAnggota', tok.Budi, { nama: '=HACK()' }), 'VALIDASI');
  galat(api('tambahAnggota', tok.Budi, { nama: 'Sari', peran: 'Pengelola' }), 'VALIDASI');
  const d = ok(api('tambahAnggota', tok.Budi, { nama: '  Sari ' }));
  sama(d.nama, 'Sari');
  pastikan(/^\d{6}$/.test(d.pin), 'PIN sementara');
  pin.Sari = d.pin;
  sama(ok(api('daftarNama')), ['Budi', 'Sari']);
  awal = ok(api('muatAwal', tok.Budi));
  sama(awal.pemilik, ['Budi', 'Sari', 'Bersama']);
  pastikan(awal.akun.some((a) => a.nama === 'Tunai Sari' && a.pemilik === 'Sari'), 'akun Tunai Sari');
});

uji('Sari masuk & ganti PIN; Anggota tidak bisa mengelola anggota', () => {
  tok.Sari = ok(api('masuk', 'Sari', pin.Sari)).token;
  ok(api('gantiPin', tok.Sari, pin.Sari, '730519'));
  pin.Sari = '730519';
  sama(ok(api('muatAwal', tok.Sari)).sesi.peran, 'Anggota');
  galat(api('tambahAnggota', tok.Sari, { nama: 'Tamu' }), 'AKSES_DITOLAK');
  galat(api('resetPinAnggota', tok.Sari, 'Budi'), 'AKSES_DITOLAK');
  galat(api('aturAktifAnggota', tok.Sari, 'Budi', false), 'AKSES_DITOLAK');
  sama(ok(api('daftarAnggota', tok.Sari)).map((a) => a.nama + ':' + a.peran), ['Budi:Pengelola', 'Sari:Anggota']);
});

uji('Token palsu / kedaluwarsa -> SESI_HABIS; sesi disimpan sebagai hash', () => {
  galat(api('muatAwal', 'bukan-token'), 'SESI_HABIS');
  galat(api('muatAwal', '00000000-0000-0000-0000-000000000000'), 'SESI_HABIS');
  const kunci = [...P.props.keys()].filter((k) => k.startsWith('SESI_'));
  pastikan(kunci.length >= 2 && kunci.every((k) => k.indexOf(tok.Budi) === -1), 'token tidak tersimpan polos');
  const t = ok(api('masuk', 'Budi', pin.Budi)).token;
  const k = P.jalankan(`kunciSesi_('${t}')`);
  const isi = JSON.parse(P.props.get(k));
  isi.e = Date.now() - 1000;
  P.props.set(k, JSON.stringify(isi));
  galat(api('muatAwal', t), 'SESI_HABIS');
  pastikan(!P.props.has(k), 'sesi kedaluwarsa dihapus');
});

// ---------------------------------------------------------------- Akun & kategori
uji('Tambah akun Bank bersama; nama kembar ditolak', () => {
  const d = ok(api('simpanAkun', tok.Budi, { nama: 'Bank Bersama', jenis: 'Bank', pemilik: 'Bersama', saldoAwal: 2000000 }));
  pastikan(/^AK-/.test(d.id), 'ID akun');
  galat(api('simpanAkun', tok.Sari, { nama: 'bank bersama', jenis: 'Bank', pemilik: 'Sari', saldoAwal: 0 }), 'VALIDASI');
  galat(api('simpanAkun', tok.Sari, { nama: 'X', jenis: 'Kripto', pemilik: 'Sari' }), 'VALIDASI');
  galat(api('simpanAkun', tok.Sari, { nama: 'X', jenis: 'Bank', pemilik: 'Gabungan' }), 'VALIDASI');
  awal = ok(api('muatAwal', tok.Budi));
  sama(awal.saldo[akunNama('Bank Bersama')], 2000000);
});

uji('Tambah kategori; kategori terpakai tidak bisa pindah ke/dari Penghasilan', () => {
  const d = ok(api('simpanKategori', tok.Sari, { kelompok: 'Tabungan', nama: 'Dana Rumah', keterangan: 'DP rumah' }));
  pastikan(/^KT-/.test(d.id), 'ID kategori');
  galat(api('simpanKategori', tok.Sari, { kelompok: 'Tabungan', nama: 'dana rumah' }), 'VALIDASI');
  ok(api('simpanKategori', tok.Sari, { kelompok: 'Investasi', nama: 'Dana Rumah' }), 'nama sama di kelompok lain boleh');
  awal = ok(api('muatAwal', tok.Budi));
});

// ---------------------------------------------------------------- Transaksi
let idGaji, idMakan, idTransfer;
uji('Catat gaji (Masuk), makan (Keluar), transfer; saldo ikut', () => {
  const g = ok(api('simpanTransaksi', tok.Budi, { tanggal: hariIni, jenis: 'Masuk', pemilik: 'Budi', kategoriId: katNama('Gaji'), akunId: akunNama('Bank Bersama'), nominal: 8000000, keterangan: 'Gaji' }));
  idGaji = g.transaksi.id;
  sama([g.transaksi.dicatatOleh, g.transaksi.status, g.transaksi.tanggal], ['Budi', 'Aktif', hariIni]);
  const m = ok(api('simpanTransaksi', tok.Budi, { tanggal: hariIni, jenis: 'Keluar', pemilik: 'Budi', kategoriId: katNama('Makanan & Minuman'), akunId: akunNama('Tunai Budi'), nominal: 35000, keterangan: '=IMPORTXML("http://x")' }));
  idMakan = m.transaksi.id;
  sama(m.transaksi.keterangan, '=IMPORTXML("http://x")', 'teks disimpan apa adanya');
  const t = ok(api('simpanTransaksi', tok.Budi, { tanggal: hariIni, jenis: 'Transfer', pemilik: 'Budi', akunId: akunNama('Bank Bersama'), akunTujuanId: akunNama('Tunai Budi'), nominal: 500000 }));
  idTransfer = t.transaksi.id;
  sama(t.saldo[akunNama('Tunai Budi')], 465000);
  sama(t.saldo[akunNama('Bank Bersama')], 9500000);
});

uji('Nilai tanggal di sheet tersimpan sebagai teks (bukan Date)', () => {
  const r = barisData('Transaksi').find((x) => x[0] === idGaji);
  sama(typeof r[kolom('Transaksi', 'Tanggal')], 'string');
});

uji('Transaksi tidak valid ditolak (field asing, nominal, tanggal depan, kategori salah jenis)', () => {
  const d = { tanggal: hariIni, jenis: 'Keluar', pemilik: 'Sari', kategoriId: katNama('Transportasi'), akunId: akunNama('Tunai Sari'), nominal: 10000 };
  galat(api('simpanTransaksi', tok.Sari, Object.assign({}, d, { dicatatOleh: 'Budi' })), 'VALIDASI');
  galat(api('simpanTransaksi', tok.Sari, Object.assign({}, d, { nominal: 10.5 })), 'VALIDASI');
  galat(api('simpanTransaksi', tok.Sari, Object.assign({}, d, { tanggal: P.jalankan(`tambahHari_('${hariIni}', 2)`) })), 'VALIDASI');
  galat(api('simpanTransaksi', tok.Sari, Object.assign({}, d, { kategoriId: katNama('Gaji') })), 'VALIDASI');
  galat(api('simpanTransaksi', tok.Sari, Object.assign({}, d, { akunId: 'AK-TIDAKADA' })), 'VALIDASI');
});

uji('Sari tidak bisa mengubah/membatalkan transaksi Budi', () => {
  galat(api('simpanTransaksi', tok.Sari, { id: idMakan, tanggal: hariIni, jenis: 'Keluar', pemilik: 'Budi', kategoriId: katNama('Makanan & Minuman'), akunId: akunNama('Tunai Budi'), nominal: 1 }), 'AKSES_DITOLAK');
  galat(api('batalkanTransaksi', tok.Sari, idMakan), 'AKSES_DITOLAK');
});

uji('Budi mengubah transaksinya sendiri: nominal & Diubah berubah, pencatat tetap', () => {
  const d = ok(api('simpanTransaksi', tok.Budi, { id: idMakan, tanggal: hariIni, jenis: 'Keluar', pemilik: 'Budi', kategoriId: katNama('Makanan & Minuman'), akunId: akunNama('Tunai Budi'), nominal: 40000, keterangan: 'Bakso' }));
  sama([d.transaksi.nominal, d.transaksi.dicatatOleh, d.transaksi.keterangan], [40000, 'Budi', 'Bakso']);
  pastikan(d.transaksi.diubah, 'Diubah terisi');
  sama(d.saldo[akunNama('Tunai Budi')], 460000);
  sama(barisData('Transaksi').length, 3, 'tidak menambah baris');
});

uji('Sari mencatat pengeluaran bersama, tagihan, tabungan, hutang', () => {
  const c = (o) => ok(api('simpanTransaksi', tok.Sari, Object.assign({ tanggal: hariIni, jenis: 'Keluar', akunId: akunNama('Bank Bersama') }, o)));
  c({ pemilik: 'Bersama', kategoriId: katNama('Listrik'), nominal: 300000 });
  c({ pemilik: 'Sari', kategoriId: katNama('Tabungan Tujuan'), nominal: 2000000 });
  c({ pemilik: 'Sari', kategoriId: katNama('Cicilan Kendaraan'), nominal: 700000 });
  c({ pemilik: 'Sari', kategoriId: katNama('Transportasi'), nominal: 50000, akunId: akunNama('Tunai Sari') });
  ok(api('simpanTransaksi', tok.Sari, { tanggal: hariIni, jenis: 'Masuk', pemilik: 'Sari', kategoriId: katNama('Gaji'), akunId: akunNama('Tunai Sari'), nominal: 6000000 }));
});

uji('Batalkan transaksi: status Batal, saldo kembali, tidak bisa dibatalkan dua kali', () => {
  const d = ok(api('batalkanTransaksi', tok.Budi, idTransfer));
  sama(d.transaksi.status, 'Batal');
  sama(d.saldo[akunNama('Tunai Budi')], -40000, 'saldo boleh negatif');
  galat(api('batalkanTransaksi', tok.Budi, idTransfer), 'VALIDASI');
  galat(api('simpanTransaksi', tok.Budi, { id: idTransfer, tanggal: hariIni, jenis: 'Transfer', pemilik: 'Budi', akunId: akunNama('Bank Bersama'), akunTujuanId: akunNama('Tunai Budi'), nominal: 1 }), 'VALIDASI');
});

uji('Riwayat bulan ini berisi semua (termasuk Batal); bulan tidak valid ditolak', () => {
  const r = ok(api('riwayat', tok.Sari, { bulan: bulan }));
  sama(r.transaksi.length, 8);
  pastikan(r.transaksi.some((t) => t.status === 'Batal'), 'ada Batal');
  sama(ok(api('riwayat', tok.Sari, { bulan: bulanDepan })).transaksi.length, 0);
  galat(api('riwayat', tok.Sari, { bulan: '2026-13' }), 'VALIDASI');
});

// ---------------------------------------------------------------- Laporan & anggaran
uji('Laporan Gabungan: ringkasan benar, transfer & batal tidak dihitung', () => {
  const l = ok(api('laporanBulanan', tok.Sari, { bulan: bulan, pemilik: 'Gabungan' }));
  const r = l.ringkasan;
  sama([r.penghasilan, r.pengeluaran, r.hutang, r.tabungan, r.sisa], [14000000, 390000, 700000, 2000000, 10910000]);
  sama(l.komposisi[0].nama, 'Listrik');
  sama(l.totalSaldo, 2000000 + 8000000 - 300000 - 2000000 - 700000 + (-40000) + (6000000 - 50000));
});

uji('Laporan per orang & Bersama hanya berisi miliknya; saldo hanya akunnya', () => {
  const a = ok(api('laporanBulanan', tok.Budi, { bulan: bulan, pemilik: 'Budi' }));
  sama([a.ringkasan.penghasilan, a.ringkasan.pengeluaran, a.ringkasan.tabungan], [8000000, 40000, 0]);
  sama(a.saldo.map((s) => s.nama), ['Tunai Budi']);
  const b = ok(api('laporanBulanan', tok.Budi, { bulan: bulan, pemilik: 'Bersama' }));
  sama(b.ringkasan.pengeluaran, 300000);
  galat(api('laporanBulanan', tok.Budi, { bulan: bulan, pemilik: 'Joko' }), 'VALIDASI');
});

uji('Anggaran: simpan, baca, 0 menghapus, Gabungan ditolak untuk anggaran', () => {
  ok(api('simpanAnggaran', tok.Sari, { bulan: bulan, pemilik: 'Sari', nominal: { [katNama('Transportasi')]: 40000, [katNama('Tabungan Tujuan')]: 2000000, [katNama('Kesehatan')]: 100000 } }));
  ok(api('simpanAnggaran', tok.Sari, { bulan: bulan, pemilik: 'Sari', nominal: { [katNama('Kesehatan')]: 0 } }));
  const g = ok(api('getAnggaran', tok.Budi, { bulan: bulan, pemilik: 'Sari' }));
  sama(Object.keys(g.nominal).length, 2);
  sama(g.nominal[katNama('Transportasi')], 40000);
  sama(barisData('Anggaran').length, 2);
  galat(api('getAnggaran', tok.Budi, { bulan: bulan, pemilik: 'Gabungan' }), 'VALIDASI');
  galat(api('simpanAnggaran', tok.Sari, { bulan: bulan, pemilik: 'Sari', nominal: { [katNama('Transportasi')]: -1 } }), 'VALIDASI');
  galat(api('simpanAnggaran', tok.Sari, { bulan: bulan, pemilik: 'Sari', nominal: { 'KT-XXX': 1 } }), 'VALIDASI');
});

uji('Laporan Sari: anggaran vs realisasi dengan status lewat', () => {
  const l = ok(api('laporanBulanan', tok.Sari, { bulan: bulan, pemilik: 'Sari' }));
  const tr = l.anggaran.find((x) => x.nama === 'Transportasi');
  sama([tr.anggaran, tr.realisasi, tr.status], [40000, 50000, 'lewat']);
  const tb = l.anggaran.find((x) => x.nama === 'Tabungan Tujuan');
  sama([tb.status, tb.progres], ['target', 1], 'tabungan = target, bukan peringatan');
});

uji('Salin anggaran ke bulan depan tanpa menimpa isian', () => {
  ok(api('simpanAnggaran', tok.Sari, { bulan: bulanDepan, pemilik: 'Sari', nominal: { [katNama('Transportasi')]: 99000 } }));
  pastikan(ok(api('getAnggaran', tok.Sari, { bulan: bulanDepan, pemilik: 'Sari' })).bisaSalin, 'bisa salin');
  sama(ok(api('salinAnggaran', tok.Sari, { bulan: bulanDepan, pemilik: 'Sari' })).disalin, 1);
  const g = ok(api('getAnggaran', tok.Sari, { bulan: bulanDepan, pemilik: 'Sari' }));
  sama([g.nominal[katNama('Transportasi')], g.nominal[katNama('Tabungan Tujuan')], g.bisaSalin], [99000, 2000000, false]);
});

uji('Selisih bulan lalu terhitung', () => {
  ok(api('simpanTransaksi', tok.Budi, { tanggal: bulanLalu + '-15', jenis: 'Keluar', pemilik: 'Budi', kategoriId: katNama('Makanan & Minuman'), akunId: akunNama('Tunai Budi'), nominal: 20000 }));
  const l = ok(api('laporanBulanan', tok.Budi, { bulan: bulan, pemilik: 'Budi' }));
  sama(l.selisih.pengeluaran, { nilai: 20000, persen: 1 });
});

// ---------------------------------------------------------------- Nonaktif
uji('Akun nonaktif tidak bisa dipakai transaksi baru', () => {
  const id = akunNama('Tunai Sari');
  ok(api('simpanAkun', tok.Sari, { id: id, nama: 'Tunai Sari', jenis: 'Tunai', pemilik: 'Sari', saldoAwal: 0, aktif: false }));
  galat(api('simpanTransaksi', tok.Sari, { tanggal: hariIni, jenis: 'Keluar', pemilik: 'Sari', kategoriId: katNama('Transportasi'), akunId: id, nominal: 1000 }), 'VALIDASI');
  ok(api('simpanAkun', tok.Sari, { id: id, nama: 'Tunai Sari', jenis: 'Tunai', pemilik: 'Sari', saldoAwal: 0, aktif: true }));
});

uji('Kategori Penghasilan terpakai tidak bisa dipindah ke Pengeluaran', () => {
  galat(api('simpanKategori', tok.Budi, { id: katNama('Gaji'), kelompok: 'Pengeluaran', nama: 'Gaji' }), 'VALIDASI');
});

uji('Pengelola reset PIN anggota & menonaktifkan: sesi anggota langsung keluar, data lama tetap di laporan', () => {
  galat(api('resetPinAnggota', tok.Budi, 'Budi'), 'VALIDASI');
  galat(api('aturAktifAnggota', tok.Budi, 'Budi', false), 'VALIDASI');
  const r = ok(api('resetPinAnggota', tok.Budi, 'Sari'));
  galat(api('muatAwal', tok.Sari), 'SESI_HABIS');
  tok.Sari = ok(api('masuk', 'Sari', r.pin)).token;
  ok(api('gantiPin', tok.Sari, r.pin, '730519'));
  ok(api('aturAktifAnggota', tok.Budi, 'Sari', false));
  galat(api('muatAwal', tok.Sari), 'SESI_HABIS');
  galat(api('masuk', 'Sari', '730519'), 'VALIDASI');
  sama(ok(api('daftarNama')), ['Budi']);
  const l = ok(api('laporanBulanan', tok.Budi, { bulan: bulan, pemilik: 'Sari' }));
  pastikan(l.ringkasan.penghasilan > 0, 'laporan anggota nonaktif tetap bisa dibuka');
  galat(api('simpanTransaksi', tok.Budi, { tanggal: hariIni, jenis: 'Keluar', pemilik: 'Sari', kategoriId: katNama('Transportasi'), akunId: akunNama('Tunai Budi'), nominal: 1000 }), 'VALIDASI');
  ok(api('aturAktifAnggota', tok.Budi, 'Sari', true));
  tok.Sari = ok(api('masuk', 'Sari', '730519')).token;
  P.cache.remove('gagal:sari');
});

// ---------------------------------------------------------------- Menu
uji('Reset PIN dari menu: PIN sementara baru, semua sesi lama keluar', () => {
  const teks = P.menu('resetPin', 'sari');
  const m = /PIN sementara Sari: (\d{6})/.exec(teks);
  pastikan(m, 'alert berisi PIN: ' + teks);
  galat(api('muatAwal', tok.Sari), 'SESI_HABIS');
  galat(api('masuk', 'Sari', pin.Sari), 'VALIDASI');
  const s = ok(api('masuk', 'Sari', m[1]));
  sama(s.wajibGantiPin, true);
  ok(api('muatAwal', tok.Budi), 'sesi Budi tidak terpengaruh');
  P.cache.remove('gagal:sari');
});

uji('Impor template lama: akun, kategori, transaksi; impor ulang tidak menggandakan', () => {
  const setting = P.ss.insertSheet('Copy of ⚙️Setting Sari');
  const isi = [['', '', '', ''], ['', 'POSISI KAS', '', ''], ['', '', 'Tunai Budi', ''], ['', '', 'Tunai Sari', ''],
    ['', '', 'TabunganSari', ''], ['', 'PENGHASILAN', '', ''], ['', '', 'Gaji Sari', ''],
    ['', 'PENGELUARAN', '', ''], ['', '🏠Kebutuhan Pokok', '', ''], ['', '', 'Makanan & Minuman', 'x'], ['', '', 'Hobi', 'Main'],
    ['', 'HUTANG', '', ''], ['', '', 'Pinjaman Keluarga', 'Pinjaman']];
  isi.forEach((r, i) => r.forEach((v, j) => setting.tulis(i + 1, j + 1, v)));
  const trx = P.ss.insertSheet('Copy of 📋Transaksi Sari');
  const baris = [
    [], ['', 'DAFTAR TRANSAKSI'], ['', 'TANGGAL', 'KATEGORI', 'SUB KATEGORI', 'UANG MASUK', '', 'UANG KELUAR', '', 'POSISI KAS', 'KETERANGAN'],
    ['', new Date('2026-01-01T00:00:00+07:00'), 'Penghasilan', 'Gaji Sari', 'Rp', 9100000, '', '', 'Tunai Sari', ''],
    ['', new Date('2026-01-02T00:00:00+07:00'), 'Pengeluaran', 'Makanan & Minuman', '', '', 'Rp', 1750000, 'TabunganSari', 'belanja'],
    ['', new Date('2026-01-03T00:00:00+07:00'), 'Hutang', 'Pinjaman Keluarga', '', '', 'Rp', 250000, 'Tunai Sari', ''],
    ['', '', '', '', '', '', '', '', '', ''],
  ];
  baris.forEach((r, i) => r.forEach((v, j) => trx.tulis(i + 1, j + 1, v)));
  const nAkun = barisData('Akun').length;
  const teks = P.menu('imporTemplateLama');
  pastikan(/Transaksi diimpor: 3/.test(teks), teks);
  sama(barisData('Akun').length, nAkun + 1, 'hanya TabunganSari yang baru');
  const d = ok(api('muatAwal', tok.Budi));
  const tab = d.akun.find((a) => a.nama === 'TabunganSari');
  sama([tab.pemilik, tab.jenis], ['Sari', 'Bank']);
  pastikan(d.kategori.some((k) => k.nama === 'Hobi' && k.kelompok === 'Pengeluaran'), 'kategori Hobi');
  pastikan(d.kategori.some((k) => k.nama === 'Pinjaman Keluarga' && k.kelompok === 'Hutang'), 'kategori hutang');
  const r = ok(api('riwayat', tok.Budi, { bulan: '2026-01' })).transaksi;
  sama(r.map((t) => t.tanggal + ' ' + t.jenis + ' ' + t.nominal + ' ' + t.dicatatOleh).sort(),
    ['2026-01-01 Masuk 9100000 Sari', '2026-01-02 Keluar 1750000 Sari', '2026-01-03 Keluar 250000 Sari']);
  const lagi = P.menu('imporTemplateLama');
  pastikan(/Transaksi diimpor: 0 \(3 sudah pernah diimpor/.test(lagi), lagi);
});

uji('Setup Awal dari menu di file kosong menanyakan nama Pengelola', () => {
  const P2 = buatProyek({ diam: true });
  const teks = P2.menu('setupAwal', 'Dewi');
  pastikan(/Dewi: \d{6}/.test(teks), teks);
  sama(P2.panggilKlien('daftarNama', []).data, ['Dewi']);
  const tolak = buatProyek({ diam: true });
  pastikan(/2–30/.test(tolak.menu('setupAwal', 'X')), 'nama terlalu pendek ditolak');
});

uji('Migrasi pengguna versi lama: tanpa kolom Peran/Aktif -> orang pertama Pengelola', () => {
  const P3 = buatProyek({ diam: true });
  P3.jalankan("denganKunci_(function () { return jalankanSetup_('Lama'); })");
  P3.jalankan("aturPin_('Kedua', '482913', false)");
  const sh = P3.sheet('Pengguna');
  const kol = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  [kol.indexOf('Peran'), kol.indexOf('Aktif')].forEach((c) => { for (let r = 1; r <= 3; r++) sh.getRange(r, c + 1).setValue(''); });
  P3.jalankan('denganKunci_(function () { return jalankanSetup_(null); })');
  const k2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const baris = sh.getDataRange().getValues().slice(1).filter((r) => r[0]);
  sama(baris.map((r) => r[0] + ':' + r[k2.indexOf('Peran')] + ':' + r[k2.indexOf('Aktif')]), ['Lama:Pengelola:Ya', 'Kedua:Anggota:Ya']);
});

uji('Setup dari menu menampilkan pesan tanpa PIN baru', () => {
  pastikan(/Pengguna sudah ada/.test(P.menu('setupAwal')), 'pesan');
});

uji('Keluar menghapus sesi', () => {
  ok(api('keluar', tok.Budi));
  galat(api('muatAwal', tok.Budi), 'SESI_HABIS');
});

// ---------------------------------------------------------------- Bot Telegram (proyek terpisah)
{
  const B = buatProyek({ diam: true });
  const apiB = (nama, ...args) => B.panggilKlien(nama, args);
  const TOKEN = '123456789:AAEtokenUjiCobaYangCukupPanjang123456';
  let nextUpdate = 1000;
  const kirimUpdate = (update, kunciSalah) => {
    const kunci = kunciSalah ? 'salah' : B.props.get('TG_KUNCI');
    return B.ctx.doPost({ parameter: { tg: kunci }, postData: { contents: JSON.stringify(update) } });
  };
  const pesan = (chatId, text, lain) => kirimUpdate(Object.assign({
    update_id: ++nextUpdate,
    message: { message_id: nextUpdate, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Uji', is_bot: false }, text: text },
  }, lain || {}));
  const tekan = (chatId, data) => kirimUpdate({
    update_id: ++nextUpdate,
    callback_query: { id: 'cb' + nextUpdate, data: data, message: { message_id: 555, chat: { id: chatId, type: 'private' } } },
  });
  const terakhir = (metode) => B.telegram.panggilan.filter((x) => x.metode === metode).slice(-1)[0];
  const teksTerakhir = () => {
    const x = B.telegram.panggilan.filter((y) => y.metode === 'sendMessage' || y.metode === 'editMessageText').slice(-1)[0];
    return x ? x.data.text : '';
  };
  const trxB = () => B.sheet('Transaksi').getDataRange().getValues().slice(1).filter((r) => r[0]);
  let tokBudi;
  let tokSari;

  uji('Bot: siapkan proyek (Budi Pengelola + Sari)', () => {
    B.jalankan("denganKunci_(function () { return jalankanSetup_('Budi'); })");
    B.jalankan("aturPin_('Budi', '482913', false, 'Pengelola'); aturPin_('Sari', '730519', false, 'Anggota'); buatAkunTunai_('Sari')");
    tokBudi = apiB('masuk', 'Budi', '482913').data.token;
    tokSari = apiB('masuk', 'Sari', '730519').data.token;
    pastikan(tokBudi && tokSari, 'masuk');
    galat(apiB('buatKodeTelegram', tokBudi), 'BELUM_ADA_BOT');
  });

  uji('Bot: menu pasang token — format salah & token ditolak tidak mengubah apa pun', () => {
    pastikan(/Format token/.test(B.menu('hubungkanBotTelegram', 'bukan-token')), 'format');
    pastikan(/ditolak/.test(B.menu('hubungkanBotTelegram', '123456789:TOLAKtokenUjiCobaYangCukupPanjang1234')), 'ditolak');
    pastikan(!B.props.has('TG_TOKEN') && !B.props.has('TG_BOT'), 'tidak tersimpan');
  });

  uji('Bot: menu pasang token sah → webhook dengan kunci rahasia', () => {
    const teks = B.menu('hubungkanBotTelegram', TOKEN);
    pastikan(/@KeuanganUjiBot/.test(teks), teks);
    const wh = terakhir('setWebhook').data;
    pastikan(/\/exec\?tg=[0-9a-f]{32}$/.test(wh.url), wh.url);
    sama(wh.allowed_updates, ['message', 'callback_query']);
    const perintah = terakhir('setMyCommands').data.commands.map((c) => c.command);
    sama(perintah, ['bantuan', 'saldo', 'bulanini', 'batal', 'hubung', 'putus']);
    pastikan(terakhir('setMyDescription').data.description.length <= 512, 'deskripsi ≤ 512');
    pastikan(terakhir('setMyShortDescription').data.short_description.length <= 120, 'deskripsi singkat ≤ 120');
    sama(apiB('statusTelegram', tokBudi).data, { bot: 'KeuanganUjiBot', chat: [] });
  });

  uji('Bot: alamat @HEAD yang menolak (401) terdeteksi → minta URL /exec yang benar; perbaikan tanpa token menjaga kunci', () => {
    const urlHead = 'https://script.google.com/macros/s/EMULATOR/exec';
    const urlBenar = 'https://script.google.com/macros/s/TERBIT/exec';
    B.telegram.kodeWebApp[urlHead] = 401;
    B.props.delete('TG_URL');
    const kunciLama = B.props.get('TG_KUNCI');
    // Kosongkan token = perbaiki; URL otomatis (getUrl) tertolak 401 → prompt kedua diisi URL benar.
    const teks = B.menu('hubungkanBotTelegram', ['', urlBenar]);
    pastikan(/Webhook diperbaiki/.test(teks), teks);
    sama(terakhir('setWebhook').data.url, urlBenar + '?tg=' + kunciLama, 'URL benar + kunci lama');
    sama(B.props.get('TG_URL'), urlBenar);
    // URL yang juga menolak ditolak dengan penjelasan, webhook tidak diubah.
    B.telegram.kodeWebApp[urlBenar] = 401;
    B.props.delete('TG_URL');
    const n = B.telegram.panggilan.filter((x) => x.metode === 'setWebhook').length;
    pastikan(/belum bisa menerima pesan tanpa login/.test(B.menu('hubungkanBotTelegram', ['', urlBenar])), 'tolak URL 401');
    sama(B.telegram.panggilan.filter((x) => x.metode === 'setWebhook').length, n, 'tidak memasang webhook salah');
    delete B.telegram.kodeWebApp[urlBenar];
    B.props.set('TG_URL', urlBenar);
  });

  uji('Bot: menu Status Bot Telegram menampilkan galat webhook dan menyamarkan kunci', () => {
    let teks = B.menu('statusBotTelegram');
    pastikan(/Kunci webhook cocok: ya/.test(teks) && /Galat terakhir: tidak ada/.test(teks), teks);
    pastikan(/tg=••••/.test(teks) && teks.indexOf(B.props.get('TG_KUNCI')) === -1, 'kunci tidak tampil');
    B.telegram.galatWebhook = 'Wrong response from the webhook: 401 Unauthorized';
    teks = B.menu('statusBotTelegram');
    pastikan(/401/.test(teks) && /alamat Web App salah/.test(teks) && /tertahan di Telegram: 3/.test(teks), teks);
    B.telegram.galatWebhook = '';
  });

  uji('Bot: webhook tanpa kunci benar diabaikan; chat belum terhubung diberi petunjuk', () => {
    const n = B.telegram.panggilan.length;
    kirimUpdate({ update_id: 1, message: { chat: { id: 9, type: 'private' }, from: { id: 9 }, text: '25rb kopi' } }, true);
    sama(B.telegram.panggilan.length, n, 'tidak ada balasan');
    pesan(111, '25rb kopi');
    pastikan(/belum terhubung/.test(teksTerakhir()), teksTerakhir());
    pesan(111, 'halo', { message: { message_id: 1, chat: { id: -500, type: 'group' }, from: { id: 111 }, text: 'x' } });
    pastikan(/chat pribadi/.test(teksTerakhir()), 'grup ditolak');
    sama(trxB().length, 0);
  });

  uji('Bot: /hubung dengan kode dari aplikasi (salah, benar, sekali pakai)', () => {
    const k = apiB('buatKodeTelegram', tokBudi).data;
    pastikan(/^\d{6}$/.test(k.kode) && k.bot === 'KeuanganUjiBot', 'kode');
    pesan(111, '/hubung 000000');
    pastikan(/tidak valid/.test(teksTerakhir()), 'kode salah');
    pesan(111, '/hubung ' + k.kode);
    pastikan(/Terhubung sebagai Budi/.test(teksTerakhir()), teksTerakhir());
    pesan(222, '/hubung ' + k.kode);
    pastikan(/tidak valid/.test(teksTerakhir()), 'kode sekali pakai');
    sama(apiB('statusTelegram', tokBudi).data.chat.length, 1);
    const kS = apiB('buatKodeTelegram', tokSari).data;
    pesan(222, '/hubung ' + kS.kode);
    pastikan(/Terhubung sebagai Sari/.test(teksTerakhir()), 'Sari');
  });

  uji('Bot: /start — sapaan untuk chat baru, tautan mulai dengan kode langsung terhubung, sapaan singkat bila sudah terhubung', () => {
    pesan(333, '/start');
    const sapa = teksTerakhir();
    pastikan(/Halo, Uji!/.test(sapa) && /Atur › Telegram › Hubungkan/.test(sapa) && /Buka di Telegram/.test(sapa), sapa);
    pastikan(!/script\.google\.com/.test(sapa), 'sapaan tidak membocorkan alamat aplikasi');
    const k = apiB('buatKodeTelegram', tokSari).data;
    pesan(333, '/start ' + k.kode);
    pastikan(/Terhubung sebagai Sari/.test(teksTerakhir()), teksTerakhir());
    pesan(333, '/start');
    pastikan(/Halo lagi, Sari! Chat ini sudah terhubung/.test(teksTerakhir()), teksTerakhir());
    pesan(333, '/putus');
  });

  uji('Bot: "25rb makan siang" → draf dengan tombol, belum tersimpan; update ganda diabaikan', () => {
    const upd = { update_id: 7777, message: { message_id: 1, chat: { id: 111, type: 'private' }, from: { id: 111 }, text: '25rb makan siang' } };
    kirimUpdate(upd);
    const d = terakhir('sendMessage').data;
    pastikan(/Uang keluar Rp 25\.000/.test(d.text) && /Makanan & Minuman/.test(d.text) && /Tunai Budi/.test(d.text), d.text);
    sama(d.reply_markup.inline_keyboard[0][0].callback_data, 'ok');
    const n = B.telegram.panggilan.length;
    kirimUpdate(upd);
    sama(B.telegram.panggilan.length, n, 'update_id sama tidak diproses ulang');
    sama(trxB().length, 0, 'belum tersimpan tanpa konfirmasi');
  });

  uji('Bot: tekan Simpan → transaksi tercatat atas nama Budi & tampil di aplikasi', () => {
    tekan(111, 'ok');
    pastikan(/Tersimpan/.test(teksTerakhir()), teksTerakhir());
    const t = apiB('riwayat', tokBudi, { bulan: B.jalankan('hariIni_()').slice(0, 7) }).data.transaksi[0];
    sama([t.jenis, t.nominal, t.dicatatOleh, t.pemilik, t.keterangan, t.status], ['Keluar', 25000, 'Budi', 'Budi', 'makan siang', 'Aktif']);
    tekan(111, 'ok');
    pastikan(/kedaluwarsa/.test(teksTerakhir()), 'draf tidak bisa disimpan dua kali');
    sama(trxB().length, 1);
  });

  uji('Bot: kategori tak dikenal → pilih lewat tombol; ganti akun; batal', () => {
    pesan(111, '40rb futsal');
    pastikan(/Pilih kategori/.test(terakhir('sendMessage').data.text), 'tanya kategori');
    tekan(111, 'katsemua');
    const semua = terakhir('editMessageText').data.reply_markup.inline_keyboard.flat();
    const tr = semua.find((b) => b.text === 'Transportasi');
    pastikan(tr, 'daftar lengkap berisi Transportasi');
    tekan(111, tr.callback_data);
    tekan(111, 'akun');
    const akunBtn = terakhir('editMessageText').data.reply_markup.inline_keyboard.flat().find((b) => b.text === 'Tunai Sari');
    tekan(111, akunBtn.callback_data);
    pastikan(/Akun: Tunai Sari/.test(teksTerakhir()) && /Transportasi/.test(teksTerakhir()), teksTerakhir());
    tekan(111, 'x');
    pastikan(/Dibatalkan/.test(teksTerakhir()), 'batal');
    sama(trxB().length, 1);
  });

  uji('Bot: pesan tidak jelas dijawab petunjuk; transfer diarahkan ke aplikasi', () => {
    pesan(111, 'makan siang');
    pastikan(/Nominalnya belum ada/.test(teksTerakhir()), teksTerakhir());
    pesan(111, 'tf 100rb ke gopay');
    pastikan(/lewat aplikasi/.test(teksTerakhir()), teksTerakhir());
    pesan(111, '/entah');
    pastikan(/tidak dikenal/.test(teksTerakhir()), 'perintah asing');
  });

  uji('Bot: /saldo & /bulanini', () => {
    pesan(111, '/saldo');
    pastikan(/Tunai Budi: -Rp 25\.000/.test(teksTerakhir()) && /Total: -Rp 25\.000/.test(teksTerakhir()), teksTerakhir());
    pesan(111, '/bulanini');
    pastikan(/Terpakai: Rp 25\.000/.test(teksTerakhir()) && /Sisa: -Rp 25\.000/.test(teksTerakhir()), teksTerakhir());
  });

  uji('Bot: /batal hanya catatan bot terakhir milik sendiri', () => {
    pesan(222, '/batal');
    pastikan(/Tidak ada catatan/.test(teksTerakhir()), 'Sari tidak punya catatan bot');
    pesan(111, '/batal');
    pastikan(/Batalkan catatan ini/.test(teksTerakhir()), teksTerakhir());
    tekan(111, 'btl:ya');
    pastikan(/dibatalkan/.test(teksTerakhir()), teksTerakhir());
    sama(trxB()[0][12], 'Batal');
  });

  uji('Bot: reset PIN Sari memutus chat Sari; /putus memutus chat sendiri', () => {
    apiB('resetPinAnggota', tokBudi, 'Sari');
    pesan(222, '10rb parkir');
    pastikan(/belum terhubung/.test(teksTerakhir()), teksTerakhir());
    pesan(111, '/putus');
    pastikan(/diputus/.test(teksTerakhir()), 'putus');
    sama(apiB('statusTelegram', tokBudi).data.chat, []);
  });

  uji('Bot: salinan file — token, sambungan chat, dan sesi dari file asal dibuang', () => {
    const k = apiB('buatKodeTelegram', tokBudi).data;
    pesan(111, '/hubung ' + k.kode);
    const kunciLama = B.props.get('TG_KUNCI');
    B.ss._id = 'SS-SALINAN';
    const n = B.telegram.panggilan.length;
    B.ctx.doPost({ parameter: { tg: kunciLama }, postData: { contents: JSON.stringify({ update_id: 99999, message: { chat: { id: 111, type: 'private' }, from: { id: 111 }, text: '/saldo' } }) } });
    sama(B.telegram.panggilan.length, n, 'salinan tidak membalas memakai bot asal');
    pastikan(!B.props.has('TG_TOKEN') && ![...B.props.keys()].some((x) => /^(TGC_|SESI_)/.test(x)), 'properti warisan dibersihkan');
    galat(apiB('muatAwal', tokBudi), 'SESI_HABIS');
    sama(B.props.get('FILE_ID'), 'SS-SALINAN');
  });
}

uji('dist/ (untuk salin-tempel) sama dengan kode sumber', () => {
  const beda = require('./bundel').cek();
  pastikan(!beda.length, 'jalankan node dev/bundel.js — berbeda: ' + beda.join(', '));
});

uji('dist/Keuangan.gs berjalan sebagai satu-satunya file: Setup → masuk → catat → tes logika', () => {
  const D = buatProyek({ diam: true, berkas: [require('path').join(__dirname, '..', 'dist', 'Keuangan.gs')] });
  const h = D.jalankan("denganKunci_(function () { return jalankanSetup_('Dewi'); })");
  const tok = D.panggilKlien('masuk', ['Dewi', h.pinBaru[0].pin]).data.token;
  D.panggilKlien('gantiPin', [tok, h.pinBaru[0].pin, '482913']);
  const awal = D.panggilKlien('muatAwal', [tok]).data;
  const kat = awal.kategori.find((k) => k.nama === 'Transportasi').id;
  const r = D.panggilKlien('simpanTransaksi', [tok, { tanggal: D.jalankan('hariIni_()'), jenis: 'Keluar', pemilik: 'Dewi', kategoriId: kat, akunId: awal.akun[0].id, nominal: 15000 }]);
  pastikan(r.ok && r.data.transaksi.nominal === 15000, JSON.stringify(r));
  const t = D.panggilKlien('jalankanTes', []);
  pastikan(t.gagal === 0 && t.lulus > 30, 'tes logika di bundel');
});

uji('Tes logika (Tes.js) semua lulus', () => {
  const h = api('jalankanTes');
  pastikan(h.gagal === 0, h.detail.filter((x) => x[0] === '✘').join('\n'));
});

console.log('\n' + lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) process.exit(1);
