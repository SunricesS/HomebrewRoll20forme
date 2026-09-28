const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const app = express();
const axios = require('axios');
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { createClient } = require('@supabase/supabase-js');

// === SUPABASE KURULUMU ===
const SUPABASE_URL = 'https://fjcnaofzetkoxuyrwfpw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oAFX73DbfClKaQVXg8-GSw_qbVX6bWk';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === SABİTLER ===
const MAX_DRAW_HISTORY = 10000;
const BACKUP_INTERVAL_MS = 30000; 
const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

// === YARDIMCI FONKSİYONLAR ===

/**
 * URL'nin geçerli bir http/https URL olup olmadığını kontrol edr.
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sayısal değeri güvenli aralığa sınırlar.
 */
function clampNumber(val, min, max) {
  const n = Number(val);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * String'i belirli uzunluğa kırpar.
 */
function truncateStr(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.substring(0, maxLen);
}

// === MIDDLEWARE ===
app.use(express.static('public'));

// Genel JSON body limiti — 1 MB
app.use(express.json({ limit: '10mb' }));

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// === REST API ROTALARI ===

// ---- ImgBB Resim Yükleme (yüksek limit) ----
app.post('/upload', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const base64Image = req.body.image;
    const fileName = truncateStr(req.body.name || 'İsimsiz Resim', 100);
    if (!base64Image || typeof base64Image !== 'string') {
      return res.status(400).json({ error: 'Resim verisi bulunamadı.' });
    }

    // data URI şemasını kaldır (ör. "data:image/png;base64,")
    const base64Data = base64Image.replace(/^data:.*?;base64,/, '');

    const payload = { image: base64Data };
    if (fileName && fileName !== 'İsimsiz Resim') {
      payload.name = fileName;
    }

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, payload, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    if (response.data && response.data.data && response.data.data.url) {
      const imgUrl = response.data.data.url;

      // Supabase'e kaydet
      const { error: dbError } = await supabase
        .from('images')
        .insert([{ name: fileName, url: imgUrl }]);

      if (dbError) {
        console.error('Supabase resim kaydetme hatası:', dbError);
      }

      res.json({ url: imgUrl });
    } else {
      res.status(500).json({ error: 'Resim yüklenemedi.' });
    }
  } catch (error) {
    let errMessage = error.message;
    if (error.response && error.response.data) {
      errMessage = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    }
    console.error('ImgBB yükleme hatası:', errMessage);
    res.status(500).json({ error: `Resim yüklenirken hata oluştu: ${errMessage}` });
  }
});

// ---- Galeri Resimleri ----
app.get('/api/gallery-images', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('images')
      .select('id, name, url');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Galeri çekme hatası:', err);
    res.status(500).json({ error: 'Resimler getirilemedi.' });
  }
});

// ---- Profil Listesi ----
app.get('/api/profiles', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Profil çekme hatası:', err);
    res.status(500).json({ error: 'Profiller getirilemedi.' });
  }
});

