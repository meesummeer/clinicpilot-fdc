const firebaseConfig = {
  apiKey: "AIzaSyB6GBcJA0510Xb3sC-OXikOjIOa_WJqu6g",
  authDomain: "clinicpilot-fdc-20cd3.firebaseapp.com",
  projectId: "clinicpilot-fdc-20cd3",
  storageBucket: "clinicpilot-fdc-20cd3.firebasestorage.app",
  messagingSenderId: "596795251833",
  appId: "1:596795251833:web:76a4649af0d6bd4c3586a8"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
window.db = db;
window.fbLib = { collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, query, where, orderBy };
