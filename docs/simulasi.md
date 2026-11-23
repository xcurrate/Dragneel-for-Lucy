# 📖 Panduan Simulasi Battle

Panduan ini menjelaskan pemakaian fitur simulasi dari nol sampai membaca
hasilnya. Semua contoh memakai prefix `d` (bawaan). Kalau prefix server kamu
berbeda, ganti `d` dengan prefix tersebut.

---

## Langkah 1 — Buat tim dulu

Simulasi butuh tim, jadi ini selalu langkah pertama. Ada **2 cara** membuat tim.

### Cara 1 — Susun manual (isi slot satu per satu)

Cocok kalau kamu mau mengatur sendiri hewan, senjata, dan pasifnya.

```
d team new Rocket
```

Tim baru otomatis jadi tim aktif. Balasannya menyebut ID tim, misalnya
`[1] Rocket`. ID itu yang dipakai untuk memanggil tim ini nanti.

Lalu isi slotnya. Satu tim punya **3 slot**:

```
d team add 1 snail level=50 weapon=gsword passive=12
d team add 2 snail level=50 weapon=bow passive=12
d team add 3 hp=14,att=6,pr=2,wp=3,mag=0,mr=1 level=50
```

Tiga hal yang perlu diketahui:

- **Hewan dex** diisi namanya (`snail`). Stat-nya diambil otomatis dari dex.
- **Stat manual** diisi 6 angka berurutan: `hp,att,pr,wp,mag,mr`. Berguna untuk
  meniru pet yang belum ada di dex.
- **Senjata wajib punya pasif.** `weapon=gsword` tanpa `passive=` ditolak dengan
  pesan "butuh minimal 1 pasif". Di `d team add`, pasif ditulis sebagai **ID
  angka** (`passive=12`), bukan nama. Beberapa pasif sekaligus dipisah koma:
  `passive=1,12`.

Kalau ingin menulis pasif dengan **nama**, pasang senjatanya lewat `d tm s`:

```
d tm s gsword crit
d tm s bow crit 2        ← angka terakhir = nomor slot
```

Menambah opsi lain pada slot:

```
d team add 1 snail level=80 weapon=gsword passive=1,12 quality=80 label=tank
```

`quality=80` memasang kualitas senjata 80%. Kalau tidak diisi, kualitas
mengikuti default (100%).

### Cara 2 — Impor dari kartu tim Lucy

Cocok kalau kamu sudah punya tim di OwO/Lucy dan tidak mau mengetik ulang.

1. Kirim (atau biarkan muncul) kartu tim Lucy di channel. Kartu itu pesan dari
   bot Lucy yang berisi baris `**[1] ...**`, `**[2] ...**`, `**[3] ...**` beserta
   stat, level, senjata, dan pasif.
2. Bot menambahkan reaksi **📊** otomatis pada kartu tersebut.
3. Klik reaksi **📊** itu.
4. Bot membalas `✅ Tim **Lucy Import - <nama>** berhasil diimpor (N slot)`.

Stat, level, senjata, dan pasif ikut tersalin, jadi hasilnya langsung siap
dipakai simulasi. Satu kartu hanya bisa diimpor sekali; kalau ingin mengulang,
kirim kartu baru atau hapus dulu tim hasil impor.

> Kalau reaksi 📊 tidak muncul, berarti pesan itu tidak dikenali sebagai kartu
> tim Lucy. Pastikan pesannya dari bot Lucy dan berisi baris `**[1]` dan
> seterusnya — bukan screenshot atau teks yang disalin ulang.

---

## Langkah 2 — Cek timnya sudah benar

Sebelum simulasi, lihat dulu isinya. Ini juga cara tercepat menemukan slot yang
masih kosong.

```
d tm
```

Panel menampilkan komposisi tim aktif beserta tombol:

| Tombol | Fungsi |
| --- | --- |
| ◀ ▶ | pindah ke tim sebelumnya / berikutnya |
| menu pilih | lompat langsung ke tim tertentu |
| 🗑️ Hapus | hapus tim yang sedang tampil (ada konfirmasi) |

Untuk melihat semua tim sekaligus beserta ID-nya:

```
d team list
```

Tim bertanda ✅ adalah tim aktif. Untuk mengganti tim aktif:

```
d team pick 2
d team pick Rocket
```

Tim yang masih kosong **tidak bisa** dipakai simulasi; bot menolak dengan pesan
"Tim ... masih kosong".

---

## Langkah 3 — Jalankan simulasi

`d sim` punya dua bentuk hasil:

- **Tanpa `-m`** → **satu** pertarungan. Hasilnya kondisi akhir tiap hewan:
  sisa HP/WP dan senjatanya, plus siapa yang menang dan dalam berapa turn.
  Footer-nya merangkum dua hal sekaligus: hasil pertarungan itu, lalu rekap
  50 pertarungan untuk matchup yang sama:

  ```
  🏆 kamu menang dalam 7 turn | 🎲 48 win, 2 lose, 0 tie
  ```

### Menyaring hasil: `-win`, `-lose`, `-tie`

