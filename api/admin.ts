import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFirestore } from '../lib/firestore.js';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

let dodo: any = null;
let getAuth: any = null;
let initError: string | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Try dynamic imports inside the handler to prevent top-level Vercel crashes
  if (!dodo || !getAuth) {
    try {
      const authModule = await import('firebase-admin/auth');
      getAuth = authModule.getAuth;

      const dodoModule = await import('dodopayments');
      const DodoPayments = dodoModule.default || dodoModule;

      dodo = new DodoPayments({
        bearerToken: process.env.DODO_SECRET_KEY?.trim() || 'test',
        environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
      });

      if (!getApps().length) {
        const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (privateKey) {
          initializeApp({
            credential: cert({
              project_id: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() || '',
              client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL || '',
              private_key: privateKey,
            }),
          });
        } else {
          initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() });
        }
      }
    } catch (e: any) {
      initError = e.message || String(e);
      console.error("Dynamic import init error:", e);
    }
  }

  const db = getFirestore();
  const url = req.url || "/";
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  async function logAudit(adminId: string, action: string, targetUserId: string, changes: any) {
    await db.collection('audit_log').add({
      adminId,
      action,
      targetUserId,
      changes,
      timestamp: new Date()
    });
  }

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
    const adminId = decodedToken.uid;

    const userDoc = await db.collection('users').doc(adminId).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Requires admin role' });
    }

    // --- Routes ---
    
    if (url.includes('/api/admin/check') && req.method === 'GET') {
      return res.json({ success: true });
    }

    if (url.includes('/api/admin/grant-tier-access') && req.method === 'POST') {
      const { userId, tier, beta_expires_at, beta_tier, notes } = req.body;
      if (!userId || !tier) return res.status(400).json({ error: 'Missing userId or tier' });

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
    }

    if (url.includes('/api/admin/revoke-access') && req.method === 'POST') {
      const { userId } = req.body;
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
    }

    if (url.includes('/api/admin/search-users') && req.method === 'GET') {
      const q = (req.query.q as string || '').trim();

      if (q) {
        if (q.includes('@')) {
          try {
            const authUser = await getAuth().getUserByEmail(q);
            const userDoc = await db.collection('users').doc(authUser.uid).get();
            const data = userDoc.exists ? userDoc.data() : { tier: 'free' };
            return res.status(200).json({ users: [{ id: authUser.uid, email: authUser.email, ...data }] });
          } catch (e) {
            return res.status(200).json({ users: [] });
          }
        } else {
          // Try search by UID
          try {
            const authUser = await getAuth().getUser(q);
            const userDoc = await db.collection('users').doc(q).get();
            const data = userDoc.exists ? userDoc.data() : { tier: 'free' };
            return res.status(200).json({ users: [{ id: authUser.uid, email: authUser.email, ...data }] });
          } catch (e) {
            return res.status(200).json({ users: [] });
          }
        }
      }

      // No search, list recent 50 users
      const usersQuery = db.collection('users').limit(50);
      const usersSnapshot = await usersQuery.get();
      const firestoreUsers = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Fetch emails from Firebase Auth
      const identifiers = firestoreUsers.map(u => ({ uid: u.id }));
      if (identifiers.length > 0) {
        const authRecords = await getAuth().getUsers(identifiers);
        const emailMap = new Map();
        authRecords.users.forEach((r: any) => emailMap.set(r.uid, r.email));
        
        const mergedUsers = firestoreUsers.map(u => ({
          ...u,
          email: emailMap.get(u.id) || 'Unknown Email'
        }));
        return res.status(200).json({ users: mergedUsers });
      }
      return res.status(200).json({ users: [] });
    }

    if (url.includes('/api/admin/beta-testers') && req.method === 'GET') {
      const snapshot = await db.collection('users').where('beta_tester', '==', true).get();
      const testers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.json({ testers });
    }

    if (url.includes('/api/admin/bulk-grant-beta') && req.method === 'POST') {
      const { rows } = req.body;
      let successCount = 0;
      for (const row of rows) {
        const { email, tier, expiryDays } = row;
        const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!snapshot.empty) {
          const userDoc = snapshot.docs[0];
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + (parseInt(expiryDays) || 14));
          const updates = { tier, beta_tester: true, beta_expires_at: expiry, beta_tier: tier, updatedAt: new Date() };
          await userDoc.ref.set(updates, { merge: true });
          await logAudit(adminId, 'BULK_GRANT_BETA', userDoc.id, updates);
          successCount++;
        }
      }
      return res.json({ success: true, count: successCount });
    }

    if (url.includes('/api/admin/analytics/stats') && req.method === 'GET') {
      const usersRef = db.collection('users');
      const totalCount = await usersRef.count().get();
      const betaCount = await usersRef.where('beta_tester', '==', true).count().get();
      const payingCount = await usersRef.where('tier', '!=', 'free').count().get();

      const grandCru = await usersRef.where('tier', '==', 'grandCru').count().get();
      const strategist = await usersRef.where('tier', '==', 'strategist').count().get();
      const aiAgent = await usersRef.where('tier', '==', 'aiAgent').count().get();

      let recentPayments: any[] = [];
      let mrr = 0;
      try {
        const paymentsList = await dodo.payments.list({ limit: 10 });
        recentPayments = paymentsList.items || [];
        mrr = recentPayments.reduce((acc: number, p: any) => acc + (p.total_amount || 0), 0) / 100;
      } catch (dodoErr) {
        console.warn("Failed to fetch from Dodo Payments API:", dodoErr);
      }

      return res.json({
        totalUsers: totalCount.data().count,
        betaTesters: betaCount.data().count,
        payingUsers: payingCount.data().count - betaCount.data().count,
        mrr,
        recentPayments,
        tierDistribution: [
          { name: 'Grand Cru', value: grandCru.data().count },
          { name: 'Strategist', value: strategist.data().count },
          { name: 'AI Agent', value: aiAgent.data().count }
        ]
      });
    }

    if (url.includes('/api/admin/audit-log') && req.method === 'GET') {
      const userIdFilter = req.query.userId as string;
      let query: any = db.collection('audit_log').orderBy('timestamp', 'desc').limit(50);
      if (userIdFilter) query = query.where('targetUserId', '==', userIdFilter);
      const snapshot = await query.get();
      const logs = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      return res.json({ logs });
    }

    if (url.includes('/api/admin/extend-all-beta') && req.method === 'POST') {
      const { days = 7 } = req.body;
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
    }

    if (url.includes('/api/admin/customer-portal') && req.method === 'POST') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
      const customerId = userDoc.data()?.dodoCustomerId;
      if (!customerId) return res.status(400).json({ error: 'User does not have a linked Dodo Payments Customer ID' });
      
      const portalSession = await dodo.customers.customerPortal.create(customerId);
      return res.json({ url: portalSession.link });
    }

    return res.status(404).json({ error: "Admin route not found" });

  } catch (error: any) {
    console.error("Admin API Error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
