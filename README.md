# Lucy Boss Tracker

Bot Discord Node.js untuk memantau pesan Components V2 dari bot Lucy, membaca timestamp Boss baru, lalu mengirim notifikasi saat waktunya tiba.

## Fitur
- Membaca timestamp Discord khusus pada baris Boss baru.
- Memantau pesan baru dan pesan yang diperbarui dari Lucy.
- Notifikasi channel server dengan role mention yang dikonfigurasi moderator/admin.
- Preferensi DM pribadi per anggota: DM, channel (tanpa DM), atau keduanya.
- DM peringatan sebelum boss muncul.
- Panel Components v2 untuk preferensi pribadi.
- Perintah slash dan prefix dengan alias per subperintah.
- Auto Thread Rep: membuat thread dari pesan *rep dengan mention target yang benar pada channel yang dipilih; instruksi rep dikirim sebagai teks untuk disalin, bukan dieksekusi.
- Web Control Dashboard lokal untuk konfigurasi fitur dan runtime logs.
- Konfigurasi tersimpan dan jadwal dipulihkan setelah restart.

## Web Control Dashboard

Dashboard memiliki kategori Overview, Boss Tracker, Auto Thread Rep, Lucy Counter, Boss Reward Reminder, Notes, dan System Logs.

Pengaturan Boss Tracker: ON/OFF, channel notifikasi, role mention, prefix server, dan status waktu boss berikutnya.

Pengaturan Auto Thread Rep: ON/OFF, **channel pemicu khusus**, target Discord user ID, nominal rep, awalan nama thread, dan durasi auto-archive. Fitur hanya memproses pesan *rep yang dikirim di channel Auto Thread Rep yang dipilih. Channel ini terpisah dari channel notifikasi Boss Tracker.

Notes: catatan bebas per server (judul + isi), bisa ditambah, diedit, dan dihapus langsung dari dashboard. Catatan disimpan di `data/notes.json` dan hanya berlaku untuk server yang sedang dipilih.

Kotak log menampilkan log runtime terbaru secara otomatis. Buffer menyimpan maksimal 300 entri terakhir di memori proses.

Pengaturan pribadi per anggota (mode DM dan waktu DM peringatan) tetap dikelola oleh masing-masing anggota melalui perintah /boss menu. Dashboard mengatur konfigurasi fitur pada tingkat server dan tidak menimpa preferensi pribadi tersebut.

### Akses dashboard developer

Tidak menggunakan OAuth atau login Discord. Untuk hosting Pterodactyl, dashboard bind ke `0.0.0.0` agar dapat menerima koneksi dari allocation port container. Atur `DASHBOARD_PORT` ke port allocation di panel (contoh `4002`), `DASHBOARD_HOST=0.0.0.0`, dan isi `DASHBOARD_TOKEN` dengan secret acak minimal 24 karakter melalui Environment Variables di panel. Buka `http://bt1.luckystore.id:4002` (ganti host/port sesuai allocation). Saat pertama dibuka, masukkan token tersebut; token disimpan hanya di session browser. API dashboard menolak request tanpa token. Jangan pernah memasukkan token ke source code atau membagikannya. Jika panel memakai proxy HTTPS, akses melalui URL HTTPS yang disediakan panel.

## Untuk semua anggota
- /boss menu — panel pengaturan pribadi.
- /boss notify mode:... — pilih mode DM, channel, atau keduanya.
- /boss warn detik:60 — atur DM peringatan sebelum boss muncul (0 = matikan).
- /boss on dan /boss off — aktifkan/matikan DM pribadi.
- /boss status — lihat status tracker dan waktu boss berikutnya.
- /boss help — panduan singkat.

Versi prefix (prefix default `d`, inisial bot Dragneel). Fitur boss ada di bawah kategori `boss`,
perintah tingkat bot langsung mengikuti prefix:
- d boss notify dm / d boss notify channel / d boss notify both
- d boss warn <detik> — DM peringatan sebelum boss muncul (0 untuk matikan)
- d boss menu, d boss status
- d f100 — mulai ronde Family 100
- d f100 clue — buka 1 huruf acak di semua jawaban; terkunci saat sisa 2 huruf (jatah 3x per pemain)
- d f100 reveal — tampilkan semua jawaban soal aktif selama 2 detik lalu hilang (khusus developer)

## Cepat Tepat (Matematika)
Game hitung cepat: bot mengirim satu soal aritmetika, siapa pun yang menjawab benar paling dulu dapat poin.
Tingkat kesulitan naik tiap soal; poin = dasar per level + bonus kecepatan.
- d math [jumlah] — mulai ronde (default 5 soal, maks 30) (alias: d mtk, d hitung)
- d math lb [all] — leaderboard mingguan/all-time
- d math stop — hentikan ronde (moderator/admin/developer)

## Pengingat Aksi Lucy
Aksi Lucy ditulis `<prefix-lucy> <aksi>`, dengan pengingat otomatis setelah durasi tunggu:

| Jenis pengingat | Bentuk aksi yang dikenali | Pengingat |
|---|---|---|
| Lucy Pray/Curse | `lucy pray`, `lpray`, `lucy curse`, `lcurse` | 5 menit |
| Lucy Battle/Hunt | `lucy battle`, `lucy fight`, `lucy war`, `lbattle`, `lfight`, `lb`, `lucy hunt`, `lucy catch`, `lhunt`, `lh` | 15 detik |
| Lucy | pesan yang memuat kata "lucy" | 10 detik |

**Semua pengingat OFF secara default.** Anggota menyalakannya sendiri lewat
`d lreminder`.

Aksi yang durasinya sama berbagi satu pengingat: pray+curse (5 menit) dan
battle+hunt (15 detik). Yang menyatu hanya pengingat dan cooldown-nya, sementara
**penghitungan tetap per aksi** — jadi `d llb pray` dan `d llb curse` tetap
menunjukkan angka masing-masing, begitu juga battle dan hunt.

Mention boleh disertakan di belakang, mis. `lpray @Lucy`, `lb <@123>`,
`lucy battle <@123>`. Teks lain di belakang tetap dianggap chat biasa, jadi
`lb ya nanti` tidak memicu apa pun.

**Pengingat pertama yang menang.** Kalau kamu menulis `lh` lalu `lb`, atau
`lpray` lalu `lcurse`, yang dihitung adalah aksi yang **lebih dulu**: waktunya
tidak digeser, dan teks pengingatnya memakai aksi pertama itu. Jadi `lh` lalu
`lb` tetap dihitung dari `lh`, dan `lpray` lalu `lcurse` tetap dari `lpray`.

**Bot tidak membalas aksi sama sekali.** Termasuk anggota yang belum
menyalakan pengingat: tidak ada ajakan atau info apa pun. Aksi cukup dipantau.

