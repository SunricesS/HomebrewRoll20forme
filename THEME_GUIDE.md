# DnD Masaüstü — Tema Rehberi (Theme Guide)

> Bu dosya, gelecekteki dil modelleri ve geliştiricilerin projede tutarlı bir görsel dil sürdürmesi için oluşturulmuştur.
> Yeni bileşen, sayfa veya özellik eklerken bu rehbere **kesinlikle** uyulmalıdır.

---

## 1. Renk Paleti

### Arka Plan Katmanları (Koyudan Açığa)

| Token | Hex | Kullanım |
|---|---|---|
| `--bg-deepest` | `#060a13` | Combat log, en koyu alanlar |
| `--bg-primary` | `#0a0e17` | Body arka plan |
| `--bg-secondary` | `#0f1923` | Panel içi bölümler, input arka plan |
| `--bg-panel` | `#141d2b` | Kontrol paneli (sidebar) |
| `--bg-card` | `#1a2332` | Card bileşenleri, collapsible'lar |
| `--bg-elevated` | `#1e293b` | Hover durumları, yükseltilmiş alanlar |

### Vurgu Maviler

| Token | Hex | Kullanım |
|---|---|---|
| `--accent` | `#0ea5e9` | Ana vurgu rengi, aktif durumlar |
| `--accent-hover` | `#38bdf8` | Hover durumları, başlıklar |
| `--accent-dim` | `#0284c7` | Gradient'lerin koyu ucu |
| `--accent-glow` | `rgba(14, 165, 233, 0.35)` | Glow/shadow efektleri |
| `--accent-subtle` | `rgba(14, 165, 233, 0.08)` | Çok hafif arka plan tonu |

### Semantik Renkler

| Token | Hex | Kullanım |
|---|---|---|
| `--danger` | `#ef4444` | Hasar, silme, hata |
| `--danger-dim` | `#dc2626` | Danger gradient koyu uç |
| `--success` | `#22c55e` | Başarı, kaydetme, HP |
| `--success-dim` | `#16a34a` | Success gradient koyu uç |
| `--warning` | `#f59e0b` | Uyarı, DM kaydet butonu |
| `--warning-dim` | `#d97706` | Warning gradient koyu uç |
| `--purple` | `#a855f7` | İkincil aksiyonlar, direnç |
| `--purple-dim` | `#7c3aed` | Purple gradient koyu uç |
| `--gold` | `#fbbf24` | Kritik vuruşlar, özel vurgular |

### Metin Renkleri

| Token | Hex | Kullanım |
|---|---|---|
| `--text-primary` | `#e2e8f0` | Ana metin |
| `--text-secondary` | `#94a3b8` | İkincil metin, label'lar |
| `--text-muted` | `#64748b` | Placeholder, ipucu metni |
| `--text-on-accent` | `#ffffff` | Renkli arka plan üzerindeki metin |

### Border & Glass

| Token | Değer | Kullanım |
|---|---|---|
| `--border-subtle` | `rgba(148, 163, 184, 0.10)` | Hafif ayırıcılar |
| `--border-default` | `rgba(148, 163, 184, 0.15)` | Normal border'lar |
| `--border-accent` | `rgba(14, 165, 233, 0.25)` | Aktif/hover border |
| `--glass-bg` | `rgba(10, 14, 23, 0.80)` | Glassmorphism arka plan |
| `--glass-border` | `rgba(14, 165, 233, 0.12)` | Glass border |
| `--glass-blur` | `16px` | Backdrop blur miktarı |

---

## 2. Tipografi

| Özellik | Değer |
|---|---|
| **Font Ailesi** | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| **Mono Font** | `'Cascadia Code', 'Fira Code', 'Consolas', monospace` |
| **Font Ağırlıkları** | 300 (light), 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold) |
| **Metin Yumuşatma** | `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;` |

### Metin Boyut Referansı

