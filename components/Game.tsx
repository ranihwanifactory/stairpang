
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSound } from '../utils/audio';
import { rtdb } from '../firebase';
import { ref, update, onValue, off } from 'firebase/database';
import { CharacterSprite } from './CharacterSprite';

interface GameProps {
  roomId: string | 'practice'; // 'practice'일 경우 연습 모드
  uid: string;
  characterId: string;
  onFinish: (score: number) => void;
}

interface OpponentData {
  floor: number;
  charId: string;
  name: string;
  facing: number;
}

export const Game: React.FC<GameProps> = ({ roomId, uid, characterId, onFinish }) => {
  const isPractice = roomId === 'practice';
  const [floor, setFloor] = useState(0);
  const [facing, setFacing] = useState(1); // 0: Left, 1: Right
  const [stairs, setStairs] = useState<number[]>([]); // 0: Left, 1: Right
  const [opponentFloors, setOpponentFloors] = useState<Record<string, OpponentData>>({});
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [isDead, setIsDead] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  
  const timerRef = useRef<number>();
  const lastSyncFloor = useRef(0);
  const floorRef = useRef(0);
  const facingRef = useRef(1);
  const movingTimeoutRef = useRef<number>();

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

    let listener: any = null;
    if (!isPractice) {
      const roomRef = ref(rtdb, `rooms/${roomId}/players`);
      listener = onValue(roomRef, (snapshot) => {
        const players = snapshot.val();
        const opps: Record<string, OpponentData> = {};
        if (players) {
          Object.keys(players).forEach(pId => {
            if (pId !== uid) {
              opps[pId] = {
                floor: players[pId].currentFloor || 0,
                charId: players[pId].characterId || 'rabbit',
                name: players[pId].displayName || '친구',
                facing: players[pId].facing || 1
              };
            }
          });
        }
        setOpponentFloors(opps);
      });
    }

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
      if (!isPractice && listener) {
        const roomRef = ref(rtdb, `rooms/${roomId}/players`);
        off(roomRef, 'value', listener);
      }
      clearInterval(cdInterval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roomId, uid, generateStairs, isPractice]);

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
      setIsMoving(true);
      playSound('tap');
      
      if (movingTimeoutRef.current) clearTimeout(movingTimeoutRef.current);
      movingTimeoutRef.current = window.setTimeout(() => setIsMoving(false), 150);

      setTimeLeft(prev => Math.min(30, prev + (isPractice ? 0.3 : 0.2))); // 연습 모드는 조금 더 여유롭게

      if (!isPractice && nextFloor - lastSyncFloor.current >= 2) {
        lastSyncFloor.current = nextFloor;
        update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
          currentFloor: nextFloor,
          facing: nextFacing
        });
      }
    } else {
      gameOver();
    }
  }, [gameActive, isDead, stairs, roomId, uid, gameOver, isPractice]);

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
    <div className={`fixed inset-0 overflow-hidden ${isPractice ? 'bg-[#98FB98]' : 'bg-[#87CEEB]'} flex flex-col items-center font-['Jua'] select-none`}>
      {/* 배경 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute bottom-0 w-full h-64 bg-gradient-to-t ${isPractice ? 'from-green-500' : 'from-[#4a90e2]'} to-transparent opacity-30`}></div>
        <div className="absolute top-20 left-10 text-8xl opacity-20 animate-pulse">☁️</div>
        <div className="absolute top-60 right-10 text-9xl opacity-10 animate-pulse delay-700">☁️</div>
      </div>

      {/* HUD */}
      <div className="absolute top-6 left-0 right-0 px-6 flex justify-between items-start z-40">
        <div className="flex flex-col gap-2">
          <div className="bg-white/90 px-6 py-2 rounded-2xl font-bold text-3xl shadow-[0_4px_0_#ddd] text-[#333] border-2 border-white">
            {floor} <span className="text-sm">STAIRS</span>
          </div>
          <div className="w-48 h-6 bg-gray-200 rounded-full border-2 border-white overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-100 ${timeLeft < 5 ? 'bg-red-500' : isPractice ? 'bg-green-400' : 'bg-yellow-400'}`}
              style={{ width: `${(timeLeft / 30) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
           <div className={`${isPractice ? 'bg-green-600' : 'bg-pink-500'} text-white px-4 py-1 rounded-full text-sm font-bold shadow-md`}>
             {isPractice ? '열심히 연습 중! 🌱' : '실시간 대결 중! 🏁'}
           </div>
           {!isPractice && Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => (
             <div key={id} className="bg-white/80 px-3 py-1 rounded-lg text-xs font-bold border border-pink-200 flex items-center gap-2 animate-bounce">
               <span className="w-5 h-5 flex items-center justify-center">
                 <CharacterSprite type={data.charId} facing={1} isMoving={false} size={24} />
               </span>
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
             <p className="text-2xl text-gray-700">{isPractice ? '다시 도전해볼까요?' : '발을 헛디뎠어요!'}</p>
             <p className={`text-4xl ${isPractice ? 'text-green-500' : 'text-pink-500'} mt-4 font-bold`}>{floor}층 도달!</p>
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
          {/* 1. 계단 레이어 */}
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

          {/* 2. 경쟁자 레이어 (연습 모드에선 숨김) */}
          {!isPractice && Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => {
            const x = getStairX(data.floor);
            return (
              <div 
                key={`ghost-${id}`}
                className="absolute z-20 transition-all duration-300"
                style={{ 
                  bottom: `${data.floor * 40 + 40}px`,
                  left: `${x}px`,
                  transform: `translateX(-50%)` 
                }}
              >
                <CharacterSprite type={data.charId} facing={data.facing} isMoving={false} size={70} opacity={0.6} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap">
                  {data.name}
                </div>
              </div>
            );
          })}

          {/* 3. 플레이어 캐릭터 레이어 */}
          <div 
            className={`absolute z-30 transition-transform duration-100 ${isDead ? 'animate-ping' : ''}`}
            style={{ 
              bottom: `${floor * 40 + 40}px`,
              left: `${currentPlayerX}px`,
              transform: `translateX(-50%)` 
            }}
          >
            <CharacterSprite type={characterId} facing={facing} isMoving={isMoving} size={90} />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-3 bg-black/20 rounded-full blur-sm -z-10"></div>
          </div>
        </div>
      </div>

      <div className="w-full bg-white/90 backdrop-blur-md p-8 border-t-4 border-[#eee] z-40">
        <div className="max-w-md mx-auto flex justify-between gap-6 h-36">
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('up'); }}
            className={`flex-1 ${isPractice ? 'bg-green-500 hover:bg-green-600 shadow-[0_10px_0_#2e7d32]' : 'bg-[#4a90e2] hover:bg-[#357abd] shadow-[0_10px_0_#2a5a8e]'} active:scale-95 transition-all text-white rounded-3xl active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/20 group`}
          >
            <span className="text-5xl mb-1 group-active:scale-125 transition-transform">👣</span>
            <span className="font-bold text-xl uppercase tracking-widest">CLIMB</span>
          </button>
          
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('turn'); }}
            className={`flex-1 ${isPractice ? 'bg-orange-400 hover:bg-orange-500 shadow-[0_10px_0_#c47b00]' : 'bg-[#ff6b6b] hover:bg-[#ee5253] shadow-[0_10px_0_#b33939]'} active:scale-95 transition-all text-white rounded-3xl active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/20 group`}
          >
            <span className="text-5xl mb-1 group-active:rotate-180 transition-transform">🔄</span>
            <span className="font-bold text-xl uppercase tracking-widest">TURN</span>
          </button>
        </div>
      </div>
    </div>
  );
};
