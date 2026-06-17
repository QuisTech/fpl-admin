import DodoPayments from 'dodopayments';

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_SECRET_KEY?.trim(),
  environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
});

import { verifyAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Authenticate user securely
  const uid = await verifyAuth(req, res);
  if (!uid) return;
  
  const { tier, successUrl, cancelUrl, customerEmail, customerName } = req.body;
  const userId = uid; // Enforce Zero-Trust: Ignore client-provided userId
  
  if (!tier) {
    return res.status(400).json({ error: 'Missing tier' });
  }
  
  // Product IDs from Dodo Payments dashboard (pdt_...)
  const productIds = {
    strategist: process.env.DODO_PRICE_STRATEGIST?.trim(),
    grandCru: process.env.DODO_PRICE_GRAND_CRU?.trim(),
    aiAgent: process.env.DODO_PRICE_AI_AGENT?.trim(),
    betaPilot: process.env.DODO_PRICE_AI_AGENT?.trim()
  };
  
  const productId = productIds[tier];
  if (!productId) {
    return res.status(400).json({ error: 'Invalid tier selected' });
  }
  
  try {
    // Determine the app URL from Vercel environment or request origin
    const appUrl = process.env.APP_URL || (req.headers.origin ? req.headers.origin : (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'));

    // Create checkout session with Dodo Payments actual payload structure
    const session = await dodo.checkoutSessions.create({
      product_cart: [
        {
          product_id: productId,
          quantity: 1
        }
      ],
      // return_url handles both success and cancellation in Dodo
      return_url: successUrl || `${appUrl}/dashboard?session_id=dodopayments_session`,
      ...(customerEmail || customerName ? {
        customer: {
          ...(customerEmail && { email: customerEmail }),
          ...(customerName && { name: customerName })
        }
      } : {}),
      metadata: {
        tier,
        userId
      }
    });
    
    // Return the checkout URL
    res.json({
      success: true,
      url: session.checkout_url
    });
    
  } catch (error) {
    console.error('Dodo Payments error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message || 'Unknown error'
    });
  }
}
