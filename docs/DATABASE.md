# DATABASE.md

Satu Spreadsheet. Baris 1 = header (dibekukan), data mulai baris 2. Satu baris = satu catatan;
tidak ada rumus di sheet data — semua perhitungan di Apps Script.
ID dibuat server (`Utilities.getUuid()` dipendekkan). Tanggal disimpan sebagai teks `yyyy-MM-dd`
(zona `Asia/Jakarta`) agar tidak berubah oleh zona waktu dan aman dikirim ke klien.

## Pengguna
| Kolom | Isi |
|---|---|
| Nama | nama anggota (kunci, unik, tidak bisa diganti) |
| Hash PIN | SHA-256(salt + PIN), hex |
| Salt | UUID acak per pengguna |
| Ganti PIN | `Ya` bila PIN sementara |
| Diubah | waktu ISO |
| Peran | `Pengelola` (satu, dibuat Setup Awal) / `Anggota` |
| Aktif | `Ya` / `Tidak` — nonaktif tidak bisa masuk, datanya tetap |

Migrasi: baris lama tanpa Peran/Aktif diisi otomatis oleh Setup Awal (orang pertama = Pengelola, semua Aktif).

## Akun
| Kolom | Isi |
|---|---|
| ID | `AK-xxxxxx` |
| Nama | mis. `Tunai Budi`, `Bank Bersama` |
| Jenis | `Tunai` / `Bank` / `E-Wallet` |
| Pemilik | nama anggota / `Bersama` |
| Saldo Awal | angka rupiah (boleh negatif) |
| Aktif | `Ya` / `Tidak` |
| Urutan | angka, untuk tampilan |

## Kategori
| Kolom | Isi |
|---|---|
| ID | `KT-xxxxxx` |
| Kelompok | `Penghasilan` / `Pengeluaran` / `Tagihan` / `Hutang` / `Tabungan` / `Investasi` |
| Nama | mis. `Makanan & Minuman` |
| Keterangan | teks bantu |
| Aktif | `Ya` / `Tidak` |
| Urutan | angka |

## Transaksi
| Kolom | Isi |
|---|---|
| ID | `TR-xxxxxxxxxx` (impor: `TR-IMP-<NAMA>-<baris>`) |
| Tanggal | `yyyy-MM-dd` |
| Jenis | `Masuk` / `Keluar` / `Transfer` |
| Pemilik | nama anggota / `Bersama` |
| Kategori ID | kosong untuk Transfer |
| Akun ID | akun sumber (Keluar/Transfer) atau tujuan (Masuk) |
| Akun Tujuan ID | hanya Transfer |
| Nominal | bilangan bulat > 0 |
| Keterangan | ≤ 200 karakter |
| Dicatat Oleh | nama dari sesi server |
| Dibuat | waktu ISO |
| Diubah | waktu ISO / kosong |
| Status | `Aktif` / `Batal` |

Append-only kecuali pengubahan transaksi sendiri (kolom ditimpa + `Diubah`). Tidak ada penghapusan baris.

## Anggaran
| Kolom | Isi |
|---|---|
| Bulan | `yyyy-MM` |
| Pemilik | nama anggota / `Bersama` |
| Kategori ID | |
| Nominal | angka |
| Diubah Oleh | nama |
| Diubah | waktu ISO |

Kunci unik: (Bulan, Pemilik, Kategori ID). Simpan anggaran = timpa baris yang ada / tambah baris baru; 0 = hapus.

## Pengaturan
`Kunci` | `Nilai` — mis. `VERSI`, `NAMA_APLIKASI`, `MATA_UANG` (`Rp`).

## Aturan Tulis
- Semua akses sheet lewat `Db.js`; baca seluruh tabel sekali (`getValues`), tidak ada `getRange` di loop.
- Semua penulisan di dalam `denganKunci_()`.
- Teks dari pengguna ditulis lewat `amanSel_()` (cegah formula injection).
- Cache baca (CacheService) berversi; setiap tulis menaikkan versi tabel terkait.

## Impor dari Template Lama
Sumber = tab salinan template lama di file ini (nama berisi `Setting` / `Transaksi <Nama>`), bukan file lain.

| Template lama | Aplikasi |
|---|---|
| Setting › POSISI KAS | Akun (pemilik ditebak dari nama anggota di nama akun, selain itu Bersama) |
| Setting › PENGHASILAN … INVESTASI | Kategori (kelompok = judul bagian) |
| Transaksi `<Nama>` (Kategori, Sub Kategori, Masuk/Keluar, Posisi Kas) | Transaksi; Pemilik & Dicatat Oleh = anggota yang namanya ada di nama tab |
| Budget | **Tidak diimpor**: kolom kategorinya hasil ARRAYFORMULA yang rusak saat tab disalin |

Anggota dengan nama yang sama harus sudah ditambahkan sebelum impor agar transaksinya terbaca.
