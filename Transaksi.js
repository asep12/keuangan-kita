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
