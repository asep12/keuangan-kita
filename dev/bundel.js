/**
 * dev/bundel.js — siapkan folder dist/ untuk pemasangan tanpa terminal (salin-tempel ke editor Apps Script).
 *   node dev/bundel.js         -> tulis ulang dist/
 *   node dev/bundel.js --cek   -> keluar 1 bila dist/ tidak sama dengan sumber (dipakai uji-e2e)
 *
 * Semua file .js digabung jadi satu Keuangan.gs: Apps Script berbagi satu namespace global, dan aturan proyek
 * melarang konstanta top-level merujuk konstanta file lain, jadi urutan penggabungan aman.
 * dist/ diabaikan clasp (.claspignore) agar fungsi tidak terdaftar dua kali.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FILE_JS = ['Code.js', 'Db.js', 'Logika.js', 'Auth.js', 'Anggota.js', 'Master.js', 'Transaksi.js', 'Telegram.js',
  'Laporan.js', 'Setup.js', 'Tes.js'];
const FILE_SALIN = ['Index.html', 'Css.html', 'Js.html', 'appsscript.json'];

function isiDist() {
  const bagian = FILE_JS.map((f) => {
    const teks = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').trimEnd();
    return '// ===================================================================== ' + f + '\n\n' + teks + '\n';
  });
  const gs = [
    '/**',
    ' * Keuangan.gs — SEMUA kode server Keuangan Kita dalam satu file, untuk ditempel ke editor Apps Script.',
    ' * Dibuat otomatis oleh dev/bundel.js dari file sumber di repo; jangan diedit langsung.',
    ' * Panduan pemasangan: README.md › "Pasang tanpa terminal".',
    ' */',
    '',
  ].join('\n') + bagian.join('\n');
  const hasil = { 'Keuangan.gs': gs };
  FILE_SALIN.forEach((f) => { hasil[f] = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); });
  return hasil;
}

function cek() {
  const harap = isiDist();
  return Object.keys(harap).filter((f) => {
    const p = path.join(DIST, f);
    return !fs.existsSync(p) || fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== harap[f];
  });
}

if (require.main === module) {
  if (process.argv.includes('--cek')) {
    const beda = cek();
    if (beda.length) {
      console.error('dist/ belum diperbarui: ' + beda.join(', ') + '. Jalankan: node dev/bundel.js');
      process.exit(1);
    }
    console.log('dist/ sesuai sumber.');
  } else {
    fs.mkdirSync(DIST, { recursive: true });
    const isi = isiDist();
    Object.keys(isi).forEach((f) => fs.writeFileSync(path.join(DIST, f), isi[f]));
    console.log('dist/ ditulis: ' + Object.keys(isi).join(', '));
  }
}

module.exports = { cek, isiDist };
