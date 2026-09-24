/* V8 caches public application files only. Student data and API requests are excluded. */
const PREFIX='sv-attendance:'+self.registration.scope+':';
const CACHE=PREFIX+'v8';
const BASE=new URL('./',self.location.href);
const INDEX=new URL('index.html',BASE).href;
const APP=new URL('app.js?v=8',BASE).href;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    for(const url of [INDEX,APP]){
      const response=await fetch(new Request(url,{cache:'reload'}));
      if(!response.ok)throw new Error('App update incomplete');
      await cache.put(url,response);
    }
  }));
  // Do not activate/reload while a teacher has an unfinished form.
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==BASE.origin||!url.href.startsWith(BASE.href))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{try{return await fetch(request);}catch(e){return await caches.match(INDEX)||Response.error();}})());
  }else if(url.href===APP){
    event.respondWith(caches.match(APP).then(cached=>cached||fetch(request)));
  }
});
