import { motion } from 'motion/react';
import { PlayerCard } from './PlayerCard';
import { RecommendationResponse, ScoredPlayer } from '../types';

interface PitchViewProps {
  data: RecommendationResponse | null;
  formation: {
    gkp: ScoredPlayer[];
    def: ScoredPlayer[];
    mid: ScoredPlayer[];
    fwd: ScoredPlayer[];
  };
}

export const PitchView = ({ data, formation }: PitchViewProps) => {
  return (
    <motion.div 
      key="pitch-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-grow flex flex-col justify-around py-4"
    >
      <div className="flex justify-around items-center">
        {formation.gkp.map(p => <PlayerCard key={p.id} player={p} isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)} />)}
      </div>
      <div className="flex justify-around items-center">
        {formation.def.map(p => <PlayerCard key={p.id} player={p} isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)} />)}
      </div>
      <div className="flex justify-around items-center">
        {formation.mid.map(p => <PlayerCard key={p.id} player={p} isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)} />)}
      </div>
      <div className="flex justify-around items-center">
        {formation.fwd.map(p => <PlayerCard key={p.id} player={p} isCaptain={!!(data?.captain?.id && p.id === data.captain.id)} isViceCaptain={!!(data?.viceCaptain?.id && p.id === data.viceCaptain.id)} />)}
      </div>

      {/* Pitch Bench Sub-Component */}
      <div className="mt-8 pt-4 border-t border-fpl-border/50">
        <div className="flex justify-center gap-2">
           {data?.bench?.filter(Boolean).map(p => <PlayerCard key={p.id} player={p} compact />)}
        </div>
        <p className="text-center text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-2 px-6">Substitution Bench</p>
      </div>
    </motion.div>
  );
};
