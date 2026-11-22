# Hasil tes: crune vs blitz

Metode: `battleEngine.runBattle`, **200 seed per konfigurasi** (seed 1-200).
Semua angka di bawah adalah keluaran perintah, bukan perkiraan.

## Tim yang diuji

| Slot | [7] dengan crune | [8] tanpa crune |
|---|---|---|
| 1 | ulquiorracifer L50, weapon 5, pasif 24 | sama |
| 2 | 3.1.1.1.13.2 L50, weapon 124 (Conduit Claw), pasif 2 | sama |
| 3 | ellie L50, **weapon 18 (crune), pasif 5 + 16** | ellie L50, **tanpa senjata** |

Lawan: **[2] blitz** — feagle / gspider / gfish L50, semuanya pasif 9 (Mana Tap 15-30%).
gspider memakai Leeching Scythe (memasang Leech, buff 11), gfish Poison Dagger (buff 2).

Satu-satunya beda antar tim: slot 3.

## Winrate

| Konfigurasi slot 3 | Menang | % | Turn | gspider hidup di akhir |
|---|---|---|---|---|
| tanpa senjata (acuan) | 200/200 | **100%** | 4,1 | 0/200 |
| crune, tanpa pasif | 152/200 | 76% | 6,7 | 48/200 |
| crune + pasif 5 (PR +15-35%) | 174/200 | **87%** | 9,0 | 26/200 |
| crune + pasif 16 (Energize) | 152/200 | 76% | 6,7 | 48/200 |
| crune + pasif 5+16 (kondisi asli) | 132/200 | **66%** | 9,9 | **68/200** |

Pasif 16 sendirian tidak mengubah apa pun (152 vs 152, sama persis).
Pasif 5 sendirian **menaikkan** winrate 76% -> 87%.
Gabungan 5+16 justru menjatuhkan ke 66% — kombinasi inilah yang bermasalah,
bukan crune-nya sendiri.

## Komposisi yang dimaksud

Rantai yang dirancang: tank memasang taunt agar semua penyerang musuh
menyerangnya, Frost Armor (pasif 24) menempelkan Frostbite ke penyerang,
lalu Conduit Claw memindahkan satu debuff dari musuh dan memberi 120-170% MAG.

Diukur pada 100 pertarungan: **95% serangan musuh mendarat di tank**
(1.095 dari 1.150). Frostbite menumpuk di penyerang sampai 19-82 stack.
Rantai ini memang berjalan.

### Bug: penerima debuff diambil dari tim yang salah

Deskripsi resmi Conduit Claw: "Move a **debuff** from an enemy to the ally
with the most **buffs**." "Ally" adalah sekutu pemakai senjata, yaitu tim
kita. Kode lama mengambil penerima dari `target.team` — tim musuh:

```js
const receiver = target.team          // salah: tim musuh
  .filter(u => e.isAlive(u) && u !== target)
  .sort((a, b) => b.buffs.length - a.buffs.length)[0];
```

Terukur pada 200 pertarungan: **482 debuff dipindah ke tim lawan, 0 ke tim
kita**. Akibatnya Frostbite menumpuk di lawan (121 stack tersisa di akhir)
dan ability kehilangan penerima begitu tinggal satu lawan, karena
`target.team` tidak menyisakan unit lain.

Sudah diperbaiki menjadi `e.aliveOf(actor.team)`, dan `moved.from` tidak lagi
ditimpa ke pemakai claw agar sesuai "Moved buffs are calculated based on the
original caster's stats". Damage Conduit Claw terukur **1.051 per cast**,
masih dalam rentang 120-170% MAG (750 x 120-170% = 900-1.275).

### Efek perbaikan pada komposisi

| Konfigurasi | Sebelum | Sesudah |
|---|---|---|
| crune + pasif 5 | 174/200 | **200/200** |
| crune + pasif 5+16 (asli) | 132/200, 42 seri | **200/200** |
| tanpa senjata (acuan) | 200/200 | 200/200 |

Pertarungan selesai rata-rata 3,3 turn (sebelumnya 9,9). gspider tidak lagi
bertahan hidup di satu pun dari 200 pertarungan. Efek samping di tim kita
kecil: 3,2 stack Frostbite dan 0,13 unit kena Freeze per pertarungan,
karena tank menerima debuff dari Conduit Claw sendiri.

## Mekanisme: heal crune menjadi HP lawan

gspider memakai Leeching Scythe. Leech (buff 11) memotong heal yang masuk ke
target lalu **memindahkan potongan itu ke pemilik Leech**:

```js
unit.stats.hp[0] -= stolen;
e.heal(ctx, from, stolen, from);   // from = pemilik Leech (gspider)
```

Crune menghasilkan heal besar; makin besar heal, makin besar yang berpindah ke
gspider. Neraca gspider:

| Konfigurasi | Damage masuk ke gspider | Heal diterima gspider | Selisih |
|---|---|---|---|
| crune tanpa pasif | 793 | 411 | -382 |
| crune + pasif 5 | 1.393 | 958 | -435 |
| crune + pasif 16 | 793 | 411 | -382 |
| crune + pasif 5+16 | 1.568 | 1.238 | -330 |

Selisihnya selalu negatif: heal yang diterima gspider **lebih besar** daripada
damage yang kita berikan. Di konfigurasi 5+16, gspider bertahan hidup di
**68 dari 200** pertarungan, dan 42 di antaranya tidak selesai bahkan ketika
batas 24 turn dinaikkan ke 60 — HP gspider kembali penuh setiap turn.