**Bot tidak membalas aksi.** Aksi cukup dipantau; pengingat dijadwalkan dari
pesanmu dan dikirim setelah durasi tunggu habis. Jadi satu aksi = satu pesan
(pengingatnya), bukan balasan lalu pengingat. Anggota yang belum pernah mengatur
dan pengingatnya masih OFF akan diberi tahu sekali lewat pesan sementara yang
hanya dia yang lihat.

Bentuk berspasi juga jalan: `l fight`, `l hunt`.

- d lreminder — kotak interaksi: tombol on/off dan tombol cara ping per jenis
- Cara ping: Tag, Reply, Tag + Reply, atau Tanpa keduanya
- Pengaturan reminder berlaku GLOBAL di semua server — atur sekali, berlaku di mana pun

### Prefix bot Lucy
Prefix bot Lucy adalah prefix yang dipakai bot Lucy untuk membaca perintah user
(mis. `lucy`, `l`, atau `g`). Ini berbeda dari prefix bot kita sendiri (`d`), yang
hanya untuk perintah `d lreminder`, `d llb`, dan sejenisnya.

`lucy` adalah prefix bawaan bot Lucy, jadi **selalu dikenali** dan tidak bisa
dihapus. Pengaturan admin hanya MENAMBAH prefix lain yang dipakai di server.

- d lucyprefix — lihat prefix yang dipantau (mis. `lucy`, `l`)
- d lucyprefix add g — tambah `g` (jadi `lucy`, `l`, dan `g`)
- d lucyprefix remove l — hapus `l` (kalau server tidak memakainya)
- d lucyprefix set g — hanya tambahan `g` (`lucy` tetap aktif)
- d lucyprefix reset — kembali ke default `lucy` dan `l`

Jadi `lucy battle` tetap dikenali di server mana pun. Untuk tiap prefix, bentuk
pendek juga jalan (mis. `gb`, `gh`, `gfight`).
- d lreminder reply <jenis> <teks> — balasan kustom (khusus premium)
- Balasan default tersedia untuk semua; balasan kustom + embed direncanakan sebagai fitur premium

### Leaderboard Aksi Lucy
- d top [kategori] [rentang] [halaman] (alias d t) — tanpa kategori = jumlah LUCY
- d top <pray|curse|battle|hunt|lucy> — kategori aksi; battle mencakup hunt
  contoh: d top, d top pray, d top battle 7d, d top lucy all
- d global (alias d g) — sama seperti `top` tapi lintas server; tanpa kategori = jumlah LUCY
  contoh: d g, d g pray, d g battle 7d
- Tambahkan `global` untuk menggabungkan seluruh server (mis. `d top pray 7d global`)
- Bentuk lama `d llb ...` tetap jalan
- `all` adalah **rentang** (semua waktu), bukan kategori. `d top all` = board LUCY
  sepanjang waktu. Kategori gabungan semua aksi sudah dihapus karena tidak dipakai.
- Semua leaderboard punya tombol ⏮️ ◀️ ▶️ ⏭️ (awal, sebelumnya, berikutnya,
  akhir). Tombol membaca ulang data setiap kali ditekan, halaman di-clamp di
  ujung, dan kategori/rentang/lintas-server ikut terbawa saat berpindah halaman.
- Rentang: kosong/harian (hari ini), 7d (7 hari terakhir), all (semua waktu), satu tanggal
  (`5 nov`), atau **rentang tanggal** (`10-18 nov`, `1 nov - 5 nov 2026`). Daftar bentuk yang
  diterima ada di bagian "Rentang tanggal leaderboard" di bawah.
- battle dan hunt digabung jadi satu kategori; lucy memakai penghitung Lucy yang sudah ada
### Statistik aksi per orang

- d stats (alias d stat, d dstats, d statistik) — statistik aksi kamu sendiri
- d stats @user [rentang] — statistik orang lain (mention atau ID mentah)
- contoh: d stats, d stats 30m, d stats 2j, d stats 7d, d stats all,
  d stats @user 2j, d stats 123456789012345678 10-18 nov

Yang ditampilkan: rincian **per kategori**, sama seperti reminder, diurutkan
dari yang terbanyak, plus total aksi:

- `Lucy Battle/Hunt` — hunt dan battle berbagi satu jendela tunggu
- `Lucy Pray/Curse` — pray dan curse berbagi satu jendela tunggu
- `Lucy (say Lucy)`

**Satu jendela tunggu = satu aksi.** Jadi `lh` lalu `lb` dalam 15 detik dihitung
**1** aksi Battle/Hunt, dan `pray` lalu `curse` dalam 5 menit dihitung **1** aksi
Pray/Curse. Aksi berikutnya baru dihitung setelah jendela tunggu kategori itu
habis. Ini aturan yang sama untuk leaderboard dan `d stats`, sehingga angkanya
selalu cocok. Nama diambil dari cache member, mention,
lalu catatan terakhir di database — jadi target lewat ID tetap tampil bernama.

Tanpa argumen rentang, `d stats` memakai **hari ini**. Jadi:

- `d stats <id>` → angka hari ini
- `d stats <id> all` → angka sepanjang waktu
- `d stat <id> 1h` → angka 1 jam terakhir

Ketiganya bisa berbeda jauh untuk orang yang sama; itu memang benar, bukan bug.
Bila ID tidak punya catatan sama sekali, bot membalas dengan pesan "belum punya
catatan aksi di server ini, atau ID-nya salah" alih-alih board nol.

Rentang yang diterima:

| Bentuk | Arti | Sumber data |
|--------|------|-------------|
| `30m`, `45 menit`, `90m` | N menit terakhir | kejadian bertimestamp |
| `2j`, `3 jam`, `1h`, `2 hour` | N jam terakhir | kejadian bertimestamp |
| `2d`, `7d`, `2 hari`, `1 day` | N hari **kalender** (sama seperti leaderboard) | agregat harian |
| `all` | semua waktu | agregat harian |
| `5 nov`, `10-18 nov` | tanggal / rentang tanggal | agregat harian |

Satuan hari sengaja **tidak** dibaca sebagai jendela bergulir 24 jam. `2d` berarti
"hari ini + kemarin" (kalender), persis seperti `d top 2d`. Ini penting supaya
angkanya konsisten: hasil harus selalu naik saat rentang melebar
(`hari ini` <= `2d` <= `all`).

Rentang yang lebih tua dari data server (mis. `300d` di server yang baru
dipakai sebulan) menghasilkan angka yang sama dengan rentang yang lebih pendek.
Itu wajar — footer akan menyebut `data server mulai <tanggal>` sebagai penjelasan.

Catatan penting soal data:

