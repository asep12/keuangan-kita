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
