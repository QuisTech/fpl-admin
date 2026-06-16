import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

export async function verifyAuth(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
    return null;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() || '',
          clientEmail: process.env.GOOGLE_CLOUD_CLIENT_EMAIL || '',
          privateKey: (process.env.GOOGLE_CLOUD_PRIVATE_KEY || '').replace(/\\n/g, '\n')
        })
      });
    }
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.error("[Auth] Invalid ID token", error);
    res.status(403).json({ error: "Forbidden: Invalid token" });
    return null;
  }
}
