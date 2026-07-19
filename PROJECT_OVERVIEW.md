# Proje Genel Bakış ve Geliştirici Rehberi (PROJECT_OVERVIEW.md)

Bu rehber, **Homebrew Roll20 DnD Web Arayüzü** projesinin mimarisini, veritabanı şemasını, ağ protokollerini ve istemci/sunucu kod yapısını özetlemektedir. Gelecekte projeye dahil olacak yapay zeka modelleri ve geliştiricilerin tüm kaynak kodunu baştan sona okumasına gerek kalmadan sistemi anlamasını hedefler.

---

## 1. Genel Teknoloji Yığını (Tech Stack)

- **Backend:** Node.js, Express, Socket.io (WebSocket), Supabase-JS (İstemci Kütüphanesi), Axios, Dotenv
- **Database (Supabase):** PostgreSQL (REST API ve in-memory senkronizasyon yedeklemesi için)
- **Frontend:** Vanilla HTML5, CSS3 (Gelişmiş Değişkenli Tasarım Sistemi, Glassmorphism, Responsive Sidebar), Vanilla Javascript (ES6+)
- **Dış Servis Entegrasyonu:** ImgBB API (Resim yükleme ve saklama servisi)

---

## 2. Klasör ve Dosya Yapısı

```
HomebrewRoll20forme-main/
├── server.js               # Express + Socket.io sunucusu, REST rotaları ve WebSocket yönetim merkezi.
├── public/                 # İstemci tarafı statik dosyaları
│   ├── index.html          # Giriş ekranı (Rol, Kullanıcı ve Karakter seçimi/oluşturulması)
│   ├── game.html           # Ana oyun ekranı (Harita tuvali ve DM/Oyuncu kontrol paneli)
│   ├── gallery.html        # DM Harita Galerisi ekranı
│   ├── css/
│   │   └── style.css       # Tüm projenin premium mavi-siyah tasarıma sahip stil dosyası.
│   └── js/
│       ├── login.js        # Giriş/Karakter seçim ekranı etkileşim mantığı ve REST API çağrıları.
│       ├── client.js       # Harita çizimleri, token sürükleme/bırakma ve ana oyun akışı.
│       └── attack-panel.js # DM Saldırı/Hasar paneli mantığı, zar hesaplama ve hasar uygulama.
├── THEME_GUIDE.md          # Projenin görsel tasarım tokens ve CSS kurallarını içeren rehber.
├── PROJECT_OVERVIEW.md     # (Bu Dosya) Projenin genel mimari rehberi.
└── .env                    # Supabase ve ImgBB API anahtarlarını barındıran yerel dosya.
```

---

## 3. Supabase Veritabanı Şeması

Proje, verileri saklamak için Supabase PostgreSQL veritabanını kullanır. Şemada 4 ana tablo bulunmaktadır:

### 3.1. `profiles` Tablosu
Sistemdeki kullanıcı profillerini saklar.
- `id` (uuid, Primary Key)
- `username` (text) - Kullanıcı adı.
- `role` (text) - Kullanıcı rolü (`player` veya `dm`).

### 3.2. `characters` Tablosu
Oyuncuların oluşturduğu karakter kartlarını saklar.
- `id` (uuid, Primary Key)
- `user_id` (uuid, Foreign Key -> profiles.id)
- `name` (text) - Karakter adı.
- `hp_max` (int) - Maksimum can değeri.
- `hp_current` (int) - Mevcut can değeri.
- `ac` (int) - Zırh Sınıfı (Base Armor Class).
- `ac_bonus` (int) - Zırh Sınıfı Bonusu.
- `corruption` (int) - Karakter yozlaşma (corruption) yüzdesi.
- `spell_slots` (jsonb) - Büyü yuvaları durumunu tutar. `{ lvl1: X, lvl2: Y, lvl3: Z, lvl4: W }`.
- `stats` (jsonb) - D&D statları ve bonusları.
  `{ str: 10, str_bonus: 0, dex: 10, dex_bonus: 0, int: 10, int_bonus: 0, con: 10, con_bonus: 0, wis: 10, wis_bonus: 0, chr: 10, chr_bonus: 0 }`.
