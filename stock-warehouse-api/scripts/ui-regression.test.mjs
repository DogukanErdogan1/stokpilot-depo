import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace('void initializeAuth();','');
function environment(responder) {
 const elements=new Map(),listeners={},requests=[];
 const element=()=>({id:'',innerHTML:'',value:'',textContent:'',hidden:false,inert:false,style:{},isConnected:true,type:'search',selectionStart:0,selectionEnd:0,matches(){return false;},classList:{add(){},remove(){},toggle(){}},getAttribute(){return null;},setAttribute(){},removeAttribute(){},focus(){},append(){},addEventListener(){},remove(){},setSelectionRange(){},querySelector(selector){return get(selector);},querySelectorAll(){return [];} });
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const document={querySelector:get,querySelectorAll(){return [];},getElementById:get,body:element(),documentElement:element(),activeElement:element(),createElement:element,addEventListener(type,listener){listeners[type]=listener;}};
 const window={scrollX:0,scrollY:350,scrollTo(position){this.lastScroll=position;},addEventListener(){}};
 const overview={metrics:{productCount:10000,criticalCount:200,totalQuantity:50000},warehouses:[{id:'w1',code:'IST',name:'İstanbul',archived:0,count:50000}],alerts:[],recentMovements:[],categories:['Elektronik']};
 const context=vm.createContext({document,window,location:{hash:'#products'},console,URL,URLSearchParams,Blob,FormData,AbortController,setTimeout,clearTimeout,fetch:async(path,options={})=>{
  requests.push({path,options});
  const result=responder?await responder(path,options):path==='/api/overview'?overview:{items:[{id:'product-1',name:'Kalem',sku:'P1',unit:'adet',minimumStockQuantity:5,stock:{w1:7}}],pagination:{page:1,pageSize:25,total:10000,totalPages:400,hasNext:true,hasPrevious:false}};
  return {ok:result.ok!==false,status:result.ok===false?500:200,json:async()=>structuredClone(result)};
 }});
 vm.runInContext(source,context);vm.runInContext('render=()=>{};',context);
 return {run:code=>vm.runInContext(code,context),requests,elements,document,window,listeners};
}
test('initial load requests a bounded overview and one product page, never the full inventory',async()=>{
 const env=environment();await env.run('refreshState()');
 assert.equal(env.requests.length,2);assert.equal(env.requests[0].path,'/api/overview');
 const url=new URL(env.requests[1].path,'http://local');assert.equal(url.pathname,'/api/products');assert.equal(url.searchParams.get('pageSize'),'25');
 assert.equal(env.run('state.products.length'),0);assert.equal(env.run('listPages.products.items.length'),1);assert.equal(env.run('metric("productCount")'),10000);
});
test('filters, archive status and page size are sent to the server and reset the page',()=>{
 const env=environment();env.run('listPages.products.page=8;listPages.products.pageSize=50;currentSearch="USB";Object.assign(stockFilters.products,{warehouse:"w1",maxQuantity:"0"});reloadList()');
 const params=new URLSearchParams(env.run('listParams("products").toString()'));
 assert.equal(params.get('page'),'1');assert.equal(params.get('pageSize'),'50');assert.equal(params.get('maxQuantity'),'0');assert.equal(params.get('q'),'USB');assert.equal(params.get('warehouseId'),'w1');
 env.run('showArchivedProducts=true');assert.equal(new URLSearchParams(env.run('listParams("products").toString()')).get('archived'),'true');
});
test('an older response cannot overwrite a newer search result',async()=>{
 const gates=new Map();const env=environment(path=>new Promise(resolve=>gates.set(new URL(path,'http://local').searchParams.get('q'),resolve)));
 env.run('currentSearch="old"');const old=env.run('loadListPage("products")');env.run('currentSearch="new"');const latest=env.run('loadListPage("products")');
 const response=name=>({items:[{id:name,name,minimumStockQuantity:0}],pagination:{page:1,pageSize:25,total:1,totalPages:1}});
 gates.get('new')(response('new'));await latest;gates.get('old')(response('old'));await old;
 assert.equal(env.run('listPages.products.items[0].id'),'new');assert.equal(env.run('listPages.products.loading'),false);assert.equal(env.requests[0].options.signal.aborted,true);
});
test('pagination stays compact and exposes the current page and correct filtered range',()=>{
 const env=environment();env.run('Object.assign(listPages.products,{page:37,pageSize:10,total:10000,totalPages:1000})');
 const html=env.run('paginationControls("products")');assert.match(html,/361–370 \/ 10.000 kayıt/);assert.match(html,/aria-current="page"/);
 assert.ok((html.match(/data-action="go-page"/g)||[]).length<=9);assert.match(html,/1000. sayfa/);
});
test('failed requests show a recoverable error without reusing stale rows',async()=>{
 const env=environment(()=>({ok:false,error:{message:'Bağlantı hatası'}}));await env.run('loadListPage("products")');
 assert.equal(env.run('filteredProducts().length'),0);assert.match(env.run('tableNotice("products",7)'),/Tekrar dene/);assert.match(env.run('tableNotice("products",7)'),/Bağlantı hatası/);
});
test('modal background lock and scroll restoration still work',()=>{
 const env=environment();env.run('beginModal()');assert.equal(env.document.body.style.position,'fixed');assert.equal(env.elements.get('#app-shell').inert,true);
 env.run('closeModal()');assert.equal(env.elements.get('#app-shell').inert,false);assert.equal(env.window.lastScroll.top,350);
});