// ---- Kullanıcı Karakter Listesi ----
app.get('/api/characters/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { data, error } = await supabase.from('characters').select('*').eq('user_id', userId);
    if (error) throw error;
    const formatted = (data || []).map(c => ({
      ...c,
      assignedAttacks: c.assigned_attacks || c.stats?.assignedAttacks || c.assignedAttacks || []
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Karakter çekme hatası:', err);
    res.status(500).json({ error: 'Karakterler getirilemedi.' });
  }
});

// ---- Tüm Karakterler (DM Saldırı Paneli için) ----
app.get('/api/characters', async (req, res) => {
  try {
    const { data, error } = await supabase.from('characters').select('*');
    if (error) throw error;
    const formatted = (data || []).map(c => ({
      ...c,
      assignedAttacks: c.assigned_attacks || c.stats?.assignedAttacks || c.assignedAttacks || []
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Tüm karakter çekme hatası:', err);
    res.status(500).json({ error: 'Karakterler getirilemedi.' });
  }
});

// === SAVAŞ SİSTEMİ (COMBAT) ===

/**
 * Sunucu tarafında güvenli zar atma
 */
function rollDie(min, max) {
  if (max <= 0 || min > max) return 0;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollAdvantage(min, max) {
  return Math.max(rollDie(min, max), rollDie(min, max));
}

function rollDisadvantage(min, max) {
  return Math.min(rollDie(min, max), rollDie(min, max));
}

// === HASAR TÜRLERİ & DİRENÇ / ZAYIFLIK MOTORU ===
function normalizeDamageType(type) {
  if (!type) return 'slashing';
  const t = String(type).toLowerCase().trim();
  if (t === 'ezme' || t === 'bludgeoning') return 'bludgeoning';
  if (t === 'delme' || t === 'piercing') return 'piercing';
  if (t === 'kesme' || t === 'slashing') return 'slashing';
  if (t === 'büyü' || t === 'buyu' || t === 'magic' || t === 'spell') return 'magic';
  return t;
}

function getDamageTypeTurkish(type) {
  const norm = normalizeDamageType(type);
  if (norm === 'bludgeoning') return 'Ezme';
  if (norm === 'piercing') return 'Delme';
  if (norm === 'slashing') return 'Kesme';
  if (norm === 'magic') return 'Büyü';
  return type || 'Fiziksel';
}

function hasDamageResistance(effects, damageType) {
  if (!Array.isArray(effects) || !damageType) return false;
  const dt = normalizeDamageType(damageType);
  return effects.some(e => {
    if (!e) return false;
    const eff = e.effects || {};
    if (eff[`res_${dt}`] || eff[`resistance_${dt}`]) return true;
    if (typeof eff.resistance === 'string' && normalizeDamageType(eff.resistance) === dt) return true;
    if (Array.isArray(eff.resistance) && eff.resistance.some(r => normalizeDamageType(r) === dt)) return true;
    if (typeof eff.resistance === 'object' && eff.resistance && eff.resistance[dt]) return true;
    const name = (e.name || '').toLowerCase();
    if (dt === 'bludgeoning' && (/ezme.*diren/i.test(name) || /bludgeon.*resist/i.test(name))) return true;
    if (dt === 'slashing' && (/kesme.*diren/i.test(name) || /slash.*resist/i.test(name))) return true;
    if (dt === 'piercing' && (/delme.*diren/i.test(name) || /pierc.*resist/i.test(name))) return true;
    if (dt === 'magic' && (/b[üy]y[üu].*diren/i.test(name) || /magic.*resist/i.test(name))) return true;
    return false;
  });
}

function hasDamageVulnerability(effects, damageType) {
  if (!Array.isArray(effects) || !damageType) return false;
  const dt = normalizeDamageType(damageType);
  return effects.some(e => {
    if (!e) return false;
    const eff = e.effects || {};
    if (eff[`vuln_${dt}`] || eff[`vulnerability_${dt}`]) return true;
    if (typeof eff.vulnerability === 'string' && normalizeDamageType(eff.vulnerability) === dt) return true;
    if (Array.isArray(eff.vulnerability) && eff.vulnerability.some(r => normalizeDamageType(r) === dt)) return true;
    if (typeof eff.vulnerability === 'object' && eff.vulnerability && eff.vulnerability[dt]) return true;
    const name = (e.name || '').toLowerCase();
    if (dt === 'bludgeoning' && (/ezme.*zay/i.test(name) || /bludgeon.*vuln/i.test(name))) return true;
    if (dt === 'slashing' && (/kesme.*zay/i.test(name) || /slash.*vuln/i.test(name))) return true;
    if (dt === 'piercing' && (/delme.*zay/i.test(name) || /pierc.*vuln/i.test(name))) return true;
    if (dt === 'magic' && (/b[üy]y[üu].*zay/i.test(name) || /magic.*vuln/i.test(name))) return true;
    return false;
  });
}

function rollChannelDamage(channel, resWeakOptions) {
  if (!channel) return { damage: 0, breakdown: '' };

  const isResistant = resWeakOptions ? Boolean(resWeakOptions.isResistant) : Boolean(channel.resistance);
  const isVulnerable = resWeakOptions ? Boolean(resWeakOptions.isVulnerable) : Boolean(channel.weakness);
  const resLabel = (resWeakOptions && resWeakOptions.typeLabel) || (isResistant ? 'Dirençli 0.5x' : 'Zayıf 2x');

  // 1. Dice pool desteği ({ dice: { d4, d6, ... }, bonus, weakness, resistance })
  if (channel.dice && typeof channel.dice === 'object') {
    let rawTotal = 0;
    const parts = [];
    const sidesList = [4, 6, 8, 10, 12, 20];
    let hasDice = false;

    for (const sides of sidesList) {
      const count = clampNumber(parseInt(channel.dice[`d${sides}`] ?? channel.dice[sides] ?? 0), 0, 50);
      if (count > 0) {
        hasDice = true;
        const rolls = [];
        for (let i = 0; i < count; i++) {
          const r = rollDie(1, sides);
          rolls.push(r);
          rawTotal += r;
        }
        parts.push(`${count}d${sides} [${rolls.join(' + ')}]`);
      }
    }

    const bonus = clampNumber(parseInt(channel.bonus) || 0, -1000, 1000);
    if (bonus !== 0) {
      rawTotal += bonus;
      parts.push(bonus > 0 ? `+${bonus}` : `${bonus}`);
    }

    if (hasDice || bonus !== 0) {
      let finalDmg = Math.max(0, rawTotal);
      if (isVulnerable && !isResistant) {
        finalDmg *= 2;
        parts.push(`(${resLabel} 2x)`);
      } else if (isResistant && !isVulnerable) {
        finalDmg = Math.floor(finalDmg / 2);
        parts.push(`(${resLabel} 0.5x)`);
      }
      return { damage: finalDmg, breakdown: parts.join(' ') };
    }
  }

  // 2. Geriye dönük uyumluluk (Legacy min/max)
  let dmg = 0;
  const parts = [];
  const pMin = clampNumber(channel.min, 0, 1000);
  const pMax = clampNumber(channel.max, 0, 1000);
  const peMin = clampNumber(channel.extraMin, 0, 1000);
  const peMax = clampNumber(channel.extraMax, 0, 1000);

  if (pMax > 0) {
    const r1 = rollDie(pMin, pMax);
    dmg += r1;
    parts.push(`[${r1}]`);
  }
  if (peMax > 0) {
    const r2 = rollDie(peMin, peMax);
    dmg += r2;
    parts.push(`Ek:[${r2}]`);
  }

  if (isVulnerable && !isResistant) {
    dmg *= 2;
    parts.push(`(${resLabel} 2x)`);
  } else if (isResistant && !isVulnerable) {
    dmg = Math.floor(dmg / 2);
    parts.push(`(${resLabel} 0.5x)`);
  }

  return { damage: dmg, breakdown: parts.join(' + ') };
}

function rollSpellDamage(spell, resWeakOptions) {
  if (!spell) return { damage: 0, breakdown: '' };
  const slotMultipliers = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
  const sLevel = clampNumber(spell.level, 1, 4);
  const mult = slotMultipliers[sLevel] || 1;

  const isResistant = resWeakOptions ? Boolean(resWeakOptions.isResistant) : false;
  const isVulnerable = resWeakOptions ? Boolean(resWeakOptions.isVulnerable) : false;
  const resLabel = (resWeakOptions && resWeakOptions.typeLabel) || (isResistant ? 'Büyü Direnci 0.5x' : 'Büyü Zayıflığı 2x');

  if (spell.dice && typeof spell.dice === 'object') {
    let rawTotal = 0;
    const parts = [];
    const sidesList = [4, 6, 8, 10, 12, 20];
    let hasDice = false;

    for (const sides of sidesList) {
      const count = clampNumber(parseInt(spell.dice[`d${sides}`] ?? spell.dice[sides] ?? 0), 0, 50);
      if (count > 0) {
        hasDice = true;
        const rolls = [];
        for (let i = 0; i < count; i++) {
          const r = rollDie(1, sides);
          rolls.push(r);
          rawTotal += r;
        }
        parts.push(`${count}d${sides} [${rolls.join(' + ')}]`);
      }
    }

    const bonus = clampNumber(parseInt(spell.bonus) || 0, -1000, 1000);
    if (bonus !== 0) {
      rawTotal += bonus;
      parts.push(bonus > 0 ? `+${bonus}` : `${bonus}`);
    }

    if (hasDice || bonus !== 0) {
      let scaledDmg = Math.max(0, Math.floor(rawTotal * mult));
      if (mult !== 1) {
        parts.push(`(Lvl ${sLevel}: ${mult}x)`);
      }
      if (isVulnerable && !isResistant) {
        scaledDmg *= 2;
        parts.push(`(${resLabel} 2x)`);
      } else if (isResistant && !isVulnerable) {
        scaledDmg = Math.floor(scaledDmg / 2);
        parts.push(`(${resLabel} 0.5x)`);
      }
      return { damage: scaledDmg, breakdown: parts.join(' ') };
    }
  }

  // Geriye dönük uyumluluk (Legacy min/max)
  const sMin = clampNumber(spell.min, 0, 1000);
  const sMax = clampNumber(spell.max, 0, 1000);
  const seMin = clampNumber(spell.extraMin, 0, 1000);
  const seMax = clampNumber(spell.extraMax, 0, 1000);

  let spellDmg = 0;
  const parts = [];
  if (sMax > 0) {
    const r1 = rollDie(Math.floor(sMin * mult), Math.floor(sMax * mult));
    spellDmg += r1;
    parts.push(`[${r1}]`);
    if (seMax > 0) {
      const r2 = rollDie(Math.floor(seMin * mult), Math.floor(seMax * mult));
      spellDmg += r2;
      parts.push(`Ek:[${r2}]`);
    }
  }
  if (isVulnerable && !isResistant) {
    spellDmg *= 2;
    parts.push(`(${resLabel} 2x)`);
  } else if (isResistant && !isVulnerable) {
    spellDmg = Math.floor(spellDmg / 2);
    parts.push(`(${resLabel} 0.5x)`);
  }
  return { damage: spellDmg, breakdown: parts.join(' + ') };
}

// ---- Saldırı / Aksiyon Hesapla (Hasar, Şifa & Hibrit / Can Çalma) ----
app.post('/api/combat/attack', (req, res) => {
  try {
    const {
      attacker,             // { type: 'marker' | 'character', id: '...' }
      attackerStats,        // { stat, bonus } — seçilen yetenek değeri ve bonusu
      target,               // { type: 'marker' | 'character', id: '...' }
      targetAC,             // hedef AC değeri
      attackType,           // 'physical' | 'spell'
      actionNature,         // 'damage' | 'heal' | 'hybrid'
      healPool,             // { dice, bonus, min, max } — Can yenileme zar havuzu
      healTarget,           // 'self' | 'target' — Şifanın gideceği taraf (saldıran veya hedef)
      lifestealPercent,     // number (0-100) — Hasar üzerinden can çalma yüzdesi
      advantage,            // bool
      disadvantage,         // bool
      attackCount,          // saldırı / aksiyon adedi
      extraDamage,          // manuel ek hasar
      halfDamageOnMiss,     // bool — Iska durumunda yarım hasar vurulsun mu
      statusEffectsToApply, // array — İsabet durumunda hedefe uygulanacak durum efektleri
      physicalDamageType,   // 'slashing' | 'bludgeoning' | 'piercing' | 'magic' | 'holy'
      // Fiziksel saldırı parametreleri
      physical,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      element1,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      element2,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      // Büyü saldırı parametreleri
      spell,                // { dice, bonus, min, max, extraMin, extraMax, level }
    } = req.body;

    const safeAC = clampNumber(targetAC, 0, 50);
    const safeCount = clampNumber(attackCount, 1, 20);
    const safeStat = clampNumber(attackerStats?.stat, 0, 30);
    const safeBonus = clampNumber(attackerStats?.bonus, 0, 30);
    const safeExtra = clampNumber(extraDamage, 0, 1000);
    const safeLifesteal = clampNumber(parseInt(lifestealPercent) || 0, 0, 100);

    // Aksiyon niteliğini tespit et (heal, hybrid veya damage)
    let effectiveNature = actionNature;
    if (!effectiveNature) {
      const hasHealDice = healPool && (healPool.bonus || Object.values(healPool.dice || {}).some(v => parseInt(v) > 0));
      const hasDmgDice = (physical && (physical.bonus || Object.values(physical.dice || {}).some(v => parseInt(v) > 0))) ||
                         (element1 && (element1.bonus || Object.values(element1.dice || {}).some(v => parseInt(v) > 0))) ||
                         (spell && (spell.bonus || Object.values(spell.dice || {}).some(v => parseInt(v) > 0)));
      if (hasHealDice && !hasDmgDice && safeLifesteal === 0) effectiveNature = 'heal';
      else if (hasHealDice && hasDmgDice) effectiveNature = 'hybrid';
      else effectiveNature = 'damage';
    }

    const effectiveHealTarget = healTarget || (effectiveNature === 'heal' ? 'target' : 'self');

    // Durum Efektlerini Çözümle
    const attackerEffects = attacker ? getTokenActiveEffects(attacker.type, attacker.id) : [];
    const targetEffects = target ? getTokenActiveEffects(target.type, target.id) : [];

    const hasAttackerBlind = attackerEffects.some(e => e.effects?.blind);
    const hasTargetPrepared = targetEffects.some(e => e.effects?.prepared);
    const hasTargetUnstoppable = targetEffects.some(e => e.effects?.unstoppable);
    const hasTargetParalyzed = targetEffects.some(e => e.effects?.paralyzed) && !hasTargetUnstoppable;

    // Hasar Direnç ve Zayıflık Çözümleme (Ezme, Kesme, Delme, Büyü)
    const physType = normalizeDamageType(physicalDamageType || 'slashing');
    const hasPhysRes = hasDamageResistance(targetEffects, physType);
    const hasPhysVuln = hasDamageVulnerability(targetEffects, physType);

    const hasMagicRes = hasDamageResistance(targetEffects, 'magic');
    const hasMagicVuln = hasDamageVulnerability(targetEffects, 'magic');

    // Direnç ve zayıflık aynı anda varsa birbirini sıfırlar (D&D 5e standardı)
    const physEffectiveRes = hasPhysRes && !hasPhysVuln;
    const physEffectiveVuln = hasPhysVuln && !hasPhysRes;

    const magicEffectiveRes = hasMagicRes && !hasMagicVuln;
    const magicEffectiveVuln = hasMagicVuln && !hasMagicRes;

    const physResOptions = {
      isResistant: physEffectiveRes,
      isVulnerable: physEffectiveVuln,
      typeLabel: `${getDamageTypeTurkish(physType)} ${physEffectiveRes ? 'Direnci' : 'Zayıflığı'}`
    };

    const magicResOptions = {
      isResistant: magicEffectiveRes,
      isVulnerable: magicEffectiveVuln,
      typeLabel: `Büyü ${magicEffectiveRes ? 'Direnci' : 'Zayıflığı'}`
    };

    let effectiveAdvantage = Boolean(advantage);
    let effectiveDisadvantage = Boolean(disadvantage);

    if (hasAttackerBlind || hasTargetPrepared) {
      effectiveDisadvantage = true;
    }

    const attacks = [];
    let totalDamage = 0;
    let totalHeal = 0;

    for (let i = 0; i < safeCount; i++) {
      // 1. Vuruş zarı (d20)
      let hitRoll = 0;
      if (effectiveAdvantage && !effectiveDisadvantage) {
        hitRoll = rollAdvantage(1, 20);
      } else if (effectiveDisadvantage && !effectiveAdvantage) {
        hitRoll = rollDisadvantage(1, 20);
      } else {
        hitRoll = rollDie(1, 20);
      }

      // 2. Bonuslu zar = hitRoll + floor((stat + bonus) / 2)
      const modifiedRoll = hitRoll + Math.floor((safeStat + safeBonus) / 2);

      // 3. Vuruş kontrolü
      let isCritical = hitRoll === 20;
      let isCritFail = hitRoll === 1;
      let isHit = false;

      // Saf şifa büyüleri doğrudan müttefike/kendine uygulandığından AC kontrolü yapmaz (kesin tutar)
      if (effectiveNature === 'heal') {
        isHit = true;
        isCritFail = false;
      } else if (hasTargetParalyzed) {
        isHit = true;
        isCritical = true; // Felçli hedefe yapılan tüm saldırılar kesin vuruş ve kritiktir
      } else {
        isHit = isCritical || (!isCritFail && modifiedRoll >= safeAC);
      }

      // 4. Saf Şifa Aksiyonu (Heal only)
      if (effectiveNature === 'heal') {
        const healRes = rollChannelDamage(healPool || {});
        let healAmount = healRes.damage + safeExtra;
        const healParts = [];

        if (healRes.breakdown) healParts.push(`Şifa Zarı: ${healRes.breakdown}`);
        if (safeExtra > 0) healParts.push(`Ek Şifa: +${safeExtra}`);

        if (isCritical) {
          healAmount = Math.floor(healAmount * 1.5);
          healParts.push('(✨ KRİTİK ŞİFA x1.5)');
        }

        totalHeal += healAmount;

        attacks.push({
          index: i + 1,
          hit: true,
          halfDamageMiss: false,
          hitRoll,
          modifiedRoll,
          isCritical,
          isCritFail: false,
          damage: 0,
          heal: healAmount,
          breakdown: healParts.join(' | ') || `💚 +${healAmount} Can`
        });
        continue;
      }

      // 5. Iska Durumu (Hasar veya Hibrit için)
      if (!isHit) {
        let missDamage = 0;
        let missHeal = 0;
        let missReason = 'ISKA';

        if (halfDamageOnMiss) {
          // Iska durumunda ham hasar hesaplanır ve yarısı uygulanır
          let rawDmg = 0;
          const missParts = [];

          if (attackType === 'physical' || physical || element1 || element2) {
            const physRes = rollChannelDamage(physical, physResOptions);
            const elem1Res = rollChannelDamage(element1);
            const elem2Res = rollChannelDamage(element2);

            if (physRes.breakdown) missParts.push(`${getDamageTypeTurkish(physType)}: ${physRes.breakdown}`);
            if (elem1Res.breakdown) missParts.push(`Ateş/El.1: ${elem1Res.breakdown}`);
            if (elem2Res.breakdown) missParts.push(`Buz/El.2: ${elem2Res.breakdown}`);

            rawDmg = physRes.damage + elem1Res.damage + elem2Res.damage + safeExtra;
            if (safeExtra > 0) missParts.push(`Manuel Ek: +${safeExtra}`);
          } else {
            const spellRes = rollSpellDamage(spell, magicResOptions);
            if (spellRes.breakdown) missParts.push(`Büyü: ${spellRes.breakdown}`);
            rawDmg = spellRes.damage + safeExtra;
            if (safeExtra > 0) missParts.push(`Manuel Ek: +${safeExtra}`);
          }

          missDamage = Math.max(1, Math.floor(rawDmg / 2));
          totalDamage += missDamage;

          // Hibrit ise can çalma da orantılı uygulanır
          if (effectiveNature === 'hybrid' && safeLifesteal > 0) {
            missHeal = Math.max(0, Math.floor(missDamage * (safeLifesteal / 100)));
            totalHeal += missHeal;
          }

          missReason = `ISKA (½ Hasar: ${missDamage}${missHeal > 0 ? `, 💚 Can Çalma: +${missHeal}` : ''}) [Ham: ${rawDmg}]`;
        } else {
          if (hasAttackerBlind) missReason = 'ISKA (Körlük)';
          else if (hasTargetPrepared) missReason = 'ISKA (Hazır)';
        }

        attacks.push({
          index: i + 1,
          hit: false,
          halfDamageMiss: Boolean(halfDamageOnMiss && missDamage > 0),
          hitRoll,
          modifiedRoll,
          isCritical: false,
          isCritFail,
          damage: missDamage,
          heal: missHeal,
          breakdown: missReason
        });
        continue;
      }

      // 6. Başarılı Vuruş — Hasar ve Şifa / Can Çalma Hesaplama
      let damage = 0;
      const breakdownParts = [];

      if (attackType === 'physical' || physical || element1 || element2) {
        const physRes = rollChannelDamage(physical, physResOptions);
        const elem1Res = rollChannelDamage(element1);
        const elem2Res = rollChannelDamage(element2);

        if (physRes.breakdown) breakdownParts.push(`${getDamageTypeTurkish(physType)}: ${physRes.breakdown}`);
        if (elem1Res.breakdown) breakdownParts.push(`Ateş/El.1: ${elem1Res.breakdown}`);
        if (elem2Res.breakdown) breakdownParts.push(`Buz/El.2: ${elem2Res.breakdown}`);

        damage = physRes.damage + elem1Res.damage + elem2Res.damage + safeExtra;
        if (safeExtra > 0) breakdownParts.push(`Manuel Ek: +${safeExtra}`);
      } else {
        const spellRes = rollSpellDamage(spell, magicResOptions);
        if (spellRes.breakdown) breakdownParts.push(`Büyü: ${spellRes.breakdown}`);
        damage = spellRes.damage + safeExtra;
        if (safeExtra > 0) breakdownParts.push(`Manuel Ek: +${safeExtra}`);
      }

      // Kritik vuruş çarpanı (Normal kritik: 1.5x, Felç kritik: 2x)
      if (isCritical) {
        if (hasTargetParalyzed) {
          damage = Math.floor(damage * 2);
          breakdownParts.push('(⚡ FELÇ KRİTİK x2)');
        } else {
          damage = Math.floor(damage * 1.5);
          breakdownParts.push('(KRİTİK x1.5)');
        }
      }

      totalDamage += damage;

      // 7. Hibrit Aksiyon (Hem Hasar Vurur Hem Can Yeniler / Can Çalar)
      let attackHeal = 0;
      if (effectiveNature === 'hybrid') {
        const healRes = rollChannelDamage(healPool || {});
        let rolledHeal = healRes.damage;
        const healDetail = [];

        if (healRes.breakdown) healDetail.push(`${healRes.breakdown}`);

        // Can çalma yüzdesi varsa hasardan ek can çek
        if (safeLifesteal > 0) {
          const lifestealVal = Math.max(0, Math.floor(damage * (safeLifesteal / 100)));
          rolledHeal += lifestealVal;
          healDetail.push(`%${safeLifesteal} Çalma: +${lifestealVal}`);
        }

        if (isCritical) {
          rolledHeal = Math.floor(rolledHeal * 1.5);
          healDetail.push('(KRİTİK x1.5)');
        }

        attackHeal = rolledHeal;
        totalHeal += attackHeal;

        if (attackHeal > 0) {
          breakdownParts.push(`💚 Şifa: +${attackHeal} Can (${healDetail.join(' ') || attackHeal})`);
        }
      }

      attacks.push({
        index: i + 1,
        hit: true,
        halfDamageMiss: false,
        hitRoll,
        modifiedRoll,
        isCritical,
        isCritFail: false,
        damage,
        heal: attackHeal,
        breakdown: breakdownParts.join(' | ') || `${damage}`
      });
    }

    res.json({
      attacks,
      totalDamage,
      totalHeal,
      actionNature: effectiveNature,
      healTarget: effectiveHealTarget,
      lifestealPercent: safeLifesteal,
      attackType,
      statusEffectsToApply: Array.isArray(statusEffectsToApply) ? statusEffectsToApply : [],
      statusNotes: {
        attackerBlind: hasAttackerBlind,
        targetPrepared: hasTargetPrepared,
        targetParalyzed: hasTargetParalyzed,
        halfDamageOnMiss: Boolean(halfDamageOnMiss),
        targetResistant: attackType === 'physical' ? physEffectiveRes : magicEffectiveRes,
        targetVulnerable: attackType === 'physical' ? physEffectiveVuln : magicEffectiveVuln,
        damageType: attackType === 'physical' ? getDamageTypeTurkish(physType) : 'Büyü'
      }
    });
  } catch (err) {
    console.error('Saldırı hesaplama hatası:', err);
    res.status(500).json({ error: 'Saldırı hesaplanamadı.' });
  }
});

// ---- Hasar ve Şifa / Can Çalma Uygula ----
app.post('/api/combat/apply-damage', async (req, res) => {
  try {
    const {
      targetType,
      targetId,
      damage,
      heal,
      healTarget,
      attackerType,
      attackerId,
      actionNature,
      statusEffectsToApply,
      isCritical,
      attackType,
      damageType,
      impactId,
      senderSocketId
    } = req.body;

    const safeDamage = clampNumber(damage, 0, 99999);
    const safeHeal = clampNumber(heal, 0, 99999);

    // Barınak (Shelter) kontrolü (Yalnızca hasar için)
    const targetEffects = getTokenActiveEffects(targetType, targetId);
    const hasShelter = targetEffects.some(e => e.effects?.shelter);

    let damageApplied = safeDamage;
    if (hasShelter && safeDamage > 0) {
      damageApplied = 0;
      io.emit('logMessage', { message: '🛡️ Barınak: Hasar tamamen engellendi (Dokunulmaz)!', color: '#3498db' });
    }

    // Durum efektlerini hedefe uygula (varsa)
    if (Array.isArray(statusEffectsToApply) && statusEffectsToApply.length > 0) {
      statusEffectsToApply.forEach(eff => {
        applyStatusEffectToTarget(targetType, targetId, eff);
      });
    }

    let targetNewHp = null;

    // 1. Hedefe Hasar Uygulama (Eğer hasar varsa veya hedef HP güncelleniyorsa)
    if (targetType === 'character') {
      const { data: charData, error: fetchErr } = await supabase
        .from('characters')
        .select('hp_current, hp_max, name')
        .eq('id', targetId)
        .single();

      if (fetchErr) throw fetchErr;

      let newHp = Math.max(0, (charData.hp_current || 0) - damageApplied);

      // Eğer şifa doğrudan hedefe uygulanıyorsa
      if (safeHeal > 0 && healTarget === 'target') {
        newHp = Math.min(charData.hp_max || 99999, newHp + safeHeal);
      }

      targetNewHp = newHp;

      const { error: updateErr } = await supabase
        .from('characters')
        .update({ hp_current: newHp })
        .eq('id', targetId);

      if (updateErr) throw updateErr;

      const playerEntry = Object.entries(players).find(
        ([, p]) => p.character && p.character.id === targetId
      );
      if (playerEntry) {
        const [socketId, playerData] = playerEntry;
        playerData.character.hp_current = newHp;
        io.emit('characterUpdated', {
          id: socketId,
          updates: { hp_current: newHp, hp_max: charData.hp_max }
        });
        syncCombatantHp(socketId, newHp, charData.hp_max);
      } else {
        syncCombatantHp(targetId, newHp, charData.hp_max);
      }

      if (damageApplied > 0) {
        io.emit('attackHitImpact', {
          targetType: 'character',
          targetId,
          damage: damageApplied,
          isCritical: Boolean(isCritical),
          attackType: attackType || 'physical',
          damageType: damageType || 'slashing',
          impactId: impactId || null,
          senderSocketId: senderSocketId || null
        });
      }

      if (safeHeal > 0 && healTarget === 'target') {
        io.emit('combatHealImpact', {
          recipientType: 'character',
          recipientId: targetId,
          targetType: 'character',
          targetId: targetId,
          heal: safeHeal,
          amount: safeHeal,
          newHp,
          maxHp: charData.hp_max,
          recipientName: charData.name,
          impactId,
          senderSocketId
        });
        io.emit('logMessage', {
          message: `💚 [ŞİFA] ${charData.name || 'Hedef'} +${safeHeal} Can Yeniledi! (${newHp}/${charData.hp_max})`,
          color: '#10b981'
        });
      }
    } else if (targetType === 'marker') {
      if (markers[targetId] && markers[targetId].hp != null) {
        let newHp = Math.max(0, markers[targetId].hp - damageApplied);

        if (safeHeal > 0 && healTarget === 'target') {
          const maxHp = markers[targetId].maxHp != null ? markers[targetId].maxHp : 99999;
          newHp = Math.min(maxHp, newHp + safeHeal);
        }

        markers[targetId].hp = newHp;
        targetNewHp = newHp;

        io.emit('updateMarkerData', markers[targetId]);
        syncCombatantHp(targetId, markers[targetId].hp, markers[targetId].maxHp);

        // Cansız Patlayıcı Obje öldü mü kontrol et
        if (markers[targetId].hp <= 0 && markers[targetId].objectType === 'explosive' && !markers[targetId].hasExploded) {
          handleExplosiveMarkerDeath(targetId, 'attack_damage');
        }

        // Cansız Çağırıcı / Yuva Obje kırıldı mı kontrol et
        if (markers[targetId].hp <= 0 && markers[targetId].objectType === 'spawner' && !markers[targetId].isBroken) {
          handleSpawnerMarkerBreak(targetId, 'attack_damage');
        }

        if (damageApplied > 0) {
          io.emit('attackHitImpact', {
            targetType: 'marker',
            targetId,
            damage: damageApplied,
            isCritical: Boolean(isCritical),
            attackType: attackType || 'physical',
            damageType: damageType || 'slashing',
            impactId: impactId || null,
            senderSocketId: senderSocketId || null
          });
        }

        if (safeHeal > 0 && healTarget === 'target') {
          io.emit('combatHealImpact', {
            recipientType: 'marker',
            recipientId: targetId,
            targetType: 'marker',
            targetId: targetId,
            heal: safeHeal,
            amount: safeHeal,
            newHp: markers[targetId].hp,
            maxHp: markers[targetId].maxHp,
            recipientName: markers[targetId].name,
            impactId,
            senderSocketId
          });
          io.emit('logMessage', {
            message: `💚 [ŞİFA] "${markers[targetId].name}" +${safeHeal} Can Yeniledi! (${markers[targetId].hp}/${markers[targetId].maxHp || '?'})`,
            color: '#10b981'
          });
        }
      }
    }

    // 2. Saldırana Şifa / Can Çalma Uygulama (healTarget === 'self')
    if (safeHeal > 0 && healTarget === 'self' && attackerType && attackerId) {
      if (attackerType === 'character') {
        const { data: atkCharData } = await supabase
          .from('characters')
          .select('hp_current, hp_max, name')
          .eq('id', attackerId)
          .single();

        if (atkCharData) {
          const currentHp = (attackerId === targetId && targetType === 'character' && targetNewHp !== null)
            ? targetNewHp
            : (atkCharData.hp_current || 0);
          const healedHp = Math.min(atkCharData.hp_max || 99999, currentHp + safeHeal);

          await supabase.from('characters').update({ hp_current: healedHp }).eq('id', attackerId);

          const playerEntry = Object.entries(players).find(
            ([, p]) => p.character && p.character.id === attackerId
          );
          if (playerEntry) {
            const [socketId, pData] = playerEntry;
            pData.character.hp_current = healedHp;
            io.emit('characterUpdated', {
              id: socketId,
              updates: { hp_current: healedHp, hp_max: atkCharData.hp_max }
            });
            syncCombatantHp(socketId, healedHp, atkCharData.hp_max);
          } else {
            syncCombatantHp(attackerId, healedHp, atkCharData.hp_max);
          }

          io.emit('combatHealImpact', {
            recipientType: 'character',
            recipientId: attackerId,
            targetType: 'character',
            targetId: attackerId,
            heal: safeHeal,
            amount: safeHeal,
            newHp: healedHp,
            maxHp: atkCharData.hp_max,
            recipientName: atkCharData.name,
            impactId,
            senderSocketId
          });

          io.emit('logMessage', {
            message: `💚 [CAN ÇALMA / ŞİFA] ${atkCharData.name || 'Saldıran'} +${safeHeal} Can Yeniledi! (${healedHp}/${atkCharData.hp_max})`,
            color: '#10b981'
          });
        }
      } else if (attackerType === 'marker') {
        if (markers[attackerId] && markers[attackerId].hp != null) {
          const mAttacker = markers[attackerId];
          const maxHp = mAttacker.maxHp != null ? mAttacker.maxHp : 99999;
          const currentHp = (attackerId === targetId && targetType === 'marker' && targetNewHp !== null)
            ? targetNewHp
            : (mAttacker.hp || 0);

          mAttacker.hp = Math.min(maxHp, currentHp + safeHeal);
          io.emit('updateMarkerData', mAttacker);
          syncCombatantHp(attackerId, mAttacker.hp, mAttacker.maxHp);

          io.emit('combatHealImpact', {
            recipientType: 'marker',
            recipientId: attackerId,
            targetType: 'marker',
            targetId: attackerId,
            heal: safeHeal,
            amount: safeHeal,
            newHp: mAttacker.hp,
            maxHp: mAttacker.maxHp,
            recipientName: mAttacker.name,
            impactId,
            senderSocketId
          });

          io.emit('logMessage', {
            message: `💚 [CAN ÇALMA / ŞİFA] "${mAttacker.name}" +${safeHeal} Can Yeniledi! (${mAttacker.hp}/${maxHp})`,
            color: '#10b981'
          });
        }
      }
    }

    res.json({
      success: true,
      newHp: targetNewHp,
      targetType,
      damageApplied,
      healApplied: safeHeal,
      shelterBlocked: Boolean(hasShelter && safeDamage > 0)
    });
  } catch (err) {
    console.error('Hasar/şifa uygulama hatası:', err);
    res.status(500).json({ error: 'Hasar/şifa uygulanamadı.' });
  }
});

// ---- Karakter Güncelle (REST — Saldırı paneli stat güncellemesi) ----
app.put('/api/characters/:charId', async (req, res) => {
  try {
    const charId = req.params.charId;
    const { hp_current, hp_max, ac, ac_bonus, corruption, spell_slots, stats } = req.body;

    const updates = {};
    if (hp_current !== undefined) updates.hp_current = clampNumber(hp_current, 0, 99999);
    if (hp_max !== undefined) updates.hp_max = clampNumber(hp_max, 1, 99999);
    if (ac !== undefined) updates.ac = clampNumber(ac, 0, 50);
    if (ac_bonus !== undefined) updates.ac_bonus = clampNumber(ac_bonus, 0, 50);
    if (corruption !== undefined) updates.corruption = clampNumber(corruption, 0, 100);
    if (req.body.assignedAttacks !== undefined && Array.isArray(req.body.assignedAttacks)) {
      updates.assignedAttacks = req.body.assignedAttacks;
      if (!updates.stats) updates.stats = {};
      updates.stats.assignedAttacks = req.body.assignedAttacks;
    }
    if (spell_slots !== undefined) {
      updates.spell_slots = {
        lvl1: clampNumber(spell_slots?.lvl1, 0, 20),
        lvl2: clampNumber(spell_slots?.lvl2, 0, 20),
        lvl3: clampNumber(spell_slots?.lvl3, 0, 20),
        lvl4: clampNumber(spell_slots?.lvl4, 0, 20),
      };
    }
    if (stats) {
      updates.stats = {
        ...(updates.stats || {}),
        str: clampNumber(stats.str, 0, 30),
        str_bonus: clampNumber(stats.str_bonus, 0, 30),
        dex: clampNumber(stats.dex, 0, 30),
        dex_bonus: clampNumber(stats.dex_bonus, 0, 30),
        int: clampNumber(stats.int, 0, 30),
        int_bonus: clampNumber(stats.int_bonus, 0, 30),
        con: clampNumber(stats.con, 0, 30),
        con_bonus: clampNumber(stats.con_bonus, 0, 30),
        wis: clampNumber(stats.wis, 0, 30),
        wis_bonus: clampNumber(stats.wis_bonus, 0, 30),
        chr: clampNumber(stats.chr, 0, 30),
        chr_bonus: clampNumber(stats.chr_bonus, 0, 30),
      };
      if (req.body.assignedAttacks !== undefined) {
        updates.stats.assignedAttacks = req.body.assignedAttacks;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan yok.' });
    }

    let { error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', charId);

    if (error && error.message && error.message.includes('column') && updates.assignedAttacks !== undefined) {
      const { assignedAttacks, ...safeUpdates } = updates;
      const retry = await supabase.from('characters').update(safeUpdates).eq('id', charId);
      error = retry.error;
    }

    if (error) throw error;

    // Bağlı oyuncuyu sync et
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.character && p.character.id === charId
    );
    if (playerEntry) {
      const [socketId, playerData] = playerEntry;
      Object.assign(playerData.character, updates);
      io.emit('characterUpdated', { id: socketId, updates });
    }

    res.json({ success: true, updates });
  } catch (err) {
    console.error('Karakter güncelleme hatası:', err);
    res.status(500).json({ error: 'Karakter güncellenemedi.' });
  }
});

// ---- Yeni Karakter Oluşturma ----
app.post('/api/characters', async (req, res) => {
  try {
    const { user_id, name, hp_max, stats, avatar_url, ac, ac_bonus } = req.body;

    if (!user_id || !name || !hp_max) {
      return res.status(400).json({ error: 'user_id, name ve hp_max zorunludur.' });
    }

    const sanitizedName = truncateStr(name, 50);
    const sanitizedHpMax = clampNumber(hp_max, 1, 99999);

    const sanitizedStats = {
      str: clampNumber(stats?.str, 0, 30),
      str_bonus: clampNumber(stats?.str_bonus, 0, 30),
      dex: clampNumber(stats?.dex, 0, 30),
      dex_bonus: clampNumber(stats?.dex_bonus, 0, 30),
      int: clampNumber(stats?.int, 0, 30),
      int_bonus: clampNumber(stats?.int_bonus, 0, 30),
      con: clampNumber(stats?.con, 0, 30),
      con_bonus: clampNumber(stats?.con_bonus, 0, 30),
      wis: clampNumber(stats?.wis, 0, 30),
      wis_bonus: clampNumber(stats?.wis_bonus, 0, 30),
      chr: clampNumber(stats?.chr, 0, 30),
      chr_bonus: clampNumber(stats?.chr_bonus, 0, 30)
    };

    const insertData = {
      user_id,
      name: sanitizedName,
      hp_current: sanitizedHpMax,
      hp_max: sanitizedHpMax,
      ac: clampNumber(ac, 0, 50) || 10,
      ac_bonus: clampNumber(ac_bonus, 0, 50) || 0,
      corruption: 0,
      spell_slots: { lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 },
      stats: sanitizedStats,
      avatar_url: avatar_url && isValidUrl(avatar_url) ? avatar_url : null
    };

    const { data, error } = await supabase
      .from('characters')
      .insert([insertData])
      .select();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Karakter oluşturma hatası:', err);
    res.status(500).json({ error: 'Karakter oluşturulamadı: ' + err.message });
  }
});

// === SUNUCU DURUMU (IN-MEMORY) ===
const players = {};
const markers = {};
const sessionCache = {};
let mapBgUrl = '';
let drawHistory = [];

// === STATUS EFFECTS & CUSTOM EFFECT BUILDER MOTORU ===
let customStatusPresets = [];

// === HAZIR SALDIRI PRESETLERİ (ATTACK PRESETS) ===
let attackPresets = [];

// === HAZIR TOKEN ŞEMALARI (TOKEN PRESETS / SCHEMAS) ===
let tokenPresets = [];

/**
 * Token veya karakterin aktif durum efektlerini döndürür.
 */
function getTokenActiveEffects(targetType, targetId) {
  if (!targetId) return [];
  if (targetType === 'marker') {
    return markers[targetId]?.activeEffects || [];
  } else if (targetType === 'character' || targetType === 'player') {
    const playerEntry = Object.values(players).find(
      p => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      if (!playerEntry.activeEffects) playerEntry.activeEffects = [];
      return playerEntry.activeEffects;
    }
  }
  const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
  return c?.activeEffects || [];
}

/**
 * Hedefe durum efekti ekler veya günceller.
 */
function applyStatusEffectToTarget(targetType, targetId, effect) {
  if (!effect || !targetId) return false;

  const currentEffects = getTokenActiveEffects(targetType, targetId);
  const hasUnstoppable = currentEffects.some(e => e.effects?.unstoppable);

  const effectToApply = JSON.parse(JSON.stringify(effect));
  effectToApply.id = effectToApply.id || ('eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000));

  // Felç bağışıklığı kontrolü
  if (effectToApply.effects?.paralyzed && hasUnstoppable) {
    delete effectToApply.effects.paralyzed;
    io.emit('logMessage', { message: `🦏 Durdurulamaz: ${effectToApply.name || 'Efekt'} içindeki Felç bağışıklık nedeniyle engellendi!`, color: '#e67e22' });
  }

  // Token üzerinde kaydet
  if (targetType === 'marker' && markers[targetId]) {
    if (!markers[targetId].activeEffects) markers[targetId].activeEffects = [];
    const idx = markers[targetId].activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
    if (idx >= 0) markers[targetId].activeEffects[idx] = effectToApply;
    else markers[targetId].activeEffects.push(effectToApply);
    io.emit('updateMarkerData', markers[targetId]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
      if (!p.activeEffects) p.activeEffects = [];
      if (p.character && !p.character.activeEffects) p.character.activeEffects = [];

      const idx = p.activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
      if (idx >= 0) {
        p.activeEffects[idx] = effectToApply;
        if (p.character) p.character.activeEffects[idx] = effectToApply;
      } else {
        p.activeEffects.push(effectToApply);
        if (p.character) p.character.activeEffects.push(effectToApply);
      }
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects });
    }
  }

  // Savaşçı listesinde güncelle
  if (combatState.active) {
    const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
    if (c) {
      if (!c.activeEffects) c.activeEffects = [];
      const idx = c.activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
      if (idx >= 0) c.activeEffects[idx] = effectToApply;
      else c.activeEffects.push(effectToApply);
      io.emit('combatStateUpdated', combatState);
    }
  }

  const targetName = (targetType === 'marker' ? markers[targetId]?.name : Object.values(players).find(p => p.id === targetId || p.character?.id === targetId)?.character?.name) || 'Hedef';
  io.emit('logMessage', {
    message: `${effectToApply.icon || '✨'} [${effectToApply.name}]: ${targetName} üzerine uygulandı (${effectToApply.duration ? effectToApply.duration + ' Tur' : 'Kalıcı'}).`,
    color: '#e5c158'
  });

  return true;
}

/**
 * Hedef üzerinden durum efektini kaldırır.
 */
function removeStatusEffectFromTarget(targetType, targetId, effectId) {
  if (!targetId || !effectId) return false;

  let effectName = 'Efekt';
  let targetName = 'Hedef';

  const isMarker = targetType === 'marker' || !!markers[targetId];

  if (isMarker && markers[targetId]) {
    targetName = markers[targetId].name || 'Token';
    if (!markers[targetId].activeEffects) markers[targetId].activeEffects = [];

    if (effectId === 'all') {
      markers[targetId].activeEffects = [];
    } else {
      const eff = markers[targetId].activeEffects.find(e => e.id === effectId);
      if (eff) effectName = eff.name;
      markers[targetId].activeEffects = markers[targetId].activeEffects.filter(e => e.id !== effectId);
    }
    io.emit('updateMarkerData', markers[targetId]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
      targetName = p.character?.name || p.username || 'Oyuncu';

      if (effectId === 'all') {
        p.activeEffects = [];
        if (p.character) p.character.activeEffects = [];
      } else {
        if (p.activeEffects) {
          const eff = p.activeEffects.find(e => e.id === effectId);
          if (eff) effectName = eff.name;
          p.activeEffects = p.activeEffects.filter(e => e.id !== effectId);
        }
        if (p.character && p.character.activeEffects) {
          p.character.activeEffects = p.character.activeEffects.filter(e => e.id !== effectId);
        }
      }
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects || [] });
    }
  }

  if (combatState.active) {
    const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
    if (c && c.activeEffects) {
      if (effectId === 'all') {
        c.activeEffects = [];
      } else {
        const eff = c.activeEffects.find(e => e.id === effectId);
        if (eff) effectName = eff.name;
        c.activeEffects = c.activeEffects.filter(e => e.id !== effectId);
      }
      io.emit('combatStateUpdated', combatState);
    }
  }

  if (effectId === 'all') {
    io.emit('logMessage', {
      message: `✨ [${targetName}]: Tüm durum efektleri kaldırıldı.`,
      color: '#95a5a6'
    });
  } else {
    io.emit('logMessage', {
      message: `✨ [${effectName}]: ${targetName} üzerinden kaldırıldı.`,
      color: '#95a5a6'
    });
  }

  return true;
}

/**
 * Tur biten combatant'ın DoT hasarını uygular ve süreli efektlerinin duration sayacını 1 azaltır.
 */
async function processCombatantTurnEnd(combatant) {
  if (!combatant || !combatant.activeEffects || combatant.activeEffects.length === 0) return;

  const expiredEffects = [];
  const targetType = combatant.isMarker ? 'marker' : 'character';
  const targetId = combatant.isMarker ? combatant.id : (combatant.characterId || combatant.id);

  // 1. DoT Hasarı Kontrolü
  for (const eff of combatant.activeEffects) {
    if (eff.effects?.dotDamage) {
      const minDmg = clampNumber(parseInt(eff.effects.dotDamage.min) || 1, 0, 9999);
      const maxDmg = clampNumber(parseInt(eff.effects.dotDamage.max) || minDmg, minDmg, 9999);
      const dotDmg = rollDie(minDmg, maxDmg);

      if (dotDmg > 0) {
        // Hedefte shelter (barınak) var mı?
        const hasShelter = combatant.activeEffects.some(e => e.effects?.shelter);
        if (hasShelter) {
          io.emit('logMessage', {
            message: `🛡️ [Barınak]: ${combatant.name} üzerindeki ${eff.name} DoT hasarı engellendi!`,
            color: '#3498db'
          });
        } else {
          // Hasarı uygula
          if (combatant.isMarker && markers[combatant.id] && markers[combatant.id].hp != null) {
            markers[combatant.id].hp = Math.max(0, markers[combatant.id].hp - dotDmg);
            combatant.hpCurrent = markers[combatant.id].hp;
            combatant.isDead = combatant.hpCurrent <= 0;
            io.emit('updateMarkerData', markers[combatant.id]);
            syncCombatantHp(combatant.id, combatant.hpCurrent, combatant.hpMax);

            // Cansız Patlayıcı Obje DoT hasarıyla öldüyse patlat
            if (markers[combatant.id].hp <= 0 && markers[combatant.id].objectType === 'explosive' && !markers[combatant.id].hasExploded) {
              handleExplosiveMarkerDeath(combatant.id, 'dot_damage');
            }

            // Cansız Çağırıcı Obje DoT hasarıyla kırıldıysa parçala
            if (markers[combatant.id].hp <= 0 && markers[combatant.id].objectType === 'spawner' && !markers[combatant.id].isBroken) {
              handleSpawnerMarkerBreak(combatant.id, 'dot_damage');
            }
          } else if (!combatant.isMarker && combatant.characterId) {
            try {
              const { data: charData } = await supabase
                .from('characters')
                .select('hp_current, hp_max')
                .eq('id', combatant.characterId)
                .single();
              if (charData) {
                const newHp = Math.max(0, (charData.hp_current || 0) - dotDmg);
                await supabase.from('characters').update({ hp_current: newHp }).eq('id', combatant.characterId);
                combatant.hpCurrent = newHp;
                combatant.isDead = newHp <= 0;

                const playerEntry = Object.entries(players).find(
                  ([, p]) => p.character && p.character.id === combatant.characterId
                );
                if (playerEntry) {
                  const [socketId, p] = playerEntry;
                  p.character.hp_current = newHp;
                  io.emit('characterUpdated', { id: socketId, updates: { hp_current: newHp, hp_max: charData.hp_max } });
                }
                syncCombatantHp(combatant.id, newHp, charData.hp_max);
              }
            } catch (err) {
              console.error('DoT character hasar hatası:', err);
            }
          }

          io.emit('logMessage', {
            message: `${eff.icon || '🔥'} [${eff.name}]: ${combatant.name} ${dotDmg} tur sonu hasarı aldı! (Kalan HP: ${combatant.hpCurrent || 0})`,
            color: '#e74c3c'
          });
        }
      }
    }

    // 1.5. HoT (Healing over Time / Rejenerasyon / Can Yenileme) Kontrolü
    if (eff.effects?.hotHealing) {
      const minHeal = clampNumber(parseInt(eff.effects.hotHealing.min) || 1, 0, 9999);
      const maxHeal = clampNumber(parseInt(eff.effects.hotHealing.max) || minHeal, minHeal, 9999);
      const hotHeal = rollDie(minHeal, maxHeal);

      if (hotHeal > 0) {
        if (combatant.isMarker && markers[combatant.id] && markers[combatant.id].hp != null) {
          const maxHp = markers[combatant.id].maxHp != null ? markers[combatant.id].maxHp : 99999;
          markers[combatant.id].hp = Math.min(maxHp, markers[combatant.id].hp + hotHeal);
          combatant.hpCurrent = markers[combatant.id].hp;
          io.emit('updateMarkerData', markers[combatant.id]);
          syncCombatantHp(combatant.id, combatant.hpCurrent, combatant.hpMax);
          io.emit('combatHealImpact', { targetType: 'marker', targetId: combatant.id, heal: hotHeal });
        } else if (!combatant.isMarker && combatant.characterId) {
          try {
            const { data: charData } = await supabase
              .from('characters')
              .select('hp_current, hp_max')
              .eq('id', combatant.characterId)
              .single();
            if (charData) {
              const newHp = Math.min(charData.hp_max || 99999, (charData.hp_current || 0) + hotHeal);
              await supabase.from('characters').update({ hp_current: newHp }).eq('id', combatant.characterId);
              combatant.hpCurrent = newHp;

              const playerEntry = Object.entries(players).find(
                ([, p]) => p.character && p.character.id === combatant.characterId
              );
              if (playerEntry) {
                const [socketId, p] = playerEntry;
                p.character.hp_current = newHp;
                io.emit('characterUpdated', { id: socketId, updates: { hp_current: newHp, hp_max: charData.hp_max } });
              }
              syncCombatantHp(combatant.id, newHp, charData.hp_max);
              io.emit('combatHealImpact', { targetType: 'character', targetId: combatant.characterId, heal: hotHeal });
            }
          } catch (err) {
            console.error('HoT character iyileşme hatası:', err);
          }
        }

        io.emit('logMessage', {
          message: `${eff.icon || '💚'} [${eff.name}]: ${combatant.name} +${hotHeal} can yeniledi! (Mevcut HP: ${combatant.hpCurrent || 0})`,
          color: '#10b981'
        });
      }
    }
  }

  // 2. Süre Azaltma & Süresi Dolanları Ayıklama
  combatant.activeEffects.forEach(eff => {
    if (eff.duration != null && eff.duration > 0) {
      eff.duration -= 1;
      if (eff.duration <= 0) {
        expiredEffects.push(eff);
      }
    }
  });

  // Süresi dolanları kaldır
  if (expiredEffects.length > 0) {
    expiredEffects.forEach(exp => {
      removeStatusEffectFromTarget(targetType, targetId, exp.id);
      io.emit('logMessage', {
        message: `✨ [${exp.name}] etkisi ${combatant.name} üzerinden sona erdi.`,
        color: '#9b59b6'
      });
    });
  }

  // Senkronizasyon
  if (combatant.isMarker && markers[combatant.id]) {
    markers[combatant.id].activeEffects = combatant.activeEffects.filter(e => e.duration == null || e.duration > 0);
    io.emit('updateMarkerData', markers[combatant.id]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === combatant.id || (p.character && p.character.id === combatant.characterId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
      p.activeEffects = combatant.activeEffects.filter(e => e.duration == null || e.duration > 0);
      if (p.character) p.character.activeEffects = p.activeEffects;
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects });
    }
  }

  io.emit('combatStateUpdated', combatState);
}

// === OYUN MODU SİSTEMİ (GÜNEŞ & KENAN) ===
let currentGameMode = 'gunes'; // 'gunes' veya 'kenan'

// === SAVAŞ / İNİSİYATİF DURUMU (BG3 COMBAT TRACKER) ===
let combatState = {
  active: false,
  round: 1,
  currentTurnIndex: 0,
  combatants: []
};

/**
 * Haritadaki tüm aktif oyuncu ve marker tokenları için 1d20 + CHR modifikatörü hesaplayıp
 * BG3 tarzı inisiyatif listesi oluşturur ve sıralar.
 */
function calculateInitiativeForCombat() {
  const list = [];

  // 1. Oyuncular (DM Hariç)
  Object.values(players).forEach(p => {
    // DM tokeni savaşa dahil edilmez
    if (p.role === 'dm') return;

    const name = p.character?.name || 'Oyuncu';
    const characterId = p.character?.id || null;
    const chrStat = p.character?.stats?.chr != null ? p.character.stats.chr : 10;
    const chrBonus = p.character?.stats?.chr_bonus != null ? p.character.stats.chr_bonus : 0;
    // D&D CHR Modifikatörü = floor((CHR - 10) / 2) + Bonus
    const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + chrMod;
    const hpCurrent = p.character?.hp_current ?? null;
    const hpMax = p.character?.hp_max ?? null;

    list.push({
      id: p.id,
      sessionId: p.sessionId,
      characterId: characterId,
      name: name,
      color: p.color || '#3498db',
      imgUrl: p.imgUrl || p.character?.avatar_url || null,
      isMarker: false,
      role: p.role || 'player',
      hpCurrent: hpCurrent,
      hpMax: hpMax,
      ac: p.character?.ac ?? 10,
      ac_bonus: p.character?.ac_bonus ?? 0,
      stats: p.character?.stats || null,
      darkness: p.character?.darkness != null ? p.character.darkness : 0,
      maxDarkness: p.character?.max_darkness != null ? p.character.max_darkness : 100,
      hasDarkness: true,
      chrStat: chrStat,
      chrBonus: chrBonus,
      chrMod: chrMod,
      roll: roll,
      total: total,
      isDead: hpCurrent !== null && hpCurrent <= 0,
      activeEffects: p.activeEffects || p.character?.activeEffects || [],
      assignedAttacks: p.assignedAttacks || p.character?.assignedAttacks || []
    });
  });

  // 2. DM Marker'ları (Canavarlar / NPC'ler)
  Object.values(markers).forEach(m => {
    const name = m.name || 'NPC';
    const chrStat = m.stats?.chr != null ? m.stats.chr : 10;
    const chrBonus = m.stats?.chr_bonus != null ? m.stats.chr_bonus : 0;
    const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + chrMod;
    const hpCurrent = m.hp ?? null;
    const hpMax = m.maxHp ?? null;

    list.push({
      id: m.id,
      name: name,
      color: m.color || '#e74c3c',
      imgUrl: m.imgUrl || null,
      isMarker: true,
      role: 'marker',
      hpCurrent: hpCurrent,
      hpMax: hpMax,
      ac: m.ac != null ? m.ac : 10,
      ac_bonus: m.ac_bonus != null ? m.ac_bonus : 0,
      stats: m.stats || null,
      hasDarkness: Boolean(m.hasDarkness),
      darkness: m.darkness != null ? m.darkness : 0,
      maxDarkness: m.maxDarkness != null ? m.maxDarkness : 100,
      chrStat: chrStat,
      chrBonus: chrBonus,
      chrMod: chrMod,
      roll: roll,
      total: total,
      isDead: hpCurrent !== null && hpCurrent <= 0,
      objectType: m.objectType || 'creature',
      objectConfig: m.objectConfig || null,
      hasExploded: Boolean(m.hasExploded),
      activeEffects: m.activeEffects || [],
      assignedAttacks: m.assignedAttacks || []
    });
  });

  // 3. Sıralama:
  // - En yüksek toplam puan en solda (azalan)
  // - Eşitlik durumunda CHR değeri (stat + bonus) yüksek olana öncelik
  // - Hâlâ eşitse d20 ham zar sonucuna göre
  list.sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    const aChrTotal = a.chrStat + a.chrBonus;
    const bChrTotal = b.chrStat + b.chrBonus;
    if (bChrTotal !== aChrTotal) {
      return bChrTotal - aChrTotal;
    }
    if (b.roll !== a.roll) {
      return b.roll - a.roll;
    }
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Savaşçı can değerini günceller ve değişiklik varsa tüm istemcilere bildirir.
 */
function syncCombatantHp(id, hpCurrent, hpMax) {
  if (!combatState.active || !combatState.combatants.length) return;
  let changed = false;
  combatState.combatants.forEach(c => {
    if (c.id === id || (c.sessionId && c.sessionId === id)) {
      if (hpCurrent !== undefined) c.hpCurrent = hpCurrent;
      if (hpMax !== undefined) c.hpMax = hpMax;
      c.isDead = c.hpCurrent !== null && c.hpCurrent <= 0;
      changed = true;
    }
  });
  if (changed) {
    io.emit('combatStateUpdated', combatState);
  }
}

// ============================================================
// CANSIZ OBJELER (INANIMATE OBJECTS) SİSTEMİ
// Tür 1: Ölümde Patlayan Obje (Explosive Object)
// Tür 2: Her Tur Çevresine Etki Yayan Obje (Aura / Totem)
// ============================================================

/**
 * Cansız Patlayıcı Obje öldüğünde (HP <= 0) etrafına patlama hasarı ve durum efekti uygular.
 * Zincirleme patlama (chain reaction) korumalı ve kademeli gecikmeli olarak çalışır.
 */
async function handleExplosiveMarkerDeath(markerId, sourceInfo = null) {
  const marker = markers[markerId];
  if (!marker || marker.objectType !== 'explosive' || marker.hasExploded) return;

  // Çift tetiklenmeyi ve döngüleri engelle
  marker.hasExploded = true;

  const cfg = marker.objectConfig || {};
  const radius = clampNumber(cfg.radius || 120, 20, 2000);
  const damage = clampNumber(cfg.damage || 20, 0, 99999);
  const damageType = cfg.damageType || 'fire';
  const statusEffects = Array.isArray(cfg.statusEffects) ? cfg.statusEffects : [];
  const targetFilter = cfg.targetFilter || 'all'; // 'all', 'players', 'markers'
  const destroyOnExplode = cfg.destroyOnExplode !== false;

  const markerSize = marker.size || 50;
  const cx = (marker.x || 0) + markerSize / 2;
  const cy = (marker.y || 0) + markerSize / 2;

  const affectedTargets = [];
  const chainedExplosions = [];

  // 1. Oyuncuları Kontrol Et
  if (targetFilter === 'all' || targetFilter === 'players') {
    for (const [socketId, p] of Object.entries(players)) {
      if (p.role === 'dm' || !p.character) continue;
      const pSize = 50;
      const pcx = (p.x || 0) + pSize / 2;
      const pcy = (p.y || 0) + pSize / 2;
      const dist = Math.hypot(pcx - cx, pcy - cy);
      if (dist <= radius + (pSize / 2) * 0.7) {
        // Shelter kontrolü
        const targetEffects = getTokenActiveEffects('character', p.character.id);
        const hasShelter = targetEffects.some(e => e.effects?.shelter);
        if (hasShelter) continue;

        const oldHp = p.character.hp_current || 0;
        const newHp = Math.max(0, oldHp - damage);
        p.character.hp_current = newHp;

        try {
          await supabase.from('characters').update({ hp_current: newHp }).eq('id', p.character.id);
        } catch (e) {
          console.error('Patlama oyuncu HP güncelleme hatası:', e);
        }

        io.emit('characterUpdated', {
          id: socketId,
          updates: { hp_current: newHp, hp_max: p.character.hp_max }
        });
        syncCombatantHp(socketId, newHp, p.character.hp_max);

        // Durum efektlerini uygula
        for (const eff of statusEffects) {
          applyStatusEffectToTarget('character', p.character.id, eff);
        }

        affectedTargets.push({
          type: 'character',
          id: p.character.id,
          name: p.character.name || 'Oyuncu',
          oldHp,
          newHp,
          damage
        });
      }
    }
  }

  // 2. Diğer Marker'ları Kontrol Et
  if (targetFilter === 'all' || targetFilter === 'markers') {
    for (const [mid, m] of Object.entries(markers)) {
      if (mid === markerId || m.hp == null) continue;
      const mSize = m.size || 50;
      const mcx = (m.x || 0) + mSize / 2;
      const mcy = (m.y || 0) + mSize / 2;
      const dist = Math.hypot(mcx - cx, mcy - cy);
      if (dist <= radius + (mSize / 2) * 0.7) {
        // Shelter kontrolü
        const targetEffects = getTokenActiveEffects('marker', mid);
        const hasShelter = targetEffects.some(e => e.effects?.shelter);
        if (hasShelter) continue;

        const oldHp = m.hp;
        m.hp = Math.max(0, m.hp - damage);
        io.emit('updateMarkerData', m);
        syncCombatantHp(mid, m.hp, m.maxHp);

        // Durum efektlerini uygula
        for (const eff of statusEffects) {
          applyStatusEffectToTarget('marker', mid, eff);
        }

        affectedTargets.push({
          type: 'marker',
          id: mid,
          name: m.name || 'Marker',
          oldHp,
          newHp: m.hp,
          damage
        });

        // Zincirleme patlama kontrolü!
        if (m.hp <= 0 && m.objectType === 'explosive' && !m.hasExploded) {
          chainedExplosions.push(mid);
        }
      }
    }
  }

  // Tüm istemcilere görsel patlama dalgası gönder
  io.emit('aoeDamageApplied', {
    damage,
    aoeInfo: { x: cx, y: cy, radius, damageType },
    affectedTargets
  });

  const effNames = statusEffects.map(e => e.name).join(', ');
  const effStr = effNames ? ` + [✨ ${effNames}]` : '';
  const names = affectedTargets.map(t => `${t.name} (-${t.damage})`).join(', ');
  io.emit('logMessage', {
    message: `💣💥 [NESNE PATLAMASI] "${marker.name}" patladı! (${damage} ${damageType} hasarı${effStr}). Etkilenenler: ${names || 'Kimse etkilenmedi'}`,
    color: '#ef4444'
  });

  // Eğer destroyOnExplode ise nesneyi haritadan ve savaştan kaldır
  if (destroyOnExplode) {
    setTimeout(() => {
      if (markers[markerId]) {
        delete markers[markerId];
        io.emit('removeMarker', markerId);
        if (combatState.active) {
          combatState.combatants = combatState.combatants.filter(c => c.id !== markerId);
          if (combatState.currentTurnIndex >= combatState.combatants.length) {
            combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
          }
          io.emit('combatStateUpdated', combatState);
        }
        backupMapState();
      }
    }, 850);
  } else {
    backupMapState();
  }

  // Zincirleme patlamaları tetikle (350ms kademeli gecikmeyle gerçekçi his)
  if (chainedExplosions.length > 0) {
    chainedExplosions.forEach((chainedId, idx) => {
      setTimeout(() => {
        handleExplosiveMarkerDeath(chainedId, 'chain_reaction');
      }, (idx + 1) * 350);
    });
  }
}

/**
 * Cansız Aura/Totem Objesi canı olduğu müddetçe çevresine hasar ve/veya durum efekti yayar.
 */
async function handleAuraMarkerPulse(markerId) {
  const marker = markers[markerId];
  if (!marker || marker.objectType !== 'aura' || marker.hp === null || marker.hp <= 0) return;

  const cfg = marker.objectConfig || {};
  const radius = clampNumber(cfg.radius || 150, 20, 2000);
  const damage = clampNumber(cfg.damage || 0, 0, 99999);
  const damageType = cfg.damageType || 'necrotic';
  const statusEffects = Array.isArray(cfg.statusEffects) ? cfg.statusEffects : [];
  const targetFilter = cfg.targetFilter || 'all'; // 'all', 'players', 'markers'

  const markerSize = marker.size || 50;
  const cx = (marker.x || 0) + markerSize / 2;
  const cy = (marker.y || 0) + markerSize / 2;

  const affectedTargets = [];

  // 1. Oyuncular
  if (targetFilter === 'all' || targetFilter === 'players') {
    for (const [socketId, p] of Object.entries(players)) {
      if (p.role === 'dm' || !p.character) continue;
      const pSize = 50;
      const pcx = (p.x || 0) + pSize / 2;
      const pcy = (p.y || 0) + pSize / 2;
      const dist = Math.hypot(pcx - cx, pcy - cy);
      if (dist <= radius + (pSize / 2) * 0.7) {
        // Shelter kontrolü
        const targetEffects = getTokenActiveEffects('character', p.character.id);
        const hasShelter = targetEffects.some(e => e.effects?.shelter);
        if (hasShelter) continue;

        let newHp = p.character.hp_current || 0;
        if (damage > 0) {
          newHp = Math.max(0, newHp - damage);
          p.character.hp_current = newHp;
          try {
            await supabase.from('characters').update({ hp_current: newHp }).eq('id', p.character.id);
          } catch (e) {
            console.error('Aura oyuncu HP güncelleme hatası:', e);
          }
          io.emit('characterUpdated', {
            id: socketId,
            updates: { hp_current: newHp, hp_max: p.character.hp_max }
          });
          syncCombatantHp(socketId, newHp, p.character.hp_max);
        }

        // Durum efektlerini uygula
        for (const eff of statusEffects) {
          applyStatusEffectToTarget('character', p.character.id, eff);
        }

        affectedTargets.push({
          type: 'character',
          id: p.character.id,
          name: p.character.name || 'Oyuncu',
          damage,
          newHp
        });
      }
    }
  }

  // 2. Marker'lar
  if (targetFilter === 'all' || targetFilter === 'markers') {
    for (const [mid, m] of Object.entries(markers)) {
      if (mid === markerId || m.hp == null) continue;
      const mSize = m.size || 50;
      const mcx = (m.x || 0) + mSize / 2;
      const mcy = (m.y || 0) + mSize / 2;
      const dist = Math.hypot(mcx - cx, mcy - cy);
      if (dist <= radius + (mSize / 2) * 0.7) {
        // Shelter kontrolü
        const targetEffects = getTokenActiveEffects('marker', mid);
        const hasShelter = targetEffects.some(e => e.effects?.shelter);
        if (hasShelter) continue;

        if (damage > 0) {
          m.hp = Math.max(0, m.hp - damage);
          io.emit('updateMarkerData', m);
          syncCombatantHp(mid, m.hp, m.maxHp);
        }

        // Durum efektlerini uygula
        for (const eff of statusEffects) {
          applyStatusEffectToTarget('marker', mid, eff);
        }

        affectedTargets.push({
          type: 'marker',
          id: mid,
          name: m.name || 'Marker',
          damage,
          newHp: m.hp
        });
      }
    }
  }

  // Aura dalga görselini ve floating rakamlarını tüm istemcilere bildir
  io.emit('objectAuraPulseApplied', {
    markerId,
    cx,
    cy,
    radius,
    damage,
    damageType,
    affectedTargets
  });

  const effNames = statusEffects.map(e => e.name).join(', ');
  const effStr = effNames ? ` + [✨ ${effNames}]` : '';
  const dmgStr = damage > 0 ? `${damage} ${damageType} hasarı` : 'Aura etkisi';
  const names = affectedTargets.map(t => `${t.name}${damage > 0 ? ` (-${t.damage})` : ''}`).join(', ');
  io.emit('logMessage', {
    message: `🔮⚡ [AURA / TOTEM] "${marker.name}" etrafına aura yaydı! (${dmgStr}${effStr}). Etkilenenler: ${names || 'Kimse etkilenmedi'}`,
    color: '#a855f7'
  });
}

/**
 * Tur/Round başında 'round' zamanlamalı aura nesnelerini tetikler.
 */
async function handleRoundStartAuras() {
  for (const [mid, m] of Object.entries(markers)) {
    if (m.objectType === 'aura' && m.hp !== null && m.hp > 0 && m.objectConfig?.triggerTiming === 'round') {
      await handleAuraMarkerPulse(mid);
    }
  }
}

/**
 * Çağırıcı / Yuva / Portal nesnesinin kırılıp yok olmasını işler (Kırılabilir Obje Mantığı).
 */
async function handleSpawnerMarkerBreak(markerId, reason = null) {
  const marker = markers[markerId];
  if (!marker || marker.objectType !== 'spawner' || marker.isBroken) return;

  marker.isBroken = true;
  marker.hp = 0;

  io.emit('logMessage', {
    message: `🌀💥 [ÇAĞIRICI PARÇALANDI] "${marker.name}" kırıldı ve yok edildi! Artık düşman doğuramaz!`,
    color: '#ef4444'
  });

  io.emit('spawnerDestroyed', {
    markerId,
    name: marker.name,
    x: marker.x,
    y: marker.y
  });

  // Eğer kırılınca silinmesi ayarlandıysa haritadan kaldır
  const destroyOnBreak = marker.objectConfig?.destroyOnBreak !== false;
  if (destroyOnBreak) {
    delete markers[markerId];
    io.emit('removeMarker', markerId);
    if (combatState.active) {
      combatState.combatants = combatState.combatants.filter(c => c.id !== markerId);
      if (combatState.currentTurnIndex >= combatState.combatants.length) {
        combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
      }
      io.emit('combatStateUpdated', combatState);
    }
  } else {
    io.emit('updateMarkerData', marker);
  }
}

/**
 * Çağırıcı / Yuva nesnesi tetiklendiğinde sahnede önceden hazırlanmış düşmanı doğurur.
 */
async function handleSpawnerTrigger(spawnerId, manualTrigger = false) {
  const spawner = markers[spawnerId];
  if (!spawner || spawner.objectType !== 'spawner') return;
  if (spawner.hp !== null && spawner.hp <= 0) return;
  if (spawner.isBroken) return;

  const config = spawner.objectConfig || {};
  const presetId = config.spawnPresetId;

  // Önceden hazır edilen düşman şablonunu bul
  let preset = tokenPresets.find(p => p.id === presetId);
  if (!preset) {
    // ID bulunamadıysa ilk uygun yaratık şablonunu veya varsayılan düşmanı kullan
    preset = tokenPresets.find(p => p.objectType === 'creature' || !p.objectType) || {
      name: 'Yaratık',
      hp: 15,
      maxHp: 15,
      ac: 11,
      acBonus: 0,
      color: '#e74c3c',
      size: 50,
      stats: { str: 10, str_bonus: 0, dex: 10, dex_bonus: 0, con: 10, con_bonus: 0, int: 10, int_bonus: 0, wis: 10, wis_bonus: 0, chr: 10, chr_bonus: 0 }
    };
  }

  const spawnCount = clampNumber(parseInt(config.spawnCount) || 1, 1, 6);
  const spawnRadius = clampNumber(parseInt(config.spawnRadius) || 80, 30, 600);
  const spawnedList = [];

  for (let i = 0; i < spawnCount; i++) {
    config.totalSpawnedSoFar = (parseInt(config.totalSpawnedSoFar) || 0) + 1;
    const waveNum = config.totalSpawnedSoFar;

    // Yuvanın çevresinde radyal olarak boşluklu koordinat belirle
    const angle = (i * (2 * Math.PI / spawnCount)) + (Math.random() * 0.5 - 0.25);
    const dist = (spawner.size || 50) / 2 + spawnRadius * (0.6 + Math.random() * 0.4);
    const spawnX = clampNumber(Math.round(spawner.x + Math.cos(angle) * dist), 30, 9900);
    const spawnY = clampNumber(Math.round(spawner.y + Math.sin(angle) * dist), 30, 9900);

    const newMarkerId = 'marker_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_' + i;
    const newMarker = {
      id: newMarkerId,
      x: spawnX,
      y: spawnY,
      name: `${preset.name} #${waveNum}`,
      color: preset.color || '#e74c3c',
      imgUrl: preset.imgUrl || null,
      hp: preset.hp != null ? preset.hp : (preset.maxHp != null ? preset.maxHp : 15),
      maxHp: preset.maxHp != null ? preset.maxHp : (preset.hp != null ? preset.hp : 15),
      ac: preset.ac != null ? preset.ac : 10,
      ac_bonus: preset.acBonus != null ? preset.acBonus : 0,
      stats: preset.stats ? JSON.parse(JSON.stringify(preset.stats)) : null,
      size: preset.size || 50,
      hasDarkness: Boolean(preset.hasDarkness),
      darkness: preset.darkness || 0,
      maxDarkness: preset.maxDarkness || 100,
      isMarker: true,
      assignedAttacks: Array.isArray(preset.assignedAttacks) ? [...preset.assignedAttacks] : [],
      objectType: preset.objectType || 'creature',
      objectConfig: preset.objectConfig ? JSON.parse(JSON.stringify(preset.objectConfig)) : null,
      hasExploded: false
    };

    markers[newMarkerId] = newMarker;
    io.emit('newMarker', newMarker);
    spawnedList.push(newMarker);

    // Eğer savaş aktifse yeni doğan düşmanı savaşa ekle
    if (combatState.active) {
      const chrStat = newMarker.stats?.chr != null ? newMarker.stats.chr : 10;
      const chrBonus = newMarker.stats?.chr_bonus != null ? newMarker.stats.chr_bonus : 0;
      const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + chrMod;
      combatState.combatants.push({
        id: newMarker.id,
        name: newMarker.name,
        color: newMarker.color,
        imgUrl: newMarker.imgUrl,
        isMarker: true,
        role: 'marker',
        hpCurrent: newMarker.hp,
        hpMax: newMarker.maxHp,
        ac: newMarker.ac,
        ac_bonus: newMarker.ac_bonus,
        stats: newMarker.stats,
        hasDarkness: newMarker.hasDarkness,
        darkness: newMarker.darkness,
        maxDarkness: newMarker.maxDarkness,
        chrStat,
        chrBonus,
        chrMod,
        roll,
        total,
        isDead: false,
        objectType: newMarker.objectType,
        objectConfig: newMarker.objectConfig,
        activeEffects: [],
        assignedAttacks: newMarker.assignedAttacks
      });
    }
  }

  spawner.objectConfig = config;
  io.emit('updateMarkerData', spawner);

  if (combatState.active) {
    io.emit('combatStateUpdated', combatState);
  }

  // Sahneye çağırma dalgasını ve görsel efektini yayınla
  io.emit('spawnerSpawned', {
    spawnerId: spawner.id,
    spawnerName: spawner.name,
    spawnerX: spawner.x,
    spawnerY: spawner.y,
    spawnerSize: spawner.size || 50,
    spawnedMarkers: spawnedList.map(m => ({ id: m.id, name: m.name, x: m.x, y: m.y, color: m.color, size: m.size }))
  });

  const manualTag = manualTrigger ? ' (Manuel)' : '';
  io.emit('logMessage', {
    message: `🌀 [ÇAĞIRICI / YUVA] "${spawner.name}" sahneye ${spawnCount} adet "${preset.name}" doğurdu!${manualTag}`,
    color: '#10b981'
  });
}

/**
 * Tur/Round başında 'round' zamanlamalı çağırıcı yuva nesnelerini tetikler.
 */
async function handleRoundStartSpawners() {
  for (const [mid, m] of Object.entries(markers)) {
    if (m.objectType === 'spawner' && m.hp !== null && m.hp > 0 && !m.isBroken && m.objectConfig?.triggerTiming === 'round') {
      await handleSpawnerTrigger(mid);
    }
  }
}

// === SOCKET.IO EVENT YÖNETİMİ ===
io.on('connection', (socket) => {
  console.log('Bir oyuncu bağlandı: ' + socket.id);

  // Supabase'den yüklenmiş mevcut efekt ve saldırı şablonlarını hemen istemciye gönder
  socket.emit('customEffectsUpdated', customStatusPresets);
  socket.emit('attackPresetsUpdated', attackPresets);
  socket.emit('tokenPresetsUpdated', tokenPresets);
  socket.emit('gameModeUpdated', currentGameMode);

  // Oyun Modu Değiştirme (DM veya Oyuncu)
  socket.on('setGameMode', (mode) => {
    if (mode !== 'gunes' && mode !== 'kenan') return;
    currentGameMode = mode;
    io.emit('gameModeUpdated', currentGameMode);
    console.log('Oyun modu güncellendi:', currentGameMode);
  });

  // ---- Oyuncu Katılma ----
  socket.on('playerJoin', async (data) => {
    if (!data || typeof data !== 'object') return;

    // Aynı session önceden var mı kontrol et (kısa süreli kopmalara karşı)
    let existingPlayerId = null;

    if (data.sessionId) {
      existingPlayerId = Object.keys(players).find(k => players[k].sessionId === data.sessionId);
    } else {
      existingPlayerId = Object.keys(players).find(k => {
        if (data.character && players[k].character) return players[k].character.id === data.character.id;
        if (data.role === 'dm' && players[k].role === 'dm') return true;
        return false;
      });
    }

    let startX = 50;
    let startY = 50;
    let color = data.role === 'dm' ? '#8e44ad' : '#3498db';
    let imgUrl = null;
    let cacheMatch = null;

    if (existingPlayerId && players[existingPlayerId]) {
      startX = players[existingPlayerId].x;
      startY = players[existingPlayerId].y;
      color = players[existingPlayerId].color;
      imgUrl = players[existingPlayerId].imgUrl;
      cacheMatch = { ...players[existingPlayerId] };

      // Eski ghost socket'i temizle ve koptuğunu yayınla (klonları engeller)
      delete players[existingPlayerId];
      socket.broadcast.emit('playerDisconnected', existingPlayerId);
    } else {
      if (data.sessionId && sessionCache[data.sessionId]) {
        cacheMatch = sessionCache[data.sessionId];
      } else {
        // Tarayıcı kapanıp açılmışsa ve sessionId değişmişse rol / karakter id'den bulmayı dene
        cacheMatch = Object.values(sessionCache).find(c => {
          if (data.character && c.character) return c.character.id === data.character.id;
          if (data.role === 'dm' && c.role === 'dm') return true;
          return false;
        });
      }

      if (cacheMatch) {
        startX = cacheMatch.x;
        startY = cacheMatch.y;
        if (cacheMatch.color) color = cacheMatch.color;
        if (cacheMatch.imgUrl) imgUrl = cacheMatch.imgUrl;
      }
    }

    // Karakter atanmış saldırılarını koru (gir-çık durumlarında silinmeyi engeller)
    let charObj = data.character ? { ...data.character } : null;
    if (charObj && charObj.id) {
      let restoredAssigned = null;
      if (Array.isArray(charObj.assignedAttacks) && charObj.assignedAttacks.length > 0) {
        restoredAssigned = charObj.assignedAttacks;
      } else if (charObj.stats && Array.isArray(charObj.stats.assignedAttacks) && charObj.stats.assignedAttacks.length > 0) {
        restoredAssigned = charObj.stats.assignedAttacks;
      } else if (cacheMatch && cacheMatch.character && Array.isArray(cacheMatch.character.assignedAttacks) && cacheMatch.character.assignedAttacks.length > 0) {
        restoredAssigned = cacheMatch.character.assignedAttacks;
      } else if (cacheMatch && cacheMatch.character?.stats && Array.isArray(cacheMatch.character.stats.assignedAttacks) && cacheMatch.character.stats.assignedAttacks.length > 0) {
        restoredAssigned = cacheMatch.character.stats.assignedAttacks;
      }

      // Eğer hala bulunamadıysa Supabase'deki characters tablosundan sorgula
      if (!restoredAssigned) {
        try {
          const { data: dbChar } = await supabase.from('characters').select('stats, assigned_attacks').eq('id', charObj.id).single();
          if (dbChar) {
            if (Array.isArray(dbChar.assigned_attacks) && dbChar.assigned_attacks.length > 0) {
              restoredAssigned = dbChar.assigned_attacks;
            } else if (dbChar.stats && Array.isArray(dbChar.stats.assignedAttacks) && dbChar.stats.assignedAttacks.length > 0) {
              restoredAssigned = dbChar.stats.assignedAttacks;
            }
          }
        } catch (_) {}
      }

      if (restoredAssigned) {
        charObj.assignedAttacks = restoredAssigned;
        if (!charObj.stats) charObj.stats = {};
        charObj.stats.assignedAttacks = restoredAssigned;
      }
    }

    const playerSize = (cacheMatch && cacheMatch.size) || (charObj && (charObj.token_size || charObj.size)) || 50;

    players[socket.id] = {
      id: socket.id,
      sessionId: data.sessionId || socket.id,
      x: startX,
      y: startY,
      role: data.role === 'dm' ? 'dm' : 'player',
      profile: data.profile,
      character: charObj,
      color: color,
      imgUrl: imgUrl,
      size: playerSize
    };

    // Yalnızca yeni bağlanan oyuncuya mevcut oyuncuları gönder
    socket.emit('currentPlayers', players);

    // Diğerlerine yeni oyuncuyu bildir
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Kurtarılan atanmış saldırıları yeni bağlanan oyuncunun client hafızasına gönder
    if (charObj && charObj.assignedAttacks && charObj.assignedAttacks.length > 0) {
      socket.emit('characterUpdated', { id: socket.id, updates: { assignedAttacks: charObj.assignedAttacks } });
    }

    // Ayrıca mevcut markerları da gönder
    socket.emit('currentMarkers', markers);
    // Çizim geçmişini gönder
    socket.emit('drawHistory', drawHistory);

    // Arka planı gönder
    if (mapBgUrl) {
      socket.emit('updateBg', mapBgUrl);
    }

    // Mevcut Savaş / İnisiyatif durumunu gönder
    socket.emit('combatStateUpdated', combatState);
  });

  // ---- DM: Yeni Marker Oluştur ----
  socket.on('createMarker', (markerData) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!markerData || typeof markerData !== 'object') return;

    const markerId = 'marker_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const newMarker = {
      id: markerId,
      x: clampNumber(markerData.x, 0, 10000),
      y: clampNumber(markerData.y, 0, 10000),
      name: truncateStr(markerData.name || 'X', 40),
      color: truncateStr(markerData.color || '#f1c40f', 9),
      imgUrl: isValidUrl(markerData.imgUrl) ? markerData.imgUrl : null,
      hp: markerData.hp != null ? clampNumber(markerData.hp, 0, 99999) : null,
      maxHp: markerData.maxHp != null ? clampNumber(markerData.maxHp, 0, 99999) : null,
      ac: markerData.ac != null ? clampNumber(markerData.ac, 0, 50) : 10,
      ac_bonus: markerData.acBonus != null ? clampNumber(markerData.acBonus, 0, 50) : 0,
      stats: markerData.stats ? {
        str: clampNumber(markerData.stats?.str, 0, 30),
        str_bonus: clampNumber(markerData.stats?.str_bonus, 0, 30),
        dex: clampNumber(markerData.stats?.dex, 0, 30),
        dex_bonus: clampNumber(markerData.stats?.dex_bonus, 0, 30),
        int: clampNumber(markerData.stats?.int, 0, 30),
        int_bonus: clampNumber(markerData.stats?.int_bonus, 0, 30),
        con: clampNumber(markerData.stats?.con, 0, 30),
        con_bonus: clampNumber(markerData.stats?.con_bonus, 0, 30),
        wis: clampNumber(markerData.stats?.wis, 0, 30),
        wis_bonus: clampNumber(markerData.stats?.wis_bonus, 0, 30),
        chr: clampNumber(markerData.stats?.chr, 0, 30),
        chr_bonus: clampNumber(markerData.stats?.chr_bonus, 0, 30),
      } : null,
      size: clampNumber(markerData.size || 50, 10, 500),
      hasDarkness: Boolean(markerData.hasDarkness),
      darkness: markerData.darkness != null ? clampNumber(markerData.darkness, 0, 99999) : 0,
      maxDarkness: markerData.maxDarkness != null ? clampNumber(markerData.maxDarkness, 1, 99999) : 100,
      isMarker: true,
      assignedAttacks: Array.isArray(markerData.assignedAttacks) ? markerData.assignedAttacks : [],
      objectType: (markerData.objectType === 'explosive' || markerData.objectType === 'aura' || markerData.objectType === 'spawner') ? markerData.objectType : 'creature',
      objectConfig: (markerData.objectType === 'explosive' || markerData.objectType === 'aura' || markerData.objectType === 'spawner') && markerData.objectConfig && typeof markerData.objectConfig === 'object' ? {
        radius: clampNumber(markerData.objectConfig.radius || (markerData.objectType === 'explosive' ? 120 : (markerData.objectType === 'spawner' ? 80 : 150)), 20, 2000),
        damage: clampNumber(markerData.objectConfig.damage || 0, 0, 99999),
        damageType: truncateStr(markerData.objectConfig.damageType || (markerData.objectType === 'explosive' ? 'fire' : 'necrotic'), 20),
        statusEffects: Array.isArray(markerData.objectConfig.statusEffects) ? markerData.objectConfig.statusEffects : [],
        targetFilter: markerData.objectConfig.targetFilter || 'all',
        destroyOnExplode: markerData.objectConfig.destroyOnExplode !== false,
        destroyOnBreak: markerData.objectConfig.destroyOnBreak !== false,
        triggerTiming: markerData.objectConfig.triggerTiming || 'turn',
        spawnPresetId: truncateStr(markerData.objectConfig.spawnPresetId || '', 100),
        spawnCount: clampNumber(parseInt(markerData.objectConfig.spawnCount) || 1, 1, 10),
        spawnRadius: clampNumber(parseInt(markerData.objectConfig.spawnRadius) || 80, 20, 1000),
        totalSpawnedSoFar: clampNumber(parseInt(markerData.objectConfig.totalSpawnedSoFar) || 0, 0, 9999)
      } : null,
      hasExploded: false,
      isBroken: false
    };
    markers[markerId] = newMarker;
    io.emit('newMarker', newMarker);

    // Eğer savaş aktifse yeni marker'ı da savaşa ekle
    if (combatState.active) {
      const chrStat = newMarker.stats?.chr != null ? newMarker.stats.chr : 10;
      const chrBonus = newMarker.stats?.chr_bonus != null ? newMarker.stats.chr_bonus : 0;
      const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + chrMod;
      combatState.combatants.push({
        id: newMarker.id,
        name: newMarker.name || 'NPC',
        color: newMarker.color || '#e74c3c',
        imgUrl: newMarker.imgUrl || null,
        isMarker: true,
        role: 'marker',
        hpCurrent: newMarker.hp,
        hpMax: newMarker.maxHp,
        ac: newMarker.ac != null ? newMarker.ac : 10,
        ac_bonus: newMarker.ac_bonus != null ? newMarker.ac_bonus : 0,
        stats: newMarker.stats || null,
        hasDarkness: newMarker.hasDarkness,
        darkness: newMarker.darkness,
        maxDarkness: newMarker.maxDarkness,
        chrStat,
        chrBonus,
        chrMod,
        roll,
        total,
        isDead: newMarker.hp !== null && newMarker.hp <= 0,
        objectType: newMarker.objectType,
        objectConfig: newMarker.objectConfig,
        hasExploded: newMarker.hasExploded,
        activeEffects: newMarker.activeEffects || [],
        assignedAttacks: newMarker.assignedAttacks || []
      });
      io.emit('combatStateUpdated', combatState);
    }
  });


  // ---- DM: Marker Sil ----
  socket.on('deleteMarker', (markerId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (typeof markerId !== 'string' || !markers[markerId]) return;

    delete markers[markerId];
    io.emit('removeMarker', markerId);

    // Savaş aktifse listeden çıkar
    if (combatState.active) {
      combatState.combatants = combatState.combatants.filter(c => c.id !== markerId);
      if (combatState.currentTurnIndex >= combatState.combatants.length) {
        combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
      }
      io.emit('combatStateUpdated', combatState);
    }
  });

  // ---- DM: Marker Düzenle ----
  socket.on('editMarker', (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!data || typeof data !== 'object' || !markers[data.id]) return;

    const m = markers[data.id];

    if (data.name !== undefined) m.name = truncateStr(data.name || 'X', 40);
    if (data.color !== undefined) m.color = truncateStr(data.color || '#f1c40f', 9);
    if (data.imgUrl !== undefined) m.imgUrl = isValidUrl(data.imgUrl) ? data.imgUrl : null;
    if (data.hp !== undefined) m.hp = data.hp != null ? clampNumber(data.hp, 0, 99999) : null;
    if (data.maxHp !== undefined) m.maxHp = data.maxHp != null ? clampNumber(data.maxHp, 0, 99999) : null;
    if (data.size !== undefined) m.size = clampNumber(data.size, 10, 500);
    if (data.ac !== undefined) m.ac = clampNumber(data.ac, 0, 50);
    if (data.ac_bonus !== undefined || data.acBonus !== undefined) {
      m.ac_bonus = clampNumber(data.ac_bonus ?? data.acBonus, 0, 50);
    }
    if (data.assignedAttacks !== undefined && Array.isArray(data.assignedAttacks)) {
      m.assignedAttacks = data.assignedAttacks;
    }
    if (data.hasDarkness !== undefined) m.hasDarkness = Boolean(data.hasDarkness);
    if (data.darkness !== undefined) m.darkness = data.darkness != null ? clampNumber(data.darkness, 0, 99999) : 0;
    if (data.maxDarkness !== undefined) m.maxDarkness = data.maxDarkness != null ? clampNumber(data.maxDarkness, 1, 99999) : 100;
    if (data.stats && typeof data.stats === 'object') {
      m.stats = {
        str: clampNumber(data.stats.str, 0, 30),
        str_bonus: clampNumber(data.stats.str_bonus, 0, 30),
        dex: clampNumber(data.stats.dex, 0, 30),
        dex_bonus: clampNumber(data.stats.dex_bonus, 0, 30),
        int: clampNumber(data.stats.int, 0, 30),
        int_bonus: clampNumber(data.stats.int_bonus, 0, 30),
        con: clampNumber(data.stats.con, 0, 30),
        con_bonus: clampNumber(data.stats.con_bonus, 0, 30),
        wis: clampNumber(data.stats.wis, 0, 30),
        wis_bonus: clampNumber(data.stats.wis_bonus, 0, 30),
        chr: clampNumber(data.stats.chr, 0, 30),
        chr_bonus: clampNumber(data.stats.chr_bonus, 0, 30),
      };
    }
    if (data.objectType !== undefined) {
      m.objectType = (data.objectType === 'explosive' || data.objectType === 'aura' || data.objectType === 'spawner') ? data.objectType : 'creature';
    }
    if (data.objectConfig !== undefined) {
      if (data.objectConfig && typeof data.objectConfig === 'object') {
        m.objectConfig = {
          radius: clampNumber(data.objectConfig.radius || (m.objectType === 'explosive' ? 120 : (m.objectType === 'spawner' ? 80 : 150)), 20, 2000),
          damage: clampNumber(data.objectConfig.damage || 0, 0, 99999),
          damageType: truncateStr(data.objectConfig.damageType || (m.objectType === 'explosive' ? 'fire' : 'necrotic'), 20),
          statusEffects: Array.isArray(data.objectConfig.statusEffects) ? data.objectConfig.statusEffects : [],
          targetFilter: data.objectConfig.targetFilter || 'all',
          destroyOnExplode: data.objectConfig.destroyOnExplode !== false,
          destroyOnBreak: data.objectConfig.destroyOnBreak !== false,
          triggerTiming: data.objectConfig.triggerTiming || 'turn',
          spawnPresetId: truncateStr(data.objectConfig.spawnPresetId || '', 100),
          spawnCount: clampNumber(parseInt(data.objectConfig.spawnCount) || 1, 1, 10),
          spawnRadius: clampNumber(parseInt(data.objectConfig.spawnRadius) || 80, 20, 1000),
          totalSpawnedSoFar: clampNumber(parseInt(data.objectConfig.totalSpawnedSoFar) || (m.objectConfig?.totalSpawnedSoFar || 0), 0, 9999)
        };
      } else {
        m.objectConfig = null;
      }
    }
    if (data.hasExploded !== undefined) {
      m.hasExploded = Boolean(data.hasExploded);
    }
    if (data.isBroken !== undefined) {
      m.isBroken = Boolean(data.isBroken);
    }

    // Düzenleme sonucu can 0 olduysa ve patlayıcı ise patlat
    if (m.hp !== null && m.hp <= 0 && m.objectType === 'explosive' && !m.hasExploded) {
      handleExplosiveMarkerDeath(m.id, 'edit_hp_zero');
    }

    // Düzenleme sonucu can 0 olduysa ve çağırıcı ise kır
    if (m.hp !== null && m.hp <= 0 && m.objectType === 'spawner' && !m.isBroken) {
      handleSpawnerMarkerBreak(m.id, 'edit_hp_zero');
    }

    io.emit('updateMarkerData', m);

    // Savaş aktifse combatant bilgilerini de senkronize et
    if (combatState.active) {
      const c = combatState.combatants.find(item => item.id === data.id);
      if (c) {
        if (data.name !== undefined) c.name = m.name;
        if (data.color !== undefined) c.color = m.color;
        if (data.imgUrl !== undefined) c.imgUrl = m.imgUrl;
        if (data.hp !== undefined) c.hpCurrent = m.hp;
        if (data.maxHp !== undefined) c.hpMax = m.maxHp;
        if (data.assignedAttacks !== undefined) c.assignedAttacks = m.assignedAttacks;
        if (data.hasDarkness !== undefined) c.hasDarkness = m.hasDarkness;
        if (data.darkness !== undefined) c.darkness = m.darkness;
        if (data.maxDarkness !== undefined) c.maxDarkness = m.maxDarkness;
        c.objectType = m.objectType;
        c.objectConfig = m.objectConfig;
        c.hasExploded = m.hasExploded;
        c.isDead = m.hp !== null && m.hp <= 0;
      }
      io.emit('combatStateUpdated', combatState);
    }
  });

  // ---- DM: Toplu Saldırı Atama (Batch Assign Attacks to Markers) ----
  socket.on('batchAssignAttacks', ({ markerIds, attackPresetIds, mode }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!Array.isArray(markerIds) || !Array.isArray(attackPresetIds)) return;

    let updatedCount = 0;
    markerIds.forEach(mid => {
      const m = markers[mid];
      if (!m) return;

      if (mode === 'append') {
        const current = Array.isArray(m.assignedAttacks) ? m.assignedAttacks : [];
        const set = new Set([...current, ...attackPresetIds]);
        m.assignedAttacks = Array.from(set);
      } else {
        // replace mode
        m.assignedAttacks = [...attackPresetIds];
      }

      io.emit('updateMarkerData', m);

      if (combatState.active) {
        const c = combatState.combatants.find(item => item.id === mid);
        if (c) {
          c.assignedAttacks = m.assignedAttacks;
        }
      }
      updatedCount++;
    });

    if (combatState.active && updatedCount > 0) {
      io.emit('combatStateUpdated', combatState);
    }

    backupMapState(); // Anında Supabase'e yedekle

    socket.emit('batchAssignAttacksResult', { success: true, count: updatedCount });
    io.emit('logMessage', {
      message: `⚡ DM, ${updatedCount} adet tokene toplu saldırı atadı (${attackPresetIds.length} preset).`,
      color: '#38bdf8'
    });
  });

  // ---- DM: Daire Alan Hasarı (AoE Damage) ----
  socket.on('applyAoEDamage', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    const { damage, targets, aoeInfo } = data || {};
    const safeDamage = clampNumber(damage, 0, 99999);
    if (!safeDamage || !Array.isArray(targets) || targets.length === 0) return;

    const affectedTargets = [];

    for (const t of targets) {
      if (!t || !t.id || !t.type) continue;

      // 1. Shelter (Barınak) kontrolü
      const targetEffects = getTokenActiveEffects(t.type, t.id);
      const hasShelter = targetEffects.some(e => e.effects?.shelter);
      if (hasShelter) {
        continue;
      }

      if (t.type === 'marker') {
        const marker = markers[t.id];
        if (marker && marker.hp != null) {
          const oldHp = marker.hp;
          marker.hp = Math.max(0, marker.hp - safeDamage);
          io.emit('updateMarkerData', marker);
          syncCombatantHp(t.id, marker.hp, marker.maxHp);
          affectedTargets.push({
            type: 'marker',
            id: t.id,
            name: marker.name || 'Yaratık',
            oldHp,
            newHp: marker.hp,
            damage: safeDamage
          });

          // Cansız Patlayıcı Obje AoE hasarıyla öldüyse patlat
          if (marker.hp <= 0 && marker.objectType === 'explosive' && !marker.hasExploded) {
            handleExplosiveMarkerDeath(t.id, 'aoe_damage');
          }
        }
      } else if (t.type === 'character') {
        try {
          const { data: charData, error: fetchErr } = await supabase
            .from('characters')
            .select('hp_current, hp_max, name')
            .eq('id', t.id)
            .single();

          if (!fetchErr && charData) {
            const oldHp = charData.hp_current || 0;
            const newHp = Math.max(0, oldHp - safeDamage);
            await supabase
              .from('characters')
              .update({ hp_current: newHp })
              .eq('id', t.id);

            const playerEntry = Object.entries(players).find(
              ([, p]) => p.character && p.character.id === t.id
            );
            if (playerEntry) {
              const [socketId, pData] = playerEntry;
              pData.character.hp_current = newHp;
              io.emit('characterUpdated', {
                id: socketId,
                updates: { hp_current: newHp, hp_max: charData.hp_max }
              });
              syncCombatantHp(socketId, newHp, charData.hp_max);
            } else {
              syncCombatantHp(t.id, newHp, charData.hp_max);
            }

            affectedTargets.push({
              type: 'character',
              id: t.id,
              name: charData.name || 'Oyuncu',
              oldHp,
              newHp,
              damage: safeDamage
            });
          }
        } catch (err) {
          console.error('AoE hasar uygulama karakter hatası:', err);
        }
      }
    }

    if (affectedTargets.length > 0) {
      backupMapState();

      // Tüm istemcilere görsel patlama dalgası ve floating hasar rakamları bildir
      io.emit('aoeDamageApplied', {
        damage: safeDamage,
        aoeInfo,
        affectedTargets
      });

      // Oyun günlüğüne yaz
      const names = affectedTargets.map(at => `${at.name} (-${at.damage})`).join(', ');
      io.emit('logMessage', {
        message: `💥 [ALAN HASARI] DM ${safeDamage} hasar vurdu! Etkilenenler: ${names}`,
        color: '#ef4444'
      });
    }
  });

  // Saldırı paneli veya presetlerden gelen anlık patlama görseli yayını (gönderen hariç yayınla, gönderen yerel olarak zaten oynattı)
  socket.on('triggerAoeExplosion', (data) => {
    if (!data || typeof data !== 'object') return;
    socket.broadcast.emit('aoeDamageApplied', data);
  });

  // ---- DM: Arka Plan Güncelle ----
  socket.on('updateBg', (url) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;

    if (url && !isValidUrl(url)) return;
    mapBgUrl = url || '';
    io.emit('updateBg', mapBgUrl);
  });

  // ---- Token Görünüm Güncelle ----
  socket.on('updateTokenAppearance', (data) => {
    if (!players[socket.id] || !data || typeof data !== 'object') return;

    if (data.imgUrl !== undefined) {
      players[socket.id].imgUrl = isValidUrl(data.imgUrl) ? data.imgUrl : null;
    }
    if (data.color !== undefined) {
      players[socket.id].color = truncateStr(data.color, 9);
    }
    io.emit('tokenAppearanceUpdated', {
      id: socket.id,
      imgUrl: players[socket.id].imgUrl,
      color: players[socket.id].color
    });

    if (combatState.active) {
      const c = combatState.combatants.find(item => item.id === socket.id);
      if (c) {
        if (data.imgUrl !== undefined) c.imgUrl = players[socket.id].imgUrl;
        if (data.color !== undefined) c.color = players[socket.id].color;
        io.emit('combatStateUpdated', combatState);
      }
    }
  });

  // ---- DM: Karakter Güncelle ----
  socket.on('updateCharacter', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!data || typeof data !== 'object' || !data.characterId) return;

    const updates = {
      hp_current: clampNumber(data.hp_current, 0, 99999),
      hp_max: clampNumber(data.hp_max, 1, 99999),
      stats: {
        str: clampNumber(data.stats?.str, 0, 30),
        str_bonus: clampNumber(data.stats?.str_bonus, 0, 30),
        dex: clampNumber(data.stats?.dex, 0, 30),
        dex_bonus: clampNumber(data.stats?.dex_bonus, 0, 30),
        int: clampNumber(data.stats?.int, 0, 30),
        int_bonus: clampNumber(data.stats?.int_bonus, 0, 30),
        con: clampNumber(data.stats?.con, 0, 30),
        con_bonus: clampNumber(data.stats?.con_bonus, 0, 30),
        wis: clampNumber(data.stats?.wis, 0, 30),
        wis_bonus: clampNumber(data.stats?.wis_bonus, 0, 30),
        chr: clampNumber(data.stats?.chr, 0, 30),
        chr_bonus: clampNumber(data.stats?.chr_bonus, 0, 30)
      }
    };

    // Opsiyonel alanlar
    if (data.ac !== undefined) updates.ac = clampNumber(data.ac, 0, 50);
    if (data.ac_bonus !== undefined) updates.ac_bonus = clampNumber(data.ac_bonus, 0, 50);
    if (data.corruption !== undefined) updates.corruption = clampNumber(data.corruption, 0, 100);
    if (data.darkness !== undefined) updates.darkness = clampNumber(data.darkness, 0, 99999);
    if (data.max_darkness !== undefined || data.maxDarkness !== undefined) {
      updates.max_darkness = clampNumber(data.max_darkness ?? data.maxDarkness, 1, 99999);
    }
    if (data.assignedAttacks !== undefined && Array.isArray(data.assignedAttacks)) {
      updates.assignedAttacks = data.assignedAttacks;
      updates.stats.assignedAttacks = data.assignedAttacks;
    }
    if (data.spell_slots) {
      updates.spell_slots = {
        lvl1: clampNumber(data.spell_slots.lvl1, 0, 20),
        lvl2: clampNumber(data.spell_slots.lvl2, 0, 20),
        lvl3: clampNumber(data.spell_slots.lvl3, 0, 20),
        lvl4: clampNumber(data.spell_slots.lvl4, 0, 20),
      };
    }

    if (data.size !== undefined || data.token_size !== undefined) {
      const safeSize = clampNumber(data.size || data.token_size, 20, 500);
      updates.token_size = safeSize;
      updates.size = safeSize;
    }

    let { error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', data.characterId);

    if (error && error.message && error.message.includes('column')) {
      const safeUpdates = { ...updates };
      if (safeUpdates.assignedAttacks !== undefined) delete safeUpdates.assignedAttacks;
      if (safeUpdates.darkness !== undefined) delete safeUpdates.darkness;
      if (safeUpdates.max_darkness !== undefined) delete safeUpdates.max_darkness;
      if (safeUpdates.size !== undefined) delete safeUpdates.size;
      if (safeUpdates.token_size !== undefined) delete safeUpdates.token_size;
      const retry = await supabase.from('characters').update(safeUpdates).eq('id', data.characterId);
      error = retry.error;
    }

    if (error) {
      console.error("Supabase güncellerken hata (hafıza güncelleniyor):", error.message);
    }

    // Başarılıysa sunucu durumunu güncelle ve herkese anons et
    if (players[data.id] && players[data.id].character) {
      Object.assign(players[data.id].character, updates);
      if (updates.assignedAttacks !== undefined) {
        players[data.id].character.assignedAttacks = updates.assignedAttacks;
        if (!players[data.id].character.stats) players[data.id].character.stats = {};
        players[data.id].character.stats.assignedAttacks = updates.assignedAttacks;
      }
      if (updates.size !== undefined || updates.token_size !== undefined) {
        const tokenSize = updates.size || updates.token_size;
        players[data.id].size = tokenSize;
        if (players[data.id].sessionId && sessionCache[players[data.id].sessionId]) {
          sessionCache[players[data.id].sessionId].size = tokenSize;
        }
      }
      if (players[data.id].sessionId && sessionCache[players[data.id].sessionId]) {
        sessionCache[players[data.id].sessionId].character = players[data.id].character;
      }
      io.emit('characterUpdated', { id: data.id, updates: updates });
      if (updates.size !== undefined || updates.token_size !== undefined) {
        io.emit('tokenSizeUpdated', { id: data.id, size: updates.size || updates.token_size });
      }
      syncCombatantHp(data.id, updates.hp_current, updates.hp_max);

      if (combatState.active) {
        const c = combatState.combatants.find(item => item.id === data.id || item.characterId === data.characterId);
        if (c) {
          if (updates.assignedAttacks !== undefined) c.assignedAttacks = updates.assignedAttacks;
          if (updates.darkness !== undefined) c.darkness = updates.darkness;
          if (updates.max_darkness !== undefined) c.maxDarkness = updates.max_darkness;
          io.emit('combatStateUpdated', combatState);
        }
      }
    }
  });

  // ---- DM: Oyuncu Token Boyutu Hızlı Güncelle ----
  socket.on('updatePlayerTokenSize', async ({ playerId, size }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!playerId || !players[playerId]) return;

    const safeSize = clampNumber(size, 20, 500);
    players[playerId].size = safeSize;
    if (players[playerId].character) {
      players[playerId].character.token_size = safeSize;
      players[playerId].character.size = safeSize;
    }
    if (players[playerId].sessionId && sessionCache[players[playerId].sessionId]) {
      sessionCache[players[playerId].sessionId].size = safeSize;
    }

    io.emit('tokenSizeUpdated', { id: playerId, size: safeSize });

    const charName = players[playerId].character?.name || 'Oyuncu';
    io.emit('logMessage', {
      message: `📏 DM, ${charName} token boyutunu ${safeSize}px yaptı.`,
      color: '#c5a059'
    });

    if (players[playerId].character?.id) {
      try {
        await supabase
          .from('characters')
          .update({ token_size: safeSize })
          .eq('id', players[playerId].character.id);
      } catch (_) {}
    }
  });

  // ---- Çizim Eventleri ----
  socket.on('drawLine', (data) => {
    if (!data || typeof data !== 'object') return;

    const line = {
      playerId: socket.id,
      type: truncateStr(data.type || 'line', 20),
      x0: clampNumber(data.x0, -10000, 20000),
      y0: clampNumber(data.y0, -10000, 20000),
      x1: clampNumber(data.x1, -10000, 20000),
      y1: clampNumber(data.y1, -10000, 20000),
      width: clampNumber(data.width || data.lineWidth || 3, 1, 100),
      color: truncateStr(data.color || '#e74c3c', 35),
      fill: Boolean(data.fill)
    };

    drawHistory.push(line);

    // Sınırsız büyümeyi engelle
    if (drawHistory.length > MAX_DRAW_HISTORY) {
      drawHistory = drawHistory.slice(-MAX_DRAW_HISTORY);
    }

    socket.broadcast.emit('draw', line);
  });

  socket.on('undoDraw', () => {
    for (let i = drawHistory.length - 1; i >= 0; i--) {
      if (drawHistory[i].playerId === socket.id) {
        drawHistory.splice(i, 1);
        io.emit('drawHistory', drawHistory);
        break;
      }
    }
  });

  socket.on('requestClearAllDrawings', () => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    drawHistory = [];
    io.emit('drawHistory', drawHistory);
  });

  socket.on('requestClearMyDrawings', () => {
    drawHistory = drawHistory.filter(line => line.playerId !== socket.id);
    io.emit('drawHistory', drawHistory);
  });

  // ---- Zar Atma (Sunucu Tarafında Üretim) ----
  socket.on('rollDice', (data) => {
    if (!data || typeof data !== 'object') return;

    const validDice = [4, 6, 8, 10, 12, 20, 100];
    const diceType = validDice.includes(data.diceType) ? data.diceType : 20;
    const result = Math.floor(Math.random() * diceType) + 1;

    const rollerName = truncateStr(data.rollerName || 'Bilinmiyor', 30);

    io.emit('diceRolled', {
      rollerName: rollerName,
      diceType: diceType,
      result: result
    });
  });

  // ---- Token Hareketi ----
  socket.on('playerMovement', (movementData) => {
    if (!movementData || typeof movementData !== 'object') return;
    const sender = players[socket.id];
    if (!sender) return;

    const x = clampNumber(movementData.x, -500, 20000);
    const y = clampNumber(movementData.y, -500, 20000);

    // Kendi id'si ise kendi yerini günceller
    if (movementData.id === socket.id) {
      players[socket.id].x = x;
      players[socket.id].y = y;
      socket.broadcast.emit('updateTokenPosition', { id: socket.id, x, y });
    }
    // Eğer DM ise başkalarını veya markerları hareket ettirebilir
    else if (sender.role === 'dm') {
      if (players[movementData.id]) {
        players[movementData.id].x = x;
        players[movementData.id].y = y;
        socket.broadcast.emit('updateTokenPosition', { id: movementData.id, x, y });
      } else if (markers[movementData.id]) {
        markers[movementData.id].x = x;
        markers[movementData.id].y = y;
        socket.broadcast.emit('updateTokenPosition', { id: movementData.id, x, y });
      }
    }
  });

  // ---- DM: Manuel Kaydet ----
  socket.on('forceSave', async () => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    await backupMapState();
    socket.emit('saveComplete');
  });

  // ---- BG3 COMBAT / İNİSİYATİF EVENTLERİ ----
  socket.on('getCombatState', () => {
    socket.emit('combatStateUpdated', combatState);
  });

  socket.on('startCombat', () => {
    combatState.combatants = calculateInitiativeForCombat();
    combatState.active = true;
    combatState.round = 1;
    combatState.currentTurnIndex = 0;
    io.emit('combatStateUpdated', combatState);
    io.emit('combatStarted', { round: combatState.round, combatants: combatState.combatants });
  });

  socket.on('endCombat', () => {
    combatState.active = false;
    combatState.currentTurnIndex = 0;
    combatState.round = 1;
    combatState.combatants = [];
    io.emit('combatStateUpdated', combatState);
    io.emit('combatEnded');
  });

  socket.on('toggleCombat', () => {
    if (combatState.active) {
      combatState.active = false;
      combatState.currentTurnIndex = 0;
      combatState.round = 1;
      combatState.combatants = [];
      io.emit('combatStateUpdated', combatState);
      io.emit('combatEnded');
    } else {
      combatState.combatants = calculateInitiativeForCombat();
      combatState.active = true;
      combatState.round = 1;
      combatState.currentTurnIndex = 0;
      io.emit('combatStateUpdated', combatState);
      io.emit('combatStarted', { round: combatState.round, combatants: combatState.combatants });
    }
  });

  socket.on('nextCombatTurn', async () => {
    if (!combatState.active || !combatState.combatants.length) return;

    // 1. Sırası biten combatant için DoT hasarını uygula ve süreleri azalt
    const currentCombatant = combatState.combatants[combatState.currentTurnIndex];
    if (currentCombatant) {
      await processCombatantTurnEnd(currentCombatant);
    }

    // 2. Sıradaki combatant'a geç
    let nextIndex = combatState.currentTurnIndex + 1;
    let roundAdvanced = false;
    if (nextIndex >= combatState.combatants.length) {
      nextIndex = 0;
      combatState.round += 1;
      roundAdvanced = true;
    }
    combatState.currentTurnIndex = nextIndex;
    io.emit('combatStateUpdated', combatState);

    // 3. Sırası gelen combatant canlı bir Aura/Totem veya Çağırıcı objesi ise tetikle
    const nextCombatant = combatState.combatants[nextIndex];
    if (nextCombatant && nextCombatant.isMarker) {
      const m = markers[nextCombatant.id];
      if (m && m.objectType === 'aura' && m.hp !== null && m.hp > 0 && (m.objectConfig?.triggerTiming !== 'round')) {
        await handleAuraMarkerPulse(nextCombatant.id);
      }
      if (m && m.objectType === 'spawner' && m.hp !== null && m.hp > 0 && !m.isBroken && (m.objectConfig?.triggerTiming !== 'round')) {
        await handleSpawnerTrigger(nextCombatant.id);
      }
    }

    // 4. Yeni raund başladıysa 'round' tetiklemeli aura ve çağırıcı nesnelerini tetikle
    if (roundAdvanced) {
      await handleRoundStartAuras();
      await handleRoundStartSpawners();
    }
  });

  socket.on('prevCombatTurn', () => {
    if (!combatState.active || !combatState.combatants.length) return;
    
    if (combatState.currentTurnIndex > 0) {
      combatState.currentTurnIndex -= 1;
    } else if (combatState.round > 1) {
      combatState.round -= 1;
      combatState.currentTurnIndex = combatState.combatants.length - 1;
    }
    io.emit('combatStateUpdated', combatState);
  });

  socket.on('setCombatTurn', async (index) => {
    if (!combatState.active || !combatState.combatants.length) return;
    const safeIdx = clampNumber(index, 0, combatState.combatants.length - 1);
    
    const currentCombatant = combatState.combatants[combatState.currentTurnIndex];
    if (currentCombatant && safeIdx !== combatState.currentTurnIndex) {
      await processCombatantTurnEnd(currentCombatant);
    }

    combatState.currentTurnIndex = safeIdx;
    io.emit('combatStateUpdated', combatState);

    // Sırası verilen combatant canlı bir Aura/Totem veya Çağırıcı objesi ise tetikle
    const targetCombatant = combatState.combatants[safeIdx];
    if (targetCombatant && targetCombatant.isMarker) {
      const m = markers[targetCombatant.id];
      if (m && m.objectType === 'aura' && m.hp !== null && m.hp > 0) {
        await handleAuraMarkerPulse(targetCombatant.id);
      }
      if (m && m.objectType === 'spawner' && m.hp !== null && m.hp > 0 && !m.isBroken) {
        await handleSpawnerTrigger(targetCombatant.id);
      }
    }
  });

  socket.on('rerollCombatInitiative', () => {
    if (!combatState.active) return;
    combatState.combatants = calculateInitiativeForCombat();
    combatState.currentTurnIndex = 0;
    io.emit('combatStateUpdated', combatState);
  });

  // ---- DM: Cansız Nesneler Manuel Tetikleme Eventleri ----
  socket.on('detonateObject', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    const markerId = typeof data === 'string' ? data : (data?.markerId || data?.id);
    if (markerId && markers[markerId] && markers[markerId].objectType === 'explosive') {
      await handleExplosiveMarkerDeath(markerId, 'dm_manual');
    }
  });

  socket.on('triggerObjectAura', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    const markerId = typeof data === 'string' ? data : (data?.markerId || data?.id);
    if (markerId && markers[markerId] && markers[markerId].objectType === 'aura') {
      await handleAuraMarkerPulse(markerId);
    }
  });

  socket.on('triggerObjectSpawner', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    const markerId = typeof data === 'string' ? data : (data?.spawnerId || data?.markerId || data?.id);
    if (markerId && markers[markerId] && markers[markerId].objectType === 'spawner') {
      await handleSpawnerTrigger(markerId, true);
    }
  });

  // ---- STATUS EFFECTS & CUSTOM EFFECT BUILDER SOCKET EVENTLERİ ----
  socket.on('getCustomEffects', () => {
    socket.emit('customEffectsUpdated', customStatusPresets);
  });

  socket.on('saveCustomEffect', async (effectTemplate) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!effectTemplate || !effectTemplate.name) return;

    const newEffect = {
      id: effectTemplate.id || ('custom_' + Date.now()),
      name: truncateStr(effectTemplate.name, 30),
      icon: effectTemplate.icon || '✨',
      duration: effectTemplate.duration != null && effectTemplate.duration !== '' ? clampNumber(parseInt(effectTemplate.duration), 1, 99) : null,
      effects: effectTemplate.effects || {}
    };

    const existingIdx = customStatusPresets.findIndex(e => e.id === newEffect.id);
    if (existingIdx >= 0) {
      customStatusPresets[existingIdx] = newEffect;
    } else {
      customStatusPresets.push(newEffect);
    }

    io.emit('customEffectsUpdated', customStatusPresets);

    // Supabase veritabanına kaydet (upsert)
    try {
      const dbRecord = {
        id: newEffect.id,
        name: newEffect.name,
        icon: newEffect.icon,
        duration: newEffect.duration,
        effects: newEffect.effects
      };
      const { error } = await supabase.from('status_presets').upsert(dbRecord);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase status preset kaydetme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase status preset kaydetme istisnası:', err.message);
    }
  });

  socket.on('deleteCustomEffect', async (effectId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    customStatusPresets = customStatusPresets.filter(e => e.id !== effectId);
    io.emit('customEffectsUpdated', customStatusPresets);

    // Supabase veritabanından sil
    try {
      const { error } = await supabase.from('status_presets').delete().eq('id', effectId);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase status preset silme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase status preset silme istisnası:', err.message);
    }
  });

  socket.on('applyStatusEffect', ({ targetType, targetId, effect }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    applyStatusEffectToTarget(targetType, targetId, effect);
  });

  socket.on('removeStatusEffect', ({ targetType, targetId, effectId }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    removeStatusEffectFromTarget(targetType, targetId, effectId);
  });

  // ---- ATTACK PRESETS SOCKET EVENTLERİ ----
  socket.on('getAttackPresets', () => {
    socket.emit('attackPresetsUpdated', attackPresets);
  });

  socket.on('saveAttackPreset', async (preset) => {
    if (!preset || !preset.name) return;

    const newPreset = {
      id: preset.id || ('atk_custom_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      name: truncateStr(preset.name, 40),
      stat: preset.stat || 'STR',
      attackType: preset.attackType === 'spell' ? 'spell' : 'physical',
      physicalDamageType: preset.physicalDamageType || 'slashing',
      actionNature: preset.actionNature || 'damage',
      healPool: (preset.healPool && typeof preset.healPool === 'object') ? preset.healPool : null,
      healTarget: preset.healTarget || (preset.actionNature === 'heal' ? 'target' : 'self'),
      lifestealPercent: clampNumber(parseInt(preset.lifestealPercent) || 0, 0, 100),
      spellLevel: clampNumber(parseInt(preset.spellLevel) || 1, 1, 4),
      consumesSpellSlot: Boolean(preset.consumesSpellSlot),
      baseSpellLevel: clampNumber(parseInt(preset.baseSpellLevel) || 1, 1, 4),
      slotScaling: (typeof preset.slotScaling === 'object' && preset.slotScaling !== null) ? preset.slotScaling : {},
      dicePools: preset.dicePools || { phys: {}, elem1: {}, elem2: {} },
      statusEffectsToApply: Array.isArray(preset.statusEffectsToApply) ? preset.statusEffectsToApply : [],
      halfDamageOnMiss: Boolean(preset.halfDamageOnMiss),
      extraDamage: clampNumber(parseInt(preset.extraDamage) || 0, 0, 1000),
      attackCount: clampNumber(parseInt(preset.attackCount) || 1, 1, 20),
      isAoe: Boolean(preset.isAoe),
      aoeRadius: Math.max(0.5, parseFloat(preset.aoeRadius) || 1),
      description: truncateStr(preset.description || '', 200)
    };

    const existingIdx = attackPresets.findIndex(p => p.id === newPreset.id);
    if (existingIdx >= 0) {
      attackPresets[existingIdx] = newPreset;
    } else {
      attackPresets.push(newPreset);
    }

    io.emit('attackPresetsUpdated', attackPresets);

    try {
      const dbRecord = {
        id: newPreset.id,
        name: newPreset.name,
        stat: newPreset.stat,
        attack_type: newPreset.attackType,
        spell_level: newPreset.baseSpellLevel || newPreset.spellLevel,
        dice_pools: {
          ...newPreset.dicePools,
          _meta: {
            physicalDamageType: newPreset.physicalDamageType
          },
          _aoe: {
            isAoe: newPreset.isAoe,
            radius: newPreset.aoeRadius
          },
          _spellSlotConfig: {
            consumesSpellSlot: newPreset.consumesSpellSlot,
            baseSpellLevel: newPreset.baseSpellLevel,
            slotScaling: newPreset.slotScaling
          },
          _healConfig: {
            actionNature: newPreset.actionNature,
            healPool: newPreset.healPool,
            healTarget: newPreset.healTarget,
            lifestealPercent: newPreset.lifestealPercent
          }
        },
        status_effects_to_apply: newPreset.statusEffectsToApply,
        half_damage_on_miss: newPreset.halfDamageOnMiss,
        extra_damage: newPreset.extraDamage,
        attack_count: newPreset.attackCount,
        description: newPreset.description
      };
      const { error } = await supabase.from('attack_presets').upsert(dbRecord);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase attack preset kaydetme hatası:', error.message);
      } else {
        console.log(`[Supabase] "${newPreset.name}" (${newPreset.id}) başarıyla kaydedildi.`);
      }
    } catch (err) {
      console.error('Supabase attack preset kaydetme istisnası:', err.message);
    }
  });

  socket.on('deleteAttackPreset', async (presetId) => {
    if (!presetId) return;

    attackPresets = attackPresets.filter(p => p.id !== presetId);
    io.emit('attackPresetsUpdated', attackPresets);

    try {
      const { error } = await supabase.from('attack_presets').delete().eq('id', presetId);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase attack preset silme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase attack preset silme istisnası:', err.message);
    }
  });

  // ---- TOKEN PRESETS (HAZIR ŞEMALAR) SOCKET EVENTLERİ ----
  socket.on('getTokenPresets', () => {
    socket.emit('tokenPresetsUpdated', tokenPresets);
  });

  socket.on('saveTokenPreset', async (preset) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!preset || !preset.name) return;

    const newPreset = {
      id: preset.id || ('token_preset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      name: truncateStr(preset.name, 40),
      imgUrl: isValidUrl(preset.imgUrl) ? preset.imgUrl : (preset.imgUrl || ''),
      color: truncateStr(preset.color || '#f1c40f', 9),
      hp: preset.hp != null && preset.hp !== '' ? clampNumber(parseInt(preset.hp), 0, 99999) : null,
      maxHp: preset.maxHp != null && preset.maxHp !== '' ? clampNumber(parseInt(preset.maxHp), 0, 99999) : null,
      size: clampNumber(parseInt(preset.size) || 50, 10, 500),
      ac: preset.ac != null && preset.ac !== '' ? clampNumber(parseInt(preset.ac), 0, 50) : 10,
      acBonus: (preset.acBonus != null || preset.ac_bonus != null) ? clampNumber(parseInt(preset.acBonus ?? preset.ac_bonus) || 0, 0, 50) : 0,
      stats: preset.stats ? {
        str: clampNumber(parseInt(preset.stats.str) || 0, 0, 30),
        str_bonus: clampNumber(parseInt(preset.stats.str_bonus) || 0, 0, 30),
        dex: clampNumber(parseInt(preset.stats.dex) || 0, 0, 30),
        dex_bonus: clampNumber(parseInt(preset.stats.dex_bonus) || 0, 0, 30),
        int: clampNumber(parseInt(preset.stats.int) || 0, 0, 30),
        int_bonus: clampNumber(parseInt(preset.stats.int_bonus) || 0, 0, 30),
        con: clampNumber(parseInt(preset.stats.con) || 0, 0, 30),
        con_bonus: clampNumber(parseInt(preset.stats.con_bonus) || 0, 0, 30),
        wis: clampNumber(parseInt(preset.stats.wis) || 0, 0, 30),
        wis_bonus: clampNumber(parseInt(preset.stats.wis_bonus) || 0, 0, 30),
        chr: clampNumber(parseInt(preset.stats.chr) || 0, 0, 30),
        chr_bonus: clampNumber(parseInt(preset.stats.chr_bonus) || 0, 0, 30),
      } : {
        str: 10, str_bonus: 0,
        dex: 10, dex_bonus: 0,
        int: 10, int_bonus: 0,
        con: 10, con_bonus: 0,
        wis: 10, wis_bonus: 0,
        chr: 10, chr_bonus: 0
      },
      hasDarkness: Boolean(preset.hasDarkness),
      darkness: preset.darkness != null ? clampNumber(parseInt(preset.darkness) || 0, 0, 99999) : 0,
      maxDarkness: preset.maxDarkness != null ? clampNumber(parseInt(preset.maxDarkness) || 100, 1, 99999) : 100,
      assignedAttacks: Array.isArray(preset.assignedAttacks) ? preset.assignedAttacks : [],
      objectType: (preset.objectType === 'explosive' || preset.objectType === 'aura' || preset.objectType === 'spawner') ? preset.objectType : 'creature',
      objectConfig: (preset.objectType === 'explosive' || preset.objectType === 'aura' || preset.objectType === 'spawner') && preset.objectConfig && typeof preset.objectConfig === 'object' ? {
        radius: clampNumber(parseInt(preset.objectConfig.radius) || (preset.objectType === 'explosive' ? 120 : (preset.objectType === 'spawner' ? 80 : 150)), 20, 2000),
        damage: clampNumber(parseInt(preset.objectConfig.damage) || 0, 0, 99999),
        damageType: truncateStr(preset.objectConfig.damageType || (preset.objectType === 'explosive' ? 'fire' : 'necrotic'), 20),
        statusEffects: Array.isArray(preset.objectConfig.statusEffects) ? preset.objectConfig.statusEffects : [],
        targetFilter: preset.objectConfig.targetFilter || 'all',
        destroyOnExplode: preset.objectConfig.destroyOnExplode !== false,
        destroyOnBreak: preset.objectConfig.destroyOnBreak !== false,
        triggerTiming: preset.objectConfig.triggerTiming || 'turn',
        spawnPresetId: truncateStr(preset.objectConfig.spawnPresetId || '', 100),
        spawnCount: clampNumber(parseInt(preset.objectConfig.spawnCount) || 1, 1, 10),
        spawnRadius: clampNumber(parseInt(preset.objectConfig.spawnRadius) || 80, 20, 1000),
        totalSpawnedSoFar: clampNumber(parseInt(preset.objectConfig.totalSpawnedSoFar) || 0, 0, 9999)
      } : null
    };

    const existingIdx = tokenPresets.findIndex(p => p.id === newPreset.id);
    if (existingIdx >= 0) {
      tokenPresets[existingIdx] = newPreset;
    } else {
      tokenPresets.push(newPreset);
    }

    io.emit('tokenPresetsUpdated', tokenPresets);

    try {
      const dbRecord = {
        id: newPreset.id,
        name: newPreset.name,
        img_url: newPreset.imgUrl,
        color: newPreset.color,
        hp: newPreset.hp,
        max_hp: newPreset.maxHp,
        size: newPreset.size,
        ac: newPreset.ac,
        ac_bonus: newPreset.acBonus,
        stats: newPreset.stats,
        has_darkness: newPreset.hasDarkness,
        darkness: newPreset.darkness,
        max_darkness: newPreset.maxDarkness,
        assigned_attacks: newPreset.assignedAttacks,
        object_type: newPreset.objectType,
        object_config: newPreset.objectConfig,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('token_presets').upsert(dbRecord);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase token preset kaydetme hatası:', error.message);
      } else if (!error) {
        console.log(`[Supabase] "${newPreset.name}" (${newPreset.id}) token şeması başarıyla kaydedildi.`);
      }
    } catch (err) {
      console.error('Supabase token preset kaydetme istisnası:', err.message);
    }
  });

  socket.on('deleteTokenPreset', async (presetId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!presetId) return;

    tokenPresets = tokenPresets.filter(p => p.id !== presetId);
    io.emit('tokenPresetsUpdated', tokenPresets);

    try {
      const { error } = await supabase.from('token_presets').delete().eq('id', presetId);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase token preset silme hatası:', error.message);
      } else if (!error) {
        console.log(`[Supabase] "${presetId}" token şeması başarıyla silindi.`);
      }
    } catch (err) {
      console.error('Supabase token preset silme istisnası:', err.message);
    }
  });

  // ---- HARİTA DÜZENİ BACKUP / RESTORE ----
  socket.on('requestMapBackup', async () => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    await backupMapState();
    socket.emit('backupCompleted', { success: true, timestamp: new Date().toLocaleTimeString('tr-TR') });
  });

  // ---- Bağlantı Kopma ----
  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı: ' + socket.id);
    if (players[socket.id]) {
      const p = players[socket.id];
      sessionCache[p.sessionId] = {
        x: p.x,
        y: p.y,
        size: p.size || 50,
        color: p.color,
        imgUrl: p.imgUrl,
        role: p.role,
        character: p.character,
        cachedAt: Date.now()
      };

      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);

      // Savaş devam ediyorsa listeden çıkar
      if (combatState.active) {
        combatState.combatants = combatState.combatants.filter(c => c.id !== socket.id);
        if (combatState.currentTurnIndex >= combatState.combatants.length) {
          combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
        }
        io.emit('combatStateUpdated', combatState);
      }
    }
  });
});

