// ============================================================
// FIREBASE CONFIG — LNN Legal
// Replace ALL placeholder values below with your Firebase project config.
//
// Steps:
// 1. Go to https://console.firebase.google.com
// 2. Click "Add project" → name it "lnn-legal" → Create
// 3. Click the </> Web icon to register a web app
// 4. Copy the firebaseConfig object values below
// 5. Go to Firestore Database → Create database → Start in test mode
// 6. Save this file & push to GitHub → Vercel auto-deploys
// ============================================================

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

try {
    firebase.initializeApp(firebaseConfig);
    window.fsdb = firebase.firestore();
    // Enable offline persistence so the app works even without internet
    window.fsdb.enablePersistence().catch(() => { });
} catch (e) {
    console.warn('Firebase init failed:', e.message);
    window.fsdb = null;
}
