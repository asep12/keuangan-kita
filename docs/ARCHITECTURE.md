# ARCHITECTURE.md

## Peta file
| File | Isi |
|---|---|
| `Code.js` | `doGet`, `include`, menu `onOpen`, pembungkus `jalankan_`, `galat_`, `denganKunci_`, util tanggal |
| `Db.js` | `SKEMA`, baca/tulis tabel berdasar nama header, pemetaan baris→objek, cache berversi |
| `Logika.js` | fungsi murni: validasi, saldo, ringkasan, anggaran, impor Setting lama |
| `Auth.js` | masuk/keluar/ganti PIN, sesi di ScriptProperties |
| `Telegram.js` | bot Telegram: webhook `doPost`, draf & konfirmasi, perintah, menu pasang bot, pengaman salinan file |
| `Anggota.js` | daftar/tambah anggota, reset PIN anggota, nonaktifkan (khusus Pengelola) |
| `Master.js` | `muatAwal`, akun, kategori |
| `Transaksi.js` | simpan/ubah/batal, riwayat |
| `Laporan.js` | laporan bulanan, anggaran |
| `Setup.js` | menu Setup Awal, Impor Template Lama, Reset PIN |
| `Tes.js` | `jalankanTes` untuk Logika.js |
| `Index.html`, `Css.html`, `Js.html` | Web App satu halaman |
| `dev/` | emulator Apps Script, uji e2e, server lokal, `bundel.js` (tidak di-push) |
| `dist/` | hasil `dev/bundel.js`: `Keuangan.gs` (semua kode server) + HTML + manifest untuk pemasangan salin-tempel; diabaikan clasp |

## Alur request
Klien `api(nama, ...)` → `google.script.run[nama](token, ...)` → fungsi publik → `jalankan_(token, fn)`
→ `cekSesi_` → `fn(sesi)` → `{ok, data}`. Error bisnis (`galat_`) diteruskan apa adanya; error lain jadi `SERVER`.

## Alur tulis
Semua tulis di `denganKunci_` (script lock 10 detik). Tabel dibaca segar dari sheet di dalam kunci (bukan dari cache),
ditulis dengan satu `setValues` per operasi, lalu `naikkanVersi_(nama)` membuang cache tabel itu.

## Cache
`denganCache_(nama)`: JSON dipotong 50 KB per kunci di CacheService, kunci memuat versi dari ScriptProperties
(`VER_trx`, `VER_akun`, `VER_kat`, `VER_agr`, `VER_user`, `VER_atur`). TTL 10 menit.

## Sesi
`SESI_<hash token>` di ScriptProperties → `{n: nama, v: versi sesi, e: kedaluwarsa ms, t: terakhir diperpanjang}`.
Versi sesi per nama (`SESIVER_<nama>`) naik saat Setup/Reset PIN → semua perangkat orang itu keluar.

## Perhitungan
Semua dihitung di server dari tabel Transaksi (tidak ada rumus di sheet). Saldo akun = saldo awal + Masuk − Keluar ± Transfer.
Laporan per pemilik menyaring kolom Pemilik; Gabungan = semua. Transfer tidak masuk ringkasan.

## Frontend
Satu IIFE di `Js.html`. State di objek `S`; setiap layar punya `muatX`/`renderX`. Elemen dibuat lewat `h()` (textContent).
Token di `localStorage` (`kk_token`) agar HP tetap masuk; dihapus saat Keluar/sesi habis.
