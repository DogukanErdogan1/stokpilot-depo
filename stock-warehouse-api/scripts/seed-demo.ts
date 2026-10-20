import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/db.js";

const day = 24 * 60 * 60 * 1000;

const warehouseSeeds = [
  { code: "DEP-01", name: "Doğu Deposu", address: "Erzurum, Türkiye" },
  { code: "IST-MRK", name: "İstanbul Merkez Depo", address: "Esenyurt, İstanbul" },
  { code: "ANK-01", name: "Ankara Dağıtım Deposu", address: "Yenimahalle, Ankara" },
];

const productSeeds = [
  { sku: "KBL-USBC-1M", name: "USB-C Şarj Kablosu 1 m", category: "Kablolar", description: "Örgülü, hızlı şarj destekli USB-C kablosu.", unit: "adet", cost: 95, minimum: 20, symbol: "🔌", stock: { "DEP-01": 21, "IST-MRK": 31, "ANK-01": 14 } },
  { sku: "KBL-HDMI-2M", name: "HDMI Kablo 2 m", category: "Kablolar", description: "4K görüntü aktarımını destekleyen HDMI kablo.", unit: "adet", cost: 145, minimum: 15, symbol: "📺", stock: { "DEP-01": 4, "IST-MRK": 8, "ANK-01": 2 } },
  { sku: "ADP-USBC-65W", name: "USB-C Adaptör 65 W", category: "Elektronik", description: "USB-C uyumlu cihazlar için güç adaptörü.", unit: "adet", cost: 520, minimum: 8, symbol: "🔋", stock: { "DEP-01": 9, "IST-MRK": 6, "ANK-01": 5 } },
  { sku: "MOU-WL-24G", name: "Kablosuz Mouse", category: "Çevre birimleri", description: "2.4 GHz alıcılı, ergonomik kablosuz mouse.", unit: "adet", cost: 360, minimum: 12, symbol: "🖱️", stock: { "DEP-01": 15, "IST-MRK": 12, "ANK-01": 9 } },
  { sku: "KLAV-MEK-01", name: "Mekanik Klavye", category: "Çevre birimleri", description: "Türkçe Q dizilimli, kompakt mekanik klavye.", unit: "adet", cost: 1650, minimum: 8, symbol: "⌨️", stock: { "DEP-01": 3, "IST-MRK": 4, "ANK-01": 1 } },
  { sku: "KUL-BT-01", name: "Bluetooth Kulaklık", category: "Ses ürünleri", description: "Mikrofonlu, kablosuz günlük kullanım kulaklığı.", unit: "adet", cost: 1250, minimum: 6, symbol: "🎧", stock: { "DEP-01": 0, "IST-MRK": 0, "ANK-01": 0 } },
  { sku: "SSD-NVME-1TB", name: "NVMe SSD 1 TB", category: "Depolama", description: "Dizüstü ve masaüstü bilgisayarlar için M.2 NVMe disk.", unit: "adet", cost: 3200, minimum: 5, symbol: "💾", stock: { "DEP-01": 4, "IST-MRK": 4, "ANK-01": 2 } },
  { sku: "USB-32GB", name: "USB Bellek 32 GB", category: "Depolama", description: "Günlük dosya aktarımı için USB 3.0 bellek.", unit: "adet", cost: 250, minimum: 20, symbol: "🔑", stock: { "DEP-01": 18, "IST-MRK": 12, "ANK-01": 7 } },
  { sku: "KAGIT-A4-80", name: "A4 Fotokopi Kağıdı", category: "Ofis", description: "80 g/m², 500 yapraklık ofis kağıdı.", unit: "paket", cost: 165, minimum: 10, symbol: "📄", stock: { "DEP-01": 14, "IST-MRK": 9, "ANK-01": 7 } },
  { sku: "ETK-THERM-100", name: "Termal Kargo Etiketi", category: "Paketleme", description: "100 × 150 mm termal yazıcı etiketi.", unit: "rulo", cost: 130, minimum: 12, symbol: "🏷️", stock: { "DEP-01": 4, "IST-MRK": 3, "ANK-01": 2 } },
  { sku: "RTR-AX1800", name: "Wi-Fi 6 Router AX1800", category: "Ağ ekipmanları", description: "Çift bantlı Wi-Fi 6 kablosuz ağ yönlendiricisi.", unit: "adet", cost: 2400, minimum: 4, symbol: "📡", stock: { "DEP-01": 3, "IST-MRK": 2, "ANK-01": 2 } },
  { sku: "PRIZ-6LI", name: "6'lı Akım Korumalı Priz", category: "Elektrik", description: "Anahtarlı ve aşırı gerilim korumalı çoklu priz.", unit: "adet", cost: 480, minimum: 6, symbol: "🔌", stock: { "DEP-01": 1, "IST-MRK": 2, "ANK-01": 1 } },
  { sku: "KBL-CAT6-5M", name: "CAT6 Ethernet Kablosu 5 m", category: "Ağ ekipmanları", description: "Gigabit bağlantı için CAT6 Ethernet kablosu.", unit: "adet", cost: 95, minimum: 10, symbol: "🌐", stock: { "DEP-01": 11, "IST-MRK": 9, "ANK-01": 6 } },
];