Ketiga flag ini mengulang pertarungan sampai hasilnya cocok, lalu hasil itu yang
ditampilkan. Berguna untuk melihat seperti apa kondisi saat timmu kalah.

```
d sim 2 -lose              → satu pertarungan yang kalah
d sim 2 -win               → satu pertarungan yang menang
d sim 2 -tie               → satu pertarungan yang seri
d sim 2 -lose -m 20        → statistik dari 20 pertarungan yang kalah
```

Footer tetap memakai format biasa:

```
💀 kamu kalah dalam 12 turn | 🎲 0 win, 50 lose, 0 tie
```

Kalau tidak ada pertarungan yang cocok, perintahnya dilaporkan gagal, bukan
menampilkan hasil lain. Tanpa `-m`, dicoba 50 pertarungan (jumlah yang sama
dengan rekap footer). Dengan `-m N`, dijalankan tepat N pertarungan lalu
dihitung yang cocok saja.
- **Dengan `-m <jumlah>`** → statistik dari banyak pertarungan (menang/kalah/seri,
  distribusi turn). Default-nya 50 kalau `-m` disebut tanpa angka.

### Lawan tim milikmu sendiri

```
d sim                 → tim aktif melawan salinan dirinya sendiri (mirror)
d sim 2               → tim aktif melawan tim ID 2
d sim Blue            → tim aktif melawan tim bernama Blue
d sim 1 vs 2          → tim ID 1 melawan tim ID 2
d sim Rocket vs Blue  → memakai nama tim
```

`mirror` artinya tim diadu dengan salinan persisnya. Berguna untuk melihat
seberapa besar pengaruh RNG: kalau winrate jauh dari 50%, berarti urutan
serangan ikut menentukan.

### Lawan dari dex atau stat manual

Cara ini tidak perlu membuat tim lawan lebih dulu:

```
d sim snail level=60
d sim hp=14,att=6,pr=2,wp=3,mag=0,mr=1 level=60
```

### Komposisi inline

Kedua sisi juga bisa ditulis langsung sebagai komposisi, tanpa membuat tim:

```
d sim snail sword crit mtap, snail Aegis 100,50 sac 10,10 vs 100 snail
```

Artinya:

- `snail sword crit mtap` — snail dengan **Great Sword**, pasif **Critical** dan **Mana Tap**.
- `snail Aegis 100,50 sac 10,10` — snail dengan **Defender's Aegis**,
  quality taunt **100** dan quality biaya WP **50**, pasif **Sacrifice** dengan
  quality heal **10** dan replenish **10**.
- `100 snail` — lawan snail level **100**.

Aturannya:

- Koma memisahkan unit. Koma di dalam angka adalah quality, mis. `100,50`.
- Angka di depan hewan adalah level, mis. `100 snail`. Tanpa angka, level
  memakai default **50** (sama dengan `d team add`).
- Setelah senjata, daftar angka adalah quality senjata. Setelah pasif, daftar
  angka adalah quality pasif itu.
- Jumlah pasif harus sesuai senjata, sama seperti `d tm s`.

### Mengatur jumlah pertarungan

```
d sim -m 100
d sim 1 vs 2 -m 200
```

Makin banyak pertarungan, makin stabil angka winrate-nya. Batasnya **200 per
perintah** untuk user biasa (developer bisa mengubahnya lewat `d sim limit`).

Tanpa `-m`, tombol 🔁 di bawah hasil tetap mengulang matchup yang sama sebanyak
50 pertarungan sekaligus — jadi kamu bisa melihat satu pertarungan dulu, lalu
langsung cek statistiknya tanpa mengetik ulang.

### Mengatur level dan kualitas senjata

```
d sim 1 vs 2 lvl100         → kedua sisi level 100
d sim 1 vs 2 lvl100/40      → kita 100, lawan 40
d sim 1 vs 2 lvl/40         → kita tetap, lawan 40
d sim 1 vs 2 -qp 100 -qe 10 → senjata kita 100%, senjata lawan 10%
```

`-qp` mengatur kualitas senjata sisi kita, `-qe` sisi lawan. Kualitas yang
terpasang langsung di slot **menang** atas flag ini. Jadi kalau hasilnya tidak
berubah, cek dulu apakah slotnya sudah punya `quality=` sendiri.

`-s <seed>` mengulang hasil yang sama persis:

```
d sim 1 vs 2 -m 100 -s 42
```

---

## Langkah 4 — Simulasi global (melawan semua tim)

Kalau kamu sudah punya beberapa tim, `d sim global` mengadu tim aktif melawan
**seluruh tim tersimpan** sekaligus. Ini cara tercepat menjawab "timku kuat
tidak dibanding semua timku?".

```
d sim global
```

Opsinya sama seperti `d sim`:

```
d sim global -m 100          → 100 pertarungan per tim lawan
d sim global -total 1000     → total 1000 pertarungan, dibagi rata
d sim global lvl60           → semua lawan disamakan level 60
d sim global -qp 100 -qe 10  → senjata kita 100%, senjata lawan 10%
```