- Statistik per jam/menit butuh catatan **per kejadian**, yang baru ada sejak
  tabel `lucy_action_events` aktif. Hari-hari sebelumnya tidak bisa dibuat
  ulang, jadi rentang jam sebelum itu akan tampil kosong — bot menyebutkan
  "catatan paling awal" di footer bila jendela yang diminta lebih tua dari
  data yang ada.
- Kejadian bertimestamp disimpan **365 hari** lalu dipangkas otomatis saat bot
  start. Statistik per tanggal/all-time tidak terpengaruh karena memakai
  agregat harian yang disimpan permanen.

### Rentang tanggal leaderboard

Selain `7d` dan `all`, leaderboard menerima rentang tanggal eksplisit. Bulan dan tahun
boleh ditulis sebagai nama (`nov`) atau angka (`11`).

| Bentuk | Arti |
|--------|------|
| `10-18 nov` | 10–18 November tahun berjalan |
| `10 nov - 18 nov` | sama, dengan spasi |
| `10/11-18/11` | sama, bentuk angka |
| `10-18/11` | sama, sisi kiri tanpa bulan |
| `1-5 nov 2026` | tahun eksplisit |
| `25 des - 2 jan 2027` | melewati pergantian tahun |
| `10 s/d 18 nov`, `10 sampai 18 nov`, `10 hingga 18 nov`, `10 sd 18 nov`, `10 to 18 nov` | pemisah kata |
| `10–18 nov`, `10 — 18 nov` | pemisah en/em dash |

Aturan yang perlu diketahui:

- Tanpa tahun, dipakai tahun berjalan. Rentang yang terbalik karena melewati tahun baru
  (`28 des - 3 jan`) otomatis dibaca sebagai rentang lintas tahun, bukan 358 hari.
- Urutan terbalik di bulan yang sama (`18-10 nov`) **ditolak** dengan pesan kesalahan,
  bukan diam-diam dianggap rentang hampir setahun.
- `5 nov` tetap berarti **satu tanggal**, bukan rentang. Tanggal mustahil (`32-40 nov`)
  dan angka tanpa bulan (`10-18`) juga ditolak.
- Judul embed menyebut jumlah hari (`9 Hari`), dan rentangnya ikut terbawa saat berpindah
  halaman lewat tombol.

- d ping (alias d p) — cek latency bot (roundtrip & WebSocket)
- d dex <nama...> — Animal Dex (alias d d)
- d help (alias d) — panduan; d prefix — lihat/ubah prefix server

Prefix bisa diganti per server oleh moderator (`d prefix <prefix-baru>`) atau lewat dashboard
developer. Subcommand yang tidak dikenal diabaikan supaya chat biasa seperti "duh" tidak memicu
balasan bot.

## Lucy Counter & Leaderboard
Menghitung pesan yang memuat kata "lucy" per anggota (cooldown 10 detik per anggota, maksimal 1 per pesan).

**Sakelar counter per server.** Seluruh counter Lucy (mention Lucy, pray, curse,
battle, hunt) bisa dinyalakan/dimatikan per server dengan
`d s count on` atau `d s count off` (alias `d count on|off`; khusus admin server
atau developer bot). Saat OFF, aktivitas tidak dihitung maupun dicatat, dan
perintah leaderboard membalas:

```text
No data found!

Server admins can enable counting for this server using `<prefix> s count`
```

Saat ON kembali, penghitungan berjalan seperti biasa. Sakelar ini sama dengan
"LUCY COUNTER SERVER ON/OFF" di dashboard. Default: **OFF**.

Leaderboard **lintas server** (`d g`/`d global`, `d lservers`) tetap tampil
walau server ini OFF — data server lain yang ON tetap bisa dilihat. Yang
diblokir hanya board per server.
- d lcount [halaman] — leaderboard Lucy harian.
- d lcountall [halaman] — leaderboard Lucy all-time.
- d ltarget [halaman] — leaderboard progres Target Lucy (alias: d ltargetlb, d lucytarget leaderboard).
- d lservers [halaman] — leaderboard all-time per server (alias: d lserver).
- d lucytarget on|off, d lucytarget target on|off, d lucytarget set <jumlah>, d lucytarget message <pesan>, d lucytarget status — pengaturan Target Lucy (moderator/admin).

## Chart detak jantung (`d chart`)

`d chart` mengirim **gambar PNG** berisi grafik garis gaya monitor detak jantung
untuk "say Lucy". Garisnya kurva halus dengan glow, dan hari tanpa aksi turun ke
garis dasar — jadi jeda terlihat sebagai garis datar, bukan dilewati.

```
d chart                 # 7 hari terakhir (default)
d chart 30d             # 30 hari
d chart -sincestart     # sejak catatan PERTAMA user itu di server ini
d chart @user 14d       # orang lain
```

Catatan perilaku:

- `-sincestart` memakai hari pertama **user tersebut**, bukan hari pertama server.
  Kalau user belum pernah tercatat, bot membalas teks (bukan gambar kosong).
- Rentang di bawah 7 hari dilebarkan ke 7 titik supaya chart tetap terbaca. Hari
  sebelum data pertama bernilai nol, jadi tidak ada data yang dikarang.
- Rentang panjang diagregasi otomatis: di atas 62 hari per minggu, di atas 130
  hari per bulan. Total pada judul tetap jumlah keseluruhan.
- Garisnya **polyline lurus** antar titik, bukan kurva — sambungan tajam supaya
  lonjakan dan jeda terbaca apa adanya.
- Render memakai `@napi-rs/canvas` (binary prebuilt, tanpa compiler). Warna
  mengikuti token dashboard (`#10131b`, `#a6f36b`).

### Tampilan nama di leaderboard

Di samping tombol navigasi (`⏮️ ◀️ ▶️ ⏭️`) ada tombol **Nama Biru**. Tombol ini
mengganti nama yang tampil dari displayName menjadi mention (`@user`, tampil biru
dan bisa diklik). Labelnya berubah jadi **Nama** untuk kembali. Pilihan ini ikut
terbawa saat pindah halaman, dan mention ditampilkan tanpa mengirim notifikasi
(`allowedMentions: { parse: [] }`).

## Simulasi battle (gaya OwO)

