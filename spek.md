# spek.md — Keuangan Kita

Aplikasi pencatatan & laporan keuangan pribadi/rumah tangga. Mulai dipakai **satu orang** (Pengelola);
Pengelola bisa menambah anggota (pasangan, keluarga) yang mencatat dari HP masing-masing.
Backend Google Apps Script (container-bound), frontend Web App HTML Service vanilla, database Google Sheets.
Bisa mengimpor data dari template spreadsheet "Budget Planner" versi lama (tab Setting & Transaksi).

## 1. Tujuan
1. Mencatat transaksi dari HP dalam hitungan detik.
2. Laporan bulanan yang benar dan mudah dibaca: per orang **dan** gabungan.
3. Anggaran bulanan per kategori, dibandingkan dengan realisasi.
4. (Fase 2) Memantau pelunasan hutang dan target tabungan bersama.

## 2. Pengguna & Akses
- **Pengelola**: orang pertama, dibuat saat *Setup Awal* (menu Spreadsheet menanyakan namanya).
- **Anggota**: ditambahkan Pengelola dari aplikasi (Atur › Anggota) → PIN sementara tampil sekali untuk
  diberikan ke orang itu. Pengelola juga bisa me-reset PIN anggota dan menonaktifkan/mengaktifkan lagi.
  Anggota nonaktif langsung keluar & tidak bisa masuk; catatan lamanya tetap ada dan tetap muncul di laporan.
- Masuk lewat URL Web App: pilih nama → PIN 6 digit. Tidak perlu akun Google. Wajib ganti PIN sementara.
- **Semua anggota melihat semua data** (keuangan dibuka bersama).
- Setiap orang **hanya boleh mengubah/membatalkan transaksi yang ia catat sendiri**. Riwayat tidak pernah
  dihapus: pembatalan menandai `Status = Batal`.
- Akun, kategori, dan anggaran boleh diubah semua anggota; perubahan mencatat siapa & kapan.
- Pemilik file Spreadsheet mengurus pemasangan, deploy, dan Reset PIN darurat lewat menu Spreadsheet.
- Selama baru satu anggota aktif, pilihan "milik siapa", filter per orang, dan "Bersama" disembunyikan.

## 3. Konsep Data
- **Pemilik** transaksi/akun/anggaran: nama salah satu anggota, atau `Bersama`. Laporan "Gabungan" = semua.
- **Akun**: tempat uang berada (Tunai, Bank, E-Wallet), punya pemilik & saldo awal. Setiap anggota baru
  otomatis mendapat akun "Tunai <nama>".
- **Kelompok kategori** (tetap): `Penghasilan`, `Pengeluaran`, `Tagihan`, `Hutang`, `Tabungan`, `Investasi`.
  Kategori bebas ditambah di bawah kelompoknya.
- **Jenis transaksi**:
  - `Masuk` — uang masuk ke akun; kategori wajib dari kelompok Penghasilan.
  - `Keluar` — uang keluar dari akun; kategori wajib dari kelompok selain Penghasilan.
  - `Transfer` — pindah antar akun (tarik tunai, top-up e-wallet, kirim ke rekening anggota lain).
    **Tidak** dihitung sebagai penghasilan/pengeluaran; hanya menggeser saldo akun.

## 4. Aturan Bisnis
1. Nominal bilangan bulat rupiah > 0. Tanggal tidak boleh lebih dari 1 hari di masa depan.
2. Saldo akun = saldo awal + Masuk − Keluar − Transfer keluar + Transfer masuk (transaksi `Aktif` saja).
   Saldo boleh negatif (hanya diberi peringatan) agar pencatatan tidak macet.
3. Ringkasan bulanan (per pemilik terpilih, transaksi Aktif, tanggal dalam bulan):
   - Penghasilan = Σ Masuk.
   - Pengeluaran & Tagihan, Bayar Hutang, Tabungan & Investasi = Σ Keluar per kelompok.
   - **Sisa uang bulan ini** = Penghasilan − semua Keluar.
   - Pembanding: nilai yang sama bulan sebelumnya (selisih Rp dan %).
