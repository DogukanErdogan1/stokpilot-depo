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

Tarayıcıda `http://localhost:3000` adresini aç. İlk başlatmada yönetici hesabı oluşturulur; parola SQLite'ta scrypt özeti olarak saklanır. Kullanıcı kaydı açık değildir ve varsayılan demo hesabı yoktur. Var olan yönetici hesabının parolası `.env` değiştirilerek otomatik sıfırlanmaz.

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
