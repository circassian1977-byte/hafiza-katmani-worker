// Hafıza Katmanı - Cloudflare Worker (her zaman açık uç)
//
// NEDEN VAR: platformlar (claude.ai, ChatGPT, Grok) bağlayıcı olarak TEK bir
// sabit adrese bağlanır. O adres bugüne kadar kullanıcının bilgisayarındaki
// geçici Cloudflare tüneliydi - bilgisayar kapanınca adres de kaybolurdu,
// telefondan yazılan hiçbir şey işlenemezdi. Bu worker o sabit adres oluyor:
// Cloudflare'in kendi altyapısında, 7/24 açık, kullanıcının ücretsiz kendi
// hesabında çalışıyor (bizim sunucumuz DEĞİL).
//
// NASIL ÇALIŞIR (vekil + yedek düzeni):
//   1) Bilgisayar açıksa: worker isteği doğrudan bilgisayardaki gerçek
//      sunucuya (o anki tünel adresine) iletir (proxy). Cevap oradan gelir,
//      yani arama/filtreleme gibi tüm zengin mantık aynen çalışır.
//   2) Bilgisayar kapalıysa/tünel cevap vermiyorsa: worker isteği KENDİSİ,
//      D1 veritabanındaki YANSIMA (en son bilinen kart halleri) üzerinden
//      cevaplar; yazma istekleri "bekleyenler" kuyruğuna eklenir.
//   3) Bilgisayar tekrar açılınca kendi programı /bekleyenler'i çeker,
//      gerçek veritabanına işler, kuyruğu temizler.
//
// Kaynak veritabanı HER ZAMAN bilgisayardaki SQLite'tır. Bu worker'daki D1
// sadece bir ayna + geçici kuyruk, asla tek başına "doğru" kabul edilmez.

