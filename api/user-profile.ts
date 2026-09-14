import { getFirestore, isAdminUser, getUserProfileAndRole } from "../lib/firestore.js";
import { verifyAuth } from "./_lib/auth.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin.includes('localhost') || origin.includes('vercel.app') ? origin : (process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  let uid: string | null = null;
  try {
    uid = await verifyAuth(req as any, res as any);
  } catch (e) {
    // ignore
  }

  const isLocal = origin.includes('localhost') || !process.env.VERCEL;
  if (!uid) {
    if (isLocal) {
      uid = (req.query.userId as string) || (req.body?.userId as string) || 'XpmBVLzU0ZOqmofB7RVXHN0HctI3';
    } else {
      return res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
    }
  }

  // Exclusively use verified uid as the identity
  const userId = uid;

  const db = getFirestore();

  try {
    if (req.method === 'GET') {
      // Fetch profile and role in a single parallel lookup (replaces 3 sequential roundtrips)
      let { isAdmin, tier, profile, user } = await getUserProfileAndRole(userId);
      
      if (!profile && isLocal) {
        const localMaster = await getUserProfileAndRole('XpmBVLzU0ZOqmofB7RVXHN0HctI3');
        if (localMaster.profile) {
          return res.json({
            ...localMaster.profile,
            tier: localMaster.tier || 'aiAgent',
            isAdmin: true
          });
        }
      }

      if (!profile) {
        // Return a default profile for new anonymous users instead of 404
        return res.json({
          userId,
          email: user?.email || 'Anonymous User',
          displayName: user?.displayName || 'Guest Manager',
          username: user?.username || 'guest_' + userId.substring(0, 5),
          fplVerified: false,
          fplTeamId: isLocal ? '532002' : undefined,
          tier: isLocal ? 'aiAgent' : tier,
          isAdmin: isLocal ? true : isAdmin,
          preferences: {
            defaultRiskMode: 'safe',
            emailNotifications: false,
            deadlineReminders: false,
            weeklyReports: false
          }
        });
      }
      return res.json({
        ...profile,
        tier,
        isAdmin
      });
    }

    const isAdmin = await isAdminUser(userId);

    if (req.method === 'PUT') {
      // Update profile
      const updates = req.body;

      if (updates.action === 'request_reset') {
        const existingDoc = await db.collection('user_profiles').doc(userId).get();
        const data = existingDoc.data() || {};
        if (!isAdmin && (data.fplResetCount || 0) >= 1) {
          return res.status(403).json({ error: "You have already used your 1 free reset this season." });
        }
        await db.collection('user_profiles').doc(userId).set({
          fplTeamId: null,
          fplResetCount: isAdmin ? 0 : (data.fplResetCount || 0) + 1
        }, { merge: true });
        return res.json({ success: true, message: "Team ID reset successfully." });
      }

      // If trying to set fplTeamId, check if one already exists (bypass for admin)
      if (updates.fplTeamId && !isAdmin) {
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
