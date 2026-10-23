export const firebaseConfig = {
    apiKey: "AIzaSyD6EUQ729_NLNrXecZvmaD4oFhWkE_D_5g",
    authDomain: "web-ban-hoa-9fe0b.firebaseapp.com",
    projectId: "web-ban-hoa-9fe0b",
    storageBucket: "web-ban-hoa-9fe0b.firebasestorage.app",
    messagingSenderId: "842068724218",
    appId: "1:842068724218:web:51bfa70dde2eec0a957c43",
    measurementId: "G-3TREPTQ660"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
    (value) => typeof value === "string" && value.trim().length > 0
);
