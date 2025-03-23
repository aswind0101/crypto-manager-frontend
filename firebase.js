// firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAX6viOZkDh4EBDQDBM7NN0VHU0gq9ZMuc",
    authDomain: "crypto-manager-93a43.firebaseapp.com",
    projectId: "crypto-manager-93a43",
    storageBucket: "crypto-manager-93a43.appspot.com", // đã sửa lại ở đây
    messagingSenderId: "687176910244",
    appId: "1:687176910244:web:ef171ecc2016b624846d31"
};

// 🔥 Kiểm tra xem app đã được khởi tạo chưa
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { app, auth, provider };
