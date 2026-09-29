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