Batasnya **100 pertarungan per tim** dan **10 juta pertarungan** per perintah.
Cooldown-nya 10 detik.

Tim yang sedang dipilih **tidak ikut diadu**, karena itulah tim kamu sendiri.
Tim kosong dilewati dan jumlahnya dicatat di hasil.

---

## Langkah 5 — Membaca hasil

### Hasil `d sim`

```
🏆 37 menang (74%)      ← berapa kali menang, beserta persentasenya
   Turns: 6 (×13), ...  ← distribusi jumlah turn; makin panjang makin ketat
💀 13 kalah (26%)       ← berapa kali kalah
⚖️ 3 seri (6%)          ← hanya muncul kalau ada yang seri
```

Bagian atas embed menampilkan komposisi kedua sisi. Arti ikonnya:

| Ikon | Arti |
| --- | --- |
| 🐾 | hewan |
| 🔴 🟡 🟠 🟣 🔵 🟢 ⚪ | peringkat kualitas senjata, dari tertinggi (fabled) ke terendah (common) |
| ⚔️ | senjata |
| ✨ | pasif |
| `100%` | kualitas senjata |

Di footer ada jumlah simulasi dan **seed**. Seed inilah yang bisa kamu masukkan
lewat `-s` untuk mengulang hasil yang sama.

### Tombol 🔁

Setiap hasil punya tombol **🔁** untuk mengulang matchup yang sama. Hasilnya
hanya terlihat olehmu (ephemeral) dan memakai komposisi serta kualitas yang
sama persis dengan hasil sebelumnya.

### Hasil `d sim global`

| Bagian | Isi |
| --- | --- |
| 🪖 Komposisi tim kamu | tim yang kamu pakai |
| 🔅 Max level < 35 | hasil melawan tim berlevel di bawah 35 |
| 🔆 Max level ≥ 35 | hasil melawan tim berlevel 35 ke atas |
| 📊 Rekap | total menang / seri / kalah |
| 🔥 Streak | rata-rata dan kemenangan beruntun terpanjang |
| 📉 Kalah per tim | rata-rata berapa kali kalah per tim lawan |

Hasil dipisah pada level 35 supaya tidak tertipu: menang banyak melawan tim
level rendah tidak berarti timmu kuat.

Tombol **Lihat kekalahan** menampilkan tim mana saja yang mengalahkan kamu.
Hanya terlihat olehmu, dan senjata lawan disembunyikan.

---

## Ringkasan perintah

| Perintah | Fungsi |
| --- | --- |
| `d team new <nama>` | buat tim baru (langsung aktif) |
| `d team add <slot> <hewan\|stat> [level=] [weapon=] [passive=] [quality=]` | isi satu slot |
| `d tm s <senjata> [pasif] [slot]` | pasang / ganti senjata |
| `d tm` | panel tim (pindah, pilih, hapus) |
| `d team list` | daftar semua tim + ID |
| `d team pick <id\|nama>` | jadikan tim aktif |
| `d team show [id\|nama]` | lihat isi satu tim |
| `d team clear <slot>` | kosongkan slot |
| `d team rename <lama> <baru>` | ganti nama tim |
| `d team del <id\|nama>` | hapus tim |
| `d sim` | tim aktif vs mirror |
| `d sim <id\|nama>` | tim aktif vs tim lain |
| `d sim A vs B` | dua tim milikmu diadu |
| `d sim <hewan> level=N` | lawan dari dex |
| `d sim <stat manual> level=N` | lawan dari stat manual |
| `d sim global` | tim aktif vs semua tim tersimpan |
| `d sim help` / `d sim global help` | bantuan di Discord |

---

## Kalau ada yang tidak jalan

| Pesan | Penyebab dan solusi |
| --- | --- |
| `Belum ada tim aktif` | buat tim dulu: `d team new <nama>` |
| `Tim ... masih kosong` | isi minimal satu slot: `d team add 1 <hewan>` |
| `... butuh minimal 1 pasif` | tambahkan `passive=<id>` saat memasang senjata |
| `Senjata ... tidak dikenal` | cek nama senjata yang tersedia, atau pakai alias yang benar |
| `Slot ... masih kosong` | isi hewannya dulu sebelum memasang senjata lewat `d tm s` |
| `Tunggu 5.0 detik lagi` | cooldown `d sim` 5 detik; tunggu sebentar |
| `Simulasi global baru bisa dipakai lagi dalam ...` | cooldown `d sim global` 10 detik |
| `Maksimum ... pertarungan per tim` | turunkan `-m`, atau minta developer menaikkan `d sim global limit` |
| `Belum ada tim lawan yang bisa dipakai` | `d sim global` butuh minimal satu tim lain; buat tim kedua |
| `Butuh 6 angka (hp,att,pr,wp,mag,mr)` | stat manual harus tepat 6 angka, mis. `hp=14,att=6,pr=2,wp=3,mag=0,mr=1` |
| `Pesan tim Lucy ini sudah kamu impor sebelumnya` | kartu itu sudah pernah diimpor; pakai kartu baru |
