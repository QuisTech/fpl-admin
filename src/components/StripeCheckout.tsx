import { useState } from 'react';
import { cn } from '../lib/utils';

interface Props {
  userId: string;
  tier: 'strategist' | 'grandCru' | 'aiAgent' | 'betaPilot';
  buttonText?: string;
  className?: string;
}

const tierPrices = {
  strategist: '$9.99',
  grandCru: '$24.99',
  aiAgent: '$49.99',
  betaPilot: '$49.99'
};

import axios from 'axios';

export const StripeCheckout = ({ userId, tier, buttonText, className }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      setLoading(true);
      const response = await axios.post('/api/create-checkout', { userId, tier });
      const data = response.data;
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Checkout failed: " + (data.error || data.message || 'Unknown error'));
        setLoading(false);
      }
    } catch (err: any) {
      alert("Checkout failed: " + (err.response?.data?.error || err.message || 'Unknown error'));
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={cn(
        className || "w-full bg-fpl-green text-slate-950 font-black py-3 rounded-xl hover:bg-fpl-green/90 transition-all disabled:opacity-50"
      )}
    >
      {loading ? 'Processing...' : (buttonText || `Upgrade to ${tier} - ${tierPrices[tier]}/month`)}
    </button>
  );
};
