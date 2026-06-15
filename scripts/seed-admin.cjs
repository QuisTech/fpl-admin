const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Path to your service account key
const keyPath = path.join(__dirname, '..', 'firebase-key.json');

if (!fs.existsSync(keyPath)) {
  console.error("Error: firebase-key.json not found in the project root.");
  console.error("Please download it from Firebase Console -> Project Settings -> Service Accounts.");
  process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function seedAdmin(email) {
  try {
    console.log(`Searching for user with email: ${email}...`);
    
    // Find the user by email in the 'users' collection
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).limit(1).get();

    if (snapshot.empty) {
      console.log(`No user found with email ${email}. Make sure you have signed up in the app first!`);
      process.exit(1);
    }

    const userDoc = snapshot.docs[0];
    
    console.log(`Found user: ${userDoc.id}. Updating role to 'admin'...`);
    
    await userDoc.ref.update({
      role: 'admin',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Success! ${email} is now an admin. You can now log into the admin dashboard.`);
    process.exit(0);
  } catch (error) {
    console.error("Error updating user:", error);
    process.exit(1);
  }
}

// Get email from command line arguments
const targetEmail = process.argv[2];

if (!targetEmail) {
  console.log("Usage: node scripts/seed-admin.cjs <your-email@example.com>");
  process.exit(1);
}

seedAdmin(targetEmail);