function jetonEsitMi(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

function jetonDogrula(req, url, env) {
  const dogru = (env.HAFIZA_JETON || '').trim();
  if (!dogru) return false;
  const baslik = req.headers.get('authorization') || '';
  if (baslik.toLowerCase().startsWith('bearer ')) {
    if (jetonEsitMi(baslik.slice(7).trim(), dogru)) return true;
  }
  const parcalar = url.pathname.split('/').filter(Boolean);
  const sonParca = parcalar[parcalar.length - 1];
  if (sonParca && jetonEsitMi(sonParca, dogru)) return true;
  return false;
}

function jsonYanit(gövde, durum = 200) {
  return new Response(JSON.stringify(gövde), {
    status: durum,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonRpcHata(id, kod, mesaj, durum = 200) {
  return jsonYanit({ jsonrpc: '2.0', id: id ?? null, error: { code: kod, message: mesaj } }, durum);
}

function jsonRpcSonuc(id, sonuc) {
  return jsonYanit({ jsonrpc: '2.0', id: id ?? null, result: sonuc });
}

function aracMetni(metin) {
  return { content: [{ type: 'text', text: metin }] };
}

const ARAC_TANIMLARI = [
  {
    name: 'durumu_guncelle',
    description:
      'Bir proje/konu hakkındaki güncel duruma TEK cümlelik/kısa bir gelişme ekler (ucuz, hızlı yazma). Kartın tamamını yeniden yazmaz, sadece "SON GELİŞMELER" bölümüne ekler.',
    inputSchema: {
      type: 'object',
      properties: {
        konu: { type: 'string', description: 'Konunun/projenin adı - TEKİL anahtar.' },
        gelisme: { type: 'string', description: 'Eklenecek kısa gelişme/not.' },
        etiketler: { type: 'array', items: { type: 'string' } },
      },
      required: ['konu', 'gelisme'],
    },
  },
  {
    name: 'durumu_kaydet',
    description:
      'Bir proje/konu hakkındaki GÜNCEL DURUMU kalıcı olarak yazar - aynı konuda kart varsa üstüne yazar.',
    inputSchema: {
      type: 'object',
      properties: {
        konu: { type: 'string' },
        icerik: { type: 'string' },
        etiketler: { type: 'array', items: { type: 'string' } },
      },
      required: ['konu', 'icerik'],
    },
  },
  {
    name: 'hafizaya_sor',
    description:
      'Kullanıcının kendisi, projeleri, tercihleri, kararları hakkında soru sorulduğunda İLK OLARAK çağrılmalı.',
    inputSchema: {
      type: 'object',
      properties: { sorgu: { type: 'string' } },
      required: ['sorgu'],
    },
  },
  {
    name: 'hatirla',
    description: 'Kullanıcı hakkında ileride hatırlanmaya değer TEK bir bilgiyi kaydeder.',
    inputSchema: {
      type: 'object',
      properties: {
        baslik: { type: 'string' },
        icerik: { type: 'string' },
        etiketler: { type: 'array', items: { type: 'string' } },
      },
      required: ['baslik', 'icerik'],
    },
  },
  {
    name: 'ham_kaydet',
    description:
      'hatirla/durumu_kaydet\'ten farklı: filtresiz/ham içerik (uzun kod, tam gerekçe) için - context sıkışıp özetlenmeden (compaction) önce kayıp riskini azaltmak amacıyla, üzerine yazmadan doğrudan ham_log\'a ekler.',
    inputSchema: {
      type: 'object',
      properties: {
        baslik: { type: 'string' },
        icerik: { type: 'string' },
        etiketler: { type: 'array', items: { type: 'string' } },
      },
      required: ['baslik', 'icerik'],
    },
  },
];

async function pcYeAyna(env, govdeMetni, jeton) {
  const adresSatiri = await env.DB.prepare('SELECT deger FROM ayarlar WHERE anahtar = ?')
    .bind('pc_adresi')
    .first();
  if (!adresSatiri || !adresSatiri.deger) return null;
  const hedef = `${adresSatiri.deger.replace(/\/+$/, '')}/mcp/${jeton}`;
  try {
    const cevap = await fetch(hedef, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: govdeMetni,
      signal: AbortSignal.timeout(4500),
    });
    if (!cevap.ok) return null;
    return cevap;
  } catch {
    return null; // bilgisayar kapalı ya da tünel çökmüş - yerel yedeğe düş
  }
}

async function bekleyenEkle(env, tur, veri) {
  await env.DB.prepare('INSERT INTO bekleyenler (tur, veri, zaman) VALUES (?, ?, ?)')
    .bind(tur, JSON.stringify(veri), new Date().toISOString())
    .run();
}

async function kartYansimasiOku(env, konu) {
  return env.DB.prepare('SELECT * FROM kartlar_yansima WHERE konu = ?').bind(konu).first();
}

async function kartYansimasiAra(env, sorgu) {
  const s = `%${sorgu.trim()}%`;
  const { results } = await env.DB.prepare(
    'SELECT * FROM kartlar_yansima WHERE konu LIKE ? OR icerik LIKE ? ORDER BY zaman DESC LIMIT 3'
  )
    .bind(s, s)
    .all();
  return results || [];
}

async function hamLogAra(env, sorgu) {
  const s = `%${sorgu.trim()}%`;
  const { results } = await env.DB.prepare(
    'SELECT * FROM ham_log WHERE baslik LIKE ? OR icerik LIKE ? ORDER BY id DESC LIMIT 3'
  )
    .bind(s, s)
    .all();
  return results || [];
}

async function yerelAracCagrisi(env, ad, girdi) {
  if (ad === 'durumu_guncelle') {
    const { konu, gelisme, etiketler = [] } = girdi;
    if (!konu || !gelisme) return aracMetni('Hata: konu ve gelisme zorunlu.');
    await bekleyenEkle(env, 'durumu_guncelle', { konu, gelisme, etiketler });
    const mevcut = await kartYansimasiOku(env, konu);
    const eklenecek = `\n- (${new Date().toISOString().slice(0, 10)}, bilgisayar KAPALIYKEN eklendi, henüz senkron değil) ${gelisme}`;
    const yeniIcerik = mevcut ? mevcut.icerik + eklenecek : `SON GELİŞMELER (birleştirilmeyi bekliyor)${eklenecek}`;
    await env.DB.prepare(
      'INSERT INTO kartlar_yansima (konu, icerik, etiketler, zaman) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(konu) DO UPDATE SET icerik = excluded.icerik, zaman = excluded.zaman'
    )
      .bind(konu, yeniIcerik, JSON.stringify(etiketler), new Date().toISOString())
      .run();
    return aracMetni(
      `Not alındı: "${konu}" kartına eklendi. Bilgisayar şu an erişilemez durumda - bu bilgi bilgisayar açılınca gerçek karta işlenecek, o zamana kadar geçici bir yansıma olarak tutuluyor.`
    );
  }

  if (ad === 'durumu_kaydet') {
    const { konu, icerik, etiketler = [] } = girdi;
    if (!konu || !icerik) return aracMetni('Hata: konu ve icerik zorunlu.');
    await bekleyenEkle(env, 'durumu_kaydet', { konu, icerik, etiketler });
    await env.DB.prepare(
      'INSERT INTO kartlar_yansima (konu, icerik, etiketler, zaman) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(konu) DO UPDATE SET icerik = excluded.icerik, etiketler = excluded.etiketler, zaman = excluded.zaman'
    )
      .bind(konu, icerik, JSON.stringify(etiketler), new Date().toISOString())
      .run();
    return aracMetni(
      `Kaydedildi: "${konu}" (geçici yansıma). Bilgisayar erişilemez durumda - bilgisayar açılınca gerçek veritabanına işlenecek.`
    );
  }

  if (ad === 'hatirla') {
    const { baslik, icerik, etiketler = [] } = girdi;
    if (!baslik || !icerik) return aracMetni('Hata: baslik ve icerik zorunlu.');
    await bekleyenEkle(env, 'hatirla', { baslik, icerik, etiketler });
    // durumu_guncelle/durumu_kaydet gibi anlık bir yansıma da bırakılıyor,
    // yoksa bilgisayar açılana kadar hafizaya_sor bu notu hiç bulamaz.
    await env.DB.prepare(
      'INSERT INTO kartlar_yansima (konu, icerik, etiketler, zaman) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(konu) DO UPDATE SET icerik = excluded.icerik, etiketler = excluded.etiketler, zaman = excluded.zaman'
    )
      .bind(baslik, icerik, JSON.stringify(etiketler), new Date().toISOString())
      .run();
    return aracMetni(
      `Not alındı: "${baslik}". Bilgisayar erişilemez durumda - bilgisayar açılınca kalıcı hafızaya işlenecek.`
    );
  }

  if (ad === 'hafizaya_sor') {
    const { sorgu = '' } = girdi;
    const sonuclar = await kartYansimasiAra(env, sorgu);
    if (sonuclar.length) {
      const metin = sonuclar
        .map((k) => `### ${k.konu} (yansıma, son güncelleme: ${k.zaman})\n${k.icerik}`)
        .join('\n\n');
      return aracMetni(
        `[BİLGİSAYAR ŞU AN ERİŞİLEMEZ - bu, en son bilgisayar açıkken kaydedilmiş yansımadır, güncel olmayabilir]\n\n${metin}`
      );
    }

    const hamSonuclar = await hamLogAra(env, sorgu);
    if (!hamSonuclar.length) {
      return aracMetni(
        `"${sorgu}" için kayıtlı bir kart veya ham kayıt bulunamadı (not: bilgisayar şu an erişilemez durumda, bu yalnızca son bilinen yansımadır, tam arşiv değildir).`
      );
    }
    const hamMetin = hamSonuclar
      .map((k) => `### ${k.baslik} (ham_log, ${k.zaman})\n${k.icerik}`)
      .join('\n\n');
    return aracMetni(
      `[BİLGİSAYAR ŞU AN ERİŞİLEMEZ - kart bulunamadı, ham_log yedeğinden gösteriliyor]\n\n${hamMetin}`
    );
  }

  if (ad === 'ham_kaydet') {
    const { baslik, icerik, etiketler = [] } = girdi;
    if (!baslik || !icerik) return aracMetni('Hata: baslik ve icerik zorunlu.');
    await env.DB.prepare('INSERT INTO ham_log (baslik, icerik, etiketler, zaman) VALUES (?, ?, ?, ?)')
      .bind(baslik, icerik, JSON.stringify(etiketler), new Date().toISOString())
      .run();
    return aracMetni(`Ham kayıt alındı: "${baslik}" - filtresiz olarak ham_log'a yazıldı.`);
  }

  return aracMetni(`Bilinmeyen araç: ${ad}`);
}

async function mcpIstegiIsle(govdeMetni, env, jeton) {
  let govde;
  try {
    govde = JSON.parse(govdeMetni);
  } catch {
    return jsonRpcHata(null, -32700, 'Geçersiz JSON');
  }
  const { id, method, params } = govde;

  if (method === 'initialize') {
    return jsonRpcSonuc(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'hafiza-katmani-worker', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized') {
    return new Response(null, { status: 202 });
  }
  if (method === 'tools/list') {
    return jsonRpcSonuc(id, { tools: ARAC_TANIMLARI });
  }
  if (method === 'tools/call') {
    const ad = params?.name;
    const girdi = params?.arguments || {};

    // ham_kaydet PC'nin açık olup olmamasından bağımsız çalışır - vekilliğe
    // gerek yok, her zaman doğrudan Worker'daki D1'e (ham_log) yazılır.
    if (ad === 'ham_kaydet') {
      const sonuc = await yerelAracCagrisi(env, ad, girdi);
      return jsonRpcSonuc(id, sonuc);
    }

    const vekilCevap = await pcYeAyna(env, govdeMetni, jeton);
    if (vekilCevap) return vekilCevap;

    const sonuc = await yerelAracCagrisi(env, ad, girdi);
    return jsonRpcSonuc(id, sonuc);
  }

  return jsonRpcHata(id, -32601, `Bilinmeyen method: ${method}`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (!jetonDogrula(req, url, env)) {
      return jsonRpcHata(null, -32001, 'Yetkisiz: geçerli bir jeton gerekli', 401);
    }
    const parcalar = url.pathname.split('/').filter(Boolean);
    const jeton = env.HAFIZA_JETON;

    if (req.method === 'POST' && parcalar[0] === 'mcp') {
      const govdeMetni = await req.text();
      return mcpIstegiIsle(govdeMetni, env, jeton);
    }

    if (req.method === 'POST' && parcalar[0] === 'kayit') {
      const { adres } = await req.json().catch(() => ({}));
      if (!adres) return jsonYanit({ hata: 'adres zorunlu' }, 400);
      await env.DB.prepare(
        'INSERT INTO ayarlar (anahtar, deger) VALUES (?, ?) ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger'
      )
        .bind('pc_adresi', adres)
        .run();
      return jsonYanit({ kaydedildi: true });
    }

    if (req.method === 'GET' && parcalar[0] === 'bekleyenler') {
      const { results } = await env.DB.prepare(
        'SELECT id, tur, veri, zaman FROM bekleyenler WHERE uygulandi = 0 ORDER BY id ASC'
      ).all();
      return jsonYanit({ bekleyenler: results || [] });
    }

    if (req.method === 'POST' && parcalar[0] === 'bekleyenler-temizle') {
      const { idler } = await req.json().catch(() => ({ idler: [] }));
      if (Array.isArray(idler) && idler.length) {
        const yerTutucular = idler.map(() => '?').join(',');
        await env.DB.prepare(`UPDATE bekleyenler SET uygulandi = 1 WHERE id IN (${yerTutucular})`)
          .bind(...idler)
          .run();
      }
      return jsonYanit({ temizlendi: true });
    }

    if (req.method === 'POST' && parcalar[0] === 'yansit') {
      const { konu, icerik, etiketler = [] } = await req.json().catch(() => ({}));
      if (!konu || !icerik) return jsonYanit({ hata: 'konu ve icerik zorunlu' }, 400);
      await env.DB.prepare(
        'INSERT INTO kartlar_yansima (konu, icerik, etiketler, zaman) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(konu) DO UPDATE SET icerik = excluded.icerik, etiketler = excluded.etiketler, zaman = excluded.zaman'
      )
        .bind(konu, icerik, JSON.stringify(etiketler), new Date().toISOString())
        .run();
      return jsonYanit({ yansitildi: true });
    }

    if (req.method === 'POST' && parcalar[0] === 'ham-log-ekle') {
      const { baslik, icerik, etiketler = [] } = await req.json().catch(() => ({}));
      if (!baslik || !icerik) return jsonYanit({ hata: 'baslik ve icerik zorunlu' }, 400);
      await env.DB.prepare('INSERT INTO ham_log (baslik, icerik, etiketler, zaman) VALUES (?, ?, ?, ?)')
        .bind(baslik, icerik, JSON.stringify(etiketler), new Date().toISOString())
        .run();
      return jsonYanit({ eklendi: true });
    }

    if (req.method === 'GET' && parcalar[0] === 'ham-log-cek') {
      const { results } = await env.DB.prepare(
        'SELECT id, baslik, icerik, etiketler, zaman FROM ham_log ORDER BY id ASC'
      ).all();
      return jsonYanit({ kayitlar: results || [] });
    }

    return jsonYanit({ hata: 'bulunamadi' }, 404);
  },
};
