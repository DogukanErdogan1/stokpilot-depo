# StokPilot

Türkçe stok ve depo yönetim paneli. Bu sürüm ürün/depo ekleme, stok hareketi, sayım düzeltme, depo transferi, arama ve CSV dışa aktarma etkileşimlerini örnek verilerle sunar. Kayıtlar bu tarayıcıdaki `localStorage` alanında saklanır; Node.js API'sine henüz bağlı değildir.

## Demo hesabı

- E-posta: `demo@stokpilot.com`
- Şifre: `StokPilot2026!`

Bu giriş yalnızca arayüz demosu içindir; kimlik bilgileri tarayıcı tarafında kontrol edilir ve gerçek erişim güvenliği sağlamaz. Oturum sekme kapatılana kadar sürer. Envanter verileri `localStorage` içinde kalır.

## Açma

`dist/index.html` dosyasını bir tarayıcıda açabilir veya klasörü herhangi bir statik web sunucusuyla yayınlayabilirsin. Demo hesabıyla giriş yaptığında örnek depo ve ürünler açılır. Demo verilerini sıfırlamak için tarayıcıda `stokpilot-demo-v1` adlı site verisini temizle.