- `avatar_url` (text, nullable) - Karakter resmi URL'si.

### 3.3. `images` Tablosu
DM'lerin yüklediği harita arka plan resimlerinin metadata kayıtları.
- `id` (int, Primary Key)
- `name` (text) - Resim adı.
- `url` (text) - ImgBB sunucularındaki direkt URL.

### 3.4. `map_state` Tablosu
Mevcut oyun oturumunun harita durumunu (çizimler, tokenlar vb.) düzenli aralıklarla yedeklemek için tek satırlık bir tablo.
- `id` (int, Primary Key - Her zaman `1`)
- `data` (jsonb) - Haritanın durumunu temsil eden JSON veri yapısı:
  - `players`: Bağlı oyuncuların pozisyon ve token verileri.
  - `markers`: DM'in haritaya eklediği NPC ve HP'li işaretçiler.
  - `drawHistory`: Çizim geçmişi listesi.
  - `mapBgUrl`: Geçerli harita arka plan resmi.

---

## 4. REST API Endpoint'leri

Sunucu (`server.js`) üzerinde tanımlı REST rotaları ve kabul ettikleri veri yapıları:

| Metot | Rota | Açıklama | Girdi (Body/Param) | Çıktı (JSON) |
|---|---|---|---|---|
| **GET** | `/ping` | Sunucu sağlık kontrolü. | - | `'pong'` (Plain text) |
| **POST** | `/upload` | ImgBB servisine base64 resmi yükler ve Supabase `images` tablosuna ekler. | `{ image: "base64Data...", name: "Resim Adı" }` (max 10MB) | `{ url: "http://..." }` |
| **GET** | `/api/gallery-images` | Yüklenmiş tüm galeri resimlerini döner. | - | `[{ id, name, url }, ...]` |
| **GET** | `/api/profiles` | Kayıtlı tüm kullanıcı profillerini döner. | - | `[{ id, username, role }, ...]` |
| **GET** | `/api/characters/:userId` | Belirli bir kullanıcıya ait karakterleri döner. | `:userId` (URL Param) | `[{ id, name, hp_max, ... }, ...]` |
| **GET** | `/api/characters` | Veritabanındaki tüm karakter kartlarını döner (Saldırı Paneli seçicisi için). | - | `[{ id, name, ... }, ...]` |
| **POST** | `/api/combat/attack` | Saldıran, hedef ve hasar girdilerine göre sunucu tarafında güvenli zar ve hasar hesaplaması yapar. | *Aşağıdaki Bknz: 4.1* | `{ attacks: [...], totalDamage: X, attackType: "..." }` |
| **POST** | `/api/combat/apply-damage` | Hesaplanan hasarı karakter kartına (Supabase) veya DM işaretçisine (bellek) uygular. | `{ targetType: "character"/"marker", targetId: "id", damage: X }` | `{ success: true, newHp: Y, targetType: "..." }` |
| **PUT** | `/api/characters/:charId` | Bir karakter kartının niteliklerini günceller. | `{ hp_current, hp_max, ac, ac_bonus, corruption, spell_slots, stats }` | `{ success: true, updates: {...} }` |
| **POST** | `/api/characters` | Yeni bir karakter kartı oluşturur. | `{ user_id, name, hp_max, stats, avatar_url, ac, ac_bonus }` | `[{ yeni_karakter_verileri }]` |

### 4.1. `/api/combat/attack` Girdi Formatı (Payload)
```json
{
  "attackerStats": { "stat": 14, "bonus": 2 },
  "targetAC": 15,
  "attackType": "physical",
  "advantage": false,
  "disadvantage": false,
  "attackCount": 1,
  "extraDamage": 0,
  "physical": { "min": 1, "max": 8, "extraMin": 0, "extraMax": 0, "weakness": false, "resistance": false },
  "element1": { "min": 0, "max": 0, "extraMin": 0, "extraMax": 0, "weakness": false, "resistance": false },
  "element2": { "min": 0, "max": 0, "extraMin": 0, "extraMax": 0, "weakness": false, "resistance": false },
  "spell": { "min": 0, "max": 0, "extraMin": 0, "extraMax": 0, "level": 1 }
}
```

