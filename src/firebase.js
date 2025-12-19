import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Tu configuración (la misma que ya tienes)
const firebaseConfig = {
  apiKey: "AIzaSyDaLSdycTJJrzLsFFSZWj5gy5AyBTG55vY",
  authDomain: "english-study-3c26a.firebaseapp.com",
  projectId: "english-study-3c26a",
  storageBucket: "english-study-3c26a.firebasestorage.app",
  messagingSenderId: "908774916278",
  appId: "1:908774916278:web:2033cbdf7ea4b5cc526617",
  measurementId: "G-23YX85VNK9",
};

const app = initializeApp(firebaseConfig);

// ✅ Exporta lo que tu App.jsx necesita
export const auth = getAuth(app);
export const db = getFirestore(app);