// === HARİTA DURUMU YEDEKLEME (SUPABASE) ===
async function backupMapState() {
  try {
    const payload = {
      id: 1,
      current_map: typeof mapBgUrl !== 'undefined' ? mapBgUrl : '',
      fog_data: typeof fogGrid !== 'undefined' ? fogGrid : null,
      fog_uncovered: typeof fogUncovered !== 'undefined' ? fogUncovered : null,
      markers: typeof markers !== 'undefined' ? markers : {},
      game_mode: currentGameMode,
      updated_at: new Date().toISOString()
    };

    let { error } = await supabase
      .from('map_state')
      .upsert(payload);

    if (error && error.message && error.message.includes('column')) {
      const { game_mode, ...safePayload } = payload;
      const retry = await supabase.from('map_state').upsert(safePayload);
      error = retry.error;
    }

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Harita durumu yedeklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('map_state tablosu henüz veritabanında oluşturulmamış.');
      }
    } else {
      console.log('Map durumu yedeklendi.');
    }
  } catch (err) {
    console.error('Harita durumu yedeklenirken beklenmeyen hata:', err.message);
  }
}

// === HARİTA DURUMUNU GERİ YÜKLEME (SUPABASE) ===
async function restoreMapState() {
  try {
    const { data, error } = await supabase
      .from('map_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Harita durumu yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('map_state tablosu henüz veritabanında oluşturulmamış.');
      }
      return;
    }

    if (data) {
      if (data.current_map) mapBgUrl = data.current_map;
      if (data.fog_data) fogGrid = data.fog_data;
      if (data.fog_uncovered) fogUncovered = data.fog_uncovered;
      if (data.markers && typeof data.markers === 'object') {
        markers = data.markers;
      }
      if (data.game_mode) {
        currentGameMode = data.game_mode;
      }
      console.log('Map durumu başarıyla geri yüklendi.');
    } else {
      console.log('Geri yüklenecek map durumu bulunamadı veya tablo boş.');
    }
  } catch (err) {
    console.error('Harita durumu geri yüklenirken beklenmeyen hata:', err.message);
  }
}