---

## 5. Socket.io WebSocket Protokolü ve Senkronizasyon

Web tabanlı eşzamanlı harita etkileşimleri ve zar atma olayları WebSocket üzerinden iletilir.

### 5.1. İstemciden Gönderilen Eventler (Client -> Server)
- `playerJoin` (`{ sessionId, character, role, profile }`): İstemci bağlandığında sunucuda player nesnesini başlatır.
- `createMarker` (`{ x, y, name, color, imgUrl, hp, maxHp, ac, stats, size }`): DM'in haritaya can barı olan bağımsız bir token (NPC/Canavar) eklemesini sağlar.
- `deleteMarker` (`markerId`): DM'in bir harita işaretçisini silmesini sağlar.
- `editMarker` (`{ id, hp, size }`): DM'in işaretçi verilerini güncellemesini sağlar.
- `updateBg` (`url`): DM'in harita arka planını değiştirmesini tetikler.
- `updateTokenAppearance` (`{ imgUrl, color }`): Oyuncunun kendi token görselini veya rengini özelleştirmesini sağlar.
- `updateCharacter` (`{ id, characterId, hp_current, hp_max, stats, ... }`): DM'in bir karakter verisini güncellemesi.
- `drawLine` (`{ x0, y0, x1, y1, color }`): Harita üzerine çizilen çizgiyi sunucuya iletir.
- `requestClearAllDrawings` (): DM'in tüm çizimleri sıfırlama isteği.
- `requestClearMyDrawings` (): Oyuncunun sadece kendi çizimlerini sıfırlama isteği.
- `rollDice` (`{ diceType, rollerName }`): Sunucu tarafında rastgele zar atılıp herkese yayınlanmasını tetikler.
- `playerMovement` (`{ id, x, y }`): Bir token'ın harita üzerindeki yeni koordinatını sunucuya bildirir.
- `forceSave` (): DM'in harita durumunu veritabanına anlık yedeklemesini tetikler.

### 5.2. Sunucudan Yayınlanan veya Gönderilen Eventler (Server -> Client)
- `currentPlayers` (`players` listesi): Sadece yeni katılan istemciye mevcut tüm oyuncuları gönderir.
- `newPlayer` (`player` nesnesi): Diğer oyunculara yeni bağlanan tokenı bildirir.
- `playerDisconnected` (`socketId`): Bağlantısı kopan oyuncunun tokenını haritadan kaldırmayı sağlar.
- `currentMarkers` (`markers` listesi): Mevcut harita işaretçilerini yeni bağlanan istemciye gönderir.
- `newMarker` (`marker` nesnesi): Herkese yeni oluşturulan işaretçiyi bildirir.
- `removeMarker` (`markerId`): Silinen işaretçinin haritadan kaldırılmasını sağlar.
- `updateMarkerData` (`marker` nesnesi): İşaretçinin HP ve boyut güncellemelerini yayınlar.
- `updateBg` (`mapBgUrl`): Herkese güncel arka plan URL'sini bildirir.
- `tokenAppearanceUpdated` (`{ id, imgUrl, color }`): Bir token'ın görüntüsünün değiştiğini bildirir.
- `characterUpdated` (`{ id, updates }`): Karakter kartındaki can/stat güncellemelerini yayınlar.
- `drawHistory` (`drawHistory` dizisi): Bağlanıldığında veya temizlendiğinde tüm çizim geçmişini gönderir.
- `draw` (`line` nesnesi): Anlık olarak çizilen çizgiyi diğer istemcilere yayınlar.
- `diceRolled` (`{ rollerName, diceType, result }`): Atılan zarın sonucunu loglara eklenmesi için herkese yayınlar.
- `updateTokenPosition` (`{ id, x, y }`): Token hareketini diğer istemcilerde yumuşak bir şekilde günceller.
- `saveComplete` (): DM istemcisine haritanın veritabanına yedeklendiğini onaylar.

