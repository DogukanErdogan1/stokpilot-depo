# StokPilot — uygulama ve API

StokPilot arayüzünü ve TypeScript API'sini aynı Node.js sunucusunda çalıştırır. Ürün, depo, stok bakiyesi ve hareket kayıtları SQLite veritabanında tutulur. Arayüz kayıtları tarayıcı deposuna yazmaz.

## Gereksinimler

- Node.js 22 veya üzeri
- İlk yönetici hesabı için `ADMIN_EMAIL` ve en az 12 karakterli `ADMIN_PASSWORD`

## Yerel çalıştırma

```powershell
Copy-Item .env.example .env
```

`.env` içindeki yönetici e-postasını ve parolasını kendine göre değiştir. Sonra proje kökünden:

```bash
npm install
npm run sync:ui
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini aç. İlk başlatmada yönetici hesabı ve ona özel çalışma alanı oluşturulur; parola SQLite'ta scrypt özeti olarak saklanır. Kullanıcı kaydı açık değildir. Var olan yönetici hesabının parolası `.env` değiştirilerek otomatik sıfırlanmaz.

İsteğe bağlı ayrı demo hesabı oluşturmak için `DEMO_EMAIL` ve `DEMO_PASSWORD` değerlerini birlikte tanımlayın. İlk başlatmada demo hesabı, kendi çalışma alanı ve örnek ürün, depo, stok bakiyesi ve hareket kayıtlarıyla oluşturulur. Demo kullanıcısı yönetici hesabının kayıtlarını göremez; tekrar başlatmak mevcut parolayı değiştirmez.

Yerel ortamda mevcut ilk kullanıcının çalışma alanına örnek kayıt eklemek için API klasöründe `npm run seed:demo` çalıştır. Komut production ortamında çalıştırılmaz.

Parolayı değiştirmek için `.env` içindeki `ADMIN_EMAIL` ve `ADMIN_PASSWORD` değerlerini güncelle, `npm run build` çalıştır ve `npm run admin:reset` komutunu bir kez yürüt. Bu işlem etkin oturumları kapatır.

Bun ile geliştirme sunucusu: `bun install` ve `bun run dev:bun`.

## Dağıtım

Proje Docker ile paketlenebilir:

```bash
npm run sync:ui
docker compose up --build
```

Canlı ortamda HTTPS sunan bir ters proxy/hosting kullan. `NODE_ENV=production`, `PUBLIC_ORIGIN=https://uygulama-adresin`, `ADMIN_EMAIL` ve güçlü `ADMIN_PASSWORD` değerlerini hosting'in gizli değişkenlerinde tanımla. SQLite dosyasının bulunduğu `/data` dizinini kalıcı diske bağla; geçici konteyner diskinde tutulan veriler yeniden dağıtımda kaybolabilir. `TRUST_PROXY=true` değerini yalnızca istekleri güvendiğin ters proxy iletiyorsa kullan.

Arayüz ve `/api` aynı origin üzerinden sunulur. Bu, oturum çerezinin üçüncü taraf çerezine dönüşmesini önler. Bu nedenle statik Sites yayını tek başına bu Node.js API'sini çalıştırmaz; canlı kullanım için kalıcı disk sunan Node/Docker hosting gerekir.

## Oturum güvenliği

- Oturum anahtarı `HttpOnly`, `SameSite=Strict` çerezde taşınır; sunucuda yalnızca SHA-256 özeti saklanır.
- Parolalar scrypt ile özetlenir; giriş denemeleri IP başına sınırlandırılır.
- Her envanter API rotası geçerli oturum ister. Kayıt veya arşivleme kuralları sunucuda da doğrulanır.
- Yeni kullanıcı kaydı yoktur. İlk yönetici `.env`/hosting gizli değişkenleriyle kurulur.

## API

- `GET /health` — dağıtım sağlık kontrolü
- `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/logout` — oturum
- `/api/products`, `/api/warehouses` — ürün ve depo yönetimi
- `/api/inventory`, `/api/stock-movements` — stok bakiyesi ve hareket geçmişi
- `POST /api/stock-movements`, `POST /api/inventory/adjustments`, `POST /api/transfers` — atomik stok işlemleri

Envanter uçları oturum çereziyle korunur. Giriş örneği: `{ "email": "...", "password": "..." }`. Ayrıntılı stok istek alanları kaynak kodundaki Zod şemalarında tanımlıdır.

## Yedekleme

Canlı SQLite dosyasını düzenli olarak kalıcı disk dışına yedekle. Yedek alırken SQLite'ın tutarlı bir snapshot oluşturduğundan emin ol; yalnızca ana `.sqlite` dosyasını uygulama çalışırken kopyalama.

## Sayfalama

Ürünler, stok durumu ve hareket geçmişi sunucuda sayfalanır. Örnek: `GET /api/products?page=2&pageSize=25&q=usb&sort=name`. `pageSize` 1–100 arasında, varsayılan 25'tir. Yanıt biçimi `{ items: [...], pagination: { page, pageSize, total, totalPages, hasNext, hasPrevious } }` şeklindedir. Eski doğrudan dizi yanıtını kullanan istemciler `items` alanına geçmelidir.

Arama, kategori, depo, stok durumu, maliyet/miktar/depo sayısı sınırları ve sıralama veritabanında, sayfa seçilmeden önce uygulanır. `q` ürün adı/SKU/kategori arar; hareketlerde depo ve açıklama da aranır. Eşit değerler ürün ve depo kimliğiyle kararlı sıralanır. Geçersiz sayfa boyutu veya aralıklar 400 döndürür; son sayfayı aşan istek son geçerli sayfaya alınır.

`GET /api/overview` toplamları, depo özetlerini, en fazla sekiz stok uyarısını ve beş son hareketi döndürür. Ürün seçici her istekte 20 sonuç getirir. `GET /api/export?view=inventory` (veya `products`, `movements`) aynı filtrelere uyan bütün kayıtları CSV olarak 500 satırlık parçalarla gönderir; ekranın sayfa boyutu dışa aktarımı sınırlandırmaz.

`npm test` derlemeyi, geçici test veritabanında 10.000 ürünlük API kontrollerini ve arayüzün istek/sayfalama kontrollerini çalıştırır. Gerçek uygulama veritabanını kullanmaz.
