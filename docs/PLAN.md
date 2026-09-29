# PLAN.md

Status: **Fase 1 selesai dikode & lulus uji lokal (versi 1.0.0: `node dev/uji-e2e.js` 37 skenario, 27 tes logika)
— menunggu uji pengguna di Google (checklist README §8).**

## 1. Keputusan

| # | Topik | Masalah | Keputusan | Status |
|---|---|---|---|---|
| K1 | Masuk tanpa akun Google | Pengguna tidak ingin memakai akun Google/admin | Web App *Anyone* + pilih nama + PIN 6 digit; pemilik file mengurus lewat menu Spreadsheet | disetujui |
| K2 | Visibilitas | Pasangan/keluarga | Semua anggota melihat semua; ubah/batal hanya milik sendiri | disetujui |
| K3 | Spreadsheet | — | File baru; template lama jadi arsip | disetujui |
| K4 | Impor data lama | Membaca file lain butuh scope `spreadsheets` penuh | Salin tab Setting & Transaksi lama ke file ini, impor dari tab lokal. Scope tetap minimal. Anggaran lama tidak diimpor | otomatis |
| K5 | Akun Google untuk deploy | Akun Workspace kantor/sekolah sering melarang akses *Anyone* | Deploy dari Gmail pribadi. *File › Buat salinan* membawa script, tetapi deployment, trigger, dan sesi tidak ikut → deploy ulang & Reset PIN di salinan | disetujui |
| K6 | Tetap masuk di HP | Mengetik PIN setiap buka aplikasi merepotkan | Sesi 30 hari di ScriptProperties (bukan cache 6 jam), token di localStorage, tombol Keluar | otomatis |
| K7 | Transfer | Template lama tidak punya | Jenis `Transfer`, tidak masuk penghasilan/pengeluaran | disetujui |
| K8 | Kelompok Tabungan/Investasi | Uang ke tabungan bukan "habis" | Dihitung terpisah dari pengeluaran di ringkasan, tetap mengurangi Sisa Uang | otomatis |
| K9 | Budget bertahun-tahun ke samping | 72 kolom sulit | Anggaran per bulan, "salin dari bulan lalu" | disetujui |
| K10 | Zona waktu | — | `Asia/Jakarta` | otomatis |
| K11 | Stack & pola kode | — | Db.js, Logika.js murni + Tes.js, emulator lokal, clasp | otomatis |
| K12 | Arti progres anggaran | 100% tabungan/cicilan bukan "hampir habis" | Pengeluaran & Tagihan = batas (peringatan); Penghasilan, Hutang, Tabungan, Investasi = target ("Tercapai") | otomatis |
| K13 | Laporan per orang | Transaksi "Bersama" masuk laporan siapa? | Laporan per orang hanya pemilik persis; Bersama punya laporan sendiri; Gabungan = semua | otomatis |
| K14 | Nama pengguna | Nama dipakai sebagai kunci di data | Nama tidak bisa diganti; divalidasi unik & bukan kata sistem | otomatis |
| K15 | Tampilan | UI awal (teal) kurang cocok | Palet "Biru Tenang" dari profil ui-ux-pro-max *Personal Finance Tracker*; Beranda; tombol Catat di tengah nav; ikon per kelompok. Font Caveat usulan skill ditolak | otomatis, menunggu penilaian |
| K16 | Satu orang dulu, anggota menyusul | Aplikasi awalnya untuk tepat dua orang | Setup membuat **Pengelola**; Pengelola menambah anggota dari aplikasi (PIN sementara), reset PIN, nonaktifkan. Anggota melihat semua data. Pilihan pemilik disembunyikan selama satu anggota | disetujui |
| K18 | Audit Impeccable (28-09-2026) | Audit teknis 14/20, critique 27/40: templat "dompet digital" generik, tanpa panduan awal, lupa PIN buntu | Nuansa **hangat & personal** (pilihan pengguna): latar putih gading, ringkasan berupa kalimat + batang komposisi (bukan angka besar), *Kita bulan ini*, *Mulai cepat*, *Lupa PIN?*, error di dekat kolom, fokus ke judul saat pindah layar, target sentuh ≥ 44px, tanpa bayangan berwarna/kaca dekoratif, baris 0% & kategori kosong dilipat, cache Beranda 30 detik | disetujui |
| K19 | Bot Telegram | Mencatat tanpa membuka aplikasi | Fase 2a teks dulu (foto nota Fase 2b). Satu bot per salinan file; anggota menghubungkan chat dengan kode dari aplikasi; semua transaksi lewat konfirmasi tombol. Detail: `docs/TELEGRAM.md` | disetujui |
| K20 | Webhook Apps Script menjawab 302 | Telegram mengirim ulang update | Dedupe `update_id`; inti `prosesUpdate_` terpisah dari jalur agar bisa pindah ke polling | otomatis |
| K17 | Publikasi GitHub | Repo tidak boleh memuat data pribadi | Data contoh/tes fiktif; `.clasp.json` di-ignore; tidak ada ID file/deployment di repo | disetujui |