// === VARSAYILAN ŞABLONLAR (STARTER PRESETS) ===
const DEFAULT_STATUS_PRESETS = [
  { id: 'preset_burn', name: 'Yanma', icon: '🔥', duration: 3, effects: { dotDamage: { min: 1, max: 6 } } },
  { id: 'preset_bleed', name: 'Kanama', icon: '🩸', duration: 3, effects: { dotDamage: { min: 1, max: 4 } } },
  { id: 'preset_blind', name: 'Körlük', icon: '👁️', duration: 2, effects: { blind: true } },
  { id: 'preset_paralyzed', name: 'Felç', icon: '⚡', duration: 1, effects: { paralyzed: true } },
  { id: 'preset_regen', name: 'Yenilenme (Rejenerasyon)', icon: '💚', duration: 3, effects: { hotHealing: { min: 2, max: 8 } } },
  { id: 'preset_blessed', name: 'Kutsanmış', icon: '✨', duration: 3, effects: { acBonus: 2 } },
  { id: 'preset_lifesteal', name: 'Yaşam Çalma', icon: '🩸', duration: 2, effects: { lifesteal: true } }
];

const DEFAULT_ATTACK_PRESETS = [
  {
    id: 'atk_preset_flame_sword',
    name: 'Alev Kılıcı',
    stat: 'STR',
    attackType: 'physical',
    physicalDamageType: 'slashing',
    actionNature: 'damage',
    healPool: null,
    healTarget: 'self',
    lifestealPercent: 0,
    spellLevel: 1,
    consumesSpellSlot: false,
    baseSpellLevel: 1,
    slotScaling: {},
    dicePools: { phys: { dice: { d8: 1 }, bonus: 2 }, elem1: { dice: { d6: 1 }, bonus: 0 } },
    statusEffectsToApply: [DEFAULT_STATUS_PRESETS[0]], // Yanma
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    isAoe: false,
    aoeRadius: 1,
    description: '1d8+2 Kesme + 1d6 Ateş Hasarı. Vuruş halinde Yanma uygular.'
  },
  {
    id: 'atk_preset_cure_wounds',
    name: 'Kutsal Şifa',
    stat: 'WIS',
    attackType: 'spell',
    physicalDamageType: 'magic',
    actionNature: 'heal',
    healPool: { dice: { d8: 2 }, bonus: 3 },
    healTarget: 'target',
    lifestealPercent: 0,
    spellLevel: 1,
    consumesSpellSlot: true,
    baseSpellLevel: 1,
    slotScaling: {
      2: { dicePools: { phys: {}, elem1: {}, elem2: {} }, healPool: { dice: { d8: 3 }, bonus: 4 } },
      3: { dicePools: { phys: {}, elem1: {}, elem2: {} }, healPool: { dice: { d8: 4 }, bonus: 5 } }
    },
    dicePools: { phys: {}, elem1: {}, elem2: {} },
    statusEffectsToApply: [DEFAULT_STATUS_PRESETS[5]], // Kutsanmış
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    isAoe: false,
    aoeRadius: 1,
    description: '2d8+3 Can Yeniler. Hedefe doğrudan şifa basar ve Kutsanmış (+2 AC) etkisi uygular.'
  },
  {
    id: 'atk_preset_vampiric_touch',
    name: 'Vampirik Dokunuş / Can Çalma',
    stat: 'INT',
    attackType: 'spell',
    physicalDamageType: 'magic',
    actionNature: 'hybrid',
    healPool: { dice: { d4: 1 }, bonus: 2 },
    healTarget: 'self',
    lifestealPercent: 100,
    spellLevel: 1,
    consumesSpellSlot: true,
    baseSpellLevel: 1,
    slotScaling: {},
    dicePools: { phys: { dice: { d6: 2 }, bonus: 2 } },
    statusEffectsToApply: [DEFAULT_STATUS_PRESETS[6]], // Yaşam Çalma
    halfDamageOnMiss: true,
    extraDamage: 0,
    attackCount: 1,
    isAoe: false,
    aoeRadius: 1,
    description: '2d6+2 Nekrotik Hasar verir. Vurulan hasarın %100\'ü kadar can çalar + 1d4+2 can ile saldıranı yeniler.'
  },
  {
    id: 'atk_preset_siphon_life',
    name: 'Ruh Sömürüsü',
    stat: 'CHR',
    attackType: 'spell',
    physicalDamageType: 'magic',
    actionNature: 'hybrid',
    healPool: { dice: { d6: 1 }, bonus: 2 },
    healTarget: 'self',
    lifestealPercent: 50,
    spellLevel: 1,
    consumesSpellSlot: false,
    baseSpellLevel: 1,
    slotScaling: {},
    dicePools: { phys: { dice: { d8: 1 }, bonus: 2 } },
    statusEffectsToApply: [],
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    isAoe: false,
    aoeRadius: 1,
    description: '1d8+2 Hasar vurur, hasarın %50\'si + 1d6+2 can saldıranın canına eklenir.'
  },
  {
    id: 'atk_preset_regen_prayer',
    name: 'Yenilenme Duası',
    stat: 'WIS',
    attackType: 'spell',
    physicalDamageType: 'magic',
    actionNature: 'heal',
    healPool: { dice: { d4: 2 }, bonus: 2 },
    healTarget: 'target',
    lifestealPercent: 0,
    spellLevel: 1,
    consumesSpellSlot: true,
    baseSpellLevel: 1,
    slotScaling: {},
    dicePools: { phys: {}, elem1: {}, elem2: {} },
    statusEffectsToApply: [DEFAULT_STATUS_PRESETS[4]], // Yenilenme (Rejenerasyon HoT)
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    isAoe: false,
    aoeRadius: 1,
    description: '2d4+2 Anlık can yeniler ve 3 tur boyunca her tur can basan Yenilenme (HoT) etkisi uygular.'
  }
];

