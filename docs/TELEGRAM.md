# TELEGRAM.md — Bot Telegram (Fase 2a: catat lewat teks)

Anggota mencatat transaksi dan melihat ringkasan lewat chat Telegram, tanpa membuka aplikasi.
Setiap salinan Spreadsheet memakai **bot sendiri** (dibuat pemasang di @BotFather); satu bot hanya bisa melayani
satu Web App.

## 1. Alur pemasangan (pemilik file)
1. Buat bot di Telegram: chat **@BotFather** › `/newbot` › salin **token** (`123456:ABC...`).
2. Spreadsheet › **Keuangan › Hubungkan Bot Telegram** › tempel token.
   Server memeriksa token (`getMe`), menyimpannya di ScriptProperties, lalu mendaftarkan webhook ke URL Web App
   (`ScriptApp.getService().getUrl()`) dengan kunci rahasia acak di parameter `?tg=<kunci>`.
3. Menu yang sama: **kosongkan token lalu OK** untuk memeriksa & memperbaiki webhook (token & kunci lama dipakai),
   atau ketik `PUTUS` untuk melepas bot.
4. **Keuangan › Status Bot Telegram** menampilkan alamat webhook (kunci disamarkan), pesan tertahan, galat terakhir
   dari Telegram, dan galat terakhir skrip (`TG_GALAT`, tanpa isi pesan). Galat tak terduga saat memproses pesan juga
   dibalas ke chat pengirim agar bot tidak diam.
5. Menu Spreadsheet tidak tampil di Google Sheets versi HP. Karena itu Pengelola juga melihat **Kondisi bot** di
   aplikasi (Atur › Telegram) dan bisa mengetuk **Perbaiki sambungan bot**: webhook dipasang ulang ke alamat
   tersimpan (`TG_URL`, diuji dulu) dengan kunci yang sama, tanpa membuang pesan tertahan.

Alamat Web App selalu diuji dulu dengan kiriman anonim (harus dijawab 200; 302 dari versi lama juga diterima). `ScriptApp.getService().getUrl()`
bisa mengembalikan deployment **@HEAD** (mode uji) yang menolak Telegram dengan 401 — bila begitu, menu meminta URL
`/exec` dari *Terapkan › Kelola deployment*. URL yang lolos disimpan (`TG_URL`).

Syarat: Web App sudah di-deploy dengan akses **Anyone** (Telegram tidak bisa login Google).

## 2. Menghubungkan anggota
1. Aplikasi › **Atur › Telegram › Hubungkan** → kode 6 digit, berlaku 10 menit, sekali pakai.
2. Tombol **Buka di Telegram** membuka `t.me/<bot>?start=KODE`; pengguna cukup menekan **Mulai** — Telegram mengirim
   `/start KODE` dan chat langsung terhubung. Cadangan manual: kirim `/hubung 482913`.
3. Chat itu kini terikat ke anggota tersebut. Satu anggota boleh terhubung dari lebih dari satu chat (HP & laptop).
- Atur › Telegram menampilkan status terhubung + **Putuskan**. Bot juga menerima `/putus`.
- Anggota yang dinonaktifkan atau di-reset PIN-nya otomatis terputus (versi sesi ikut naik).
- Hanya **chat pribadi** yang dilayani; pesan grup & chat yang belum terhubung dijawab dengan petunjuk `/hubung`.

## 3. Mencatat lewat teks
| Pesan | Dibaca sebagai |
|---|---|
| `25rb makan siang` | Keluar Rp 25.000, kategori ditebak "Makanan & Minuman", keterangan "makan siang" |
| `bensin 30k gopay` | Keluar Rp 30.000, Transportasi, akun "GoPay …" (nama akun disebut di pesan) |
| `+7,5jt gaji` / `masuk 500rb bonus` | Masuk; kategori dari kelompok Penghasilan |
| `1.250.000 listrik bersama` | Keluar, Listrik, pemilik Bersama (kata "bersama") |

