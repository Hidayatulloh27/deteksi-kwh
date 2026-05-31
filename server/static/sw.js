self.addEventListener('install', event => {
    console.log('Service Worker Installed');
});

self.addEventListener('activate', event => {
    console.log('Service Worker Activated');
});

self.addEventListener('notificationclick', event => {

    event.notification.close();

    event.waitUntil(
        clients.openWindow('/')
    );

});