Simulasi pertarungan 1 lawan 1 sampai 3 lawan 3 yang meniru mekanik battle
[Discord-OwO-Bot](https://github.com/ChristopherBThai/Discord-OwO-Bot). Hasilnya
deterministik: seluruh randomness lewat RNG ber-seed, jadi `seed` yang sama
selalu memberi hasil yang sama.

```
d team new Alpha                      # buat tim
d team add 1 snail level=50 weapon=gs # isi slot 1 dari hewan dex
d team add 2 hp=8,att=6,pr=2,wp=3,mag=5,mr=1 level=40   # atau stat manual
d team pick Alpha                     # jadikan tim aktif (bisa lewat tombol)
d sim -m 500 -s 42                    # 500 pertarungan, seed 42
```

Perintah:

| Perintah | Fungsi |
| --- | --- |
| `d team list` | daftar tim + tombol pilih tim |
| `d team new/pick/show/del/rename` | kelola tim (maks 10 tim, 3 slot) |
| `d team add <slot> <hewan\|stat> [opsi]` | isi slot; opsi `level=`, `weapon=`, `quality=`, `passive=`, `label=` |
| `dtm s <senjata> [pasif...] [slot]` | pasang atau ganti senjata pada slot yang sudah terisi |
| `d team clear <slot>` | kosongkan slot |
| `d sim [lawan] [-m n] [-s seed] [-qp q] [-qe q]` | simulasi; lawan bisa nama tim, hewan dex, atau stat manual |
| `d sim 1 vs blitz` | bentuk `vs` juga diterima, memakai tim setelah kata `vs` sebagai lawan |

Semua balasan `d team` dan `d sim` berupa embed. Ikon hewan, senjata, pasif, dan
stat diambil dari emoji OwO; emoji itu di-mirror ke aplikasi bot sekali saat start
(mekanisme yang sama dengan dex), lalu dibaca dari cache.

### Memasang senjata: `dtm s`

`d team add` mengisi slot dari nol, jadi memakai senjata baru berarti mengulang
hewan, level, dan statnya. `dtm s` hanya menyentuh kolom senjata: level, stat,
dan label hewan di slot itu tetap.

```
dtm s gsword           # Great Sword ke slot 1
dtm s sword crit       # Great Sword + pasif Critical ke slot 1
dtm s gsword 2         # Great Sword ke slot 2
dtm s sword crit 2     # Great Sword + Critical ke slot 2
dtm s orb crit th 1    # Orb of Potency punya 2 slot pasif
```

Aturannya:

- **Slot default 1.** Angka `1`-`3` di akhir argumen dianggap nomor slot, jadi
  `dtm s gsword 2` memasang ke slot 2, bukan slot 1 dengan pasif "2".
- **Nama lengkap maupun singkatan diterima.** `sword`, `gs`, dan `gsword` sama
  sama menunjuk Great Sword; `crit` sama dengan Critical.
- **Jumlah pasif mengikuti senjata.** Tiap senjata punya `passiveCount` (Great
  Sword 1, Orb of Potency 2). Menyebut lebih banyak ditolak, bukan dipotong.
- **Tanpa nama pasif, pasif diundi** saat simulasi dengan RNG ber-seed, sama
  seperti perilaku `d team add` tanpa `passive=`.
- **Mengganti senjata mempertahankan `quality=` slot.** Tier yang sudah diatur
  tidak hilang diam-diam.
- **Slot harus sudah berisi hewan.** `dtm s bow 3` pada slot kosong ditolak.

Senjata dan pasif yang namanya dikenal tetapi mekaniknya belum ada dijawab
"belum punya mekanik simulasi", bukan "tidak dikenal". Daftarnya ada di
`src/data/owoPending.json`.

### Level

Hewan yang dimasukkan ke tim tanpa `level=` memakai level **50**. Saat
simulasi, `lvl` menimpa level tanpa mengubah data tim:

| Argumen | Tim kamu | Lawan |
| --- | --- | --- |
| `lvl100` | 100 | 100 |
| `lvl100/60` | 100 | 60 |
| `lvl/40` | level tersimpan | 40 |

`level=` di lawan (mis. `d sim snail level=60`) tetap menang atas `lvl`, karena
lebih spesifik. Bentuk `lvl` yang salah (`lvl`, `lvl0`, `lvlabc`, `lvl9999`)
dilaporkan sebagai error, bukan dianggap nama lawan.

### Tampilan `d team show`

Tiap slot jadi satu blok, mengikuti format OwO: nomor slot, level, emoji hewan,
nama, lalu stat final yang benar-benar dipakai simulasi.

```
[1] L.100 <a:lobbot:...> lobbot
<:hp:...> `1200` <:wp:...> `780`
<:att:...> `600` <:mg:...> `600`
<:pr:...> `72%` <:mr:...> `72%`
<a:fabled:...><:frstaff:...><:fhgen:...><:fhgen:...> 100%
```

Baris terakhir adalah rank, senjata, lalu pasif beserta quality-nya. Slot kosong
hanya menampilkan perintah pengisiannya. Angka dihitung dengan `buildUnit` yang
sama dengan `d sim`, jadi tidak ada selisih antara yang tampil dan yang bertarung.
Pasif yang tidak disimpan di slot diundi dengan seed tetap, supaya tampilan tidak
berubah setiap kali `d team show` dibuka.

### Tier senjata

Quality menentukan tier (common → fabled) sekaligus stat senjata. Urutan
penentuannya: `quality=` di slot, lalu flag `-qp`/`-qe` saat simulasi, lalu
**default tier tertinggi (100 = Fabled)**. Jadi `d team add 1 snail weapon=gs`
langsung memakai Great Sword Fabled, dan ikon `fgreatsword` yang tampil di
`d team show` memang senjata yang dipakai `d sim` — bukan roll terpisah.
Pasif senjata ikut tier yang sama.

Stat manual memakai skala koefisien OwO (0-14), bukan HP final: `hp` 8 di level 50
menghasilkan HP jauh lebih besar daripada di level 1. Kekuatan berasal dari level.

Yang **tidak** disimulasikan: wear senjata, takedown, dan XP. Ketiganya tidak
memengaruhi hasil pertarungan.

### Perbedaan yang disengaja dari OwO

- **Sisi pembuka diacak.** OwO selalu memberi giliran pertama ke tim pemain; pada
  simulasi itu membuat pertarungan cermin menang ~75%. Di sini sisi pembuka
  diacak per pertarungan lewat seed, sehingga cermin mendekati 50%.
- **Tanpa `Math.random`.** Semua roll memakai RNG ber-seed agar bisa diulang.

### Sumber angka

- `src/data/owoBattle.js` — 20 hewan, 22 senjata, 12 buff, plus formula.
  Angkanya dibaca langsung dari tabel OwO, bukan perkiraan.
- `src/data/owoPassives.json` — 21 pasif (lihat bagian di bawah).
- `src/data/owoPending.json` — senjata/pasif yang nama dan alias-nya sudah
  dikenal tetapi stat serta ability-nya belum ada. Dipakai agar input seperti
  `weapon=cstaff` dijawab "belum punya data simulasi", bukan "tidak dikenal".
- `src/services/battleEngine.js` — turn loop, damage, resistensi, heal, WP.
- `src/services/battleWeapon.js` — ability 22 senjata.
- `src/services/battleBuffs.js` — 12 buff/debuff.
- `src/services/battlePassives.js` — hook pasif.
- `src/services/battleSim.js` — batch simulasi + parsing stat.
- `src/utils/battleTeamStorage.js` — penyimpanan tim (`data/battle-teams.db`).

Resistensi memakai `(res / (100 + res)) × 0.8`, jadi damage tidak pernah nol
total tetapi juga tidak pernah kebal.

## Data pasif battle (referensi simulasi)

`src/data/owoPassives.json` berisi 21 pasif battle dari
[Discord-OwO-Bot](https://github.com/ChristopherBThai/Discord-OwO-Bot) (CC BY-NC-SA 4.0).
Ini **data referensi**, bukan bagian dari gameplay Lucy: belum ada perintah yang membacanya.
Dipakai sebagai acuan kalau fitur simulasi battle mulai dikerjakan.

Angka di dalamnya bukan hasil perkiraan. Semua diambil dengan membaca
`src/commands/commandList/battle/passives/`, lalu diverifikasi dengan menjalankan class aslinya
pada quality 0/50/100.

Akses lewat `src/data/owoPassives.js`:

```js
const passives = require('./src/data/owoPassives');
passives.get('Lifesteal');        // { id: 7, category: 'sustain', qualityList: [[15, 35]], ... }
passives.statsAt(passives.get('Lifesteal'), 50);  // [25] -> 25% lifesteal
passives.byCategory('reflect');   // [Thorns]
```

Formula: `stat = min + (max - min) × quality / 100`, dengan quality 0-100 di-roll per stat.
Kategori yang dipakai: `stat`, `damage`, `sustain`, `heal`, `defense`, `reflect`, `mana`,
`onDeath`, `utility`.

Kalau upstream OwO berubah, ganti JSON-nya; tidak ada langkah build.

## Animal Dex
Menangkap kartu **"Informasi animal"** yang dikirim bot Lucy (pesan Components V2) secara otomatis, lalu menyimpannya ke database SQLite (`data/animal-dex.db`). Dex bersifat **global** — satu entri per nama hewan, digabung dari semua server (hewan yang sama tidak diduplikasi antar server). Setiap kali bot Lucy mengirim/memperbarui kartu animal, datanya di-*upsert* per nama hewan sehingga dex selalu terbarui. Database skema lama (per-server) dimigrasikan otomatis ke global saat pertama dijalankan.
- d dex [nama...] — tampilkan detail satu atau beberapa hewan sekaligus.
- d d [nama...] — alias singkat.
Nama bisa lebih dari satu, dipisah spasi atau koma. Contoh: `d dex lawliet`, `d dex lawliet buaya kudanil`, `d d patreon, hybrid`.
Query mencocokkan nama, alias, nickname, rank, atau nama emoji hewan (tidak peka huruf besar/kecil). Bila sebuah nama cocok ke beberapa hewan, hasilnya ditampilkan sebagai daftar gabungan.

Emoji hewan di kartu Lucy memuat nama hewannya, jadi user boleh **menempel emoji tersebut** langsung sebagai query (mis. `d dex <a:lawliet:1557672128059539466>`); bot akan memakai nama di balik emoji itu untuk mencari.

Tambahkan flag **`-c`** (atau `--compact`) di akhir perintah untuk tampilan ringkas berupa **tabel** (tanpa tabel embed, hanya kolom & baris). Baris pertama berisi emoji statistik hp→mr, baris berikutnya berisi emoji hewan + angka statistiknya:

```
Animal | <hp> <att> <pr> | <wp> <mg> <mr> | Total
<emoji hewan> | 2 0 1 | 3 14 2 | 22
```

Setiap nama pada query menghasilkan satu baris, jadi `d dex lawliet buaya kudanil -c` menampilkan satu baris per hewan. Contoh: `d dex lawliet -c`, `d d -c` (seluruh dex).

Data yang **ditampilkan** per hewan: nama, jumlah, rank, alias, role, statistik (HP/ATT/PR/WP/MG/MR), dan **total stat** (jumlah seluruh statistik). Data lain (nickname, points, sell, sacrifice, rekomendasi weapon, kelangkaan) tetap tersimpan di database tetapi tidak ditampilkan pada dex.

Gambar animal diambil dari accessory kartu (Components V2 type 11) — bentuknya **link** (mis. GIF emoji Discord), bukan file terpisah; link ini disimpan dan ditampilkan sebagai thumbnail pada kartu dex.

Emoji statistik (hp → mr) dan emoji hewan berasal dari **aplikasi Lucy**. Discord hanya mengizinkan aplikasi pemilik memakai emoji aplikasinya, sehingga bot ini tidak bisa merender emoji tersebut secara langsung (akan tampil sebagai `:hp:` teks biasa). Karena itu bot **menyalin (mirror)** emoji tersebut menjadi emoji milik aplikasi bot sendiri — sekali saja, disimpan di tabel `emoji_map` — lalu memakai emoji hasil mirror itu saat menampilkan dex. Proses mirror dijalankan otomatis saat bot start dan saat render dex; bila gagal (mis. tanpa izin), dex tetap tampil memakai nama emoji sebagai fallback. Emoji **guild** yang sudah bisa diakses bot (mis. emoji buatan sendiri di server bot) dipakai langsung tanpa di-mirror.

Emoji juga bisa di-upload **manual** di Developer Portal (aplikasi → Emoji) dengan nama yang dikenali: `hp`, `att`, `pr`, `wp`, `mg`, `mr` (huruf kecil) beserta aliasnya (`mg`/`mag`/`magic`, `att`/`attack`, `pr`/`prot`/`protection`). Emoji manual ini dipakai langsung tanpa dibuat ulang.

Setiap leaderboard memiliki tombol navigasi ⏮️ ◀️ ▶️ ⏭️ (awal, sebelumnya, berikutnya, akhir). Tombol membaca ulang data dari SQLite setiap kali ditekan, sehingga jumlah Lucy yang tampil selalu sinkron dengan data terbaru. Tombol tetap aktif di halaman pertama/terakhir (halaman otomatis di-clamp ke rentang yang valid).

## Custom Reminder

Reminder pribadi dengan variabel dinamis, dibuat dan dibagikan **secara manual oleh developer bot**.
Distribusi rilis ini **tanpa giveaway otomatis, voting, tier supporter, atau pembayaran** — developer
memberi reminder setelah menentukan pemenang di luar sistem ini.

Custom Reminder **memakai engine pengingat yang sudah ada** (`src/services/lucyReminder.js`). Tidak ada
penjadwal atau pendeteksi aksi kedua: sistem ini hanya menambah **layer pemilihan pesan** pada engine
itu, sehingga trigger, durasi, cooldown, dan perilaku Lucy yang lama tetap sama.

Pengingat punya aturan sendiri (`lreminder`): **mematikan counter Lucy tidak mematikan pengingat**.
Saat counter off, aksi tidak dihitung dan tidak masuk leaderboard, tapi pengingat tetap dikirim.

### Tiga kategori dan dua format

Kategori = **apa** yang diingatkan. Format = **bagaimana** ditampilkan. Keduanya properti terpisah;
Normal dan Embed bukan kategori berbeda.

| Kategori | Arti | Aksi engine yang dicakup |
|----------|------|--------------------------|
| `PRAY_CURSE` | Pengingat Pray/Curse | `pray`, `curse` |
| `HUNT_BATTLE` | Pengingat Hunt/Battle | `hunt`, `battle` |
| `LUCY` | Pengingat **Say Lucy** | `lucy` |

`LUCY` berarti **Say Lucy**: reminder mengirim konten Lucy yang dikonfigurasi. Bukan event aktivitas
Lucy. Trigger-nya adalah perilaku "Say Lucy" yang sudah ada (`onLucyCounted` di engine).

Format: `NORMAL` (konten pesan biasa) dan `EMBED` (embed kaya). Enam kombinasi yang didukung:

- Pray/Curse Normal, Pray/Curse Embed
- Hunt/Battle Normal, Hunt/Battle Embed
- Lucy Normal, Lucy Embed

Tidak ada kategori `DAILY`.

### Urutan pemakaian pesan (fallback otomatis)

Saat engine mengirim pengingat untuk sebuah aksi:

1. **Custom Reminder milik user** yang aktif dan cocok kategorinya dipakai.
2. Kalau tidak ada (atau reminder-nya nonaktif), dipakai **default server** untuk kategori aksi itu.
3. Kalau server belum mengatur, dipakai **bawaan Dragneel** (perilaku lama).

Karena nonaktif jatuh ke langkah 2 lalu 3, **mematikan Custom Reminder otomatis mengembalikan user ke
default server** — tanpa perintah tambahan dan tanpa redeem ulang.

Aturan isolasi:

- Override bersifat pribadi; user lain tetap memakai default server.
- Admin mengubah default server **tidak** mengubah Custom Reminder anggota.
- User menyunting Custom Reminder **tidak** mengubah default server.
- Fallback per kategori: mematikan Hunt/Battle tidak memengaruhi Pray/Curse atau Lucy.
- Kalau user punya beberapa reminder aktif di kategori sama, yang dipakai adalah **yang paling awal
  dibuat** (deterministik). Semua reminder tetap ada di inventory — tidak ada yang dibuang/digabung.

### Pengaturan server: cakupan perintah `s`

`s <aksi>` menulis pengaturan **per kategori**, bukan per aksi. Jadi satu perintah mengatur
pengingat untuk dua aksi yang berbagi kategori:

| Perintah | Kategori | Mencakup aksi |
|----------|----------|---------------|
| `<prefix> s pray` | Pray/Curse | `pray` + `curse` |
| `<prefix> s battle` | Hunt/Battle | `hunt` + `battle` |
| `<prefix> s lucy` | Lucy | `lucy` |
| `<prefix> s curse` | Pray/Curse | `curse` saja (menimpa baris yang sama) |
| `<prefix> s hunt` | Hunt/Battle | `hunt` saja (menimpa baris yang sama) |

Karena `s battle` dan `s hunt` menulis baris yang sama, **tidak ada lagi pengingat yang terbelah dua**
antara Hunt dan Battle. Contoh:

```
d s battle set text {mention} ayo battle!
→ ✅ Pengingat server untuk **Hunt/Battle Reminder** disimpan.
  Mencakup aksi hunt + battle.
```

Setelah itu, baik aksi `battle` maupun `hunt` memakai teks yang sama. `d s battle reset` juga
mengembalikan keduanya ke bawaan Dragneel sekaligus.

Database lama (skema versi 2) yang menyimpan pengaturan per aksi otomatis digabung saat bot mulai:
bila satu kategori punya beberapa baris, yang paling baru dipakai dan sisanya dibuang.

### Tiga jenis ID (jangan tertukar)

| ID | Bentuk | Arti |
|----|--------|------|
| Template ID | `T-XXXXX` | Cetakan reminder yang dibuat developer. |
| Claim ID | `C-XXXXX` | Tiket pemberian untuk satu penerima; dipakai saat `redeem`. |
| Reminder ID | `R-XXXXX` | Reminder milik user (hasil redeem). Ini yang ada di inventory. |

Inventory **hanya** menampilkan Reminder ID, bukan template atau claim ID.

### Untuk penerima reminder

`<prefix> r` menampilkan **inventory** (judul memakai nama dan avatar kamu) beserta dua tombol:
**Cara menggunakan** dan **Variabel**, dengan tombol **Kembali** di tiap halaman.

Delapan perintah pengguna:

| Perintah | Fungsi |
|----------|--------|
| `<prefix> r redeem <CLAIM_ID>` | Klaim reminder dari claim ID yang dikirim developer. |
| `<prefix> r view <ID>` | Pratinjau pesan/embed (variabel sudah ter-render). |
| `<prefix> r send <@user> <ID>` | Bagikan reminder **Normal** yang sudah ditandai shareable (perlu konfirmasi). |
| `<prefix> r update <ID> <pesan>` | Ubah pesan biasa. |
| `<prefix> r embed <ID> <JSON>` | Atur embed. JSON hasil salin dari discohook.org juga diterima. |
| `<prefix> r media <URL>` | Ambil URL media dari Tenor atau Klipy. |
| `<prefix> r enable <ID>` | Nyalakan satu reminder. |
| `<prefix> r disable <ID>` | Matikan satu reminder (otomatis kembali ke default server). |

Pendukung: `<prefix> r shareable <ID> on|off` (menandai boleh dipindahbukukan), `setcollectible`,
`reset` (perlu konfirmasi), serta `active`/`info` sebagai alias tampilan. Semua balasan berupa embed.

#### Aturan berbagi reminder

| Format reminder | Bisa dibagikan? |
|-----------------|-----------------|
| **Normal** (`NORMAL`) | Bisa — selama pemilik menyalakan `shareable` |
| **Embed** (`EMBED`) | **Tidak bisa**, selamanya |

Alasannya: isi embed dibuat khusus untuk satu orang, jadi lebih rapi kalau tidak berpindah tangan.
`r shareable <ID> on` untuk reminder Embed **ditolak sejak awal**, dan `r send` pun menolak dengan
alasan format. Jadi tidak ada reminder Embed yang setengah-setengah statusnya.

Cara membagikan reminder Normal:

```
d r shareable R-F5Y9C on      (pemilik menyalakan izin)
d r send @teman R-F5Y9C       (bot minta konfirmasi)
d r confirm
→ 🎉 Reminder Dipindahbukukan
```

Ini **memindahkan kepemilikan** — setelah konfirmasi, pengirim tidak bisa lagi mengubah reminder itu.

#### Kode redeem: sekali pakai, hanya untuk penerimanya

Kode claim dari developer (`C-XXXXXX`) hanya bisa **di-redeem satu kali** dan **hanya oleh penerima
yang ditunjuk**. Percobaan kedua dijawab `Award ini sudah diklaim sebelumnya`, dan orang lain dijawab
`Award ini bukan milikmu.` Kode yang dicoba orang lain tetap berstatus `pending`, jadi penerima yang
benar tidak kehilangan haknya.

Saat dua klaim datang bersamaan, transaksi database memastikan hanya satu yang berhasil — yang kalah
mendapat pesan `Award ini baru saja diklaim. Kode hanya bisa dipakai sekali.` dan reminder setengah
jadi tidak tertinggal.

#### Menghapus reminder (khusus developer)

`<prefix> r delete <ID>` (alias `hapus`/`buang`) menghapus reminder secara **permanen**. Perintah ini
**hanya untuk developer bot** — pemilik reminder dan admin server **tidak** bisa menghapus, supaya
tidak ada yang kehilangan reminder karena salah hapus. Anggota yang ingin berhenti sementara pakai
`<prefix> r disable <ID>` (reminder tetap tersimpan).

Karena permanen, bot meminta konfirmasi lebih dulu:

```
d r delete R-F5Y9C
→ Hapus reminder `R-F5Y9C` (Pray/Curse Reminder) milik @pemilik?
  Tindakan ini permanen dan tidak bisa dibatalkan.
  Konfirmasi dengan `d r confirm` atau batalkan dengan `d r cancel` (berlaku 60 detik).
d r confirm
→ 🗑️ Reminder Dihapus
```

Developer bisa menghapus reminder milik siapa pun (mis. data uji atau salah beri). Cari ID-nya lewat
`<prefix> r inventory`. Riwayat award yang sudah diklaim tetap tercatat meski reminder dihapus.

Legenda inventory: ✅ aktif • 🎉 shareable • 🔒 tidak shareable • ❌ nonaktif (tetap bisa diubah).
Aktif dan shareable **independen** — reminder bisa aktif tanpa shareable. Semua reminder Embed selalu
bertanda 🔒. Reminder nonaktif tetap bisa disunting. Mengubah pesan/embed/collectible **tidak** mengubah Reminder ID, kategori, format, atau pemilik.

### Untuk developer bot

Memakai sistem Developer ID yang sudah ada (`isDeveloper`): `DEVELOPER_IDS`, pemilik aplikasi bot, atau
pemilik server. Tidak ada daftar developer kedua.

- `<prefix> r create <KATEGORI> <FORMAT>` — buat template kosong; bot membalas kode template.
  Kategori bisa ditulis sebagai nama aksi (`battle`, `hunt`, `pray`, `curse`, `lucy`) atau nama
  kategori resmi (`HUNT_BATTLE`, `PRAY_CURSE`, `LUCY`). Contoh: `<prefix> r create battle embed`.
- `<prefix> r templates` — daftar template (kategori + format tampil).
- `<prefix> r give <@user> <TEMPLATE_ID>` — beri reminder; bot DM penerima berisi claim ID.
- `<prefix> r awards` — daftar claim + status (`pending`, `redeemed`, `revoked`).
- `<prefix> r revoke <CLAIM_ID>` — cabut claim yang belum diklaim (perlu konfirmasi).

Alur pemberian:

```
d r create battle embed
d r give @pemenang T-NHHKT
# penerima mengatur isinya sendiri:
d r embed R-F5Y9C {"title":"Battle Reminder","description":"{USER_MENTION} ayo battle!"}
d r enable R-F5Y9C
```

Kalau DM gagal, bot memberi tahu developer dan menampilkan claim ID untuk disampaikan manual.
Developer **tidak** otomatis mendapat izin admin server.

### Pengaturan default server (`s`)

Memakai namespace Settings yang sudah ada, **bukan** `r server`:

- `<prefix> s <aksi> set text <teks>` — aksi: `pray`, `curse`, `hunt`, `battle`, `lucy`.
- `<prefix> s <aksi> reset` — kembali ke bawaan Dragneel (tidak menghapus Custom Reminder siapa pun).
- `<prefix> s <aksi>` — lihat pengaturan saat ini.

Pengaturan tetap **per aksi** (pray dan curse terpisah), walau kategori Custom Reminder-nya sama.
Hanya **pemilik server atau admin dengan izin Manage Server** yang boleh mengubah — balasan:
`Only server admins & owners can change this setting.` Developer ID saja tidak cukup.

Default server saat ini hanya mendukung **teks**; embed hanya tersedia untuk Custom Reminder milik
user. Pengaturan tersimpan per guild dan tidak bocor antar server.

### Variabel

| Kelompok | Variabel |
|----------|----------|
| User | `{USER}`, `{USER_ID}`, `{USER_MENTION}`, `{USER_NAME}`, `{USER_DISPLAYNAME}`, `{USER_NICKNAME}`, `{USER_AVATAR}`, `{USER_SERVERAVATAR}` |
| Goal | `{GOAL}`, `{GOAL_PROGRESS}`, `{GOAL_PROGRESS_INVERTED}`, `{GOAL_END}` |
| Acak | `{EMOJI}`, `{FLAG}`, `{CAT}`, `{DOG}` |
| Waktu (content) | `{DAILY}`, `{DAILY_TOMORROW}`, `{DAILY_YESTERDAY}`, `{TIME}` |
| Waktu (aman di embed) | `{DAILY_TIME}`, `{DAILY_DATE}`, `{DAILY_FULL}`, `{DAILY_IN}`, `{TOMORROW_FULL}` |
| Server | `{SERVER_NAME}`, `{SERVER_ICON}` |

Token gaya lama engine tetap didukung di pesan **dan embed** pengingat: `{user}`, `{mention}`,
`{kind}`, `{durasi}`, `{count}`.

### Reminder "Say Lucy" vs perintah aksi

Reminder kategori **Lucy** hanya menyala kalau pesanmu **benar-benar memuat kata `lucy`** sebagai chat
(mis. `halo lucy`). Kalau pesan itu **perintah aksi** bot Lucy (`lucy battle`, `lb`, `l hunt`, dst.),
yang jalan adalah reminder kategori aksi tersebut — bukan "Lucy terdeteksi". Jadi satu pesan tidak
pernah memicu dua pengingat sekaligus.

Perintah **`d reminder`** (dan `d r`) sepenuhnya milik **Custom Reminder**. Pengingat lama dipanggil
dengan **`d lreminder`** (atau `d lrem`) supaya satu perintah tidak dibalas dua kali.

- **`{USER}` = username, bukan mention.** Ini sengaja: tag bisa memicu notifikasi dan masuk log audit.
  Pakai `{USER_MENTION}` (atau token lama `{mention}`) bila memang ingin menandai.
- Tag hanya muncul kalau **ping mode** pengingat memang `tag`/`both`. Pada mode `reply` atau `none`,
  mention di dalam teks/embed diganti nama biasa. Mode `tag` menandai **sekali** walau teks sudah
  memuat mention, dan mode `reply` **hanya** me-reply tanpa menandai.
- Variabel goal dibaca dari **sistem Target Lucy**; kalau belum aktif → `(tidak tersedia)`.
- `{CAT}`/`{DOG}` dari `reminders.randomImages`; fallback jelas bila kosong.
- Nilai acak dipilih **sekali per pesan** (konsisten dalam satu render).
- **`{DAILY}`/`{DAILY_TOMORROW}`/`{DAILY_YESTERDAY}` = tepat 00:00 WIB** (`Asia/Jakarta`, UTC+7 tanpa DST).
- ⚠️ **`{DAILY}` dan `{TIME}` berisi angka timestamp mentah** (mis. `1794934800`). Discord hanya
  merender `<t:...>` di **content** pesan, **tidak** di dalam embed — makanya di embed angkanya tampil
  apa adanya. Untuk embed pakai variabel teks: `{DAILY_FULL}` (mis. `Rabu, 18 November 2026 pukul
  00.00 WIB`), `{DAILY_TIME}` (`00.00`), `{DAILY_DATE}` (`18 November 2026`), `{DAILY_IN}` (hitung
  mundur), `{TOMORROW_FULL}`. Pola `<t:{DAILY}:R>` hanya benar di content pesan.
- Variabel tak dikenal dibiarkan apa adanya; nilai hasil tidak dipindai ulang (tanpa ekspansi rekursif).

Contoh: `d r update R-F5Y9C Halo {USER}, reset <t:{DAILY_TOMORROW}:R>!`

### Contoh embed JSON

```
d r embed R-F5Y9C {"title":"Pengingat {USER}","description":"Reset <t:{DAILY_TOMORROW}:R>","color":"#5865F2","footer":{"text":"{SERVER_NAME}"},"image":{"url":"https://cdn.klipy.com/a/b.gif"}}
```

Field: `title`, `description`, `url`, `color`, `timestamp`, `footer`, `image`, `thumbnail`, `author`,
`fields`.

Payload hasil salin dari **discohook.org** juga diterima langsung: bot mengambil `embeds[0]` dari
payload webhook (`{content, embeds, attachments, ...}`). Hanya satu embed yang didukung. Untuk field
`image`/`thumbnail`, halaman penyedia (`tenor.com/...`, `klipy.com/...`) otomatis diubah ke URL media
langsung. Batas Discord ditegakkan sebelum disimpan: `title` 256, `description` 4096, `footer.text`
2048, `author.name` 256, `fields` maks 25 (nama 256, nilai 1024), total 6000. Hanya `https` — skema
`javascript:`, `data:`, `file:` ditolak, field tak dikenal ditolak.

### Media: Tenor dan Klipy

`r media <URL>` mendeteksi penyedia otomatis; `r tenor`/`r klipy` untuk satu penyedia. URL media
langsung (`.gif`/`.mp4`/`.webm`) dipakai apa adanya; halaman `tenor.com/view/...` atau `klipy.com/gif/...`
diambil HTML-nya untuk mencari URL media. Hanya `https`; URL tidak tersedia/ tidak valid ditolak dengan
pesan jelas.

### Data, konfigurasi, dan rollback

- `data/reminders.db` (SQLite `node:sqlite`): `reminder_templates`, `reminder_awards`, `reminders`,
  `reminder_audit`, dan `guild_reminder_settings` (default server per aksi).
- Skema versi 2. Upgrade dari versi 1 **aditif**: kolom `category`, `format`, `name`, `shareable`
  ditambahkan otomatis lewat `PRAGMA table_info` + `ALTER TABLE`, data lama tetap utuh.
- Tidak ada migrasi manual. `guild_reminder_settings` dibuat otomatis.
- Rollback: kembalikan kode ke versi sebelumnya; `data/reminders.db` boleh dibiarkan atau dihapus.
  Blok `reminders` di `data/guild-settings.json` aman dibiarkan.
- Cadangkan `data/reminders.db` (beserta `-wal`/`-shm`) dan `data/guild-settings.json` sebelum upgrade besar.

## Untuk moderator/admin
Membutuhkan izin Discord Manage Server (Administrator juga diizinkan):
- /boss setup channel:#channel role:@role — atur channel dan role yang akan ditag.
- /boss server-on dan /boss server-off — aktifkan atau matikan tracker seluruh server.
- /boss prefix nilai:$ — ubah prefix server (prefix bawaan `d`).
- d prefix <prefix-baru> — ubah prefix lewat chat (moderator/admin).
- /boss admin-help — panduan moderator/admin.

## Instalasi
Persyaratan: Node.js 22.13 atau lebih baru (leaderboard Lucy memakai `node:sqlite` bawaan Node).

1. Buat aplikasi/bot di Discord Developer Portal.
2. Undang bot dan berikan izin View Channels, Read Message History, Send Messages, Embed Links, serta izin mention role.
3. Aktifkan Message Content Intent di Developer Portal → Bot → Privileged Gateway Intents.
4. Jalankan:

   npm install
   cp .env.example .env
   npm run deploy-commands
   npm run check
   npm test
   npm start

Isi `.env`: `DISCORD_TOKEN`, `CLIENT_ID`, dan `LUCY_BOT_ID`. `GUILD_ID` dan `LUCY_CHANNEL_ID` opsional. Jangan unggah token atau file `.env` ke GitHub.

## Catatan
- Bot menjadwalkan waktu setelah menerima timestamp boss dari Lucy. Pastikan bot dapat membaca channel sumber.
- Jika bot mulai setelah timestamp lewat, notifikasi akan dicoba segera saat tracker aktif, kecuali sudah diberitahukan.
- DM dapat gagal jika pengguna menutup DM.
- Data leaderboard Lucy disimpan di SQLite (`data/lucy-counter.db`) memakai `node:sqlite` bawaan Node. Saat pertama dijalankan, data lama dari `data/lucy-counter.json` dimigrasikan otomatis (satu kali) lalu file JSON dibiarkan sebagai cadangan.
- Penyimpanan berbasis file cocok untuk satu instance; gunakan database bersama untuk banyak instance.
