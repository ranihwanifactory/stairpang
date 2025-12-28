
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSound } from '../utils/audio';
import { rtdb } from '../firebase';
import { ref, update, onValue, off } from 'firebase/database';

interface GameProps {
  roomId: string;
  uid: string;
  character: string;
  onFinish: (score: number) => void;
}

export const Game: React.FC<GameProps> = ({ roomId, uid, character, onFinish }) => {
  const [floor, setFloor] = useState(0);
  const [stairs, setStairs] = useState<number[]>([]); 
  const [currentDir, setCurrentDir] = useState(1); // 0: left, 1: right
  const [opponentFloors, setOpponentFloors] = useState<Record<string, { floor: number, char: string, name: string }>>({});
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(false);
  const [countdown, setCountdown] = useState(3);
  
  const timerRef = useRef<number>();
  const lastSyncFloor = useRef(0);

  // Initial setup & sync
  useEffect(() => {
    // Generate stairs (pseudo-random based on room ID for sync if needed, but here simple local)
    const initialStairs = Array.from({ length: 500 }, () => Math.round(Math.random()));
    setStairs(initialStairs);

    // Sync opponents
    const roomRef = ref(rtdb, `rooms/${roomId}/players`);
    const listener = onValue(roomRef, (snapshot) => {
      const players = snapshot.val();
      const opps: Record<string, any> = {};
      if (players) {
        Object.keys(players).forEach(pId => {
          if (pId !== uid) {
            opps[pId] = {
              floor: players[pId].currentFloor || 0,
              char: players[pId].character,
              name: players[pId].displayName
            };
          }
        });
      }
      setOpponentFloors(opps);
    });

    // Countdown before start
    const cdInterval = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(cdInterval);
          setGameActive(true);
          playSound('start');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      off(roomRef, 'value', listener);
      clearInterval(cdInterval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roomId, uid]);

  // Game timer
  useEffect(() => {
    if (gameActive) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setGameActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameActive]);

  // Finish handling
  useEffect(() => {
    if (!gameActive && countdown === 0 && timeLeft === 0) {
      onFinish(floor);
    }
  }, [gameActive, countdown, timeLeft, floor, onFinish]);

  const handleStep = useCallback((type: 'up' | 'turn') => {
    if (!gameActive) return;

    if (type === 'turn') {
      setCurrentDir(prev => (prev === 0 ? 1 : 0));
    }

    playSound('tap');
    const newFloor = floor + 1;
    setFloor(newFloor);
    
    // Throttled sync to RTDB (every 3 floors or every floor if critical)
    if (newFloor - lastSyncFloor.current >= 3) {
      lastSyncFloor.current = newFloor;
      update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
        currentFloor: newFloor
      });
    }
  }, [floor, gameActive, roomId, uid]);

  // Key handlers (PC)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameActive) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'f') handleStep('up');
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'j') handleStep('turn');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStep, gameActive]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-100 flex flex-col items-center font-['Jua'] select-none">
      {/* HUD */}
      <div className="absolute top-6 left-4 right-4 flex justify-between items-center z-20">
        <div className="bg-white/90 px-6 py-3 rounded-2xl font-bold text-2xl shadow-lg border-2 border-sky-200 text-sky-600 flex items-center gap-2">
          <span>🏠</span> {floor}층
        </div>
        <div className={`px-8 py-3 rounded-2xl text-white font-bold text-3xl shadow-lg border-2 border-white transition-colors ${timeLeft <= 5 ? 'bg-red-500 animate-pulse' : 'bg-pink-500'}`}>
          {timeLeft}초
        </div>
      </div>

      {/* Opponents Hud */}
      <div className="absolute top-24 left-4 z-20 flex flex-col gap-3 max-w-[150px]">
        {/* Fix: Explicitly cast to [string, any][] to avoid 'unknown' type errors during mapping */}
        {(Object.entries(opponentFloors) as [string, any][]).map(([id, data]) => (
          <div key={id} className="bg-white/70 backdrop-blur-sm px-4 py-2 rounded-xl text-xs font-bold text-sky-800 border border-sky-200 shadow-sm flex items-center gap-2">
            <span>{data.char}</span>
            <span className="truncate flex-1">{data.name}</span>
            <span className="text-pink-500">{data.floor}F</span>
          </div>
        ))}
      </div>

      {/* Countdown Overlay */}
      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex flex-center items-center justify-center">
           <div className="text-white text-9xl font-bold animate-ping">
             {countdown}
           </div>
        </div>
      )}

      {/* World Canvas Area */}
      <div className="flex-1 w-full flex items-center justify-center relative bg-gradient-to-b from-sky-300 to-sky-100">
        {/* Decorative Clouds */}
        <div className="absolute top-20 left-10 text-6xl opacity-20 animate-pulse">☁️</div>
        <div className="absolute top-40 right-20 text-8xl opacity-10 animate-pulse delay-700">☁️</div>
        
        <div className="relative transition-all duration-300 ease-out" style={{ transform: `translateY(${floor * 35}px)` }}>
          {Array.from({ length: 25 }).map((_, i) => {
            const stairLevel = floor - 5 + i;
            if (stairLevel < 0) return null;
            
            const isPlayerHere = stairLevel === floor;
            // Visual pattern for stairs
            const xOffset = stairLevel * 40; // Simplified sync-less visual
            
            return (
              <div 
                key={i} 
                className={`absolute w-36 h-12 bg-white border-b-8 border-sky-200 shadow-lg rounded-xl flex items-center justify-center transition-all duration-300`}
                style={{ 
                  bottom: `${stairLevel * 35}px`,
                  left: `calc(50% + ${ (currentDir === 1 ? xOffset : -xOffset) % 100 }px)`, // Visual drift for fun
                  transform: `translateX(-50%)`,
                  opacity: Math.max(0, 1 - Math.abs(stairLevel - floor) / 12)
                }}
              >
                {/* Visual indicator for stair index */}
                <span className="absolute left-2 top-1 text-[8px] text-sky-100">{stairLevel}</span>
                
                {/* Player Character */}
                {isPlayerHere && (
                  <div className="absolute -top-14 text-6xl drop-shadow-2xl animate-bounce">
                    {character}
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-black/10 rounded-full blur-sm"></div>
                  </div>
                )}

                {/* Opponents Mini Icons */}
                <div className="absolute -top-6 flex gap-1">
                  {/* Fix: Explicitly cast to [string, any][] to avoid 'unknown' type errors during mapping */}
                  {(Object.entries(opponentFloors) as [string, any][]).map(([id, data]) => 
                    data.floor === stairLevel ? (
                      <span key={id} className="text-2xl opacity-80 animate-pulse">{data.char}</span>
                    ) : null
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controller Area */}
      <div className="w-full bg-white/80 backdrop-blur-md p-8 border-t-4 border-sky-200 z-30">
        <div className="max-w-md mx-auto flex justify-between gap-6 h-36">
          <button 
            onTouchStart={() => handleStep('up')}
            onClick={() => handleStep('up')}
            className="flex-1 bg-sky-400 hover:bg-sky-500 active:scale-95 transition-all text-white rounded-3xl shadow-[0_8px_0_rgb(3,105,161)] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-2 border-white/20"
          >
            <span className="text-5xl mb-1">⬆️</span>
            <span className="font-bold text-xl">쭉쭉 위로!</span>
            <span className="text-[10px] opacity-60 font-bold mt-1">왼쪽 (A, F 키)</span>
          </button>
          
          <button 
            onTouchStart={() => handleStep('turn')}
            onClick={() => handleStep('turn')}
            className="flex-1 bg-pink-400 hover:bg-pink-500 active:scale-95 transition-all text-white rounded-3xl shadow-[0_8px_0_rgb(190,24,93)] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-2 border-white/20"
          >
            <span className="text-5xl mb-1">🔄</span>
            <span className="font-bold text-xl">방향바꿔!</span>
            <span className="text-[10px] opacity-60 font-bold mt-1">오른쪽 (D, J 키)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