| Kullanım | Boyut | Ağırlık |
|---|---|---|
| Sayfa başlığı | 28px | 800 |
| Modal başlık | 22px | 700 |
| Bölüm başlığı | 15-16px | 700 |
| Alt başlık | 13-14px | 700 |
| Normal metin | 13-14px | 400-500 |
| Label | 12px | 500-600 |
| İpucu / Hint | 11px | 400 |
| Badge / Küçük etiket | 10-11px | 600 |

---

## 3. Spacing & Layout

| Token | Değer | Kullanım |
|---|---|---|
| **Panel Genişlik** | `340px` (min: 300px, max: 400px) | Sağ sidebar |
| **Panel Padding** | `16px` | İç kenar boşluğu |
| **Card Padding** | `12-16px` | Kart iç boşluk |
| **Gap (Grid)** | `6-10px` | Grid aralıkları |
| **Gap (Buton)** | `10-12px` | Buton grupları |

### Border Radius

| Token | Değer | Kullanım |
|---|---|---|
| `--radius-sm` | `6px` | Input, küçük elemanlar |
| `--radius-md` | `10px` | Butonlar, card'lar |
| `--radius-lg` | `14px` | Modal, büyük bileşenler |
| `--radius-xl` | `20px` | Login modal, özel elemanlar |

---

## 4. Bileşen Stilleri

### Butonlar

Tüm butonlar `linear-gradient(135deg, ...)` arka plana sahip olmalıdır.

```css
/* Örnek Primary Buton */
.btn.primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-dim));
    color: var(--text-on-accent);
    box-shadow: 0 2px 10px var(--accent-glow);
    border: none;
    border-radius: var(--radius-md);
    font-weight: 600;
    transition: all var(--transition-base);
}

.btn.primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px var(--accent-glow);
}
```

**Buton Varyantları:**
- `primary` → Mavi gradient (Ana aksiyon)
- `secondary` → Mor gradient (İkincil aksiyon)
- `success` → Yeşil gradient (Kaydet/Onay)
- `danger` → Kırmızı gradient (Sil/Tehlike)
- `warning` → Turuncu gradient (Uyarı)
- `back-btn` → Koyu düz arka plan + border (Geri/İptal)

### Input'lar

```css
input {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
    outline: none;
}

input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
}
```

### Card'lar

```css
.card {
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 16px;
    transition: border-color var(--transition-base);
}

.card:hover {
    border-color: var(--border-accent);
}
```

### Collapsible / Accordion

```css
details.collapsible {
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 12px 14px;
}

details.collapsible[open] {
    border-color: var(--accent);
    box-shadow: 0 0 15px rgba(14, 165, 233, 0.08);
}

details.collapsible summary {
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
}
```

### Bölüm Başlıkları

```css
h4.section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* Sol tarafta mavi çubuk göstergesi */
h4.section-title::before {
    content: '';
    width: 3px;
    height: 14px;
    background: var(--accent);
    border-radius: 2px;
}
```

---

## 5. Glassmorphism Kuralları

Glassmorphism sadece şu durumlarda kullanılmalıdır:
- Login overlay modal kutuları
- Floating elementler (toast, dice toast)
- Modal overlay'ler

```css
.glass-element {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-lg);
}
```

> ⚠️ **Dikkat:** Sidebar ve normal card'lar için glassmorphism KULLANMAYIN. Bunlar opaque arka planlara sahip olmalıdır.

---

## 6. Animasyonlar & Geçişler

### Geçiş Süreleri

| Token | Değer | Kullanım |
|---|---|---|
| `--transition-fast` | `0.15s ease` | Focus, küçük hover efektleri |
| `--transition-base` | `0.25s ease` | Genel hover, açılma |
| `--transition-slow` | `0.4s ease` | Modal giriş, büyük geçişler |

### Hover Efektleri

```css
/* Buton hover: Yukarı kalkma + Glow */
.btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px var(--accent-glow);
}

/* Card hover: Border renk değişimi */
.card:hover {
    border-color: var(--border-accent);
}

/* List item hover: Sol border + Arka plan */
.list-item:hover {
    border-left: 3px solid var(--accent);
    background: rgba(14, 165, 233, 0.08);
    box-shadow: 0 0 12px var(--accent-glow);
}
```

### Özel Animasyonlar

