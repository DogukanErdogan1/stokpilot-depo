import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const day = 24 * 60 * 60 * 1000;

const warehouseSeeds = [
  { code: "DEMO-DEP-01", name: "Doğu Demo Deposu", address: "Erzurum, Türkiye", location: "Erzurum" },
  { code: "DEMO-IST-MRK", name: "İstanbul Demo Deposu", address: "Esenyurt, İstanbul", location: "İstanbul" },
  { code: "DEMO-ANK-01", name: "Ankara Demo Deposu", address: "Yenimahalle, Ankara", location: "Ankara" },
];

const productSeeds = [
  { sku: "DEMO-KBL-USBC-1M", name: "USB-C Şarj Kablosu 1 m", category: "Kablolar", description: "Örgülü, hızlı şarj destekli USB-C kablosu.", unit: "adet", cost: 95, minimum: 20, symbol: "🔌", stock: [21, 31, 14] },
  { sku: "DEMO-KBL-HDMI-2M", name: "HDMI Kablo 2 m", category: "Kablolar", description: "4K görüntü aktarımını destekleyen HDMI kablo.", unit: "adet", cost: 145, minimum: 15, symbol: "📺", stock: [4, 8, 2] },
  { sku: "DEMO-ADP-USBC-65W", name: "USB-C Adaptör 65 W", category: "Elektronik", description: "USB-C uyumlu cihazlar için güç adaptörü.", unit: "adet", cost: 520, minimum: 8, symbol: "🔋", stock: [9, 6, 5] },
  { sku: "DEMO-MOU-WL-24G", name: "Kablosuz Mouse", category: "Çevre birimleri", description: "2.4 GHz alıcılı, ergonomik kablosuz mouse.", unit: "adet", cost: 360, minimum: 12, symbol: "🖱️", stock: [15, 12, 9] },
  { sku: "DEMO-KLAV-MEK-01", name: "Mekanik Klavye", category: "Çevre birimleri", description: "Türkçe Q dizilimli, kompakt mekanik klavye.", unit: "adet", cost: 1650, minimum: 8, symbol: "⌨️", stock: [3, 4, 1] },
  { sku: "DEMO-KUL-BT-01", name: "Bluetooth Kulaklık", category: "Ses ürünleri", description: "Mikrofonlu, kablosuz günlük kullanım kulaklığı.", unit: "adet", cost: 1250, minimum: 6, symbol: "🎧", stock: [0, 0, 0] },
  { sku: "DEMO-SSD-NVME-1TB", name: "NVMe SSD 1 TB", category: "Depolama", description: "Dizüstü ve masaüstü bilgisayarlar için M.2 NVMe disk.", unit: "adet", cost: 3200, minimum: 5, symbol: "💾", stock: [4, 4, 2] },
  { sku: "DEMO-USB-32GB", name: "USB Bellek 32 GB", category: "Depolama", description: "Günlük dosya aktarımı için USB 3.0 bellek.", unit: "adet", cost: 250, minimum: 20, symbol: "🔑", stock: [18, 12, 7] },
  { sku: "DEMO-KAGIT-A4-80", name: "A4 Fotokopi Kağıdı", category: "Ofis", description: "80 g/m², 500 yapraklık ofis kağıdı.", unit: "paket", cost: 165, minimum: 10, symbol: "📄", stock: [14, 9, 7] },
  { sku: "DEMO-ETK-THERM-100", name: "Termal Kargo Etiketi", category: "Paketleme", description: "100 × 150 mm termal yazıcı etiketi.", unit: "rulo", cost: 130, minimum: 12, symbol: "🏷️", stock: [4, 3, 2] },
  { sku: "DEMO-RTR-AX1800", name: "Wi-Fi 6 Router AX1800", category: "Ağ ekipmanları", description: "Çift bantlı Wi-Fi 6 kablosuz ağ yönlendiricisi.", unit: "adet", cost: 2400, minimum: 4, symbol: "📡", stock: [3, 2, 2] },
  { sku: "DEMO-PRIZ-6LI", name: "6'lı Akım Korumalı Priz", category: "Elektrik", description: "Anahtarlı ve aşırı gerilim korumalı çoklu priz.", unit: "adet", cost: 480, minimum: 6, symbol: "🔌", stock: [1, 2, 1] },
  { sku: "DEMO-KBL-CAT6-5M", name: "CAT6 Ethernet Kablosu 5 m", category: "Ağ ekipmanları", description: "Gigabit bağlantı için CAT6 Ethernet kablosu.", unit: "adet", cost: 95, minimum: 10, symbol: "🌐", stock: [11, 9, 6] },
];

