import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
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
      const DodoPayments = (dodoModule.default || dodoModule) as any;

      dodo = new DodoPayments({
        bearerToken: process.env.DODO_SECRET_KEY?.trim() || 'test',
        environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
      });

      if (!getApps().length) {
        const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (privateKey) {
          initializeApp({
            credential: cert({
              projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() || '',
              clientEmail: process.env.GOOGLE_CLOUD_CLIENT_EMAIL || '',
              privateKey: privateKey,
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

    if (url.includes('/api/admin/run-backtest') && req.method === 'POST') {
      const { startGw, endGw } = req.body || {};
      const ghToken = process.env.GH_PAT || process.env.GITHUB_TOKEN;

      if (!ghToken) {
        return res.status(400).json({
          error: 'GitHub Token (GH_PAT) is not configured in Vercel Environment Variables. Please set GH_PAT with Actions write permission.'
        });
      }

      try {
        await axios.post(
          'https://api.github.com/repos/QuisTech/fpl-admin/actions/workflows/backtest-run.yml/dispatches',
          {
            ref: 'main',
            inputs: {
              start_gw: startGw ? String(startGw) : '1',
              end_gw: endGw ? String(endGw) : ''
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${ghToken.trim()}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'FPL-Admin-App'
            }
          }
        );

        await logAudit(adminId, 'TRIGGER_BACKTEST', adminId, { startGw, endGw });
        return res.json({
          success: true,
          message: `Backtest pipeline triggered on GitHub Actions for GW${startGw || 1} to GW${endGw || 'auto'}.`
        });
      } catch (err: any) {
        console.error('[Admin] Failed to trigger GitHub Action:', err?.response?.data || err.message);
        return res.status(500).json({
          error: `Failed to trigger GitHub Action: ${err?.response?.data?.message || err.message}`
        });
      }
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

    if (url.includes('/api/admin/clear-team-id') && req.method === 'POST') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      await db.collection('user_profiles').doc(userId).set({
        fplTeamId: null,
        fplResetCount: 0
      }, { merge: true });
      await logAudit(adminId, 'CLEAR_TEAM_ID', userId, { fplTeamId: null, fplResetCount: 0 });
      return res.json({ success: true });
    }

    if (url.includes('/api/admin/global-season-reset') && req.method === 'POST') {
      const snapshot = await db.collection('user_profiles').get();

      // Firestore batches are limited to 500 operations. We need to chunk if large, 
      // but assuming < 500 for hackathon MVP. We'll use a standard batch here.
      const batches = [];
      let currentBatch = db.batch();
      let operationCounter = 0;
      let totalCount = 0;

      snapshot.docs.forEach(doc => {
        currentBatch.set(doc.ref, { fplTeamId: null, fplResetCount: 0 }, { merge: true });
        operationCounter++;
        totalCount++;

        if (operationCounter === 499) {
          batches.push(currentBatch.commit());
          currentBatch = db.batch();
          operationCounter = 0;
        }
      });

      if (operationCounter > 0) {
        batches.push(currentBatch.commit());
      }

      await Promise.all(batches);
      await logAudit(adminId, 'GLOBAL_SEASON_RESET', 'ALL_USERS', { count_affected: totalCount });
      return res.json({ success: true, count: totalCount });
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
        try {
          const userRecord = await getAuth().getUserByEmail(email);
          const userId = userRecord.uid;
          
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + (parseInt(expiryDays) || 14));
          const updates = { tier, beta_tester: true, beta_expires_at: expiry, beta_tier: tier, updatedAt: new Date() };
          
          await db.collection('users').doc(userId).set(updates, { merge: true });
          await logAudit(adminId, 'BULK_GRANT_BETA', userId, updates);
          successCount++;
        } catch (e: any) {
          console.warn(`[Bulk Grant] Failed for ${email}:`, e.message);
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

    if (url.includes('/api/admin/fpl-tracker') && req.method === 'GET') {
      const trackedAccounts = [
        { email: 'michquis@gmail.com', teamId: 532002, mode: 'fplform-s-mode', label: 'FPLForm (Safe Mode)', group: 'FPLForm' },
        { email: 'quismich@gmail.com', teamId: 1884833, mode: 'fplform-risky-mode', label: 'FPLForm (Risky Mode)', group: 'FPLForm' },
        { email: 'smichqui@gmail.com', teamId: 3097103, mode: 'fplform-value-mode', label: 'FPLForm (Value Mode)', group: 'FPLForm' },

        { email: 'michael.marquis05@gmail.com', teamId: 902458, mode: 'eye-test-risky-mode', label: 'Eye-Test (Risky Mode)', group: 'Eye-Test' },
        { email: 'michaelmabbing8@gmail.com', teamId: 904491, mode: 'eye-test-value-mode', label: 'Eye-Test (Value Mode)', group: 'Eye-Test' },
        { email: 'abimbolamarquis@gmail.com', teamId: 601847, mode: 'eye-test-safe-mode', label: 'Eye-Test (Safe Mode)', group: 'Eye-Test' },

        { email: 'michaelmabbing@gmail.com', teamId: 906422, mode: 'native-risky-mode', label: 'Native FPL (Risky Mode)', group: 'Native FPL' },
        { email: 'michaelmabbing@yahoo.com', teamId: 1921923, mode: 'native-safe-mode', label: 'Native FPL (Safe Mode)', group: 'Native FPL' },
        { email: 'michealmabbing@gmail.com', teamId: 1924837, mode: 'native-value-mode', label: 'Native FPL (Value Mode)', group: 'Native FPL' },

        { email: 'brucelans@gmail.com', teamId: 600311, mode: 'fpl-strategist-s-m', label: 'FPL Strategist (Safe Mode)', group: 'Strategist' },

        { email: 'hydroquisc@gmail.com', teamId: 3274378, mode: 'fpl-optimizer-s-m', label: 'FPL Optimizer (Safe Mode)', group: 'Optimizer' },
        { email: 'cwfacwfa@gmail.com', teamId: 9291073, mode: 'fpl-optimizer-r-m', label: 'FPL Optimizer (Risky Mode)', group: 'Optimizer' },

        { email: 'inspirenovaent@gmail.com', teamId: 903137, mode: 'fpl-horizon-s-m', label: 'FPL Horizon (Safe Mode)', group: 'Horizon Flagship' },
        { email: 'inspirenovaenterprises@gmail.com', teamId: 903827, mode: 'fpl-horizon-r-m', label: 'FPL Horizon (Risky Mode)', group: 'Horizon Flagship' },
      ];

      const results = await Promise.allSettled(
        trackedAccounts.map(async (acc) => {
          try {
            const fplRes = await axios.get(`https://fantasy.premierleague.com/api/entry/${acc.teamId}/`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              timeout: 6000
            });
            const data = fplRes.data;
            return {
              ...acc,
              teamName: data.name || 'Unknown Squad',
              managerName: `${data.player_first_name || ''} ${data.player_last_name || ''}`.trim(),
              overallPoints: data.summary_overall_points ?? 0,
              overallRank: data.summary_overall_rank ?? null,
              gwPoints: data.summary_event_points ?? 0,
              gwRank: data.summary_event_rank ?? null,
              lastGw: data.current_event ?? null,
              status: 'active'
            };
          } catch (err: any) {
            return {
              ...acc,
              teamName: 'Unavailable',
              managerName: 'Unknown',
              overallPoints: 0,
              overallRank: null,
              gwPoints: 0,
              gwRank: null,
              lastGw: null,
              status: 'error',
              error: err.message
            };
          }
        })
      );

      const accountsData = results.map((r, i) => r.status === 'fulfilled' ? r.value : {
        ...trackedAccounts[i],
        teamName: 'Error',
        managerName: 'Unknown',
        overallPoints: 0,
        overallRank: null,
        gwPoints: 0,
        gwRank: null,
        lastGw: null,
        status: 'error'
      });

      return res.json({ trackedAccounts: accountsData, timestamp: Date.now() });
    }

    return res.status(404).json({ error: "Admin route not found" });

  } catch (error: any) {
    console.error("Admin API Error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
