CREATE TABLE IF NOT EXISTS kartlar_yansima (
  konu TEXT PRIMARY KEY,
  baslik TEXT,
  icerik TEXT,
  son_guncelleme TEXT
);

CREATE TABLE IF NOT EXISTS bekleyenler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arac TEXT NOT NULL,
  govde TEXT NOT NULL,
  olusturulma TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ayarlar (
  anahtar TEXT PRIMARY KEY,
  deger TEXT
);