## 2. Fase 1 — Pencatatan, Anggaran, Laporan Bulanan (selesai)
Backend: `Code.js`, `Db.js`, `Logika.js`, `Auth.js`, `Anggota.js`, `Master.js`, `Transaksi.js`, `Laporan.js`, `Setup.js`, `Tes.js`.
Frontend: Masuk & ganti PIN → Beranda → Catat → Riwayat → Laporan → Anggaran → Atur (anggota, akun, kategori).
Dev: `dev/emulator.js`, `dev/uji-e2e.js`, `dev/server.js`, `dev/screenshot.js`.

### Kriteria selesai Fase 1
- `node dev/uji-e2e.js` lulus; `jalankanTes` di Google lulus.
- Pengelola memasang sendiri, lalu menambah anggota yang bisa masuk dari HP masing-masing.
- Laporan per orang / Bersama / Gabungan cocok dengan catatan; saldo Tunai/Bank benar.

## 3. Fase 2a — Bot Telegram: catat lewat teks (berjalan)
Urutan kerja (satu per satu):
1. Spesifikasi `docs/TELEGRAM.md` + keputusan K19–K20. ✔
2. Pengurai pesan murni di `Logika.js` (`uraiPesanBot_`, nominal/kategori/akun/pemilik) + tes. ✔
3. Jalur: `Telegram.js` (`doPost`, kirim/balas via UrlFetchApp, dedupe), menu *Hubungkan Bot Telegram*, scope baru. ✔
4. Menghubungkan anggota: API `buatKodeTelegram`, `statusTelegram`, `putuskanTelegram`; UI Atur › Telegram; `/hubung`. ✔
5. Alur draf → konfirmasi → simpan; perintah `/saldo`, `/bulanini`, `/batal`, `/bantuan`, `/putus`. ✔
6. Pengaman salinan file (ID Spreadsheet di ScriptProperties). ✔
7. Emulator: `UrlFetchApp` & Telegram tiruan; skenario e2e bot (13 skenario, total 50 lulus). ✔
8. Uji nyata dengan bot pengguna (BotFather) di Web App Anyone. ← menunggu pengguna

### Kriteria selesai Fase 2a
- `node dev/uji-e2e.js` lulus termasuk skenario bot; `jalankanTes` lulus.
- Anggota terhubung bisa mencatat "25rb makan siang" dari Telegram dan transaksinya muncul di aplikasi.
- Chat tak terhubung, grup, update ganda, dan salinan file tidak bisa mencatat apa pun.

## 3b. Fase 2b — Foto nota (menyusul)
Foto → OCR/AI vision (opsional, API key pemasang) → draf dengan konfirmasi yang sama.

## 3c. Fase 3 — Target & Tren
- Sheet `Target`: hutang (pokok, cicilan/bulan) dan tabungan (target, tenggat, pemilik — mis. tujuan Bersama).
  Progres dari transaksi kategori terkait; perkiraan tanggal tercapai.
- Grafik tren penghasilan/pengeluaran/tabungan 6–12 bulan.
- Laporan bulanan siap cetak / simpan PDF (dari browser, tanpa scope Drive).

## 4. Fase 4 — Opsional
- Jatuh tempo tagihan & pengingat di beranda.
- Transaksi berulang (gaji, cicilan) sekali klik.
