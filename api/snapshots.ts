import { getFirestore } from "../lib/firestore.js";
import { verifyAuth } from "./_lib/auth.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let userId = (req.query.userId as string) || (req.body?.userId as string) || '';
  
  // Try verifying Firebase auth token if present
  try {
    const uid = await verifyAuth(req as any, res as any);
    if (uid) userId = uid;
  } catch (e) {
    // Fall back to query/body userId for guest/anonymous sessions
  }

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const db = getFirestore();

  try {
    if (req.method === 'GET') {
      const doc = await db.collection('user_snapshots').doc(userId).get();
      if (!doc.exists) {
        return res.json({ history: {} });
      }
      return res.json({ history: doc.data()?.history || {} });
    }

    if (req.method === 'POST') {
      const { history } = req.body;
      if (!history || typeof history !== 'object') {
        return res.status(400).json({ error: "Invalid history payload" });
      }

      await db.collection('user_snapshots').doc(userId).set({
        history,
        updatedAt: new Date()
      }, { merge: true });

      return res.json({ success: true, history });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("Snapshots API Error:", error);
    // In case Firestore is not initialized in dev, fail gracefully with 200 and empty object
    return res.json({ history: {}, warning: error.message });
  }
}