const DEFAULT_TOKEN_PRESETS = [
  {
    id: 'tp_goblin_raider',
    name: 'Goblin Akıncı',
    imgUrl: '',
    color: '#22c55e',
    hp: 14,
    maxHp: 14,
    size: 50,
    ac: 13,
    acBonus: 0,
    stats: { str: 8, str_bonus: 0, dex: 14, dex_bonus: 2, con: 10, con_bonus: 0, int: 10, int_bonus: 0, wis: 8, wis_bonus: 0, chr: 8, chr_bonus: 0 },
    hasDarkness: false,
    darkness: 0,
    maxDarkness: 100,
    assignedAttacks: ['atk_preset_flame_sword'],
    objectType: 'creature',
    objectConfig: null
  },
  {
    id: 'tp_skeleton_guard',
    name: 'İskelet Muhafız',
    imgUrl: '',
    color: '#94a3b8',
    hp: 18,
    maxHp: 18,
    size: 50,
    ac: 12,
    acBonus: 0,
    stats: { str: 10, str_bonus: 0, dex: 14, dex_bonus: 2, con: 12, con_bonus: 1, int: 6, int_bonus: 0, wis: 8, wis_bonus: 0, chr: 5, chr_bonus: 0 },
    hasDarkness: false,
    darkness: 0,
    maxDarkness: 100,
    assignedAttacks: [],
    objectType: 'creature',
    objectConfig: null
  },
  {
    id: 'tp_spawner_nest',
    name: 'Karanlık Canavar Yuvası',
    imgUrl: '',
    color: '#10b981',
    hp: 45,
    maxHp: 45,
    size: 75,
    ac: 11,
    acBonus: 0,
    stats: { str: 10, str_bonus: 0, dex: 10, dex_bonus: 0, con: 10, con_bonus: 0, int: 10, int_bonus: 0, wis: 10, wis_bonus: 0, chr: 10, chr_bonus: 0 },
    hasDarkness: false,
    darkness: 0,
    maxDarkness: 100,
    assignedAttacks: [],
    objectType: 'spawner',
    objectConfig: {
      spawnPresetId: 'tp_goblin_raider',
      spawnCount: 1,
      spawnRadius: 85,
      spawnTiming: 'turn',
      destroyOnBreak: true,
      totalSpawnedSoFar: 0
    }
  }
];

