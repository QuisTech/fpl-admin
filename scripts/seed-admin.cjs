const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, '..', 'firebase-key.json');

if (!fs.existsSync(keyPath)) {
  console.error("Error: firebase-key.json not found in the project root.");
  process.exit(1);
}

const serviceAccount = require(keyPath);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function seedAdmin(uid) {
  try {
    console.log(`Searching for user with UID: ${uid}...`);
    
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      console.log(`No user found with UID ${uid}. Creating one or double check the UID.`);
      // Actually we should just set it with merge: true
    }

    console.log(`Updating role to 'admin' for ${uid}...`);
    
    await userRef.set({
      role: 'admin',
      tier: 'admin',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Success! ${uid} is now an admin. You can now log into the admin dashboard.`);
    process.exit(0);
  } catch (error) {
    console.error("Error updating user:", error);
    process.exit(1);
  }
}

const targetUid = process.argv[2];

if (!targetUid) {
  console.log("Usage: node scripts/seed-admin.cjs <your-uid>");
  process.exit(1);
}

seedAdmin(targetUid);