## Kenapa pasif 5 dan 16 berbeda arah

**Pasif 5 (Physical Resistance)** menaikkan PR ellie. Heal Celebration berbasis
PR, jadi heal membesar. Tim menerima lebih banyak HP, dan kerugian curian masih
kalah oleh manfaatnya: 76% -> 87%.

**Pasif 16 (Energize)** mengisi WP tiap akhir turn. Sendirian ia tidak mengubah
apa pun (152/200 dan heal 1.600, identik dengan tanpa pasif). Baru saat
digabung pasif 5 efeknya merusak, dan penyebabnya tetap jalur Leech:

| Konfigurasi | Heal masuk tim | Heal dipindah ke gspider | gspider hidup |
|---|---|---|---|
| crune + pasif 5 | 3.510 | 958 | 26/200 |
| crune + pasif 5+16 | 4.294 | 1.238 | **68/200** |

Pasif 5 membuat heal lebih besar, dan Energize menambah panjang pertarungan
(9,0 -> 9,9 turn) sehingga lebih banyak heal yang dihasilkan. Setiap tambahan
heal itu ikut menjadi pasokan Leech: +784 heal menambah +280 heal yang
dipindahkan ke gspider. Efeknya bukan pada heal tim yang hilang, melainkan pada HP lawan yang
bertambah, sampai gspider bertahan hidup di 68 dari 200 pertarungan.

Rincian percobaan Celebration (bukan penyebab, hanya gejala):

| Konfigurasi | Cast berhasil | Gagal karena HP tim penuh | Gagal karena WP kurang |
|---|---|---|---|
| tanpa pasif | 2,7 | 3,8 | 0,0 |
| pasif 5 | 3,1 | 4,8 | 0,0 |
| pasif 16 | 2,7 | 3,8 | 0,0 |
| pasif 5+16 | 3,5 | 6,1 | 0,0 |

Kegagalan karena WP kurang nol di semua konfigurasi, jadi Energize tidak
membuat Celebration kehabisan WP. Yang naik adalah kegagalan karena HP tim
sudah penuh, seiring heal yang makin besar.

## Di mana komposisi ini pecah

Uji isolasi pada konfigurasi asli (pasif 5+16), 200 seed:

| Perlakuan | Menang | Kalah | Seri |
|---|---|---|---|
| apa adanya | 132/200 | 26 | 42 |
| Leech dimatikan | **200/200** | 0 | 0 |
| heal crune dimatikan | **200/200** | 0 | 0 |

Kedua perlakuan memberi hasil identik, karena keduanya memutus rantai yang
sama: heal crune → dicuri Leech gspider → gspider tidak pernah mati.

Polanya konsisten di semua kekalahan: gspider selesai dengan **HP 500/500
penuh** dan Frostbite 62-82 stack. Rencananya "hancurkan penyerang musuh
dulu" berhasil — feagle dan gfish mati lebih dulu — tetapi gspider tidak
pernah bisa dihabisi. Ia menerima heal curian lebih besar daripada damage
yang masuk (1.238 vs 1.568, net -330), jadi HP-nya selalu pulih penuh.

Karena itu Conduit Claw kehilangan target di fase akhir: setelah hanya
gspider tersisa, `receiver` tidak ada (tidak ada sekutu lain di tim musuh),
sehingga ability gagal dan damage 120-170% MAG tidak keluar sama sekali.
Damage yang tersisa hanya serangan dasar 88-148 per turn, jauh di bawah heal
yang dicuri gspider per turn.

Angka pada tabel di atas diukur **sebelum** bug penerima debuff diperbaiki.
Setelah perbaikan, seluruh 200 seed menang; lihat bagian bug di atas.

## Bug Leech yang ditemukan dan diperbaiki

### Bug 1: curian dihitung dari heal mentah
`heal()` menjalankan hook `healed` sebelum memotong jumlah ke sisa ruang HP.
Target dengan ruang HP 10 dan heal 600 tetap menghasilkan curian 360.

Sekarang HP ditambah dulu, lalu `postHealed` menerima jumlah yang benar-benar
masuk. Target ruang 10, heal 600, satu stack 60% -> curian 6.

### Bug 2: dua stack Leech menjumlah jadi 120%
`STACK[11] = 'independent'` membuat dua unit lawan memasang dua instance,
masing-masing 60%. Heal berubah menjadi damage. Bukti: `heal ellie +633`
tetapi HP berakhir **-31**.

Ditambahkan `ctx.healBudget` / `ctx.replenishBudget` agar total curian tidak
melebihi jumlah yang masuk.

### Bug 3: Leech seharusnya tidak menumpuk
Deskripsi Leeching Scythe menyebut "If Leech is already on the target, deal
+40-60% more damage" — hanya masuk akal bila satu instance. `STACK[11]`
diubah `'independent'` -> `'refresh'`.

Ketiga perbaikan ini mengubah besaran curian, tetapi tidak membalik arah
kesimpulan: crune tetap kalah dari tanpa senjata.

## Catatan data yang belum diselesaikan

`qualityList` Celebration di repo: `[[20,45],[15,35]]`.
Deskripsi pengguna: heal **20-50%** PR, replenish **15-40%** MR.
Nilai repo lebih rendah dari deskripsi. Belum diubah, perlu konfirmasi.
