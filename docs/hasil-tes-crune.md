# Hasil tes: crune vs blitz

Tanggal: 2026-11-22
Data: `archive-2026-11-22T052803Z.tar.gz` (dipulihkan ke `data/`)
Perintah: `d sim`, 50 pertarungan per tes

## Tim

| Slot | [7] dengan crune | [8] tanpa crune |
|---|---|---|
| 1 | ulquiorracifer, L50, weapon 5, pasif 24 | sama |
| 2 | stat manual 3.1.1.1.13.2, L50, weapon 124, pasif 2 | sama |
| 3 | ellie, L50, **weapon 18 (crune), pasif 5,16** | ellie, L50, **tanpa senjata** |

Lawan: **[2] blitz** — feagle / gspider / gfish, L50, semua pasif 9.
Satu-satunya perbedaan: slot 3.

## Hasil sebelum perbaikan

| Tes | Menang | Kalah | Seri |
|---|---|---|---|
| [7] dengan crune vs [2] blitz | 27 (54%) | 23 (46%) | 0 |
| [8] tanpa crune vs [2] blitz | 50 (100%) | 0 | 0 |

Konsisten di 5 seed (1, 7, 42, 99, 12345): 52-65% vs 100%.
Crune yang seharusnya menambah heal justru **menurunkan** peluang menang.

## Penyebab: tiga bug di pencurian heal Leech

Leech (buff 11) dipasang Leeching Scythe milik gspider dan gfish.
Deskripsi resmi: "The caster who applied this debuff steals -30-60% of
incoming heals and -30-60% of incoming replenishes."

### Bug 1: curian dihitung dari heal mentah, bukan heal yang masuk

`heal()` memotong jumlah heal ke sisa ruang HP **setelah** hook `healed`
dijalankan. Akibatnya Leech mencuri dari angka mentah.

| Kondisi | Target dapat | Lawan curi |
|---|---|---|
| ruang HP 10, heal 600, 1 stack 60% | 10 | **360** |

Lawan mendapat 360 HP padahal target hanya menerima 10.

### Bug 2: dua stack Leech menjumlah jadi 120%

`STACK[11]` bernilai `independent`, jadi dua unit lawan memasang dua instance.
Tiap instance memotong 60%, total 120% — heal berubah menjadi damage.

Bukti di pertarungan nyata (seed 2, turn 7): `heal ellie +633` tetapi HP ellie
berakhir **-31**.

### Bug 3: Leech seharusnya tidak menumpuk

Deskripsi Leeching Scythe: "If Leech is already on the target, deal +40-60%
more damage." Itu hanya masuk akal bila target punya **satu** instance Leech.
Data sudah menyiapkan `bonusIfBuffed: 1`, tapi aturan penumpukan tidak cocok.

## Perbaikan

1. `battleEngine.heal()` / `replenish()` — HP/WP ditambahkan lebih dulu, lalu
   hook `postHealed` / `postReplenished` menerima jumlah yang benar-benar masuk.
   Budget disimpan dan dipulihkan agar heal bersarang tidak menimpa batas.
2. `battleBuffs` Leech — pencurian dipindah dari `healed` ke `postHealed`,
   dibatasi `ctx.healBudget` sehingga total curian tidak melebihi heal masuk.
3. `STACK[11]` diubah ke aturan baru `refresh`: satu instance, durasi disetel
   ulang, nilai buff ikut yang terbaru.

## Hasil setelah perbaikan

| Tes | Menang | Kalah | Seri |
|---|---|---|---|
| [8] tanpa crune vs [2] blitz | 50 (100%) | 0 | 0 |
| [7] dengan crune vs [2] blitz | 35 (70%) | 8 (16%) | 7 (14%) |

Lima seed x 100 pertarungan: tanpa crune 100%, dengan crune 64,6%.

Seri muncul karena pertarungan menembus batas `MAX_TURNS` = 24. Ini perilaku
yang benar: heal yang bekerja membuat pertarungan lebih panjang, dan OwO
memang membatasi 24 turn.

## Catatan data

`qualityList` Celebration di repo adalah `[[20,45],[15,35]]`, sedangkan
deskripsi yang diberikan pengguna menyebut heal **20-50%** PR dan replenish
**15-40%** MR. Nilai di repo lebih rendah. Belum diubah — perlu konfirmasi
angka mana yang benar sebelum disesuaikan.

Leeching Scythe di repo: damage 50-80% STR, bonus 40-60% bila sudah ber-Leech,
curian 30-60%. Cocok dengan deskripsi.