```css
/* Pulse efekti (Hasar uygula butonu) */
@keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(X, X, X, 0.4); }
    50%      { box-shadow: 0 0 0 10px rgba(X, X, X, 0); }
}

/* Modal giriş */
@keyframes modalEnter {
    from { opacity: 0; transform: translateY(20px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

---

## 7. Responsive Breakpoints

| Breakpoint | Hedef | Davranış |
|---|---|---|
| `> 900px` | Masaüstü | Sidebar her zaman görünür, 340px genişlik |
| `≤ 900px` | Tablet | Sidebar overlay olarak açılır, toggle butonu görünür |
| `≤ 480px` | Mobil | Kompakt grid'ler (2-sütun), küçük font boyutları |

### Mobil Sidebar Davranışı

```
- Sidebar: position: fixed, sağdan kayarak açılır
- Toggle butonu: Sağ altta sabit, 52px yuvarlak mavi buton
- Overlay: Koyu yarı saydam arka plan, tıklanınca sidebar kapanır
```

---

## 8. Gölge Sistemi

| Token | Değer | Kullanım |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.4)` | Hafif yükseklik |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.5)` | Card'lar, butonlar |
| `--shadow-lg` | `0 8px 30px rgba(0,0,0,0.6)` | Modal, sidebar |
| `--shadow-glow` | `0 0 20px var(--accent-glow)` | Vurgulu elemanlar |

---

## 9. Custom Scrollbar

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb { background: var(--accent-dim); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); }
```

---

## 10. Yeni Bileşen Ekleme Kuralları

1. **Her zaman CSS değişkenlerini kullan** — Sabit renk kodu (`#3498db`) yerine `var(--accent)` kullan.
2. **Gradient butonlar** — Tüm ana butonlara `linear-gradient(135deg, ...)` uygula.
3. **Hover'da transform** — Butonlarda `translateY(-1px)`, card'larda `border-color` değişimi.
4. **Focus ring** — Tüm input/select elemanlarında `box-shadow: 0 0 0 3px var(--accent-glow)` kullan.
5. **Font ailesi** — Kesinlikle `var(--font-family)` kullan, tarayıcı varsayılanlarına güvenme.
6. **Border radius** — Token'lardan (`--radius-sm/md/lg/xl`) kullan, sabit piksel yerine.
7. **Geçiş süreleri** — Token'ları kullan: `var(--transition-fast/base/slow)`.
8. **Arka plan katmanlama** — Derinlik hissini korumak için doğru katmanı seç (deepest → primary → secondary → panel → card → elevated).
9. **Metin renkleri** — Ana metin: `--text-primary`, Label: `--text-secondary`, İpucu: `--text-muted`.
10. **Glassmorphism sınırı** — Sadece floating/overlay elemanlar için kullan, normal layout içinde kullanma.

---

## 11. Dosya Yapısı

```
public/
├── css/
│   └── style.css          ← Ana stil dosyası (tüm CSS burada)
├── js/
│   ├── client.js          ← Ana oyun mantığı + Socket.io
│   ├── login.js           ← Giriş sayfası mantığı
│   └── attack-panel.js    ← Saldırı paneli mantığı
├── index.html             ← Giriş sayfası
├── game.html              ← Ana oyun sayfası
└── gallery.html           ← Resim galerisi
```

---

## 12. Önemli class/id Referansları

> ⚠️ Bu class ve id'ler JavaScript tarafından kullanılmaktadır. **DEĞİŞTİRMEYİN.**

### Kritik ID'ler
`#app-container`, `#game-map`, `#map-content`, `#drawing-layer`, `#control-panel`,
`#dice-panel`, `#logs`, `#dm-tools`, `#player-info-panel`, `#status`,
`#dm-marker-editor-modal`, `#sidebar-toggle`, `#sidebar-overlay`

### Kritik Class'lar
`.token`, `.my-token`, `.token-hp-badge`, `.dice-btn`, `.dice-toast`,
`.hidden`, `.panel-open`, `.sidebar-overlay.active`,
`.list-item`, `.character-card`

---

*Son güncelleme: Haziran 2026*
