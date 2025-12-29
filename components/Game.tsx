
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { playSound } from '../utils/audio';
import { rtdb } from '../firebase';
import { ref, update, onValue, off, get } from 'firebase/database';
import { CharacterSprite } from './CharacterSprite';

interface GameProps {
  roomId: string | 'practice';
  uid: string;
  characterId: string;
  onFinish: (score: number, isWinner: boolean, action: 'rematch' | 'lobby') => void;
  customImageUrl?: string;
  stairSequence?: number[];
  targetFloor?: number; // 목표 계단 수 추가
}

interface OpponentData {
  uid: string;
  floor: number;
  charId: string;
  name: string;
  facing: number;
  isFinished: boolean;
  customImageUrl?: string;
}

export const Game: React.FC<GameProps> = ({ 
  roomId, 
  uid, 
  characterId, 
  onFinish, 
  customImageUrl, 
  stairSequence,
  targetFloor = 100 // 기본값 100
}) => {
  const isPractice = roomId === 'practice';
  const GOAL_FLOOR = targetFloor; // 동적으로 목표 설정
  
  const [floor, setFloor] = useState(0);
  const [facing, setFacing] = useState(1);
  const [stairs, setStairs] = useState<number[]>([]);
  const [opponentFloors, setOpponentFloors] = useState<Record<string, OpponentData>>({});
  const [timeLeft, setTimeLeft] = useState(15); 
  const [gameActive, setGameActive] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [result, setResult] = useState<'win' | 'lose' | null>(null);
  const [isDead, setIsDead] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isDrainingFast, setIsDrainingFast] = useState(false);
  
  const timerRef = useRef<any>(null);
  const lastSyncFloor = useRef(0);
  const floorRef = useRef(0);
  const facingRef = useRef(1);
  const movingTimeoutRef = useRef<any>(null);
  const lastActionTime = useRef<number>(Date.now());

  const getBackgroundClass = () => {
    const progress = floor / GOAL_FLOOR;
    if (progress < 0.3) return isPractice ? 'bg-[#7cfc00]' : 'bg-[#a0e9ff]';
    if (progress < 0.6) return 'bg-[#2ecc71]';
    if (progress < 0.8) return 'bg-[#f39c12]';
    return 'bg-[#34495e]';
  };

  const generateStairs = useCallback(() => {
    if (!isPractice && stairSequence) {
      setStairs(stairSequence);
      return;
    }
    const startDir = 1;
    const newStairs = [startDir, startDir]; 
    let currentX = startDir;
    for (let i = 2; i <= GOAL_FLOOR + 10; i++) {
      if (Math.random() > 0.7) currentX = currentX === 1 ? 0 : 1;
      newStairs.push(currentX);
    }
    setStairs(newStairs);
  }, [isPractice, stairSequence, GOAL_FLOOR]);

  const resetPracticeGame = useCallback(() => {
    floorRef.current = 0;
    facingRef.current = 1;
    lastSyncFloor.current = 0;
    lastActionTime.current = Date.now();
    setFloor(0);
    setFacing(1);
    setTimeLeft(15);
    setIsDead(false);
    setIsMoving(false);
    setIsDrainingFast(false);
    setResult(null);
    setCountdown(3);
    setGameActive(false);
    generateStairs();
  }, [generateStairs]);

  // 최종 승자 판정 로직
  const determineWinner = useCallback(async () => {
    if (isPractice) return;
    
    const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
    const roomData = roomSnap.val();
    if (!roomData || roomData.status === 'finished') return;

    const players = roomData.players;
    const playerIds = Object.keys(players);
    const allFinished = playerIds.every(id => players[id].isFinished || players[id].currentFloor >= GOAL_FLOOR);

    if (allFinished) {
      let winnerId = '';
      let maxFloor = -1;
      
      playerIds.forEach(id => {
        if (players[id].currentFloor > maxFloor) {
          maxFloor = players[id].currentFloor;
          winnerId = id;
        }
      });

      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'finished',
        winnerId: winnerId,
        loserId: playerIds.find(id => id !== winnerId) || 'unknown'
      });
    }
  }, [roomId, isPractice, GOAL_FLOOR]);

  const gameOver = useCallback(async (reachedGoal = false) => {
    if (!gameActive || result || isDead) return;
    
    setIsDead(true);
    setGameActive(false);
    if (timerRef.current) clearInterval(timerRef.current);

    if (isPractice) {
      setResult(reachedGoal ? 'win' : 'lose');
      if (reachedGoal) playSound('win'); else playSound('lose');
      return;
    }

    // RTDB에 나의 종료 상태 업데이트
    await update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
      isFinished: true,
      currentFloor: floorRef.current
    });

    if (reachedGoal) {
      // 목표 층 도달 시 즉시 승리 처리
      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'finished',
        winnerId: uid,
        loserId: Object.keys(opponentFloors)[0] || 'unknown'
      });
    } else {
      // 탈락 시 모든 플레이어가 종료되었는지 확인
      determineWinner();
    }
  }, [roomId, uid, isPractice, gameActive, result, isDead, opponentFloors, determineWinner]);

  useEffect(() => {
    generateStairs();
    if (!isPractice) {
      const roomPlayersRef = ref(rtdb, `rooms/${roomId}/players`);
      onValue(roomPlayersRef, (snapshot) => {
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
                isFinished: players[pId].isFinished || false,
                customImageUrl: players[pId].customCharacterURL 
              };
            }
          });
        }
        setOpponentFloors(opps);
      });

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      onValue(roomRef, (snapshot) => {
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
          lastActionTime.current = Date.now();
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
        const now = Date.now();
        const idleTime = (now - lastActionTime.current) / 1000;
        
        let penalty = 0;
        if (idleTime > 0.5) { 
          penalty = Math.min(2.0, (idleTime - 0.5) * 1.5); 
          if (!isDrainingFast) setIsDrainingFast(true);
        } else {
          if (isDrainingFast) setIsDrainingFast(false);
        }

        setTimeLeft(prev => {
          const baseDrain = 0.15; 
          const totalDrain = baseDrain + (penalty / 10);
          const nextVal = prev - totalDrain;
          
          if (nextVal <= 0) {
            clearInterval(timerRef.current);
            gameOver(false);
            return 0;
          }
          return nextVal;
        });
      }, 100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameActive, isDead, result, gameOver, isDrainingFast]);

  const handleStep = useCallback((type: 'up' | 'turn') => {
    if (!gameActive || isDead || result) return;

    lastActionTime.current = Date.now();
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

      setTimeLeft(prev => Math.min(20, prev + (isPractice ? 0.25 : 0.18))); 

      // 목표 층 도달 체크
      if (nextFloor >= GOAL_FLOOR) {
        gameOver(true);
      }

      if (!isPractice) {
        update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
          currentFloor: nextFloor,
          facing: nextFacing
        });
      }
    } else {
      gameOver(false);
    }
  }, [gameActive, isDead, result, stairs, roomId, uid, gameOver, isPractice, GOAL_FLOOR]);

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
    <div className={`fixed inset-0 overflow-hidden transition-colors duration-1000 ease-in-out ${getBackgroundClass()} flex flex-col items-center font-['Jua'] select-none`}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent pointer-events-none" />

      {/* 실시간 레이스 진행도 게이지 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-lg h-10 bg-black/20 rounded-2xl flex items-center px-4 z-[60] backdrop-blur-sm border-2 border-white/20">
         <div className="relative w-full h-2 bg-white/20 rounded-full">
            {/* 나의 위치 */}
            <div 
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-300 z-10"
              style={{ left: `${(floor / GOAL_FLOOR) * 100}%` }}
            >
              <div className="w-8 h-8 -ml-4 flex items-center justify-center bg-white rounded-full shadow-lg border-2 border-pink-400">
                <CharacterSprite type={characterId} facing={1} isMoving={false} size={20} customImageUrl={customImageUrl} />
              </div>
            </div>
            {/* 상대방 위치 */}
            {Object.values(opponentFloors).map((opp: OpponentData) => (
              <div 
                key={opp.uid}
                className="absolute top-1/2 -translate-y-1/2 transition-all duration-300"
                style={{ left: `${(opp.floor / GOAL_FLOOR) * 100}%` }}
              >
                <div className="w-6 h-6 -ml-3 flex items-center justify-center bg-gray-200 rounded-full shadow-md border-2 border-gray-400 opacity-80">
                  <CharacterSprite type={opp.charId} facing={1} isMoving={false} size={15} customImageUrl={opp.customImageUrl} />
                </div>
              </div>
            ))}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 text-2xl">🏁</div>
         </div>
      </div>

      <div className={`absolute top-16 left-1/2 -translate-x-1/2 w-[80%] max-w-md h-6 bg-white/30 rounded-full border-4 border-white shadow-lg z-50 overflow-hidden backdrop-blur-sm transition-all ${isDrainingFast ? 'animate-pulse border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.7)]' : ''}`}>
        <div 
          className={`h-full transition-all duration-100 ease-linear ${isDrainingFast ? 'bg-red-600' : timeLeft < 5 ? 'bg-red-400' : isPractice ? 'bg-green-400' : 'bg-yellow-400'}`}
          style={{ width: `${(timeLeft / 20) * 100}%` }}
        />
      </div>

      <div className="absolute top-16 left-6 z-40">
        <div className="bg-white/95 px-4 py-2 rounded-2xl font-bold text-3xl shadow-[0_4px_0_#ccc] text-[#333] border-2 border-white">
          {floor} <span className="text-sm">/ {GOAL_FLOOR}F</span>
        </div>
      </div>

      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center">
           <div className="text-white text-9xl font-bold animate-ping drop-shadow-2xl">
             {countdown}
           </div>
        </div>
      )}

      {result && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center">
           <div className="bg-white p-8 rounded-[40px] shadow-2xl border-[12px] border-pink-100 animate-in zoom-in duration-500 w-full max-w-sm relative">
             <div className="text-8xl mb-4 animate-bounce">
                {result === 'win' ? '🥇' : '💨'}
             </div>
             <h2 className={`text-5xl font-black ${result === 'win' ? 'text-yellow-500' : 'text-gray-500'} mb-2`}>
               {result === 'win' ? '우승!!' : '아쉬워요!'}
             </h2>
             <p className="text-gray-400 font-bold mb-6">{result === 'win' ? `${GOAL_FLOOR}층에 먼저 도착했어요!` : '상대방이 더 높이 올라갔어요.'}</p>
             
             <div className="bg-gray-50 p-6 rounded-3xl mb-8 border-4 border-gray-100">
                <p className="text-xs text-gray-400 font-bold uppercase mb-1">나의 최고 층수</p>
                <p className="text-6xl font-black text-pink-500">{floor}층</p>
             </div>
             
             <div className="flex flex-col gap-3">
               <button onClick={() => onFinish(floor, result === 'win', 'rematch')} className="w-full bg-green-500 text-white font-bold py-4 rounded-2xl shadow-[0_6px_0_#2e7d32] text-xl active:translate-y-1 active:shadow-none transition-all">다시 대결! 🔄</button>
               <button onClick={() => onFinish(floor, result === 'win', 'lobby')} className="w-full bg-gray-400 text-white font-bold py-4 rounded-2xl shadow-[0_6px_0_#666] text-xl active:translate-y-1 active:shadow-none transition-all">로비로 이동 🏠</button>
             </div>
           </div>
        </div>
      )}

      <div className="flex-1 w-full relative flex items-center justify-center">
        <div 
          className="relative transition-all duration-150 ease-out"
          style={{ transform: `translate(${-currentPlayerX}px, ${floor * 40 + 150}px)` }}
        >
          {/* 결승선 연출 */}
          <div 
             className="absolute w-[400px] h-2 bg-white/50 z-0"
             style={{ bottom: `${GOAL_FLOOR * 40}px`, left: '0', transform: 'translateX(-50%)' }}
          >
             <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-4xl animate-bounce whitespace-nowrap">🏆 {GOAL_FLOOR}F FINISH 🏆</div>
             <div className="w-full h-full bg-[repeating-linear-gradient(45deg,#000,#000_10px,#fff_10px,#fff_20px)] opacity-50" />
          </div>

          {Array.from({ length: GOAL_FLOOR + 20 }).map((_, i) => {
            const stairIndex = floor - 5 + i;
            if (stairIndex < 0 || stairIndex > GOAL_FLOOR + 5) return null;
            const x = getStairX(stairIndex);
            return (
              <div 
                key={`stair-${stairIndex}`}
                className={`absolute w-32 sm:w-36 h-10 border-b-[6px] border-r-4 border-l-4 border-white/20 rounded-sm shadow-lg z-10 ${stairIndex >= GOAL_FLOOR ? 'bg-yellow-400 border-yellow-600' : 'bg-[#e74c3c] border-[#c0392b]'}`}
                style={{
                  bottom: `${stairIndex * 40}px`,
                  left: `${x}px`,
                  transform: 'translateX(-50%)',
                  opacity: Math.max(0, 1 - Math.abs(stairIndex - floor) / 50),
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

      <div className="w-full bg-white/95 backdrop-blur-md p-4 pb-8 border-t-8 border-gray-100 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.1)]">
        <div className="max-w-md mx-auto flex justify-between gap-4 h-28">
          <button onPointerDown={(e) => { e.preventDefault(); handleStep('turn'); }} className={`flex-1 ${isDrainingFast ? 'bg-red-500 animate-pulse' : 'bg-[#ff5e57]'} shadow-[0_10px_0_#d63031] active:translate-y-2 active:shadow-none transition-all text-white rounded-3xl border-4 border-white/30 flex flex-col items-center justify-center`}>
            <span className="text-4xl mb-1">🔄</span>
            <span className="font-bold text-lg uppercase">회전</span>
          </button>
          <button onPointerDown={(e) => { e.preventDefault(); handleStep('up'); }} className={`flex-1 ${isDrainingFast ? 'bg-red-400 animate-pulse' : 'bg-[#3fb6ff]'} shadow-[0_10px_0_#0652dd] active:translate-y-2 active:shadow-none transition-all text-white rounded-3xl border-4 border-white/30 flex flex-col items-center justify-center`}>
            <span className="text-4xl mb-1">👣</span>
            <span className="font-bold text-lg uppercase">점프</span>
          </button>
        </div>
      </div>
    </div>
  );
};