export function seedDemoWorkspace(workspaceId: string): void {
  const seed = db.transaction(() => {
    const getWarehouse = db.prepare("SELECT id, archived FROM warehouses WHERE workspace_id = ? AND code = ?");
    const addWarehouse = db.prepare("INSERT INTO warehouses (id, workspace_id, code, name, address, location) VALUES (?, ?, ?, ?, ?, ?)");
    const warehouses: Array<{ id: string; code: string }> = [];

    for (const warehouseSeed of warehouseSeeds) {
      let warehouse = getWarehouse.get(workspaceId, warehouseSeed.code) as { id: string; archived: number } | undefined;
      if (!warehouse) {
        const id = randomUUID();
        addWarehouse.run(id, workspaceId, warehouseSeed.code, warehouseSeed.name, warehouseSeed.address, warehouseSeed.location);
        warehouse = { id, archived: 0 };
      }
      if (warehouse.archived) throw new Error(`Demo verisi için ${warehouseSeed.code} deposunu önce etkinleştirin.`);
      warehouses.push({ id: warehouse.id, code: warehouseSeed.code });
    }

    const findProduct = db.prepare("SELECT id FROM products WHERE workspace_id = ? AND sku = ?");
    const addProduct = db.prepare(`
      INSERT INTO products (id, workspace_id, sku, name, category, description, unit, cost, symbol, minimum_stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const addBalance = db.prepare(`
      INSERT INTO inventory_balances (workspace_id, product_id, warehouse_id, quantity, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const addMovement = db.prepare(`
      INSERT INTO stock_movements (id, workspace_id, product_id, warehouse_id, type, quantity_delta, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();

    for (const [productIndex, productSeed] of productSeeds.entries()) {
      if (findProduct.get(workspaceId, productSeed.sku)) continue;
      const productId = randomUUID();
      addProduct.run(productId, workspaceId, productSeed.sku, productSeed.name, productSeed.category,
        productSeed.description, productSeed.unit, productSeed.cost, productSeed.symbol, productSeed.minimum);

      for (const [warehouseIndex, warehouse] of warehouses.entries()) {
        const quantity = productSeed.stock[warehouseIndex] ?? 0;
        const emptiedDemoProduct = productSeed.sku === "DEMO-KUL-BT-01" && warehouseIndex === 0;
        const shipped = quantity > 0 && (productIndex + warehouseIndex) % 4 === 0
          ? Math.min(quantity, (productIndex % 3) + 1)
          : emptiedDemoProduct ? 6 : 0;
        const openingQuantity = quantity + shipped;

        if (openingQuantity > 0) {
          const inboundAt = new Date(now - (18 + ((productIndex + warehouseIndex) % 10)) * day).toISOString();
          addMovement.run(randomUUID(), workspaceId, productId, warehouse.id, "INBOUND", openingQuantity, "Demo başlangıç stoku", inboundAt);
        }
        if (shipped > 0) {
          const outboundAt = new Date(now - (1 + ((productIndex + warehouseIndex) % 6)) * day).toISOString();
          addMovement.run(randomUUID(), workspaceId, productId, warehouse.id, "OUTBOUND", -shipped,
            emptiedDemoProduct ? "Demo siparişiyle stok tükendi" : "Demo sipariş sevkiyatı", outboundAt);
        }
        addBalance.run(workspaceId, productId, warehouse.id, quantity, new Date(now).toISOString());
      }
    }
  });
  seed.immediate();
}
