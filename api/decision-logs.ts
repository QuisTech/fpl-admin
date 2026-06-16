import { getFirestore } from '../lib/firestore.js';
import { verifyAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, limit = '50' } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const uid = await verifyAuth(req, res);
  if (!uid) return;
  if (uid !== userId) return res.status(403).json({ error: 'Forbidden: Token mismatch' });

  let db;
  try {
    db = getFirestore();
  } catch (dbError: any) {
    console.error('[DecisionLogs] Firestore init failed:', dbError.message);
    return res.status(503).json({ 
      error: 'Database temporarily unavailable',
      decisions: [],
      revenue: { transactions: [], total: 0, currency: 'USD' },
      metadata: { lastUpdated: new Date().toISOString() }
    });
  }

  try {
    // Get AI decisions
    const decisionsSnapshot = await db.collection('ai_decisions')
      .where('userId', '==', userId)
      .get();
    
    let decisions = decisionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
    }));

    // Sort in-memory to avoid needing a Firestore composite index on (userId, timestamp)
    decisions.sort((a: any, b: any) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    // Apply limit
    decisions = decisions.slice(0, parseInt(limit as string));

    // Get revenue from Dodo Payments — wrapped separately so it can't crash decisions
    let revenue: any[] = [];
    let totalRevenue = 0;
    try {
      const revenueSnapshot = await db.collection('revenue')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();
      
      revenue = revenueSnapshot.docs.map(doc => ({
        amount: doc.data().amount,
        tier: doc.data().tier,
        currency: doc.data().currency,
        timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
      }));
      totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    } catch (revError: any) {
      console.warn('[DecisionLogs] Revenue query failed (non-fatal):', revError.message);
    }

    res.json({
      success: true,
      decisions,
      revenue: {
        transactions: revenue,
        total: totalRevenue,
        currency: 'USD'
      },
      metadata: {
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[DecisionLogs] Query error:', error.message);
    
    // Check if it's a Firestore index error
    if (error.message?.includes('index')) {
      console.error('[DecisionLogs] HINT: You may need to create a Firestore composite index. Check the URL in the error above.');
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch decision logs',
      message: error.message,
      // Still return empty structure so the frontend doesn't break
      decisions: [],
      revenue: { transactions: [], total: 0, currency: 'USD' },
      metadata: { lastUpdated: new Date().toISOString() }
    });
  }
}
