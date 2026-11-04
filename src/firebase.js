import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC_ib0xdZiguPO7LGXcGQTxzzR1DvDdDo8",
  authDomain: "classroom-web-5e9e3.firebaseapp.com",
  projectId: "classroom-web-5e9e3",
  storageBucket: "classroom-web-5e9e3.firebasestorage.app",
  messagingSenderId: "23957891872",
  appId: "1:23957891872:web:3295d1a842609686108545"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);