4. Anggaran: nominal per (bulan, pemilik, kategori). Progres = realisasi ÷ anggaran.
   Pengeluaran & Tagihan adalah **batas**: ≥ 80% "Hampir habis" (kuning), > 100% "Lewat" (merah).
   Penghasilan, Hutang, Tabungan, Investasi adalah **target**: tanpa peringatan, ≥ 100% "Tercapai".
   Status selalu berupa label teks + ikon, bukan warna saja. Laporan Gabungan menjumlahkan anggaran semua pemilik.
   Tombol "Salin dari bulan lalu" untuk mengisi bulan kosong.
5. Transfer antar akun milik orang berbeda tetap Transfer (bukan penghasilan penerima).
6. Kategori/akun yang sudah dipakai tidak bisa dihapus, hanya dinonaktifkan (disembunyikan dari input).
7. Nama anggota: 2–30 huruf/angka/spasi/titik/tanda hubung, unik (tanpa beda huruf besar/kecil), bukan
   `Bersama`/`Gabungan`/`Semua`. Nama tidak bisa diganti (dipakai sebagai kunci di data).

## 5. Layar (Web App, mobile-first)
1. **Masuk**: pilih nama, isi PIN. Wajib ganti PIN sementara saat pertama masuk. Tautan *Lupa PIN?* menjelaskan
   cara reset (Anggota → Pengelola; Pengelola → menu Spreadsheet).
2. **Beranda** (layar awal), berurutan:
   - *Mulai dalam N langkah* (pemakai baru): saldo awal akun, transaksi pertama, anggaran bulan ini, dan — untuk
     Pengelola — ajak anggota. Hilang sendiri bila semua selesai, bisa dilewati per langkah atau disembunyikan.
   - Ringkasan berupa kalimat ("Bulan ini masih tersisa Rp X dari Rp Y yang masuk") + batang komposisi berlabel
     (terpakai / ditabung / sisa) + total saldo semua akun.
   - Tombol cepat Keluar / Masuk / Transfer; *Kita bulan ini* (masuk/keluar per anggota & Bersama, bila > 1 anggota);
     anggaran yang hampir habis/lewat; saldo per akun; 5 transaksi terakhir. Navigasi bawah: Beranda · Riwayat · **+ Catat** (tengah) · Anggaran · Laporan;
   Atur lewat avatar di kanan atas.
3. **Catat**: jenis (Keluar default / Masuk / Transfer), nominal besar dengan pemisah ribuan,
   kategori (yang sering dipakai di atas), akun, pemilik (default diri sendiri), tanggal (default hari ini),
   keterangan. Simpan → form siap untuk transaksi berikutnya, dengan tombol "Urungkan".
4. **Riwayat**: daftar per bulan, filter pemilik, cari. Ubah/batalkan milik sendiri.
5. **Laporan**: pilih bulan + Gabungan / per anggota / Bersama → kartu ringkasan (dengan selisih bulan lalu),
   anggaran vs realisasi per kategori, komposisi pengeluaran, saldo per akun.
6. **Anggaran**: kategori × nominal untuk bulan & pemilik terpilih, salin dari bulan lalu.
7. **Atur**: anggota (Pengelola: tambah, reset PIN, nonaktifkan), akun, kategori, ganti PIN, keluar.

## 6. Menu Spreadsheet (pemilik file)
- *Setup Awal*: membuat sheet & data awal; pada pemasangan pertama menanyakan nama Pengelola dan
  menampilkan PIN sementaranya sekali. Aman diulang (melengkapi kolom, tidak menimpa data).
- *Impor dari Template Lama*: dari tab Setting & Transaksi template lama yang disalin ke file ini.
- *Reset PIN*: PIN sementara baru untuk siapa pun (jalur darurat bila Pengelola lupa PIN).
- *Jalankan Tes Logika*.

## 7. Di Luar Lingkup Fase 1
Hutang & target tabungan dengan progres, tren 6–12 bulan, cetak/PDF laporan (Fase 2);
pengingat jatuh tempo tagihan (Fase 3, opsional). Lihat `docs/PLAN.md`.
