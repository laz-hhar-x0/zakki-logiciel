import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBtj9jaGjijwwghMbWJNYituhgARFc36Qs",
  authDomain: "logiceil-zaki.firebaseapp.com",
  projectId: "logiceil-zaki",
  storageBucket: "logiceil-zaki.firebasestorage.app",
  messagingSenderId: "52151843077",
  appId: "1:52151843077:web:120fae4ce2b21a672adf6c",
  measurementId: "G-XM57LZZR20"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);