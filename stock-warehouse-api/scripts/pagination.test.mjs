import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temporary=mkdtempSync(join(tmpdir(),'stokpilot-pagination-'));
process.env.DATABASE_PATH=join(temporary,'test.sqlite');
const {db}=await import('../dist/db.js');
const {buildApp}=await import('../dist/app.js');
const app=await buildApp();app.log.level="silent";
const workspace=randomUUID(), other=randomUUID(), user=randomUUID(), w1=randomUUID(), w2=randomUUID(), token=randomUUID()+randomUUID();
const products=[];
db.transaction(()=>{
 for(const id of [workspace,other])db.prepare('INSERT INTO workspaces(id,name) VALUES (?,?)').run(id,'Test');
 db.prepare('INSERT INTO users(id,email,full_name,password_hash,workspace_id) VALUES (?,?,?,?,?)').run(user,'pagination-test@example.test','Test','unused',workspace);
 db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),user,'2100-01-01');
 for(const [id,code] of [[w1,'TEST-A'],[w2,'TEST-B']])db.prepare('INSERT INTO warehouses(id,workspace_id,code,name) VALUES (?,?,?,?)').run(id,workspace,code,code);
 const insert=db.prepare('INSERT INTO products(id,workspace_id,sku,name,category,cost,minimum_stock_quantity) VALUES (?,?,?,?,?,?,?)');
 const balance=db.prepare('INSERT INTO inventory_balances(product_id,warehouse_id,workspace_id,quantity) VALUES (?,?,?,?)');
 for(let i=0;i<10000;i++){
  const id=randomUUID();products.push(id);
  insert.run(id,workspace,'SKU-'+i.toString().padStart(5,'0'),'Ürün '+i.toString().padStart(5,'0'),i%2?'Ofis':'Elektronik',i%20,5);
  if(i%11)balance.run(id,w1,workspace,i%11);
 }
 insert.run(randomUUID(),other,'FOREIGN','Ürün gizli','Elektronik',0,5);
 const movement=db.prepare('INSERT INTO stock_movements(id,workspace_id,product_id,warehouse_id,type,quantity_delta,note,created_at) VALUES (?,?,?,?,?,?,?,?)');
 for(let i=0;i<205;i++)movement.run(randomUUID(),workspace,products[i],w1,i%2?'OUTBOUND':'INBOUND',i%2?-1:1,i===204?'son-kayit':'test','2026-10-01T12:00:00Z');
})();// isolated temporary fixtures; real project data is never touched.
const headers={cookie:'stokpilot_session='+token};
const get=async url=>{const r=await app.inject({url,headers});assert.equal(r.statusCode,200,r.body);return r.json();};
after(async()=>{await app.close();db.close();for(const name of readdirSync(temporary))unlinkSync(join(temporary,name));rmdirSync(temporary);});