// === ATTACK PRESETS RESTORE ===
async function restoreAttackPresets() {
  try {
    const { data, error } = await supabase
      .from('attack_presets')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(10000);

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Attack presets yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('attack_presets tablosu henüz veritabanında oluşturulmamış.');
      }
      attackPresets = [...DEFAULT_ATTACK_PRESETS];
      return;
    }

    if (data && data.length > 0) {
      const dbPresets = data.map(row => {
        const slotConfig = row.dice_pools?._spellSlotConfig || {};
        const healCfg = row.heal_config || row.dice_pools?._healConfig || {};
        return {
          id: row.id,
          name: row.name,
          stat: row.stat || 'STR',
          attackType: row.attack_type || row.attackType || 'physical',
          physicalDamageType: row.dice_pools?._meta?.physicalDamageType || row.physical_damage_type || 'slashing',
          actionNature: row.action_nature || healCfg.actionNature || 'damage',
          healPool: row.heal_pool || healCfg.healPool || null,
          healTarget: row.heal_target || healCfg.healTarget || (healCfg.actionNature === 'heal' ? 'target' : 'self'),
          lifestealPercent: clampNumber(parseInt(row.lifesteal_percent ?? healCfg.lifestealPercent) || 0, 0, 100),
          spellLevel: row.spell_level ?? row.spellLevel ?? 1,
          consumesSpellSlot: Boolean(row.consumes_spell_slot ?? row.consumesSpellSlot ?? slotConfig.consumesSpellSlot),
          baseSpellLevel: clampNumber(parseInt(row.base_spell_level ?? row.baseSpellLevel ?? slotConfig.baseSpellLevel) || (row.spell_level ?? 1), 1, 4),
          slotScaling: row.slot_scaling || row.slotScaling || slotConfig.slotScaling || {},
          dicePools: row.dice_pools || row.dicePools || { phys: {}, elem1: {}, elem2: {} },
          statusEffectsToApply: Array.isArray(row.status_effects_to_apply) ? row.status_effects_to_apply : (Array.isArray(row.statusEffectsToApply) ? row.statusEffectsToApply : []),
          halfDamageOnMiss: Boolean(row.half_damage_on_miss ?? row.halfDamageOnMiss),
          extraDamage: row.extra_damage ?? row.extraDamage ?? 0,
          attackCount: row.attack_count ?? row.attackCount ?? 1,
          isAoe: Boolean(row.is_aoe ?? row.isAoe ?? row.dice_pools?._aoe?.isAoe),
          aoeRadius: parseFloat(row.aoe_radius ?? row.aoeRadius ?? row.dice_pools?._aoe?.radius) || 1,
          description: row.description || ''
        };
      });

      // Eksik varsayılanları da ekle
      DEFAULT_ATTACK_PRESETS.forEach(def => {
        if (!dbPresets.some(p => p.id === def.id || p.name === def.name)) {
          dbPresets.push(def);
        }
      });

      attackPresets = dbPresets;
      console.log(`Supabase'den ${attackPresets.length} adet saldırı preseti başarıyla yüklendi.`);
    } else {
      attackPresets = [...DEFAULT_ATTACK_PRESETS];
      console.log(`Varsayılan ${attackPresets.length} adet hazır saldırı & şifa preseti başlatıldı.`);
    }
  } catch (err) {
    console.error('Attack presets geri yüklenirken beklenmeyen hata:', err.message);
    if (attackPresets.length === 0) attackPresets = [...DEFAULT_ATTACK_PRESETS];
  }
}

