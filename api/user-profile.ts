import { getFirestore } from "../lib/firestore.js";
import { verifyAuth } from "./_lib/auth.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  const { userId } = req.query as { userId?: string };

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const uid = await verifyAuth(req as any, res as any);
  if (!uid) return;
  if (uid !== userId) return res.status(403).json({ error: "Forbidden: Token mismatch" });

  const db = getFirestore();

  try {
    if (req.method === 'GET') {
      // Fetch profile
      const profile = await db.collection('user_profiles').doc(userId).get();
      if (!profile.exists) {
        return res.status(404).json({ error: "Profile not found" });
      }
      return res.json(profile.data());
    }

    if (req.method === 'PUT') {
      // Update profile
      const updates = req.body;

      if (updates.action === 'request_reset') {
        const existingDoc = await db.collection('user_profiles').doc(userId).get();
        const data = existingDoc.data() || {};
        if ((data.fplResetCount || 0) >= 1) {
          return res.status(403).json({ error: "You have already used your 1 free reset this season." });
        }
        await db.collection('user_profiles').doc(userId).set({
          fplTeamId: null,
          fplResetCount: (data.fplResetCount || 0) + 1
        }, { merge: true });
        return res.json({ success: true, message: "Team ID reset successfully." });
      }

      // If trying to set fplTeamId, check if one already exists
      if (updates.fplTeamId) {
        const existingDoc = await db.collection('user_profiles').doc(userId).get();
        if (existingDoc.exists && existingDoc.data()?.fplTeamId) {
          return res.status(403).json({ error: "FPL Team ID is permanently locked to your account and cannot be changed." });
        }
      }

      await db.collection('user_profiles').doc(userId).set(updates, { merge: true });
      return res.json({ success: true });
    }

    if (req.method === 'DELETE') {
      // Soft delete (anonymize data)
      await db.collection('user_profiles').doc(userId).update({
        deletedAt: new Date(),
        email: `deleted_${userId}@removed.com`,
        displayName: 'Deleted User'
      });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("Profile API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
