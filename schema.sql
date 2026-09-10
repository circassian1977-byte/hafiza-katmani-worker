CREATE TABLE IF NOT EXISTS kartlar_yansima (
  konu TEXT PRIMARY KEY,
  icerik TEXT,
  etiketler TEXT,
  zaman TEXT
);

CREATE TABLE IF NOT EXISTS bekleyenler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tur TEXT NOT NULL,
  veri TEXT NOT NULL,
  zaman TEXT NOT NULL,
  uygulandi INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ayarlar (
  anahtar TEXT PRIMARY KEY,
  deger TEXT
);

-- Filtresiz/ham kayıtlar (ham_kaydet aracı) - context sıkışıp özetlenmeden
-- önce kayıp riskini azaltmak için; hatirla/durumu_kaydet'ten farklı olarak
-- üzerine yazılmaz, sadece eklenir.
CREATE TABLE IF NOT EXISTS ham_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  baslik TEXT,
  icerik TEXT,
  etiketler TEXT,
  zaman TEXT NOT NULL
);
