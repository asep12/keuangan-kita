# API.md — kontrak fungsi backend (`google.script.run`)

Semua fungsi publik mengembalikan `{ ok: true, data }` atau `{ ok: false, kode, pesan }`.
Argumen pertama `token` (kecuali `daftarNama`, `masuk`). Nama pengguna selalu dari sesi, tidak pernah dari argumen.
Tanggal `yyyy-MM-dd`, bulan `yyyy-MM`, uang bilangan bulat rupiah. Tidak ada objek `Date` di hasil.

Kode galat: `VALIDASI`, `SESI_HABIS`, `WAJIB_GANTI_PIN`, `TERKUNCI`, `AKSES_DITOLAK`, `TIDAK_ADA`, `SIBUK`, `BELUM_SETUP`, `SERVER`.

## 1. Sesi (Auth.js)
| Fungsi | Masukan | Hasil |
|---|---|---|
| `daftarNama()` | — | nama anggota aktif, mis. `['Budi','Sari']` |
| `masuk(nama, pin)` | PIN 6 digit | `{ token, nama, wajibGantiPin, peran }` |
| `keluar(token)` | — | `true` |
| `infoSesi(token)` | — | `{ nama, wajibGantiPin, peran }` |
| `gantiPin(token, pinLama, pinBaru)` | | `true` |

`muatAwal` dan semua fungsi di bawah menolak dengan `WAJIB_GANTI_PIN` selama PIN masih sementara.

## 1b. Anggota (Anggota.js)
| Fungsi | Siapa | Masukan | Hasil |
|---|---|---|---|
| `daftarAnggota(token)` | semua | — | `[{ nama, peran, aktif, wajibGantiPin }]` |
| `tambahAnggota(token, { nama })` | Pengelola | nama baru | `{ nama, pin }` (PIN sementara, tampil sekali; akun "Tunai <nama>" dibuat) |
| `resetPinAnggota(token, nama)` | Pengelola | bukan diri sendiri | `{ nama, pin }` (semua sesi orang itu dicabut) |
| `aturAktifAnggota(token, nama, aktif)` | Pengelola | bukan diri sendiri | daftar anggota terbaru |

Selain Pengelola → `AKSES_DITOLAK`.

## 1c. Telegram (Telegram.js)
| Fungsi | Masukan | Hasil |
|---|---|---|
| `buatKodeTelegram(token)` | — | `{ kode, bot, berlakuMenit }` (kode sekali pakai untuk `/hubung`); `BELUM_ADA_BOT` bila bot belum dipasang |
| `statusTelegram(token)` | — | `{ bot|null, chat: [{ label, sejak }], diagnosa? }` milik pengguna ini; `diagnosa` (hanya Pengelola): `{ tokenSah, webhookCocok, tertahan, galatTelegram, galatSkrip }` |
| `perbaikiWebhookTelegram(token)` | — | Pengelola: pasang ulang webhook ke `TG_URL` (diuji dulu), kunci tetap → `diagnosa` |
| `putuskanTelegram(token)` | — | `true` (semua chat pengguna ini diputus) |
| `doPost(e)` | webhook Telegram | hanya diproses bila `e.parameter.tg` = kunci webhook; selalu menjawab `ok` via HtmlService (HTTP 200) |

Menu Spreadsheet: `hubungkanBotTelegram` (pasang/ganti token, `PUTUS` untuk melepas). Detail: `docs/TELEGRAM.md`.

## 2. Data awal & master (Master.js)
| Fungsi | Masukan | Hasil |
|---|---|---|
| `muatAwal(token)` | — | `{ sesi, aplikasi:{nama,versi,hariIni}, pengguna (aktif), pemilik (aktif + Bersama), semuaPemilik (termasuk nonaktif), kelompok, jenisAkun, akun[], kategori[], saldo:{akunId:n}, sering:{Masuk:[id],Keluar:[id]} }` |
| `simpanAkun(token, a)` | `{ id?, nama, jenis, pemilik, saldoAwal, aktif }` | `{ id, akun[] }` |
| `simpanKategori(token, k)` | `{ id?, kelompok, nama, keterangan, aktif }` | `{ id, kategori[] }` |

Objek akun: `{ id, nama, jenis, pemilik, saldoAwal, aktif, urutan }`.
Objek kategori: `{ id, kelompok, nama, keterangan, aktif, urutan }`.

## 3. Transaksi (Transaksi.js)
| Fungsi | Masukan | Hasil |
|---|---|---|
| `simpanTransaksi(token, t)` | `{ id?, tanggal, jenis, pemilik, kategoriId?, akunId, akunTujuanId?, nominal, keterangan }` | `{ transaksi, saldo }` |
| `batalkanTransaksi(token, id)` | | `{ transaksi, saldo }` |
| `riwayat(token, { bulan })` | | `{ bulan, transaksi[] }` (termasuk Batal, terbaru dulu) |

Dengan `id` = ubah; hanya pencatat & status Aktif (`AKSES_DITOLAK` / `VALIDASI`).
Objek transaksi: `{ id, tanggal, jenis, pemilik, kategoriId, akunId, akunTujuanId, nominal, keterangan, dicatatOleh, dibuat, diubah, status }`.

## 4. Laporan & anggaran (Laporan.js)
| Fungsi | Masukan | Hasil |
|---|---|---|
| `laporanBulanan(token, { bulan, pemilik })` | pemilik boleh `Gabungan` | lihat di bawah |
| `getAnggaran(token, { bulan, pemilik })` | pemilik bukan `Gabungan` | `{ bulan, pemilik, nominal:{katId:n}, realisasi:{katId:n}, bisaSalin }` |
| `simpanAnggaran(token, { bulan, pemilik, nominal:{katId:n} })` | 0 = hapus | `true` |
| `salinAnggaran(token, { bulan, pemilik })` | dari bulan sebelumnya | `{ disalin }` |

`laporanBulanan` → `{ bulan, pemilik, ringkasan, lalu, selisih, anggaran[], komposisi[], saldo[], totalSaldo, sampai }`:
- `ringkasan`/`lalu`: `{ penghasilan, pengeluaran (Pengeluaran+Tagihan), hutang, tabungan (Tabungan+Investasi), keluar, sisa, perKelompok, jumlahTransaksi }`
- `selisih.<kunci>`: `{ nilai, persen|null }` terhadap bulan lalu.
- `anggaran[]`: `{ kategoriId, nama, kelompok, anggaran, realisasi, sisa, progres|null, status }`,
  status `aman`/`waspada`/`lewat`/`tanpa`/`kosong` untuk Pengeluaran & Tagihan; `target`/`kosong` untuk kelompok target.
- `komposisi[]`: `{ kategoriId, nama, kelompok, nominal, porsi }` terbesar dulu.
- `saldo[]`: `{ id, nama, jenis, pemilik, saldo }` per `sampai` (akhir bulan).

## 5. Menu Spreadsheet (bukan untuk klien)
`setupAwal`, `imporTemplateLama`, `resetPin` — ditolak di konteks Web App (`pastikanDariSpreadsheet_`).
`jalankanTes` — fungsi murni, tanpa efek tulis.
