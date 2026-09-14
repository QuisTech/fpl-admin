import { getFirestore } from "../lib/firestore.js";
import { tryVerifyAuth } from "./_lib/auth.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let rawUserId = (req.query.userId as string) || (req.body?.userId as string) || '';
  let userId = rawUserId;
  
  // Try safe auth verification without side-effecting res
  if (!rawUserId.startsWith('team_')) {
    const uid = await tryVerifyAuth(req);
    if (uid) userId = uid;
  }

  const isLocal = origin.includes('localhost') || !process.env.VERCEL;
  if (!userId) {
    if (isLocal) {
      userId = 'team_532002';
    } else {
      return res.status(400).json({ error: "Missing userId" });
    }
  }

  const db = getFirestore();

  try {
    if (req.method === 'GET') {
      const doc = await db.collection('user_snapshots').doc(userId).get();
      let history = (doc.exists && doc.data()?.history && typeof doc.data()?.history === 'object') ? doc.data()?.history : null;

      // If user doc has no history, check fallbacks:
      if (!history || Object.keys(history).length === 0) {
        // 1. Check if user has a profile with a linked fplTeamId
        try {
          const profileDoc = await db.collection('user_profiles').doc(userId).get();
          const profileTeamId = profileDoc.data()?.fplTeamId;
          if (profileTeamId) {
            const teamDoc = await db.collection('user_snapshots').doc(`team_${profileTeamId}`).get();
            if (teamDoc.exists && teamDoc.data()?.history && Object.keys(teamDoc.data()?.history).length > 0) {
              return res.json({ history: teamDoc.data()?.history });
            }
          }
        } catch (e) {
          // ignore
        }

        // 2. Local development fallback: load master team_532002 snapshots
        const isLocal = origin.includes('localhost') || !process.env.VERCEL;
        if (isLocal) {
          try {
            const masterDoc = await db.collection('user_snapshots').doc('team_532002').get();
            if (masterDoc.exists && masterDoc.data()?.history && Object.keys(masterDoc.data()?.history).length > 0) {
              return res.json({ history: masterDoc.data()?.history });
            }
          } catch (e) {
            // ignore
          }
        }

        return res.json({ history: {} });
      }

      return res.json({ history });
    }

    if (req.method === 'POST') {
      const { history, season } = req.body;
      if (!history || typeof history !== 'object') {
        return res.status(400).json({ error: "Invalid history payload" });
      }

      await db.collection('user_snapshots').doc(userId).set({
        history,
        season: season || '2026/27',
        updatedAt: new Date()
      });

      return res.json({ success: true, history });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("Snapshots API Error:", error);
    // In case Firestore is not initialized in dev, fail gracefully with 200 and empty object
    return res.json({ history: {}, warning: error.message });
  }
}