// === STATUS PRESETS RESTORE ===
async function restoreStatusPresets() {
  try {
    const { data, error } = await supabase
      .from('status_presets')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Status presets yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('status_presets tablosu henüz veritabanında oluşturulmamış.');
      }
      customStatusPresets = [...DEFAULT_STATUS_PRESETS];
      return;
    }

    if (data && data.length > 0) {
      const dbPresets = data.map(row => ({
        id: row.id,
        name: row.name,
        icon: row.icon || '✨',
        duration: row.duration != null ? row.duration : null,
        effects: row.effects || {}
      }));

      DEFAULT_STATUS_PRESETS.forEach(def => {
        if (!dbPresets.some(p => p.id === def.id || p.name === def.name)) {
          dbPresets.push(def);
        }
      });

      customStatusPresets = dbPresets;
      console.log(`Supabase'den ${customStatusPresets.length} adet durum efekti preseti başarıyla yüklendi.`);
    } else {
      customStatusPresets = [...DEFAULT_STATUS_PRESETS];
      console.log(`Varsayılan ${customStatusPresets.length} adet durum efekti başlatıldı.`);
    }
  } catch (err) {
    console.error('Status presets geri yüklenirken beklenmeyen hata:', err.message);
    if (customStatusPresets.length === 0) customStatusPresets = [...DEFAULT_STATUS_PRESETS];
  }
}

