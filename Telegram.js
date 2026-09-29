/**
 * Telegram.js — bot Telegram untuk mencatat lewat chat (Fase 2a, teks). Spesifikasi: docs/TELEGRAM.md.
 *
 * Jalur masuk: webhook `doPost` (URL Web App + ?tg=<kunci>). Inti `prosesUpdate_` terpisah dari jalur agar
 * bisa dipakai mode polling. Tidak ada yang tersimpan tanpa konfirmasi tombol.
 * JANGAN menulis token bot, kunci webhook, atau isi pesan ke log.
 */

const TG_DRAF_DETIK = 900; // draf menunggu konfirmasi 15 menit
const TG_KODE_DETIK = 600; // kode /hubung berlaku 10 menit
const TG_UPDATE_DETIK = 21600; // ingat update_id 6 jam (Telegram mengirim ulang karena Apps Script menjawab 302)

// ======================================================================
// Jalur masuk
// ======================================================================

/** Webhook Telegram. Selalu menjawab cepat; galat hanya dicatat ringkas tanpa isi pesan. */
function doPost(e) {
  try {
    const kunci = props_().getProperty('TG_KUNCI');
    if (!kunci || !e || !e.parameter || e.parameter.tg !== kunci || !e.postData) return ContentService.createTextOutput('');
    pastikanFileAsli_();
    if (props_().getProperty('TG_KUNCI') !== kunci) return ContentService.createTextOutput(''); // salinan file: kunci lama dibuang
    prosesUpdate_(JSON.parse(e.postData.contents));
  } catch (err) {
    console.error('Bot Telegram: ' + (err && err.kode ? err.kode : 'galat') + ' ' + (err && err.bisnis ? err.message : ''));
  }
  return ContentService.createTextOutput('ok');
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
    return { bot: props_().getProperty('TG_BOT') || null, chat: chatMilik_(sesi.nama).map(function (c) { return { label: c.label, sejak: c.sejak }; }) };
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
    'Galat terakhir: ' + galat,
    '',
    /401|403|404/.test(galat) ? 'Galat ini berarti alamat Web App salah atau tidak terbuka untuk "Siapa saja". ' +
      'Jalankan Hubungkan Bot Telegram, kosongkan token, lalu tempel URL /exec dari Terapkan › Kelola deployment.'
      : /302/.test(galat) ? 'Galat "302" wajar untuk Apps Script: pesan tetap diproses. Bila bot tetap diam, periksa ' +
        'Editor Apps Script › Eksekusi untuk melihat galat doPost.'
        : '',
  ].join('\n'), ui.ButtonSet.OK);
}

function hapusBotTelegram_() {
  const p = props_();
  ['TG_TOKEN', 'TG_KUNCI', 'TG_BOT'].forEach(function (k) { p.deleteProperty(k); });
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
