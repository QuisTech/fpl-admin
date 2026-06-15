import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFirestore } from '../lib/firestore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ensure this is called by Vercel Cron
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getFirestore();
    const now = new Date();

    // Query all beta testers
    const snapshot = await db.collection('users').where('beta_tester', '==', true).get();
    
    let expiredCount = 0;
    const batch = db.batch();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const expiry = data.beta_expires_at?.toDate();
      
      if (expiry && expiry < now) {
        // Beta has expired! Downgrade to free tier.
        batch.update(doc.ref, {
          tier: 'free',
          beta_tester: false, // or FieldValue.delete()
          updatedAt: new Date()
        });
        
        // Log it automatically
        const logRef = db.collection('audit_log').doc();
        batch.set(logRef, {
          adminId: 'system_cron',
          action: 'AUTO_REVOKE_BETA',
          targetUserId: doc.id,
          changes: { tier: 'free', reason: 'Beta Expired' },
          timestamp: new Date()
        });
        
        expiredCount++;
      }
    });

    if (expiredCount > 0) {
      await batch.commit();
    }

    return res.status(200).json({ success: true, expiredCount });
  } catch (error: any) {
    console.error("Cron Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