test('10,000 products are counted but only the requested page is sent, in stable order',async()=>{
 const a=await get('/api/products'), b=await get('/api/products?page=2&pageSize=25');
 assert.equal(a.items.length,25);assert.equal(a.pagination.total,10000);assert.equal(a.pagination.totalPages,400);
 assert.equal(b.items[0].sku,'SKU-00025');assert.equal(new Set([...a.items,...b.items].map(p=>p.id)).size,50);
 assert.deepEqual((await get('/api/products')).items.map(p=>p.id),a.items.map(p=>p.id));
 assert.ok(!a.items.some(p=>p.sku==='FOREIGN'));
});
test('search, category, quantity and warehouse filters apply before pagination',async()=>{
 const filtered=await get('/api/products?q=09999');assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].sku,'SKU-09999');
 const category=await get('/api/products?category=Elektronik&pageSize=10&page=3');assert.equal(category.pagination.total,5000);assert.ok(category.items.every(p=>p.category==='Elektronik'));
 const empty=await get('/api/products?warehouseId='+w2+'&maxQuantity=0');assert.equal(empty.pagination.total,10000);
 const result=await get('/api/products?warehouseId='+w1+'&minQuantity=6&minCost=5&maxCost=15&minWarehouses=1');
 assert.ok(result.items.every(p=>p.stock[w1]>=6&&p.cost>=5&&p.cost<=15));
});
test('inventory includes zero balances and paginates product/warehouse rows independently',async()=>{
 const a=await get('/api/inventory?pageSize=10'), b=await get('/api/inventory?page=2&pageSize=10');
 assert.equal(a.pagination.total,20000);assert.equal(a.items.length,10);
 const keys=[...a.items,...b.items].map(r=>r.product.id+':'+r.warehouseId);assert.equal(new Set(keys).size,20);
 const empty=await get('/api/inventory?warehouseId='+w2+'&status=empty');assert.equal(empty.pagination.total,10000);assert.ok(empty.items.every(r=>r.quantity===0));
 const total=await get('/api/inventory?scope=total&minQuantity=6&productId='+products[6]);assert.equal(total.items.length,2);assert.equal(total.items.find(r=>r.warehouseId===w2).quantity,0);
});
test('movement history is searchable beyond the old 100-record boundary',async()=>{
 const result=await get('/api/stock-movements?page=5&pageSize=25');assert.equal(result.items.length,25);assert.equal(result.pagination.total,205);
 const final=await get('/api/stock-movements?page=9&pageSize=25');assert.equal(final.items.length,5);assert.equal(final.pagination.hasNext,false);
 const match=await get('/api/stock-movements?q=son-kayit');assert.equal(match.items.length,1);
 const typed=await get('/api/stock-movements?type=OUTBOUND');assert.equal(typed.pagination.total,102);
});
test('invalid parameters are rejected and out-of-range pages clamp safely',async()=>{
 for(const query of ['page=0','page=-1','pageSize=101','pageSize=0','minQuantity=8&maxQuantity=1','sort=invalid']){
  const result=await app.inject({url:'/api/products?'+query,headers});assert.equal(result.statusCode,400,result.body);
 }
 const result=await get('/api/products?page=1000000');assert.equal(result.pagination.page,400);assert.equal(result.items.length,25);
 const empty=await get('/api/products?q=missing&page=999');assert.equal(empty.pagination.page,1);assert.equal(empty.pagination.total,0);assert.equal(empty.items.length,0);
 const unauth=await app.inject({url:'/api/products'});assert.equal(unauth.statusCode,401);
 const injection=await get('/api/products?q='+encodeURIComponent("%' OR 1=1 --"));assert.equal(injection.pagination.total,0);
});
test('Turkish search and literal wildcard characters work across the complete catalogue',async()=>{
 const id=randomUUID();db.prepare('INSERT INTO products(id,workspace_id,sku,name) VALUES (?,?,?,?)').run(id,workspace,'SPECIAL','İŞARET %_');
 try{
  assert.equal((await get('/api/products?q='+encodeURIComponent('işaret'))).items[0].id,id);
  assert.equal((await get('/api/products?q='+encodeURIComponent('%_'))).pagination.total,1);
 }finally{db.prepare('DELETE FROM products WHERE id=?').run(id);}
});
test('archive on the last page clamps the new page and retains all other records',async()=>{
 const ids=Array.from({length:11},()=>randomUUID());
 for(const [i,id] of ids.entries())db.prepare('INSERT INTO products(id,workspace_id,sku,name) VALUES (?,?,?,?)').run(id,workspace,'LAST-'+i,'SonSayfa '+i.toString().padStart(2,'0'));
 try{
  const last=await get('/api/products?q=SonSayfa&pageSize=10&page=2');assert.equal(last.items.length,1);
  db.prepare('UPDATE products SET archived=1 WHERE id=?').run(last.items[0].id);
  const after=await get('/api/products?q=SonSayfa&pageSize=10&page=2');assert.equal(after.pagination.page,1);assert.equal(after.items.length,10);
  const archived=await get('/api/products?q=SonSayfa&archived=true');assert.equal(archived.pagination.total,1);
 }finally{for(const id of ids)db.prepare('DELETE FROM products WHERE id=?').run(id);}
});
test('dashboard stays bounded and totals and CSV include all pages',async()=>{
 const summary=await get('/api/overview');assert.equal(summary.metrics.productCount,10000);assert.ok(summary.alerts.length<=8);assert.equal(summary.recentMovements.length,5);assert.equal(summary.warehouses.length,2);
 const csv=await app.inject({url:'/api/export?view=inventory&page=2&pageSize=10',headers});assert.equal(csv.statusCode,200);assert.match(csv.headers['content-type'],/text\/csv/);
 assert.equal(csv.body.trim().split('\r\n').length,20001);assert.ok(!csv.body.includes('FOREIGN'));
 const movement=await app.inject({url:'/api/export?view=movements&type=OUTBOUND&pageSize=10',headers});assert.equal(movement.body.trim().split('\r\n').length,103);
 const filtered=await app.inject({url:'/api/export?view=products&q=09999',headers});assert.equal(filtered.body.trim().split('\r\n').length,3);
});
