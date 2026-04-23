import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyA3PZOLO_OSGo2aOgIw2fPmxn8XCPIqDfs",
  authDomain: "scrabble-57613.firebaseapp.com",
  databaseURL: "https://scrabble-57613-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "scrabble-57613",
  storageBucket: "scrabble-57613.firebasestorage.app",
  messagingSenderId: "366925648422",
  appId: "1:366925648422:web:f59ba7f6ccf19a01e70ce7"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);