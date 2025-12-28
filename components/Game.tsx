
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
  const [stairs, setStairs] = useState<number[]>([]); // 0: left, 1: right
  const [currentDir, setCurrentDir] = useState(1); // 0 or 1
  const [opponentFloors, setOpponentFloors] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(true);
  
  const timerRef = useRef<number>();

  // Initialize stairs
  useEffect(() => {
    const initialStairs = Array.from({ length: 50 }, () => Math.round(Math.random()));
    setStairs(initialStairs);
    playSound('start');

    // Sync with RTDB
    const roomRef = ref(rtdb, `rooms/${roomId}/players`);
    onValue(roomRef, (snapshot) => {
      const players = snapshot.val();
      const opps: Record<string, number> = {};
      if (players) {
        Object.keys(players).forEach(pId => {
          if (pId !== uid) opps[pId] = players[pId].currentFloor || 0;
        });
      }
      setOpponentFloors(opps);
    });

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

    return () => {
      off(roomRef);
      clearInterval(timerRef.current);
    };
  }, [roomId, uid]);

  useEffect(() => {
    if (!gameActive) {
      onFinish(floor);
    }
  }, [gameActive, floor, onFinish]);

  const handleStep = useCallback((type: 'up' | 'turn') => {
    if (!gameActive) return;

    const nextStair = stairs[floor % stairs.length];
    let correct = false;

    if (type === 'up') {
      correct = true; 
    } else {
      setCurrentDir(prev => (prev === 0 ? 1 : 0));
      correct = true;
    }

    if (correct) {
      playSound('tap');
      const newFloor = floor + 1;
      setFloor(newFloor);
      
      if (newFloor % 5 === 0) {
        update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
          currentFloor: newFloor
        });
      }
    }
  }, [floor, stairs, gameActive, roomId, uid]);

  // Key handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') handleStep('up');
      if (e.key === 'ArrowRight' || e.key === 'd') handleStep('turn');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStep]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-sky-100 flex flex-col items-center">
      {/* HUD */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10">
        <div className="bg-white/80 px-4 py-2 rounded-full font-bold text-2xl shadow-md border-2 border-sky-200">
          ☁️ {floor}층
        </div>
        <div className="bg-pink-500 px-6 py-2 rounded-full text-white font-bold text-2xl shadow-lg animate-pulse border-2 border-white">
          ⏰ {timeLeft}초
        </div>
      </div>

      {/* Opponent Tracker */}
      <div className="absolute top-20 left-4 z-10 flex flex-col gap-2">
        {Object.entries(opponentFloors).map(([id, f]) => (
          <div key={id} className="bg-white/50 px-3 py-1 rounded-full text-sm font-bold text-sky-800 border border-sky-200">
            상대방 친구: {f}층
          </div>
        ))}
      </div>

      {/* Visual Stairs & Player */}
      <div className="flex-1 w-full flex items-center justify-center relative">
        <div className="relative transition-transform duration-200" style={{ transform: `translateY(${floor * 10}px)` }}>
          {Array.from({ length: 20 }).map((_, i) => {
            const isPlayerHere = (floor - 5 + i) === floor;
            const xPos = (floor - 5 + i) * (currentDir === 1 ? 40 : -40);
            
            return (
              <div 
                key={i} 
                className={`absolute w-32 h-10 bg-white border-b-4 border-sky-200 shadow-sm rounded-lg flex items-center justify-center text-2xl transition-all duration-300`}
                style={{ 
                  bottom: `${(floor - 5 + i) * 30}px`,
                  left: `calc(50% + ${xPos}px)`,
                  transform: 'translateX(-50%)',
                  opacity: Math.max(0, 1 - Math.abs(isPlayerHere ? 0 : (floor - 5 + i) - floor) / 10)
                }}
              >
                {isPlayerHere && <span className="text-4xl animate-bounce drop-shadow-lg">{character}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-10 left-0 right-0 px-8 flex justify-between gap-4 h-32">
        <button 
          onClick={() => handleStep('up')}
          className="flex-1 bg-white border-4 border-sky-400 rounded-3xl shadow-xl active:scale-95 transition flex flex-col items-center justify-center"
        >
          <span className="text-4xl">⬆️</span>
          <span className="font-bold text-sky-600">올라가기</span>
        </button>
        <button 
          onClick={() => handleStep('turn')}
          className="flex-1 bg-white border-4 border-pink-400 rounded-3xl shadow-xl active:scale-95 transition flex flex-col items-center justify-center"
        >
          <span className="text-4xl">🔄</span>
          <span className="font-bold text-pink-600">방향전환</span>
        </button>
      </div>
    </div>
  );
};
