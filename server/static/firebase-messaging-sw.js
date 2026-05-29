importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDWESOMf_gnYD_XzD2t4idyqDYAq3U-1Rg",
  authDomain: "deteksi-kwh.firebaseapp.com",
  projectId: "deteksi-kwh",
  messagingSenderId: "715684768038",
  appId: "1:715684768038:web:6e877131cae53f7611b9e7",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message ', payload);

  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: '/static/icon.png'
    }
  );
});