- Nominal: `25000`, `25.000`, `25rb`, `25 ribu`, `25k`, `1,5jt`, `1.5 juta`. Tepat satu nominal per pesan.
- Kategori ditebak berurutan: (1) nama kategori ada di pesan, (2) kata di pesan pernah dipakai di keterangan
  transaksi kategori itu oleh orang yang sama, (3) kategori paling sering orang itu. Bila ragu, bot bertanya.
- Akun: nama akun disebut di pesan → akun itu; selain itu akun terakhir yang dipakai orang itu lewat bot; selain itu
  akun aktif pertama miliknya.
- Tanggal: hari ini (zona Asia/Jakarta). Transfer antar akun tetap lewat aplikasi (Fase 2a).
- **Tidak ada yang tersimpan tanpa konfirmasi.** Bot membalas draf dengan tombol:
  `✔ Simpan` · `Ganti kategori` · `Ganti akun` · `✖ Batal`. Draf berlaku 1 jam (CacheService), disimpan **per pesan
  bot** (`tgd:<chat>:<message_id>`) sehingga beberapa draf bisa menunggu bersamaan. Simpan mengambil & menghapus draf di
  dalam kunci (ketukan ganda tidak mencatat dua kali) dan langsung menampilkan "Menyimpan…".
- Setelah tersimpan, bot menyebut sisa anggaran kategori itu bila ada. Transaksi tercatat
  `Dicatat Oleh` = anggota yang terhubung, persis seperti dari aplikasi (aturan ubah/batal sama).

## 4. Perintah
| Perintah | Isi |
|---|---|
| `/start` | Chat baru: sapaan + 3 langkah menghubungkan lewat aplikasi (tanpa link aplikasi, karena bot bisa ditemukan siapa saja). Sudah terhubung: sapaan singkat + contoh. `/start KODE` (dari tautan) langsung menghubungkan |
| `/bantuan` | Panduan lengkap: contoh uang keluar/masuk, format nominal, tips, daftar perintah |
| `/hubung KODE` | Menghubungkan chat ke anggota |
| `/saldo` | Saldo semua akun aktif + total |
| `/bulanini` | Ringkasan bulan ini (masuk, terpakai, ditabung, sisa) + anggaran yang hampir habis/lewat |
| `/batal` | Batalkan transaksi terakhir yang **ia catat lewat bot** (dengan konfirmasi) |
| `/putus` | Putuskan chat ini |

## 5. Keamanan
- Token bot & kunci webhook hanya di ScriptProperties; tidak pernah dikirim ke klien atau ditulis ke log.
- `doPost` menolak permintaan tanpa `?tg=<kunci>` yang cocok (Apps Script tidak bisa membaca header
  `X-Telegram-Bot-Api-Secret-Token`, jadi kunci ditaruh di URL webhook).
- Webhook dijawab dengan `HtmlService` (HTTP 200). `ContentService` selalu dialihkan 302; Telegram menganggap 302
  gagal, mengulang update yang sama dengan jeda makin panjang, dan menahan pesan berikutnya (terlihat sebagai
  "Pesan tertahan" yang terus naik). Setiap `update_id` tetap diproses sekali (CacheService 6 jam).
- Isi pesan (nominal, keterangan) tersimpan juga di server Telegram — disebut di README.
- Pengaman salinan file: ScriptProperties mencatat ID Spreadsheet pemiliknya. Bila skrip berjalan di file lain
  (hasil *Buat salinan*), token bot, sambungan chat, dan semua sesi dari file asal diabaikan & dibersihkan.
- Scope baru: `script.external_request` (UrlFetchApp ke api.telegram.org). Pemilik file menyetujui sekali.

## 6. Cadangan: mode polling
Bila webhook bermasalah di akun tertentu, menu **Keuangan › Hubungkan Bot Telegram** menawarkan mode polling:
trigger tiap 1 menit memanggil `getUpdates` (webhook dilepas). Butuh scope `script.scriptapp`. Balasan bisa
tertunda hingga ±1 menit. Inti pemroses (`prosesUpdate_`) sama untuk kedua mode.

## 7. Di luar Fase 2a
Foto nota (Fase 2b, OCR/AI vision, opsional dengan API key pemasang), transfer lewat bot, pengingat terjadwal.
