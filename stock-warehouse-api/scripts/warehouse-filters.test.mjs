import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=mkdtempSync(join(tmpdir(),'stokpilot-warehouses-'));
process.env.DATABASE_PATH=join(temporary,'test.sqlite');process.env.NODE_ENV='test';process.env.PUBLIC_ORIGIN='http://localhost';
const {db}=await import('../dist/db.js');const {buildApp}=await import('../dist/app.js');
const app=await buildApp();app.log.level='silent';
const workspace=randomUUID(),other=randomUUID(),user=randomUUID(),token=randomUUID()+randomUUID(),ids=[];
db.transaction(()=>{
 for(const id of [workspace,other])db.prepare('INSERT INTO workspaces(id,name) VALUES (?,?)').run(id,'Warehouse test');
 db.prepare('INSERT INTO users(id,email,full_name,password_hash,workspace_id) VALUES (?,?,?,?,?)').run(user,'warehouse@example.test','Test','unused',workspace);
 db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),user,'2100-01-01');
 for(let i=0;i<31;i++){
  const id=randomUUID();ids.push(id);
  db.prepare('INSERT INTO warehouses(id,workspace_id,code,name,address,location,archived) VALUES (?,?,?,?,?,?,?)')
   .run(id,workspace,'WH-'+String(i).padStart(3,'0'),'Depo '+String(i).padStart(2,'0'),i%3===2&&i%2===0?'Osmangazi, Bursa':null,i===30?'Arşiv konumu':i%3===0?'İstanbul':i%3===1?'Ankara':null,i===30?1:0);
 }
 db.prepare('INSERT INTO warehouses(id,workspace_id,code,name,location) VALUES (?,?,?,?,?)').run(randomUUID(),other,'FOREIGN-WH','Gizli depo','Başka çalışma alanı');
 const p1=randomUUID(),p2=randomUUID(),archived=randomUUID();
 for(const [id,code,min,arch] of [[p1,'W-P1',5,0],[p2,'W-P2',2,0],[archived,'W-OLD',0,1]])db.prepare('INSERT INTO products(id,workspace_id,sku,name,minimum_stock_quantity,archived) VALUES (?,?,?,?,?,?)').run(id,workspace,code,code,min,arch);
 for(const [product,warehouseId,quantity] of [[p1,ids[0],7],[archived,ids[0],100],[p1,ids[1],2],[p2,ids[1],3]])db.prepare('INSERT INTO inventory_balances(product_id,warehouse_id,workspace_id,quantity) VALUES (?,?,?,?)').run(product,warehouseId,workspace,quantity);
})();
const headers={cookie:'stokpilot_session='+token,origin:'http://localhost',host:'localhost'};
const get=async query=>{const r=await app.inject({url:'/api/warehouses'+query,headers});assert.equal(r.statusCode,200,r.body);return r.json();};
after(async()=>{await app.close();db.close();for(const name of readdirSync(temporary))unlinkSync(join(temporary,name));rmdirSync(temporary);});

test('warehouses paginate with stable ordering and workspace-scoped facets',async()=>{
 const a=await get('?pageSize=10'),b=await get('?page=2&pageSize=10');assert.equal(a.items.length,10);assert.equal(a.pagination.total,30);assert.equal(a.pagination.totalPages,3);assert.equal(a.counts.archived,1);assert.equal(a.facets.locations.reduce((sum,item)=>sum+item.count,0),30);
 assert.equal(new Set([...a.items,...b.items].map(w=>w.id)).size,20);assert.equal(b.items[0].code,'WH-010');
 assert.ok(!a.facets.locations.some(item=>item.value==='Başka çalışma alanı'));
 assert.equal((await get('?page=999&pageSize=10')).pagination.page,3);
});
test('name, code, address and Turkish location search run before pagination',async()=>{
 for(const query of ['Depo 29','WH-029']){const r=await get('?q='+encodeURIComponent(query));assert.equal(r.items[0].id,ids[29]);assert.equal(r.pagination.total,1);}
 const address=await get('?q=Osmangazi');assert.equal(address.pagination.total,5);
 const city=await get('?q='+encodeURIComponent('İSTANBUL')+'&pageSize=3&page=4');assert.equal(city.pagination.total,10);assert.equal(city.items.length,1);
 const injection=await get('?q='+encodeURIComponent("%' OR 1=1 --"));assert.equal(injection.pagination.total,0);
});
test('location filters handle saved locations, legacy addresses, missing locations and archives',async()=>{
 const city=await get('?location='+encodeURIComponent('İSTANBUL')+'&pageSize=3&page=2');assert.equal(city.pagination.total,10);assert.ok(city.items.every(w=>w.location==='İstanbul'));
 const legacy=await get('?location='+encodeURIComponent('Osmangazi, Bursa'));assert.equal(legacy.pagination.total,5);assert.ok(legacy.items.every(w=>w.locationLabel==='Osmangazi, Bursa'&&w.location===null));
 const missing=await get('?location=');assert.equal(missing.pagination.total,5);
 const archive=await get('?archived=true');assert.equal(archive.pagination.total,1);assert.equal(archive.items[0].id,ids[30]);assert.equal(archive.facets.locations.reduce((sum,item)=>sum+item.count,0),1);
 const empty=await get('?location=missing&page=999');assert.equal(empty.pagination.total,0);assert.equal(empty.pagination.page,1);
});
test('warehouse statistics and sorting include zero balances and ignore archived products',async()=>{
 const result=await get('?sort=quantity-desc');assert.equal(result.items[0].id,ids[0]);assert.equal(result.items[0].count,7);assert.equal(result.items[0].products,1);assert.equal(result.items[0].lowCount,1);
 const byProducts=await get('?sort=products-desc');assert.equal(byProducts.items[0].id,ids[1]);assert.equal(byProducts.items[0].products,2);
 const critical=await get('?sort=critical-desc');assert.equal(critical.items[0].lowCount,2);
});
test('creating and editing locations preserves addresses and supports clearing the location',async()=>{
 const created=await app.inject({method:'POST',url:'/api/warehouses',headers,payload:{code:'NEW-LOCATION',name:'Yeni konum',address:'Bornova adresi',location:'İzmir'}});assert.equal(created.statusCode,201,created.body);const record=created.json();
 try{
  assert.equal(record.location,'İzmir');
  const updated=await app.inject({method:'PATCH',url:'/api/warehouses/'+record.id,headers,payload:{name:'Yeni konum 2'}});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().location,'İzmir');
  const cleared=await app.inject({method:'PATCH',url:'/api/warehouses/'+record.id,headers,payload:{location:null}});assert.equal(cleared.statusCode,200,cleared.body);assert.equal(cleared.json().address,'Bornova adresi');assert.equal(cleared.json().location,null);
  assert.equal((await get('?location=Bornova%20adresi&q=NEW-LOCATION')).pagination.total,1);
 }finally{db.prepare('DELETE FROM warehouses WHERE id=?').run(record.id);}
});
test('warehouse validation and authentication reject invalid or unauthorized requests',async()=>{
 for(const query of ['?sort=invalid','?pageSize=101','?page=-1']){const r=await app.inject({url:'/api/warehouses'+query,headers});assert.equal(r.statusCode,400,r.body);}
 const unauthorized=await app.inject({url:'/api/warehouses'});assert.equal(unauthorized.statusCode,401);
 const longLocation=await app.inject({method:'POST',url:'/api/warehouses',headers,payload:{code:'INVALID',name:'Invalid',location:'a'.repeat(161)}});assert.equal(longLocation.statusCode,400);
});
