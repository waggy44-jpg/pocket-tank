/* Pocket Tank service worker: app shell only. Never cache user data —
   a save lives in localStorage and caching it would serve a stale tank. */
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png",
             "./icon-512.png", "./icon-maskable.png"];
var CACHE = "pocket-tank-v1";

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      // atomic addAll: one 404 would silently kill offline support
      return Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){ return null; }); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate"){
    e.respondWith(
      fetch(req).then(function(r){ return r; }).catch(function(){ return caches.match("./index.html"); })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(r){
        if (r && r.status === 200 && r.type === "basic"){
          var copy = r.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return r;
      });
    })
  );
});