---

## 6. Bellek (In-Memory) Durum Yönetimi

Sunucu tarafında `server.js` belleğinde tutulan ve her **30 saniyede bir** Supabase `map_state` tablosuna otomatik kaydedilen yapılar:

- `players`: Bağlı olan tüm socket kullanıcıları.
  - Yapı: `socket.id` -> `{ id, sessionId, x, y, role, profile, character, color, imgUrl }`
- `markers`: Harita üzerine eklenmiş NPC işaretçileri.
  - Yapı: `marker_id` -> `{ id, x, y, name, color, imgUrl, hp, maxHp, ac, stats, size }`
- `drawHistory`: Canvas üzerinde yapılmış tüm çizimlerin koordinat ve renk geçmişi (Maksimum 10,000 çizgiyle sınırlıdır).
- `mapBgUrl`: Mevcut harita arka plan görselinin URL'si.
- `sessionCache`: Kopan oyuncuların durumunu 24 saat boyunca saklayan ve tekrar bağlandıklarında kaldıkları konumdan başlamalarını sağlayan yapı.

---

## 7. İstemci Tarafı Modülleri

1. **`login.js`:**
   - Rol seçimine (`dm` / `player`) göre sessionStorage ayarlar.
   - `/api/profiles` ve `/api/characters/:userId` rotalarını kullanarak profil/karakter seçim listesini yönetir.
   - `/api/characters` POST rotası ile karakter oluşturma formunu işler.
2. **`client.js`:**
   - Socket.io bağlantısını başlatır.
   - Harita canvas elementini yönetir, çizimleri yapar ve socket eventleri ile güncellemeleri çizer.
   - Tokenların fare ile sürüklenip bırakılması (`mousedown`, `mousemove`, `mouseup`) mantığını ele alır.
   - Sağ taraftaki sidebar boyutunun elle sürüklenerek ayarlanmasını (`#panel-resize-handle`) koordine eder.
   - DM ise oyuncu düzenleme formunu (`#dm-player-editor`) yönetir.
3. **`attack-panel.js` (Yalnızca DM):**
   - Saldıran ve Hedef seçicilerini bağlı oyuncular, veritabanındaki karakterler ve haritadaki HP'li markerlar ile besler.
   - Fiziksel ve Büyü saldırıları için form verilerini `/api/combat/attack` endpoint'ine iletir.
   - Gelen zar sonuçlarını `#atk-combat-log` içinde biçimlendirerek listeler.
   - Sonucu hedef tokena uygulamak için `/api/combat/apply-damage` endpoint'ini tetikler.

---

## 8. Önemli Tasarım Token'ları ve Class'lar

Projenin genel tasarım kuralları `THEME_GUIDE.md` dosyasında belgelenmiştir. Ancak kod yazarken sık karşılaşılan kritik seçiciler şunlardır:

- **Mavi Vurgu Renkleri:** `var(--accent)` (`#0ea5e9`), `var(--accent-hover)` (`#38bdf8`), `var(--accent-glow)` (`rgba(14, 165, 233, 0.3)`)
- **Koyu Taban Renkler:** `var(--bg-primary)` (`#060a13`), `var(--bg-secondary)` (`#0b111e`), `var(--bg-card)` (`#0f172a`)
- **Cam Efekti (Glassmorphism):** `.glass-panel` veya `.modal-box` gibi ögelerde `backdrop-filter: blur(12px)` ile uygulanır.
- **Yeniden Boyutlandırma Sınırları:** Minimum sidebar genişliği `260px`, maksimum `700px`'tir. Mobil görünümlerde sidebar (`≤900px` ekranlarda) toggle butonu aracılığıyla overlay olarak açılır.
