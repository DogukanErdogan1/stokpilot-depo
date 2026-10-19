# StokPilot

Türkçe stok ve depo yönetim paneli. Bu demo ürün/depo ekleme ve düzenleme, stok hareketi, sayım düzeltme, depo transferi, arşivleme, arama ve CSV dışa aktarma etkileşimlerini örnek verilerle sunar. Stok durumu depo bazında hesaplanır. Kayıtlar bu tarayıcıdaki `localStorage` alanında saklanır; Node.js API'sine henüz bağlı değildir.

## Demo hesabı

- E-posta: `demo@stokpilot.com`
- Şifre: `StokPilot2026!`

Bu giriş yalnızca arayüz demosu içindir; kimlik bilgileri tarayıcı tarafında kontrol edilir ve gerçek erişim güvenliği sağlamaz. Oturum sekme kapatılana kadar sürer. Envanter verileri `localStorage` içinde kalır. Gerçek kullanıcı hesabı, rol/izin sistemi ve sunucu tarafında veri saklama için API entegrasyonu gerekir.

## Ürün ve depo yönetimi

- Ürün ve depo bilgileri düzenlenebilir.
- Stok bakiyesi sıfır olmayan ürün veya depo arşivlenemez. Önce stok hareketleriyle bakiyeyi sıfırlamak gerekir.
- Arşivlenmiş kayıtlar varsayılan listelerde görünmez; arşiv filtresinden yeniden etkinleştirilebilir.
- Arşivleme hareket geçmişini silmez. Depo bazlı kritik stok sayımı sıfır bakiyeleri de kapsar.

## Açma

`dist/index.html` dosyasını bir tarayıcıda açabilir veya klasörü herhangi bir statik web sunucusuyla yayınlayabilirsin. Demo hesabıyla giriş yaptığında örnek depo ve ürünler açılır. Demo verilerini sıfırlamak için tarayıcıda `stokpilot-demo-v1` adlı site verisini temizle.

