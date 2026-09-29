# CLAUDE.md — Keuangan Kita (Google Apps Script)

Aplikasi pencatatan & laporan keuangan pribadi/rumah tangga (Pengelola + anggota). Backend Apps Script (container-bound), frontend Web App
HTML Service vanilla, database Google Sheets. Bahasa antarmuka & komentar: Indonesia.
Pola kode: Db.js (akses sheet), Logika.js murni + Tes.js, emulator lokal di `dev/`.

## Baca dulu sebelum mengubah kode
- `spek.md` — sumber kebenaran fitur & aturan bisnis.
- `docs/DATABASE.md` — skema sheet & aturan tulis.
- `docs/SECURITY.md` — PIN tanpa akun Google, sesi, otorisasi.
- `docs/PLAN.md` — keputusan & rencana per fase.
- `docs/API.md` — kontrak fungsi backend.
- `docs/TELEGRAM.md` — bot Telegram (Fase 2a): pemasangan, format pesan, keamanan.
- `docs/ARCHITECTURE.md` — peta file, alur request/tulis, cache, sesi.

## Perintah
```bash
node dev/uji-e2e.js   # uji backend di emulator (wajib lulus sebelum selesai)
node dev/bundel.js    # perbarui dist/ (file salin-tempel untuk pemasangan tanpa terminal) setiap kode berubah
node dev/server.js    # Web App lokal http://localhost:8788 (akun uji di AKUN_UJI)
clasp push            # unggah kode ke proyek Apps Script
```
`dev/emulator.js` meniru layanan Apps Script; bila kode memakai layanan/metode baru, perluas emulatornya.

## Aturan kerja
1. Kerjakan **satu fase** saja, berhenti di akhir fase untuk diuji pengguna.
2. Bila permintaan bertentangan dengan dokumen di atas, **tanyakan dulu**.
3. Setiap perubahan skema/kontrak/aturan → perbarui dokumen terkait di perubahan yang sama.

## Aturan wajib
- Fungsi yang bukan API publik berakhiran `_`.
- Semua akses sheet lewat `Db.js`; tidak ada `getRange` di dalam loop.
- Semua penulisan data di dalam `denganKunci_()`.
- Nilai kembalian ke klien tanpa objek `Date` — tanggal selalu string.
- Nama pengguna selalu dari sesi server, tidak dari argumen klien.
- Frontend: data dinamis via `textContent`, **tidak pernah** `innerHTML`.
- Konstanta top-level tidak merujuk konstanta file lain — pakai fungsi.
- Repo publik: **jangan** menulis data keuangan, nama asli, nomor rekening, atau ID file/skrip/deployment ke kode,
  tes, maupun dokumen. Data contoh memakai nama fiktif (Budi, Sari, Dewi).
