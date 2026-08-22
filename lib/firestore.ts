import { Firestore } from '@google-cloud/firestore';

let db: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!db) {
    db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim(),
      credentials: {
        client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n')
      },
      ignoreUndefinedProperties: true,
      // In development, use emulator if available
      ...(process.env.NODE_ENV === 'development' && process.env.FIRESTORE_EMULATOR_HOST ? {
        host: process.env.FIRESTORE_EMULATOR_HOST,
        ssl: false
      } : {})
    });
  }
  return db;
}

export interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  username: string;
  avatar?: string;
  phoneNumber?: string;
  language: 'en' | 'es' | 'fr';
  fplTeamId?: string;
  fplVerified: boolean;
  tier?: string;
  seasonGoal?: 'top10k' | 'top100k' | 'top1m' | 'winMiniLeague';
  preferences: {
    defaultRiskMode: 'safe' | 'aggressive' | 'value';
    emailNotifications: boolean;
    deadlineReminders: boolean;
    weeklyReports: boolean;
  };
  connectedAccounts: {
    google?: { uid: string; email: string };
    github?: { uid: string; username: string };
    facebook?: { uid: string; email: string };
  };
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIDecision {
  userId: string;
  gameweek: number;
  decision: string;
  reasoning: string;
  confidence: number;
  details: {
    transfersIn?: number[];
    transfersOut?: number[];
    chipName?: string;
  };
  timestamp?: Date;
  modelUsed: string;
  riskMode?: string;
  userPrompt?: string;
}

export async function logAIDecision(decision: AIDecision): Promise<string> {
  const db = getFirestore();
  const docRef = await db.collection('ai_decisions').add({
    ...decision,
    timestamp: new Date()
  });
  return docRef.id;
}

export async function getAIDecisions(userId: string, limit = 50): Promise<AIDecision[]> {
  const db = getFirestore();
  const snapshot = await db.collection('ai_decisions')
    .where('userId', '==', userId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as any));
}

export const SUPER_ADMIN_EMAILS = ['michquis@gmail.com'];

export async function isAdminUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const db = getFirestore();
  try {
    const [userDoc, profileDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('user_profiles').doc(userId).get()
    ]);
    const uData = userDoc.data() || {};
    const pData = profileDoc.data() || {};
    const email = (uData.email || pData.email || '').toLowerCase().trim();
    if (SUPER_ADMIN_EMAILS.includes(email)) return true;
    if (uData.role === 'admin' || uData.tier === 'admin' || pData.role === 'admin' || pData.tier === 'admin') return true;
  } catch (err) {
    console.error("[Firestore] Error checking admin status:", err);
  }
  return false;
}

export async function getUserTier(userId: string): Promise<string> {
  if (!userId) return 'free';
  const db = getFirestore();
  const userDoc = await db.collection('users').doc(userId).get();
  if (userDoc.exists) {
    const data = userDoc.data();
    return data?.tier || 'free';
  }
  return 'free';
}

export async function mergeUserTiers(anonymousId: string, newUserId: string): Promise<boolean> {
  if (!anonymousId || !newUserId || anonymousId === newUserId) return false;
  
  const db = getFirestore();
  const anonDocRef = db.collection('users').doc(anonymousId);
  const newDocRef = db.collection('users').doc(newUserId);
  
  try {
    const anonDoc = await anonDocRef.get();
    if (anonDoc.exists) {
      const anonData = anonDoc.data();
      if (anonData?.tier && anonData.tier !== 'free') {
        // Copy tier to new user
        await newDocRef.set({
          tier: anonData.tier,
          mergedFrom: anonymousId,
          updatedAt: new Date()
        }, { merge: true });
        
        // Optional: clear the anonymous tier or mark as merged
        await anonDocRef.update({
          tier: 'free',
          mergedTo: newUserId,
          mergedAt: new Date()
        });
        
        return true;
      }
    }
  } catch (error) {
    console.error("Error merging user tiers:", error);
  }
  
  return false;
}
