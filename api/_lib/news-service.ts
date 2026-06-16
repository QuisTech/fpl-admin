import { getFirestore } from '../../lib/firestore.js';

export interface FPLContext {
  generatedAt: string;
  injuries: { playerId: number; playerName: string; status: string; confidence: number; }[];
  doubts: { playerId: number; playerName: string; status: string; }[];
  returns: { playerId: number; playerName: string; status: string; }[];
  rotationRisks: { playerId: number; playerName: string; reason: string; }[];
  opportunities: { playerId: number; playerName: string; reason: string; }[];
}

export async function getNewsContextFromCache(): Promise<FPLContext | null> {
  const db = getFirestore();
  const doc = await db.collection('system').doc('fpl_news_context').get();
  if (doc.exists) {
    return doc.data() as FPLContext;
  }
  return null;
}
