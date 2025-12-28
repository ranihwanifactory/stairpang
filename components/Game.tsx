
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSound } from '../utils/audio';
import { rtdb } from '../firebase';
import { ref, update, onValue, off } from 'firebase/database';
import { CharacterSprite } from './CharacterSprite';

interface GameProps {
  roomId: string | 'practice';
  uid: string;
  characterId: string;
  onFinish: (score: number, isWinner: boolean) => void;
  customImageUrl?: string;
  stairSequence?: number[]; // 공유 계단 시퀀스 주입
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
      const change = Math.random() > 0.7;
      if (change) {
        currentX = currentX === 1 ? 0 : 1;
      }
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

  // 게임 종료 로직
  const gameOver = useCallback(async () => {
    if (!gameActive || result) return;
    
    setGameActive(false);
    if (timerRef.current) clearInterval(timerRef.current);

    if (isPractice) {
      setIsDead(true);
      setResult('lose');
      playSound('lose');
      return;
    }

    // 상대방 찾기 (1:1 기준)
    const oppIds = Object.keys(opponentFloors);
    const winnerId = oppIds[0] || 'unknown';

    await update(ref(rtdb, `rooms/${roomId}`), {
      status: 'finished',
      winnerId: winnerId,
      loserId: uid
    });
  }, [roomId, uid, opponentFloors, isPractice, gameActive, result]);

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
        if (data && data.status === 'finished') {
          setGameActive(false);
          if (data.winnerId === uid) {
            setResult('win');
            playSound('win');
          } else if (data.loserId === uid) {
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
        off(ref(rtdb, `rooms/${roomId}/players`), 'value', playersListener);
        off(ref(rtdb, `rooms/${roomId}`), 'value', roomStatusListener);
      }
      clearInterval(cdInterval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roomId, uid, generateStairs, isPractice]);

