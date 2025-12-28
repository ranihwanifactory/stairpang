
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

interface OpponentData {
  floor: number;
  char: string;
  name: string;
  facing: number;
}

export const Game: React.FC<GameProps> = ({ roomId, uid, character, onFinish }) => {
  const [floor, setFloor] = useState(0);
  const [facing, setFacing] = useState(1); // 0: Left, 1: Right
  const [stairs, setStairs] = useState<number[]>([]); // 0: Left, 1: Right
  const [opponentFloors, setOpponentFloors] = useState<Record<string, OpponentData>>({});
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [isDead, setIsDead] = useState(false);
  
  const timerRef = useRef<number>();
  const lastSyncFloor = useRef(0);
  const floorRef = useRef(0);
  const facingRef = useRef(1);

  const generateStairs = useCallback(() => {
    const newStairs = [1];
    let currentX = 1;
    for (let i = 1; i < 1000; i++) {
      const change = Math.random() > 0.7;
      if (change) {
        currentX = currentX === 1 ? 0 : 1;
      }
      newStairs.push(currentX);
    }
    setStairs(newStairs);
  }, []);

  useEffect(() => {
    generateStairs();

    const roomRef = ref(rtdb, `rooms/${roomId}/players`);
    const listener = onValue(roomRef, (snapshot) => {
      const players = snapshot.val();
      const opps: Record<string, OpponentData> = {};
      if (players) {
        Object.keys(players).forEach(pId => {
          if (pId !== uid) {
            opps[pId] = {
              floor: players[pId].currentFloor || 0,
              char: players[pId].character || '?',
              name: players[pId].displayName || '친구',
              facing: players[pId].facing || 1
            };
          }
        });
      }
      setOpponentFloors(opps);
    });

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
  }, [roomId, uid, generateStairs]);

  useEffect(() => {
    if (gameActive && !isDead) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0.1) {
            clearInterval(timerRef.current);
            setGameActive(false);
            return 0;
          }
          return Math.max(0, prev - 0.1);
        });
      }, 100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameActive, isDead]);

  const gameOver = useCallback(() => {
    setIsDead(true);
    setGameActive(false);
    playSound('lose');
    setTimeout(() => onFinish(floorRef.current), 1500);
  }, [onFinish]);

  const handleStep = useCallback((type: 'up' | 'turn') => {
    if (!gameActive || isDead) return;

    let nextFacing = facingRef.current;
    if (type === 'turn') {
      nextFacing = nextFacing === 1 ? 0 : 1;
    }

    const nextFloor = floorRef.current + 1;
    
    if (stairs[nextFloor] === nextFacing) {
      floorRef.current = nextFloor;
      facingRef.current = nextFacing;
      setFloor(nextFloor);
      setFacing(nextFacing);
      playSound('tap');
      setTimeLeft(prev => Math.min(30, prev + 0.2));

      if (nextFloor - lastSyncFloor.current >= 2) {
        lastSyncFloor.current = nextFloor;
        update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
          currentFloor: nextFloor,
          facing: nextFacing
        });
      }
    } else {
      gameOver();
    }
  }, [gameActive, isDead, stairs, roomId, uid, gameOver]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'f') handleStep('up');
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'j') handleStep('turn');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStep]);

  const getStairX = (index: number) => {
    let x = 0;
    for (let i = 1; i <= index; i++) {
      x += (stairs[i] === 1 ? 40 : -40);
    }
    return x;
  };

  const currentPlayerX = getStairX(floor);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#87CEEB] flex flex-col items-center font-['Jua'] select-none">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 w-full h-64 bg-gradient-to-t from-[#4a90e2] to-transparent opacity-30"></div>
        <div className="absolute top-20 left-10 text-8xl opacity-20 animate-pulse">☁️</div>
        <div className="absolute top-60 right-10 text-9xl opacity-10 animate-pulse delay-700">☁️</div>
      </div>

      <div className="absolute top-6 left-0 right-0 px-6 flex justify-between items-start z-40">
        <div className="flex flex-col gap-2">
          <div className="bg-white/90 px-6 py-2 rounded-2xl font-bold text-3xl shadow-[0_4px_0_#ddd] text-[#333] border-2 border-white">
            {floor} <span className="text-sm">STAIRS</span>
          </div>
          <div className="w-48 h-6 bg-gray-200 rounded-full border-2 border-white overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-100 ${timeLeft < 5 ? 'bg-red-500' : 'bg-yellow-400'}`}
              style={{ width: `${(timeLeft / 30) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
           <div className="bg-pink-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-md">
             실시간 대결 중! 🏁
           </div>
           {Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => (
             <div key={id} className="bg-white/80 px-3 py-1 rounded-lg text-xs font-bold border border-pink-200 flex items-center gap-2 animate-bounce">
               <span>{data.char}</span>
               <span>{data.name}: {data.floor}F</span>
             </div>
           ))}
        </div>
      </div>

      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center">
           <div className="text-white text-9xl font-bold animate-bounce drop-shadow-2xl">
             {countdown}
           </div>
        </div>
      )}

      {isDead && (
        <div className="absolute inset-0 z-50 bg-red-500/20 backdrop-blur-md flex flex-col items-center justify-center">
           <div className="bg-white p-8 rounded-3xl shadow-2xl border-4 border-red-500 text-center animate-bounce">
             <h2 className="text-6xl text-red-500 mb-4">으악! 😵</h2>
             <p className="text-2xl text-gray-700">발을 헛디뎠어요!</p>
             <p className="text-4xl text-pink-500 mt-4 font-bold">{floor}층 도달!</p>
           </div>
        </div>
      )}

      {/* 게임 월드 */}
      <div className="flex-1 w-full relative flex items-center justify-center">
        <div 
          className="relative transition-all duration-150 ease-out"
          style={{ 
            transform: `translate(${-currentPlayerX}px, ${floor * 40}px)`,
          }}
        >
          {/* 1. 계단 레이어 (가장 뒤) */}
          {Array.from({ length: 40 }).map((_, i) => {
            const stairIndex = floor - 10 + i;
            if (stairIndex < 0) return null;
            const x = getStairX(stairIndex);
            return (
              <div 
                key={`stair-${stairIndex}`}
                className="absolute w-32 h-10 bg-[#f0f0f0] border-b-8 border-[#ccc] rounded-lg shadow-md flex items-center justify-center z-10"
                style={{
                  bottom: `${stairIndex * 40}px`,
                  left: `${x}px`,
                  transform: 'translateX(-50%)',
                  opacity: Math.max(0, 1 - Math.abs(stairIndex - floor) / 20)
                }}
              >
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '4px 4px' }}></div>
              </div>
            );
          })}

          {/* 2. 경쟁자(고스트) 레이어 (중간) */}
          {Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => {
            const x = getStairX(data.floor);
            return (
              <div 
                key={`ghost-${id}`}
                className="absolute text-5xl opacity-50 z-20 transition-all duration-300"
                style={{ 
                  bottom: `${data.floor * 40 + 40}px`, // 발판 높이만큼 보정
                  left: `${x}px`,
                  transform: `translateX(-50%) scaleX(${data.facing === 1 ? 1 : -1})` 
                }}
              >
                {data.char}
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap">
                  {data.name}
                </div>
              </div>
            );
          })}

          {/* 3. 플레이어 캐릭터 레이어 (가장 앞) */}
          <div 
            className={`absolute text-7xl z-30 transition-transform duration-100 ${isDead ? 'animate-ping' : ''}`}
            style={{ 
              bottom: `${floor * 40 + 40}px`, // 발판 위에 서 있도록 보정
              left: `${currentPlayerX}px`,
              transform: `translateX(-50%) scaleX(${facing === 1 ? 1 : -1})` 
            }}
          >
            {character}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-3 bg-black/20 rounded-full blur-sm -z-10"></div>
          </div>
        </div>
      </div>

      <div className="w-full bg-white/90 backdrop-blur-md p-8 border-t-4 border-[#eee] z-40">
        <div className="max-w-md mx-auto flex justify-between gap-6 h-36">
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('up'); }}
            className="flex-1 bg-[#4a90e2] hover:bg-[#357abd] active:scale-95 transition-all text-white rounded-3xl shadow-[0_10px_0_#2a5a8e] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/20 group"
          >
            <span className="text-5xl mb-1 group-active:scale-125 transition-transform">👣</span>
            <span className="font-bold text-xl uppercase tracking-widest">CLIMB</span>
            <span className="text-[10px] opacity-70">PC: [A] [F] [←]</span>
          </button>
          
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('turn'); }}
            className="flex-1 bg-[#ff6b6b] hover:bg-[#ee5253] active:scale-95 transition-all text-white rounded-3xl shadow-[0_10px_0_#b33939] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/20 group"
          >
            <span className="text-5xl mb-1 group-active:rotate-180 transition-transform">🔄</span>
            <span className="font-bold text-xl uppercase tracking-widest">TURN</span>
            <span className="text-[10px] opacity-70">PC: [D] [J] [→]</span>
          </button>
        </div>
      </div>
    </div>
  );
};
