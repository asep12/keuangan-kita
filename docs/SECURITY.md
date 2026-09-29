# SECURITY.md

## 1. Model Ancaman
- Web App di-deploy **Execute as: Me**, **Who has access: Anyone** → siapa pun yang tahu URL bisa membuka
  halaman masuk, dan kode berjalan dengan hak pemilik Spreadsheet. PIN adalah satu-satunya penjaga.
- `google.script.run` dapat memanggil **setiap fungsi top-level tanpa akhiran `_`**.
- Anggota saling percaya (boleh melihat semua), tetapi pencatatan harus bisa dipertanggungjawabkan:
  hanya pencatat yang boleh mengubah/membatalkan transaksinya.
- Spreadsheet **tidak dibagikan** ke siapa pun selain pemilik file; anggota hanya diberi URL Web App.
- Repositori kode publik: **tidak boleh** berisi data keuangan, nama asli, nomor rekening, ID file/skrip/deployment.
  Data contoh & tes memakai nama fiktif (Budi, Sari, Dewi). `.clasp.json` (berisi scriptId) di-`.gitignore`.

## 2. Autentikasi (tanpa akun Google)
- Masuk = pilih nama anggota aktif + PIN 6 digit.
- Simpan `SHA-256(salt + PIN)` (`Utilities.computeDigest`), salt acak per pengguna.
- PIN sementara dibuat acak oleh Setup Awal, Reset PIN (menu), tambah/reset anggota (Pengelola); tampil sekali,
  `Ganti PIN = Ya`.
- PIN baru: tepat 6 digit, bukan pola lemah (`000000`, `123456`, `654321`, semua digit sama), tidak sama dengan PIN lama.
- Batas percobaan: 5 gagal per nama / 15 menit → `TERKUNCI`. Pesan gagal tidak membedakan penyebab
  (nama tak ada, nonaktif, atau PIN salah).

## 3. Sesi
- Token `Utilities.getUuid()`. Disimpan di **ScriptProperties** dengan kunci `SESI_<SHA-256 token>` (token polos tidak
  pernah disimpan) → `{n: nama, v: versi sesi, e: kedaluwarsa}`. Berlaku **30 hari**, diperpanjang (maks. sekali sehari).
  CacheService tidak dipakai untuk sesi karena maksimal 6 jam.
- Klien menyimpan token di `localStorage`; tombol Keluar menghapus token di klien dan server.
- Reset PIN / nonaktifkan anggota menaikkan `SESIVER_<nama>` → semua sesi orang itu batal seketika.
  Setiap panggilan memeriksa ulang bahwa pengguna masih ada & Aktif.
- Risiko diterima: HP yang hilang dalam keadaan tidak terkunci bisa membuka aplikasi sampai PIN di-reset.

## 4. Otorisasi
| Kemampuan | Pengelola | Anggota |
|---|---|---|
| Lihat semua transaksi, laporan, anggaran, saldo, daftar anggota | ✔ | ✔ |
| Catat transaksi (pemilik siapa pun yang aktif, atau Bersama) | ✔ | ✔ |
| Ubah / batalkan transaksi | hanya yang ia catat | hanya yang ia catat |
| Kelola akun, kategori, anggaran | ✔ (tercatat) | ✔ (tercatat) |
| Tambah anggota, reset PIN anggota, nonaktifkan/aktifkan | ✔ (tidak untuk dirinya) | ✘ `AKSES_DITOLAK` |
| Setup, impor, Reset PIN darurat | hanya lewat menu Spreadsheet (pemilik file) | ✘ |

Peran & nama selalu diambil dari sesi server (bukan argumen klien). Fungsi menu (`setupAwal`,
`imporTemplateLama`, `resetPin`) diawali `pastikanDariSpreadsheet_()` (gagal di konteks Web App → tolak).

## 5. Validasi Input
- Semua validasi diulang di server. Tolak field tak dikenal, tipe salah, angka non-finite/≤ 0/pecahan.
- Jenis ↔ kelompok kategori dicek server; akun & kategori harus ada dan Aktif.
- Nama anggota divalidasi `validNamaAnggota_` (huruf/angka/spasi/titik/tanda hubung, 2–30, unik, bukan kata sistem).
- Panjang teks: nama akun/kategori 60, keterangan 200. Teks ke sheet lewat `amanSel_()`.

## 6. Frontend
- Data dinamis via `textContent` / `createElement`. **Dilarang** `innerHTML` untuk data.
- Tidak ada skrip pihak ketiga; hanya Google Fonts.

## 7. Log & Error
- Jangan pernah menulis PIN, hash, salt, atau token ke log.
- Error tak terduga: klien menerima `kode: 'SERVER'` + pesan umum.

## 8. Scope
`spreadsheets.currentonly`, `script.container.ui`, dan `script.external_request` (hanya untuk api.telegram.org, Fase 2a).
Impor template lama membaca tab yang sudah disalin ke file ini, jadi tidak perlu izin membaca file lain.

## 9. Bot Telegram
Lihat `docs/TELEGRAM.md` §5: token & kunci webhook hanya di ScriptProperties, `doPost` menolak tanpa `?tg=<kunci>`,
update_id diproses sekali, hanya chat pribadi yang terhubung, semua transaksi lewat konfirmasi dan fungsi simpan yang
sama dengan aplikasi (`prosesSimpanTransaksi_`). Setiap panggilan API & webhook menjalankan `pastikanFileAsli_()`:
bila skrip berjalan di salinan file, token bot, sambungan chat, dan sesi warisan dibuang.
