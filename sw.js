const CACHE='hex-isle-3d-v1';
const ASSETS=['./','./index.html','./manifest.json','./icon-180.png','./icon-192.png','./icon-512.png','./icon.svg','./js/tiles1.js','./js/tiles2.js','./js/logic.js','./js/ui.js','./js/three.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
