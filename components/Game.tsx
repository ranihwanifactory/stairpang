
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSound } from '../utils/audio';
import { rtdb } from '../firebase';
import { ref, update, onValue, off, get } from 'firebase/database';
import { CharacterSprite } from './CharacterSprite';

interface GameProps {
  roomId: string | 'practice';
  uid: string;
  characterId: string;
  onFinish: (score: number, isWinner: boolean) => void;
  customImageUrl?: string;
  stairSequence?: number[];
}

interface OpponentData {
  uid: string;
  floor: number;
  charId: string;
  name: string;
  facing: number;
  customImageUrl?: string;
}

export const Game: React.FC<GameProps> = ({ roomId, uid, characterId, onFinish, customImageUrl, stairSequence }) => {
  const isPractice = roomId === 'practice';
  const [floor, setFloor] = useState(0);
  const [facing, setFacing] = useState(1);
  const [stairs, setStairs] = useState<number[]>([]);
  const [opponentFloors, setOpponentFloors] = useState<Record<string, OpponentData>>({});
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [result, setResult] = useState<'win' | 'lose' | null>(null);
  const [isDead, setIsDead] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  
  const timerRef = useRef<any>(null);
  const lastSyncFloor = useRef(0);
  const floorRef = useRef(0);
  const facingRef = useRef(1);
  const movingTimeoutRef = useRef<any>(null);

  const generateStairs = useCallback(() => {
    if (!isPractice && stairSequence) {
      setStairs(stairSequence);
      return;
    }
    const startDir = 1;
    const newStairs = [startDir, startDir]; 
    let currentX = startDir;
    for (let i = 2; i < 1000; i++) {
      if (Math.random() > 0.7) currentX = currentX === 1 ? 0 : 1;
      newStairs.push(currentX);
    }
    setStairs(newStairs);
  }, [isPractice, stairSequence]);

  const resetPracticeGame = useCallback(() => {
    floorRef.current = 0;
    facingRef.current = 1;
    lastSyncFloor.current = 0;
    setFloor(0);
    setFacing(1);
    setTimeLeft(30);
    setIsDead(false);
    setIsMoving(false);
    setResult(null);
    setCountdown(3);
    setGameActive(false);
    generateStairs();
  }, [generateStairs]);

  const gameOver = useCallback(async () => {
    if (!gameActive || result || isDead) return;
    
    setIsDead(true);
    setGameActive(false);
    if (timerRef.current) clearInterval(timerRef.current);

    if (isPractice) {
      setResult('lose');
      playSound('lose');
      return;
    }

    try {
      const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
      const roomData = roomSnap.val();
      if (roomData && roomData.status !== 'finished') {
        const players = roomData.players;
        const opponentId = Object.keys(players).find(id => id !== uid);
        
        await update(ref(rtdb, `rooms/${roomId}`), {
          status: 'finished',
          winnerId: opponentId || 'unknown',
          loserId: uid
        });
      }
    } catch (e) {
      console.error("GameOver update error:", e);
    }
  }, [roomId, uid, isPractice, gameActive, result, isDead]);

  useEffect(() => {
    generateStairs();

    let playersListener: any = null;
    let roomStatusListener: any = null;

    if (!isPractice) {
      const roomPlayersRef = ref(rtdb, `rooms/${roomId}/players`);
      playersListener = onValue(roomPlayersRef, (snapshot) => {
        const players = snapshot.val();
        const opps: Record<string, OpponentData> = {};
        if (players) {
          Object.keys(players).forEach(pId => {
            if (pId !== uid) {
              opps[pId] = {
                uid: pId,
                floor: players[pId].currentFloor || 0,
                charId: players[pId].characterId || 'rabbit',
                name: players[pId].displayName || '친구',
                facing: players[pId].facing || 1,
                customImageUrl: players[pId].customCharacterURL 
              };
            }
          });
        }
        setOpponentFloors(opps);
      });

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      roomStatusListener = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.status === 'finished' && !result) {
          setGameActive(false);
          if (timerRef.current) clearInterval(timerRef.current);
          
          if (data.winnerId === uid) {
            setResult('win');
            playSound('win');
          } else {
            setResult('lose');
            setIsDead(true);
            playSound('lose');
          }
        }
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
      if (!isPractice) {
        off(ref(rtdb, `rooms/${roomId}/players`));
        off(ref(rtdb, `rooms/${roomId}`));
      }
      clearInterval(cdInterval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roomId, uid, generateStairs, isPractice, result]);

  useEffect(() => {
    if (gameActive && !isDead && !result) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          const nextVal = prev - 0.1;
          if (nextVal <= 0) {
            clearInterval(timerRef.current);
            gameOver();
            return 0;
          }
          return nextVal;
        });
      }, 100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameActive, isDead, result, gameOver]);

  const handleStep = useCallback((type: 'up' | 'turn') => {
    if (!gameActive || isDead || result) return;

    let nextFacing = facingRef.current;
    if (type === 'turn') {
      nextFacing = nextFacing === 1 ? 0 : 1;
      playSound('turn');
    }
    const nextFloor = floorRef.current + 1;
    
    if (stairs[nextFloor] === nextFacing) {
      floorRef.current = nextFloor;
      facingRef.current = nextFacing;
      setFloor(nextFloor);
      setFacing(nextFacing);
      setIsMoving(true);
      
      if (type === 'up') playSound('jump');
      if (movingTimeoutRef.current) clearTimeout(movingTimeoutRef.current);
      movingTimeoutRef.current = setTimeout(() => setIsMoving(false), 150);

      setTimeLeft(prev => Math.min(30, prev + (isPractice ? 0.4 : 0.25))); 

      if (!isPractice && (nextFloor - lastSyncFloor.current >= 2)) {
        lastSyncFloor.current = nextFloor;
        update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
          currentFloor: nextFloor,
          facing: nextFacing
        });
      }
    } else {
      gameOver();
    }
  }, [gameActive, isDead, result, stairs, roomId, uid, gameOver, isPractice]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'f') handleStep('turn');
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'j') handleStep('up');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStep]);

  const getStairX = (index: number) => {
    let x = 0;
    for (let i = 1; i <= index; i++) {
      x += (stairs[i] === 1 ? 44 : -44);
    }
    return x;
  };

  const currentPlayerX = getStairX(floor);

  return (
    <div className={`fixed inset-0 overflow-hidden ${isPractice ? 'bg-[#7cfc00]' : 'bg-[#a0e9ff]'} flex flex-col items-center font-['Jua'] select-none`}>
      <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[80%] max-w-md h-6 bg-white/30 rounded-full border-4 border-white shadow-lg z-50 overflow-hidden backdrop-blur-sm">
        <div 
          className={`h-full transition-all duration-100 ease-linear ${timeLeft < 5 ? 'bg-red-500' : isPractice ? 'bg-green-400' : 'bg-yellow-400'}`}
          style={{ width: `${(timeLeft / 30) * 100}%` }}
        />
      </div>

      <div className="absolute top-6 left-6 z-40">
        <div className="bg-white/95 px-4 py-2 rounded-2xl font-bold text-3xl shadow-[0_4px_0_#ccc] text-[#333] border-2 border-white">
          {floor} <span className="text-sm">F</span>
        </div>
      </div>
      
      <div className="absolute top-6 right-6 flex flex-col items-end gap-2 z-40">
        {isPractice ? (
          <div className="bg-green-600 text-white px-4 py-1 rounded-full text-xs font-bold shadow-md border-2 border-white/30 animate-pulse">연습 중 🌱</div>
        ) : (
          Object.values(opponentFloors).map((data: OpponentData) => (
            <div key={data.uid} className="bg-white/90 px-3 py-1 rounded-xl text-xs font-bold border-2 border-pink-200 flex items-center gap-2 shadow-sm">
              <span className="w-5 h-5 flex items-center justify-center">
                <CharacterSprite type={data.charId} facing={1} isMoving={false} size={20} customImageUrl={data.customImageUrl} />
              </span>
              <span className="text-pink-600 truncate max-w-[60px]">{data.name}</span>
              <span className="bg-pink-100 px-2 rounded-full">{data.floor}F</span>
            </div>
          ))
        )}
      </div>

      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center">
           <div className="text-white text-9xl font-bold animate-ping drop-shadow-2xl">
             {countdown}
           </div>
        </div>
      )}

      {result && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-lg flex flex-col items-center justify-center p-6">
           <div className="bg-white p-8 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border-[12px] border-pink-100 text-center animate-in zoom-in duration-500 w-full max-w-sm relative">
             <div className="absolute -top-16 left-1/2 -translate-x-1/2 text-8xl drop-shadow-lg animate-bounce">
                {result === 'win' ? '👑' : '👻'}
             </div>
             <h2 className={`text-6xl ${result === 'win' ? 'text-yellow-500' : 'text-gray-500'} mb-4 tracking-tighter`}>
               {result === 'win' ? '위너! 대단해!' : '아고고! 패배...'}
             </h2>
             <div className={`p-6 rounded-3xl mb-8 ${result === 'win' ? 'bg-yellow-50 border-4 border-yellow-200' : 'bg-gray-50 border-4 border-gray-200'}`}>
                <p className="text-gray-400 text-sm font-bold uppercase mb-1">최종 기록</p>
                <p className={`text-6xl font-black ${result === 'win' ? 'text-yellow-600' : 'text-gray-600'}`}>{floor}층</p>
             </div>
             <div className="flex flex-col gap-4">
               {isPractice ? (
                 <button onClick={resetPracticeGame} className="w-full bg-green-500 text-white font-bold py-5 rounded-[24px] shadow-[0_8px_0_#2e7d32] text-2xl active:translate-y-1 active:shadow-none transition-all">한 번 더 도전! 🔄</button>
               ) : (
                 <div className="bg-sky-50 p-4 rounded-2xl mb-2 text-sky-600 font-bold">
                   승률이 계산되고 있습니다! 📈
                 </div>
               )}
               <button 
                  onClick={() => onFinish(floor, result === 'win')} 
                  className="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-5 rounded-[24px] shadow-[0_8px_0_#d63384] text-2xl active:translate-y-1 active:shadow-none transition-all"
               >
                  로비로 나가기 🏠
               </button>
             </div>
           </div>
        </div>
      )}

      <div className="flex-1 w-full relative flex items-center justify-center">
        {/* 플레이어 위치 조정을 위한 translateY 오프셋 추가 (캐릭터를 아래로 내림) */}
        <div 
          className="relative transition-all duration-150 ease-out"
          style={{ transform: `translate(${-currentPlayerX}px, ${floor * 40 + 150}px)` }}
        >
          {/* 캐릭터가 하단에 있으므로 위쪽으로 더 많은 계단을 렌더링 (45 -> 70) */}
          {Array.from({ length: 70 }).map((_, i) => {
            const stairIndex = floor - 5 + i;
            if (stairIndex < 0) return null;
            const x = getStairX(stairIndex);
            return (
              <div 
                key={`stair-${stairIndex}`}
                className="absolute w-32 sm:w-36 h-10 bg-[#e74c3c] border-b-[6px] border-[#c0392b] border-r-4 border-l-4 border-white/20 rounded-sm shadow-lg z-10"
                style={{
                  bottom: `${stairIndex * 40}px`,
                  left: `${x}px`,
                  transform: 'translateX(-50%)',
                  opacity: Math.max(0, 1 - Math.abs(stairIndex - floor) / 50),
                  backgroundImage: `linear-gradient(90deg, transparent 50%, rgba(255,255,255,0.1) 50.5%, transparent 51%), linear-gradient(0deg, transparent 90%, rgba(0,0,0,0.1) 90.5%, transparent 91%)`,
                  backgroundSize: '30px 40px'
                }}
              />
            );
          })}

          {!isPractice && 
          Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => {
            const x = getStairX(data.floor);
            return (
              <div 
                key={`ghost-${id}`}
                className="absolute z-20 transition-all duration-300"
                style={{ bottom: `${data.floor * 40 + 40}px`, left: `${x}px`, transform: `translateX(-50%)` }}
              >
                <CharacterSprite type={data.charId} facing={data.facing} isMoving={false} size={60} opacity={0.6} customImageUrl={data.customImageUrl} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm whitespace-nowrap">{data.name}</div>
              </div>
            );
          })}

          <div 
            className="absolute z-30 transition-transform duration-100"
            style={{ bottom: `${floor * 40 + 40}px`, left: `${currentPlayerX}px`, transform: `translateX(-50%)` }}
          >
            <CharacterSprite type={characterId} facing={facing} isMoving={isMoving} size={80} customImageUrl={customImageUrl} />
          </div>
        </div>
      </div>

      <div className="w-full bg-white/95 backdrop-blur-md p-4 pb-8 sm:p-8 border-t-8 border-gray-100 z-40">
        <div className="max-w-md mx-auto flex justify-between gap-4 h-28 sm:h-32">
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('turn'); }} 
            className="flex-1 bg-[#ff5e57] shadow-[0_10px_0_#d63031] active:scale-95 transition-all text-white rounded-[32px] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/30 group"
          >
            <span className="text-4xl mb-1 group-active:rotate-180 transition-transform duration-300">🔄</span>
            <span className="font-bold text-lg uppercase tracking-tighter">방향 전환</span>
          </button>
          <button 
            onPointerDown={(e) => { e.preventDefault(); handleStep('up'); }} 
            className="flex-1 bg-[#3fb6ff] shadow-[0_10px_0_#0652dd] active:scale-95 transition-all text-white rounded-[32px] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/30 group"
          >
            <span className="text-4xl mb-1 group-active:scale-125 transition-transform duration-150">👣</span>
            <span className="font-bold text-lg uppercase tracking-tighter">계단 오르기</span>
          </button>
        </div>
      </div>
    </div>
  );
};