// === TOKEN PRESETS RESTORE ===
async function restoreTokenPresets() {
  try {
    const { data, error } = await supabase
      .from('token_presets')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(10000);

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Token presets yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('token_presets tablosu henüz veritabanında oluşturulmamış.');
      }
      tokenPresets = [...DEFAULT_TOKEN_PRESETS];
      return;
    }

    if (data && data.length > 0) {
      const dbPresets = data.map(row => ({
        id: row.id,
        name: row.name,
        imgUrl: row.img_url || '',
        color: row.color || '#f1c40f',
        hp: row.hp != null ? row.hp : null,
        maxHp: row.max_hp != null ? row.max_hp : null,
        size: row.size || 50,
        ac: row.ac != null ? row.ac : 10,
        acBonus: row.ac_bonus != null ? row.ac_bonus : 0,
        stats: row.stats || {
          str: 10, str_bonus: 0,
          dex: 10, dex_bonus: 0,
          int: 10, int_bonus: 0,
          con: 10, con_bonus: 0,
          wis: 10, wis_bonus: 0,
          chr: 10, chr_bonus: 0
        },
        hasDarkness: Boolean(row.has_darkness),
        darkness: row.darkness || 0,
        maxDarkness: row.max_darkness || 100,
        assignedAttacks: Array.isArray(row.assigned_attacks) ? row.assigned_attacks : [],
        objectType: row.object_type || 'creature',
        objectConfig: row.object_config || null,
        createdAt: row.created_at
      }));

      DEFAULT_TOKEN_PRESETS.forEach(def => {
        if (!dbPresets.some(p => p.id === def.id || p.name === def.name)) {
          dbPresets.push(def);
        }
      });

      tokenPresets = dbPresets;
      console.log(`Supabase'den ${tokenPresets.length} adet token şeması (preset) başarıyla yüklendi.`);
    } else {
      tokenPresets = [...DEFAULT_TOKEN_PRESETS];
      console.log(`Varsayılan ${tokenPresets.length} adet token şeması (Yuva / Yaratık) başlatıldı.`);
    }
  } catch (err) {
    console.error('Token presets geri yüklenirken beklenmeyen hata:', err.message);
    if (tokenPresets.length === 0) tokenPresets = [...DEFAULT_TOKEN_PRESETS];
  }
}

// === SESSION CACHE TEMİZLİĞİ ===
function cleanupSessionCache() {
  const now = Date.now();
  for (const key of Object.keys(sessionCache)) {
    if (now - (sessionCache[key].cachedAt || 0) > SESSION_CACHE_TTL_MS) {
      delete sessionCache[key];
    }
  }
}

// Periyodik görevler
setInterval(backupMapState, BACKUP_INTERVAL_MS);
setInterval(cleanupSessionCache, 60 * 60 * 1000); // Her saat cache temizliği

const PORT = process.env.PORT || 3000;

// Sunucu başlamadan önce durumları geri yükle
Promise.all([restoreMapState(), restoreAttackPresets(), restoreStatusPresets(), restoreTokenPresets()]).then(() => {
  server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
  });
});