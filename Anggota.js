/**
 * Anggota.js — Pengelola menambah anggota (PIN sementara), me-reset PIN, dan menonaktifkan anggota.
 * Semua anggota boleh melihat daftar; hanya Pengelola yang boleh mengubah.
 * Anggota tidak pernah dihapus: nama mereka tetap tercatat di transaksi lama.
 */

function daftarAnggota(token) {
  return jalankan_(token, function () {
    return bacaPengguna_().map(function (p) {
      return { nama: p.nama, peran: p.peran, aktif: p.aktif, wajibGantiPin: p.gantiPin };
    });
  });
}

/** data = { nama } -> { nama, pin } ; PIN sementara tampil sekali kepada Pengelola. */
function tambahAnggota(token, data) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    tolakFieldAsing_(data, ['nama']);
    return denganKunci_(function () {
      const nama = validNamaAnggota_(data.nama, bacaPengguna_().map(function (p) { return p.nama; }));
      const pin = buatPinAcak_();
      aturPin_(nama, pin, true, PERAN.ANGGOTA);
      buatAkunTunai_(nama);
      console.log('Anggota ' + nama + ' ditambahkan oleh ' + sesi.nama);
      return { nama: nama, pin: pin };
    });
  });
}

function resetPinAnggota(token, nama) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    return denganKunci_(function () {
      const p = cariAnggota_(nama);
      if (p.nama === sesi.nama) throw galat_('VALIDASI', 'Untuk PIN sendiri, pakai menu Ganti PIN.');
      const pin = buatPinAcak_();
      aturPin_(p.nama, pin, true);
      return { nama: p.nama, pin: pin };
    });
  });
}

function aturAktifAnggota(token, nama, aktif) {
  return jalankan_(token, function (sesi) {
    pastikanPengelola_(sesi);
    return denganKunci_(function () {
      const p = cariAnggota_(nama);
      if (p.nama === sesi.nama) throw galat_('VALIDASI', 'Pengelola tidak bisa menonaktifkan dirinya sendiri.');
      const t = bacaTabel_(SHEET.PENGGUNA);
      timpaObjek_(t, cariIndeks_(t, 'Nama', p.nama), { Aktif: aktif ? 'Ya' : 'Tidak', Diubah: amanSel_(cap_()) });
      cabutSesi_(p.nama); // nonaktif = semua perangkatnya langsung keluar
      return bacaPengguna_().map(function (x) { return { nama: x.nama, peran: x.peran, aktif: x.aktif, wajibGantiPin: x.gantiPin }; });
    });
  });
}

// ---------- Internal ----------

function pastikanPengelola_(sesi) {
  if (sesi.peran !== PERAN.PENGELOLA) throw galat_('AKSES_DITOLAK', 'Hanya Pengelola yang bisa mengatur anggota.');
}

function cariAnggota_(nama) {
  const p = bacaPengguna_().find(function (x) { return x.nama === String(nama || ''); });
  if (!p) throw galat_('TIDAK_ADA', 'Anggota tidak ditemukan.');
  return p;
}

/** Setiap orang baru langsung punya akun "Tunai <nama>" agar bisa mencatat tanpa menyiapkan akun dulu. */
function buatAkunTunai_(nama) {
  const t = bacaTabel_(SHEET.AKUN);
  const daftar = t.baris.filter(function (r) { return String(r[t.kol.ID]).trim(); }).map(function (r) { return akunDariBaris_(t, r); });
  const namaAkun = 'Tunai ' + nama;
  if (daftar.some(function (a) { return a.nama.toLowerCase() === namaAkun.toLowerCase(); })) return;
  tambahObjek_(t, [{
    ID: buatId_('AK-', 6, petaId_(daftar)), Nama: amanSel_(namaAkun), Jenis: 'Tunai', Pemilik: amanSel_(nama), 'Saldo Awal': 0, Aktif: 'Ya',
    Urutan: daftar.reduce(function (m, a) { return Math.max(m, a.urutan); }, 0) + 1,
  }]);
  naikkanVersi_('akun');
}
