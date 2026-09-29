/**
 * Laporan.js — laporan bulanan dan anggaran.
 */

function laporanBulanan(token, filter) {
  return jalankan_(token, function () {
    const f = cekFilterBulan_(filter, true);
    const trx = bacaTransaksi_();
    const kategori = bacaKategori_();
    const petaKat = petaId_(kategori);
    const anggaran = bacaAnggaran_();
    const lalu = geserBulan_(f.bulan, -1);

    const realisasi = realisasiKategori_(trx, f.bulan, f.pemilik);
    const ringkasan = ringkasBulan_(trx, petaKat, f.bulan, f.pemilik);
    const ringkasLalu = ringkasBulan_(trx, petaKat, lalu, f.pemilik);

    const akun = bacaAkun_().filter(function (a) { return cocokPemilik_(a.pemilik, f.pemilik); });
    const saldo = hitungSaldo_(akun, trx, akhirBulan_(f.bulan));
    const daftarSaldo = akun
      .filter(function (a) { return a.aktif || saldo[a.id] !== 0; })
      .map(function (a) { return { id: a.id, nama: a.nama, jenis: a.jenis, pemilik: a.pemilik, saldo: saldo[a.id] }; });

    return {
      bulan: f.bulan,
      pemilik: f.pemilik,
      ringkasan: ringkasan,
      lalu: ringkasLalu,
      selisih: {
        penghasilan: selisih_(ringkasan.penghasilan, ringkasLalu.penghasilan),
        pengeluaran: selisih_(ringkasan.pengeluaran, ringkasLalu.pengeluaran),
        hutang: selisih_(ringkasan.hutang, ringkasLalu.hutang),
        tabungan: selisih_(ringkasan.tabungan, ringkasLalu.tabungan),
        sisa: selisih_(ringkasan.sisa, ringkasLalu.sisa),
      },
      anggaran: bandingAnggaran_(kategori, anggaranKategori_(anggaran, f.bulan, f.pemilik), realisasi),
      komposisi: komposisiPengeluaran_(realisasi, petaKat),
      saldo: daftarSaldo,
      totalSaldo: daftarSaldo.reduce(function (s, a) { return s + a.saldo; }, 0),
      sampai: akhirBulan_(f.bulan),
    };
  });
}

function getAnggaran(token, filter) {
  return jalankan_(token, function () {
    const f = cekFilterBulan_(filter, false);
    const semua = bacaAnggaran_();
    const lalu = geserBulan_(f.bulan, -1);
    const nominal = {};
    semua.forEach(function (a) {
      if (a.bulan === f.bulan && a.pemilik === f.pemilik) nominal[a.kategoriId] = a.nominal;
    });
    return {
      bulan: f.bulan,
      pemilik: f.pemilik,
      nominal: nominal,
      realisasi: realisasiKategori_(bacaTransaksi_(), f.bulan, f.pemilik),
      bisaSalin: barisSalinAnggaran_(semua, lalu, f.bulan, f.pemilik).length > 0,
    };
  });
}

/** data = { bulan, pemilik, nominal: { kategoriId: angka } } — hanya kategori yang dikirim yang diubah. */
function simpanAnggaran(token, data) {
  return jalankan_(token, function (sesi) {
    tolakFieldAsing_(data, ['bulan', 'pemilik', 'nominal']);
    const f = cekFilterBulan_(data, false);
    const peta = data.nominal;
    if (!peta || typeof peta !== 'object' || Array.isArray(peta)) throw galat_('VALIDASI', 'Data anggaran tidak valid.');
    const kat = petaId_(bacaKategori_());
    Object.keys(peta).forEach(function (id) {
      if (!kat[id]) throw galat_('VALIDASI', 'Kategori tidak dikenal.');
      if (!nominalValid_(peta[id], true)) throw galat_('VALIDASI', 'Anggaran ' + kat[id].nama + ' harus angka bulat ≥ 0.');
    });
    return denganKunci_(function () {
      const t = bacaTabel_(SHEET.ANGGARAN);
      const k = t.kol;
      const sisa = Object.assign({}, peta);
      const cap = amanSel_(cap_());
      const rows = [];
      t.baris.forEach(function (r) {
        if (!String(r[k.Bulan]).trim()) return; // buang baris kosong sekalian
        const a = anggaranDariBaris_(t, r);
        const row = keBaris_(t, {}, r);
        if (a.bulan === f.bulan && a.pemilik === f.pemilik && a.kategoriId in sisa) {
          const n = Number(sisa[a.kategoriId]);
          delete sisa[a.kategoriId];
          if (n === 0) return; // 0 = hapus anggaran kategori itu
          row[k.Nominal] = n;
          row[k['Diubah Oleh']] = amanSel_(sesi.nama);
          row[k.Diubah] = cap;
        }
        rows.push(row);
      });
      Object.keys(sisa).forEach(function (id) {
        if (Number(sisa[id]) === 0) return;
        rows.push(keBaris_(t, {
          Bulan: amanSel_(f.bulan), Pemilik: amanSel_(f.pemilik), 'Kategori ID': id, Nominal: Number(sisa[id]),
          'Diubah Oleh': amanSel_(sesi.nama), Diubah: cap,
        }));
      });
      gantiIsiTabel_(t, rows);
      naikkanVersi_('agr');
      return true;
    });
  });
}

/** Salin anggaran bulan lalu ke bulan ini untuk kategori yang belum diisi. */
function salinAnggaran(token, filter) {
  return jalankan_(token, function (sesi) {
    const f = cekFilterBulan_(filter, false);
    return denganKunci_(function () {
      const baru = barisSalinAnggaran_(bacaAnggaran_(), geserBulan_(f.bulan, -1), f.bulan, f.pemilik);
      const cap = amanSel_(cap_());
      tambahObjek_(bacaHeader_(SHEET.ANGGARAN), baru.map(function (a) {
        return {
          Bulan: amanSel_(a.bulan), Pemilik: amanSel_(a.pemilik), 'Kategori ID': a.kategoriId, Nominal: a.nominal,
          'Diubah Oleh': amanSel_(sesi.nama), Diubah: cap,
        };
      }));
      naikkanVersi_('agr');
      return { disalin: baru.length };
    });
  });
}

// ---------- Internal ----------

/** Filter {bulan, pemilik}. Laporan boleh "Gabungan"; anggaran selalu milik satu pemilik. */
function cekFilterBulan_(filter, bolehGabungan) {
  const f = filter || {};
  const bulan = String(f.bulan || '');
  const pemilik = String(f.pemilik || '');
  if (!bulanValid_(bulan)) throw galat_('VALIDASI', 'Bulan tidak valid.');
  const boleh = semuaPemilik_().concat(bolehGabungan ? [GABUNGAN] : []);
  if (boleh.indexOf(pemilik) === -1) throw galat_('VALIDASI', 'Pilihan pemilik tidak valid.');
  return { bulan: bulan, pemilik: pemilik };
}
