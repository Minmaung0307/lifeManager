const CACHE_NAME = 'secure-vault-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js'
];

// Install Service Worker
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching assets');
      return cache.addAll(ASSETS);
    })
  );
});

// Fetch Request
self.addEventListener('fetch', (evt) => {
  // Google Drive API request တွေကိုတော့ Cache မလုပ်ပါဘူး (အမြဲ Online လိုလို့ပါ)
  if (evt.request.url.includes('googleapis.com')) {
    return; 
  }

  evt.respondWith(
    caches.match(evt.request).then((cacheRes) => {
      return cacheRes || fetch(evt.request);
    })
  );
});