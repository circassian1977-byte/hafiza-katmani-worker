# Hafıza Katmanı - Worker

Hafıza Katmanı'nın "her zaman açık" ucu. Bilgisayarınız kapalıyken bile
claude.ai, ChatGPT, Grok, Perplexity gibi platformların hafızanıza
erişebilmesini sağlar.

Aşağıdaki düğmeye tıklayarak kendi ücretsiz Cloudflare hesabınıza tek
tıkla kurabilirsiniz - kod görmeniz, terminal açmanız gerekmez.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/circassian1977-byte/hafiza-katmani-worker)

## Kurulumdan sonra iki adım kaldı

1. **Jetonu ekleyin:** Worker'ın Cloudflare panelinde "Settings" → "Variables and Secrets" →
   "Add" → İsim: `HAFIZA_JETON`, Değer: bilgisayarınızdaki backend'in
   ekrana bastığı jeton. Kaydedin.
2. **Veritabanı şemasını yükleyin:** Cloudflare panelinde D1 veritabanınıza
   (hafiza-katmani-db) girin → "Console" sekmesi → bu depodaki
   `schema.sql` dosyasının içeriğini yapıştırıp çalıştırın.

Bu kadar. Worker adresiniz artık `https://hafiza-katmani-worker.<hesabiniz>.workers.dev`
şeklinde hazır olacak.
## Worker'ı güncellemek isterseniz

Bu depo zamanla düzeltme/iyileştirme alabilir. Sizin kurulumunuz, "Deploy"
düğmesiyle GitHub hesabınıza açılan bir KOPYA (fork) üzerinden çalışıyor -
bu depodaki değişiklikler oraya otomatik gitmez.

Güncellemek için: kendi fork'unuzun GitHub sayfasında "Sync fork" düğmesine
tıklayın. Cloudflare, fork'a bağlı olduğu için değişikliği görüp Worker'ınızı
otomatik yeniden dağıtır. Elle kod kopyalamanıza gerek yoktur.