function insertMovement(productId: string, warehouseId: string, type: "INBOUND" | "OUTBOUND", quantityDelta: number, note: string, createdAt: string): void {
  db.prepare(`
    INSERT INTO stock_movements (id, product_id, warehouse_id, type, quantity_delta, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), productId, warehouseId, type, quantityDelta, note, createdAt);
}

const seed = db.transaction(() => {
  if (process.env.NODE_ENV === "production") throw new Error("Demo verisi production ortamına eklenemez.");

  const getWarehouse = db.prepare("SELECT id, archived FROM warehouses WHERE code = ?");
  const addWarehouse = db.prepare("INSERT INTO warehouses (id, code, name, address) VALUES (?, ?, ?, ?)");
  const warehouses: Array<{ id: string; code: string }> = [];
  let addedWarehouses = 0;

  for (const warehouseSeed of warehouseSeeds) {
    let warehouse = getWarehouse.get(warehouseSeed.code) as { id: string; archived: number } | undefined;
    if (!warehouse) {
      const id = randomUUID();
      addWarehouse.run(id, warehouseSeed.code, warehouseSeed.name, warehouseSeed.address);
      warehouse = { id, archived: 0 };
      addedWarehouses += 1;
    }
    if (warehouse.archived) throw new Error(`Demo verisi için ${warehouseSeed.code} deposunu önce etkinleştirin.`);
    warehouses.push({ id: warehouse.id, code: warehouseSeed.code });
  }

  const findProduct = db.prepare("SELECT id FROM products WHERE sku = ?");
  const addProduct = db.prepare(`
    INSERT INTO products (id, sku, name, category, description, unit, cost, symbol, minimum_stock_quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const addBalance = db.prepare(`
    INSERT INTO inventory_balances (product_id, warehouse_id, quantity, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  let addedProducts = 0;
  let addedMovements = 0;
  const now = Date.now();

  for (const [productIndex, productSeed] of productSeeds.entries()) {
    if (findProduct.get(productSeed.sku)) continue;
    const productId = randomUUID();
    addProduct.run(productId, productSeed.sku, productSeed.name, productSeed.category, productSeed.description, productSeed.unit, productSeed.cost, productSeed.symbol, productSeed.minimum);
    addedProducts += 1;

    for (const [warehouseIndex, warehouse] of warehouses.entries()) {
      const quantity = productSeed.stock[warehouse.code as keyof typeof productSeed.stock] ?? 0;
      const emptiedDemoProduct = productSeed.sku === "KUL-BT-01" && warehouseIndex === 0;
      const shipped = quantity > 0 && (productIndex + warehouseIndex) % 4 === 0
        ? Math.min(quantity, (productIndex % 3) + 1)
        : emptiedDemoProduct ? 6 : 0;
      const openingQuantity = quantity + shipped;

      if (openingQuantity > 0) {
        const inboundAt = new Date(now - (18 + ((productIndex + warehouseIndex) % 10)) * day).toISOString();
        insertMovement(productId, warehouse.id, "INBOUND", openingQuantity, "Demo başlangıç stoku", inboundAt);
        addedMovements += 1;
      }
      if (shipped > 0) {
        const outboundAt = new Date(now - (1 + ((productIndex + warehouseIndex) % 6)) * day).toISOString();
        insertMovement(productId, warehouse.id, "OUTBOUND", -shipped, emptiedDemoProduct ? "Demo siparişiyle stok tükendi" : "Demo sipariş sevkiyatı", outboundAt);
        addedMovements += 1;
      }
      addBalance.run(productId, warehouse.id, quantity, new Date(now).toISOString());
    }
  }

  return { addedProducts, addedWarehouses, addedMovements };
});

try {
  const result = seed.immediate();
  console.log(`Demo verisi hazır: ${result.addedProducts} ürün, ${result.addedWarehouses} yeni depo, ${result.addedMovements} stok hareketi eklendi.`);
  console.log("Var olan ürün ve depo kayıtları korundu. Tekrar çalıştırmak eksik demo kayıtlarını ekler.");
} finally {
  db.close();
}
