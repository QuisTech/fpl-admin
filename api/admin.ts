import express, { Request, Response, NextFunction } from 'express';
import { getFirestore } from '../lib/firestore.js';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import DodoPayments from 'dodopayments';

let dodo: any = null;
let initError: string | null = null;

try {
  dodo = new DodoPayments({
    bearerToken: process.env.DODO_SECRET_KEY?.trim() || 'test',
    environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
  });

  // Initialize firebase-admin for auth if not already initialized
  if (!getApps().length) {
    const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (privateKey) {
      initializeApp({
        credential: cert({
          project_id: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim(),
          client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
          private_key: privateKey,
        }),
      });
    } else {
      initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() });
    }
  }
} catch (e: any) {
  initError = e.message || String(e);
  console.error("Top-level init error:", e);
}

const app = express();
app.use(express.json());

const db = getFirestore();

// Auth Middleware
async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // Allow OPTIONS preflight
  if (req.method === 'OPTIONS') return next();

  if (initError) {
    return res.status(500).json({ error: 'Server initialization error', details: initError });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    const userId = decodedToken.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Requires admin role' });
    }

    (req as any).adminId = userId;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

app.use('/api/admin', adminAuthMiddleware);

app.get('/api/admin/check', (req, res) => res.json({ success: true }));

// Helper to log audit actions
async function logAudit(adminId: string, action: string, targetUserId: string, changes: any) {
  await db.collection('audit_log').add({
    adminId,
    action,
    targetUserId,
    changes,
    timestamp: new Date()
  });
}

// 1. Grant Tier Access
app.post('/api/admin/grant-tier-access', async (req, res) => {
  try {
    const { userId, tier, beta_expires_at, beta_tier, notes } = req.body;
    const adminId = (req as any).adminId;

    if (!userId || !tier) {
      return res.status(400).json({ error: 'Missing userId or tier' });
    }

    const updates: any = { tier, updatedAt: new Date() };
    if (beta_expires_at) {
      updates.beta_tester = true;
      updates.beta_expires_at = new Date(beta_expires_at);
      updates.beta_tier = beta_tier || tier;
    }
    if (notes) updates.admin_notes = notes;

    await db.collection('users').doc(userId).set(updates, { merge: true });
    await logAudit(adminId, 'GRANT_TIER', userId, updates);

    return res.json({ success: true, updates });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 2. Revoke Access
app.post('/api/admin/revoke-access', async (req, res) => {
  try {
    const { userId } = req.body;
    const adminId = (req as any).adminId;

    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const updates = {
      tier: 'free',
      beta_tester: null,
      beta_expires_at: null,
      beta_tier: null,
      updatedAt: new Date()
    };

    await db.collection('users').doc(userId).update(updates);
    await logAudit(adminId, 'REVOKE_ACCESS', userId, { tier: 'free' });

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. Search Users
app.get('/api/admin/search-users', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json({ users: [] });

    // Simple search by exact email or prefix, or ID
    // Note: Firestore doesn't support generic full-text search easily without external tools.
    // For this, we'll do an exact match on email, or check if q is a doc ID.
    const byEmail = await db.collection('users').where('email', '>=', q).where('email', '<=', q + '\uf8ff').limit(10).get();
    
    let users = byEmail.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (users.length === 0) {
      const byId = await db.collection('users').doc(q).get();
      if (byId.exists) {
        users = [{ id: byId.id, ...byId.data() }];
      }
    }

    return res.json({ users });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Beta Testers
app.get('/api/admin/beta-testers', async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('beta_tester', '==', true).get();
    const testers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ testers });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 5. Bulk Grant Beta (CSV)
app.post('/api/admin/bulk-grant-beta', async (req, res) => {
  try {
    const { rows } = req.body; // Array of { email, tier, expiryDays }
    const adminId = (req as any).adminId;
    let successCount = 0;

    for (const row of rows) {
      const { email, tier, expiryDays } = row;
      const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!snapshot.empty) {
        const userDoc = snapshot.docs[0];
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + (parseInt(expiryDays) || 14));
        
        const updates = {
          tier,
          beta_tester: true,
          beta_expires_at: expiry,
          beta_tier: tier,
          updatedAt: new Date()
        };
        await userDoc.ref.set(updates, { merge: true });
        await logAudit(adminId, 'BULK_GRANT_BETA', userDoc.id, updates);
        successCount++;
      }
    }

    return res.json({ success: true, count: successCount });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 6. Analytics Stats
app.get('/api/admin/analytics/stats', async (req, res) => {
  try {
    const usersRef = db.collection('users');
    const totalCount = await usersRef.count().get();
    const betaCount = await usersRef.where('beta_tester', '==', true).count().get();
    const payingCount = await usersRef.where('tier', '!=', 'free').count().get();

    const grandCru = await usersRef.where('tier', '==', 'grandCru').count().get();
    const strategist = await usersRef.where('tier', '==', 'strategist').count().get();
    const aiAgent = await usersRef.where('tier', '==', 'aiAgent').count().get();

    // Fetch recent payments from Dodo Payments
    let recentPayments: any[] = [];
    let mrr = 0;
    try {
      const paymentsList = await dodo.payments.list({ limit: 10 });
      recentPayments = paymentsList.items || [];
      // Calculate a rough MRR from the items (this is just an approximation for display)
      mrr = recentPayments.reduce((acc: number, p: any) => acc + (p.total_amount || 0), 0) / 100;
    } catch (dodoErr) {
      console.warn("Failed to fetch from Dodo Payments API:", dodoErr);
    }

    return res.json({
      totalUsers: totalCount.data().count,
      betaTesters: betaCount.data().count,
      payingUsers: payingCount.data().count - betaCount.data().count, // rough estimate
      mrr: mrr,
      recentPayments,
      tierDistribution: [
        { name: 'Grand Cru', value: grandCru.data().count },
        { name: 'Strategist', value: strategist.data().count },
        { name: 'AI Agent', value: aiAgent.data().count }
      ]
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 7. Audit Log
app.get('/api/admin/audit-log', async (req, res) => {
  try {
    const { userId } = req.query;
    let query: any = db.collection('audit_log').orderBy('timestamp', 'desc').limit(50);
    if (userId) {
      query = query.where('targetUserId', '==', userId);
    }
    const snapshot = await query.get();
    const logs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return res.json({ logs });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 8. Extend All Beta
app.post('/api/admin/extend-all-beta', async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const adminId = (req as any).adminId;
    const snapshot = await db.collection('users').where('beta_tester', '==', true).get();
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      const currentExpiry = doc.data().beta_expires_at?.toDate() || new Date();
      currentExpiry.setDate(currentExpiry.getDate() + days);
      batch.update(doc.ref, { beta_expires_at: currentExpiry });
      logAudit(adminId, 'EXTEND_BETA', doc.id, { beta_expires_at: currentExpiry });
    });
    
    await batch.commit();
    return res.json({ success: true, count: snapshot.size });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 9. Customer Portal Link
app.post('/api/admin/customer-portal', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const customerId = userDoc.data()?.dodoCustomerId;
    if (!customerId) return res.status(400).json({ error: 'User does not have a linked Dodo Payments Customer ID' });
    
    // Create customer portal session
    const portalSession = await dodo.customerPortal.create({
      customer_id: customerId
    });
    
    return res.json({ url: portalSession.url });
  } catch (error: any) {
    console.error("Dodo portal error:", error);
    return res.status(500).json({ error: error.message });
  }
});

export default app;
