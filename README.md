# StokPilot

StokPilot, ürünleri, depoları ve stok hareketlerini yönetmek için Türkçe bir envanter panelidir. Web arayüzü ve sunucu API'si bu depoda birlikte bulunur.

## Özellikler

- Ürün ve depo kaydı, düzenleme ve arşivleme
- Stok giriş/çıkışı, sayım düzeltmesi ve depo transferi
- Hareket geçmişi, arama ve CSV dışa aktarma
- Sunucu tarafında parola özeti, oturum ve API yetkilendirmesi
- SQLite ile kalıcı veri; Docker dağıtımında kalıcı `/data` diski

## Yerelde çalıştırma

Node.js 22 veya üzeri gerekir. `stock-warehouse-api` klasöründe:

```bash
cp .env.example .env
```

`.env` içinde `ADMIN_EMAIL` ve en az 12 karakterli `ADMIN_PASSWORD` belirle, sonra:

```bash
npm ci
npm run sync:ui
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır. Windows PowerShell'de `.env.example` dosyasını `.env` olarak kopyalayabilirsin. `dist/index.html` dosyasını doğrudan `file://` üzerinden açmak API bağlantısı sağlamaz.

## Docker dağıtımı

`stock-warehouse-api` klasöründe `.env` oluşturup yönetici bilgilerini ve canlı adresi ayarla, ardından:

```bash
npm run sync:ui
docker compose up --build -d
```

Canlı hosting'de HTTPS, gizli ortam değişkenleri ve yeniden başlatmalarda korunacak kalıcı disk kullan. `DATABASE_PATH` varsayılanı `/data/inventory.sqlite` olur. Ayrıntılar için [`stock-warehouse-api/README.md`](stock-warehouse-api/README.md) dosyasına bak.

## Veri notu

Önceki tarayıcı demosunda oluşan `localStorage` kayıtları sunucu veritabanına otomatik taşınmaz. Bu sürüm yeni SQLite veritabanıyla başlar; eski demo verileri gerekiyorsa ayrı bir içe aktarma adımı gerekir. Depo, ürün ve hareket kayıtları oturum açtıktan sonra API üzerinden saklanır.

## Güvenlik

Gerçek yönetici parolasını `.env` dosyasına veya depoya commit etme. Üretimde `NODE_ENV=production`, doğru `PUBLIC_ORIGIN`, HTTPS ve güçlü yönetici parolası kullan. Bu uygulama tek yönetici hesabıyla başlar; kullanıcı kaydı ve rol tabanlı çok kullanıcılı erişim henüz yoktur.

Statik Sites yayını tek başına Node.js API'sini çalıştıramaz. API için Node.js/Docker runtime ve SQLite verisi için kalıcı disk gerekir.