  // 타이머 실행 이펙트
  useEffect(() => {
    if (gameActive && !isDead && !result) {
      // 100ms 마다 0.1씩 감소 (30초 전체)
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
      
      if (type === 'up') {
        playSound('jump');
      }
      
      if (movingTimeoutRef.current) clearTimeout(movingTimeoutRef.current);
      movingTimeoutRef.current = setTimeout(() => setIsMoving(false), 150);

      // 계단을 오를 때마다 시간 보너스
      setTimeLeft(prev => Math.min(30, prev + (isPractice ? 0.4 : 0.25))); 

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
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute bottom-0 w-full h-64 bg-gradient-to-t ${isPractice ? 'from-green-600' : 'from-[#3a80d2]'} to-transparent opacity-30`}></div>
      </div>

      <div className="absolute top-6 left-0 right-0 px-6 flex justify-between items-start z-40">
        <div className="flex flex-col gap-2">
          <div className="bg-white/95 px-4 sm:px-6 py-2 rounded-2xl font-bold text-2xl sm:text-3xl shadow-[0_4px_0_#ccc] text-[#333] border-2 border-white">
            {floor} <span className="text-xs sm:text-sm uppercase">Stairs</span>
          </div>
          <div className="w-40 sm:w-48 h-5 sm:h-6 bg-gray-200/50 rounded-full border-2 border-white overflow-hidden shadow-inner backdrop-blur-sm">
            <div 
              className={`h-full transition-[width] duration-100 ease-linear ${timeLeft < 5 ? 'bg-red-500' : isPractice ? 'bg-green-400' : 'bg-yellow-400'}`}
              style={{ width: `${(timeLeft / 30) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
           <div className={`${isPractice ? 'bg-green-600' : 'bg-pink-500'} text-white px-3 sm:px-4 py-1 rounded-full text-[10px] sm:text-xs font-bold shadow-md border-2 border-white/30`}>
             {isPractice ? '연습 중 🌱' : '실시간 대결 🏁'}
           </div>
           {!isPractice && (Object.entries(opponentFloors) as [string, OpponentData][]).map(([id, data]) => (
             <div key={id} className="bg-white/90 px-2 sm:px-3 py-1 rounded-lg text-[10px] sm:text-xs font-bold border-2 border-pink-200 flex items-center gap-2 animate-bounce">
               <span className="w-5 h-5 flex items-center justify-center">
                 <CharacterSprite type={data.charId} facing={1} isMoving={false} size={20} customImageUrl={data.customImageUrl} />
               </span>
               <span className="text-pink-600 truncate max-w-[60px]">{data.name}</span>
               <span>{data.floor}F</span>
             </div>
           ))}
        </div>
      </div>

      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
           <div className="text-white text-9xl font-bold animate-bounce drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]">
             {countdown}
           </div>
        </div>
      )}

      {result && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-md flex flex-col items-center justify-center p-4">
           <div className="bg-white p-6 sm:p-8 rounded-[40px] shadow-2xl border-8 border-pink-100 text-center animate-in zoom-in duration-300 w-full max-w-sm">
             <h2 className={`text-5xl sm:text-6xl ${result === 'win' ? 'text-yellow-500' : 'text-red-500'} mb-2`}>
               {result === 'win' ? '승리! 🏆' : '패배... 😵'}
             </h2>
             <p className="text-xl sm:text-2xl text-gray-700">{result === 'win' ? '와우! 당신이 이겼어요!' : '아쉬워요! 다음엔 꼭!'}</p>
             <div className="my-5 sm:my-6 p-4 bg-gray-50 rounded-3xl">
                <p className="text-xs sm:text-sm text-gray-400 uppercase tracking-tighter">Final Floor</p>
                <p className="text-4xl sm:text-5xl text-pink-500 font-bold">{floor}층</p>
             </div>
             
             {isPractice ? (
               <div className="flex flex-col gap-3">
                 <button onClick={resetPracticeGame} className="w-full bg-green-500 text-white font-bold py-3 sm:py-4 rounded-2xl shadow-[0_6px_0_#2e7d32] text-xl active:translate-y-1 active:shadow-none transition-all">다시하기 🔄</button>
                 <button onClick={() => onFinish(floor, false)} className="w-full bg-gray-400 text-white font-bold py-2 sm:py-3 rounded-2xl shadow-[0_6px_0_#666] text-lg active:translate-y-1 active:shadow-none transition-all">나가기 🏠</button>
               </div>
             ) : (
               <button 
                  onClick={() => onFinish(floor, result === 'win')} 
                  className="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 sm:py-4 rounded-2xl shadow-[0_6px_0_#d63384] border-2 border-white/20 text-xl active:translate-y-1 active:shadow-none transition-all"
               >
                  로비로 돌아가기 🏠
               </button>
             )}
           </div>
        </div>
      )}

      <div className="flex-1 w-full relative flex items-center justify-center">
        <div 
          className="relative transition-all duration-150 ease-out"
          style={{ transform: `translate(${-currentPlayerX}px, ${floor * 40}px)` }}
        >
          {Array.from({ length: 45 }).map((_, i) => {
            const stairIndex = floor - 10 + i;
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
                  opacity: Math.max(0, 1 - Math.abs(stairIndex - floor) / 25),
                  backgroundImage: `linear-gradient(90deg, transparent 50%, rgba(255,255,255,0.1) 50.5%, transparent 51%), linear-gradient(0deg, transparent 90%, rgba(0,0,0,0.1) 90.5%, transparent 91%)`,
                  backgroundSize: '30px 40px'
                }}
              />
            );
          })}

          {!isPractice && (Object.entries(opponentFloors) as [string, OpponentData][]).map(([id, data]) => {
            const x = getStairX(data.floor);
            return (
              <div 
                key={`ghost-${id}`}
                className="absolute z-20 transition-all duration-300"
                style={{ bottom: `${data.floor * 40 + 40}px`, left: `${x}px`, transform: `translateX(-50%)` }}
              >
                <CharacterSprite type={data.charId} facing={data.facing} isMoving={false} size={60} opacity={0.5} customImageUrl={data.customImageUrl} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[8px] sm:text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm whitespace-nowrap">{data.name}</div>
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

      <div className="w-full bg-white/95 backdrop-blur-md p-4 sm:p-8 border-t-8 border-gray-100 z-40">
        <div className="max-w-md mx-auto flex justify-between gap-4 sm:gap-6 h-28 sm:h-36">
          <button onPointerDown={(e) => { e.preventDefault(); handleStep('turn'); }} className="flex-1 bg-[#ff5e57] hover:bg-[#ff3f34] shadow-[0_10px_0_#d63031] active:scale-95 transition-all text-white rounded-[24px] sm:rounded-[32px] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/30 group">
            <span className="text-4xl sm:text-5xl mb-1 group-active:rotate-180 transition-transform duration-300">🔄</span>
            <span className="font-bold text-base sm:text-xl uppercase tracking-tighter">TURN</span>
          </button>
          <button onPointerDown={(e) => { e.preventDefault(); handleStep('up'); }} className="flex-1 bg-[#3fb6ff] hover:bg-[#0984e3] shadow-[0_10px_0_#0652dd] active:scale-95 transition-all text-white rounded-[24px] sm:rounded-[32px] active:shadow-none active:translate-y-2 flex flex-col items-center justify-center border-4 border-white/30 group">
            <span className="text-4xl sm:text-5xl mb-1 group-active:scale-125 transition-transform duration-150">👣</span>
            <span className="font-bold text-base sm:text-xl uppercase tracking-tighter">CLIMB</span>
          </button>
        </div>
      </div>
    </div>
  );
};
