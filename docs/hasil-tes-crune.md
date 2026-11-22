# Hasil tes: crune vs blitz

Tanggal: 2026-11-22
Data: `archive-2026-11-22T052803Z.tar.gz` (dipulihkan ke `data/`)
Perintah: `d sim`, 50 pertarungan per tes (sesuai permintaan)

## Tim

| Slot | [7] dengan crune | [8] tanpa crune |
|---|---|---|
| 1 | ulquiorracifer, L50, weapon 5, pasif 24 | sama |
| 2 | stat manual 3.1.1.1.13.2, L50, weapon 124, pasif 2 | sama |
| 3 | ellie, L50, **weapon 18 (crune), pasif 5,16** | ellie, L50, **tanpa senjata** |

Lawan: **[2] blitz** — feagle / gspider / gfish, L50, semua pasif 9.

Satu-satunya perbedaan: slot 3.

## Hasil 50 pertarungan

| Tes | Menang | Kalah | Seri | Turns |
|---|---|---|---|---|
| [7] dengan crune vs [2] blitz | 27 (54%) | 23 (46%) | 0 | 3-12 |
| [8] tanpa crune vs [2] blitz | 50 (100%) | 0 | 0 | 3-6 |

Seed: 1017186874 dan 740270088.

## Diulang di beberapa seed (100 pertarungan tiap seed)

| Seed | dengan crune | tanpa crune |
|---|---|---|
| 1 | 103 menang / 97 kalah | 200 / 0 |
| 7 | 130 / 70 | 200 / 0 |
| 42 | 116 / 84 | 200 / 0 |
| 99 | 115 / 85 | 200 / 0 |
| 12345 | 104 / 96 | 200 / 0 |

Konsisten: crune menurunkan peluang menang dari 100% ke sekitar 50-57%.

## Penyebab

Diisolasi satu per satu (500 pertarungan per baris):

| Varian | Menang |
|---|---|
| tanpa crune (acuan) | 100.0% |
| crune penuh | 57.0% |
| crune tanpa passives | 55.8% |
| crune tanpa senjata | 100.0% |
| ability crune dimatikan | 100.0% |

Yang menentukan hanya **ability `celebration`**, bukan passives dan bukan stat senjata
(crune tidak punya stat sama sekali: `stats = []`).

### Mekanisme 1: heal dicuri Leech

Leech (buff 11) dipasang lawan. Setiap heal yang masuk ke unit ber-Leech
dipotong, dan potongannya jadi heal untuk lawan.

| Stack Leech | heal 600 menjadi |
|---|---|
| 1 | 240 |
| 2 | 0 |
| 3 | 0 |

Pada pertarungan nyata, 2 unit lawan memasang Leech ke unit yang sama,
jadi heal crune **100% hilang**. Heal yang hilang itu tidak jadi damage apa pun.

### Mekanisme 2: crune memakan giliran serang

Ability `celebration` tidak menghasilkan damage. Saat dipakai, unit itu
tidak melakukan basic attack pada turn tersebut.

- Damage basic attack ellie tanpa crune: **±99 per turn**
- Saat crune aktif dan heal-nya dicuri: **0 damage, 0 heal**

Jadi tiap kali crune aktif dalam kondisi itu, tim kehilangan sekitar 99 damage
dan tidak mendapat imbalan apa pun.

### Mekanisme 3: heal hanya menyasar unit HP terendah

`celebration` memilih target dengan HP terendah. Saat semua unit penuh,
ability mengembalikan `false` dan unit itu basic attack seperti biasa.
Itu sebabnya hasilnya tidak selalu 0%, tergantung urutan HP.

## Catatan

Perilaku Leech ini sesuai deskripsi buff di data (`Penyerang mencuri heal/WP yang masuk`),
jadi ini bukan bug engine. Yang perlu diputuskan: apakah `celebration` sebaiknya
melewati target yang sedang ber-Leech, atau tetap seperti sekarang.
