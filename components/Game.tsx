
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { playSound, startBGM, stopBGM } from '../utils/audio';
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
  targetFloor?: number; 
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
  targetFloor = 100 
}) => {
  const isPractice = roomId === 'practice';
  const GOAL_FLOOR = targetFloor; 
  
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

  // 계단 X좌표 계산 (Memoization을 통해 성능 확보)
  const getStairX = useCallback((index: number, stairList: number[]) => {
    if (!stairList || stairList.length === 0) return 0;
    let x = 0;
    // index 0은 시작 위치 (0), index 1부터 실제 계단 방향 반영
    for (let i = 1; i <= index; i++) {
      if (stairList[i] === undefined) break;
      x += (stairList[i] === 1 ? 44 : -44);
    }
    return x;
  }, []);

  const generateStairs = useCallback(() => {
    if (!isPractice && stairSequence) {
      setStairs(stairSequence);
      return;
    }
    // 연습 모드용 계단 생성
    const startDir = 1;
    const newStairs = [startDir, startDir]; 
    let currentX = startDir;
    for (let i = 2; i <= GOAL_FLOOR + 20; i++) {
      if (Math.random() > 0.7) currentX = currentX === 1 ? 0 : 1;
      newStairs.push(currentX);
    }
    setStairs(newStairs);
  }, [isPractice, stairSequence, GOAL_FLOOR]);

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
    stopBGM(); 
    if (timerRef.current) clearInterval(timerRef.current);

    if (isPractice) {
      setResult(reachedGoal ? 'win' : 'lose');
      if (reachedGoal) playSound('win'); else playSound('lose');
      return;
    }

    await update(ref(rtdb, `rooms/${roomId}/players/${uid}`), {
      isFinished: true,
      currentFloor: floorRef.current
    });

    if (reachedGoal) {
      const oppIds = Object.keys(opponentFloors);
      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'finished',
        winnerId: uid,
        loserId: oppIds.find(id => id !== uid) || 'unknown'
      });
    } else {
      determineWinner();
    }
  }, [roomId, uid, isPractice, gameActive, result, isDead, opponentFloors, determineWinner]);

  useEffect(() => {
    generateStairs();
    if (!isPractice) {
      const roomPlayersRef = ref(rtdb, `rooms/${roomId}/players`);
      const playerListener = onValue(roomPlayersRef, (snapshot) => {
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
      const roomListener = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.status === 'finished' && !result) {
          setGameActive(false);
          stopBGM(); 
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
      return () => {
        off(roomPlayersRef, 'value', playerListener);
        off(roomRef, 'value', roomListener);
      };
    }

    const cdInterval = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(cdInterval);
          setGameActive(true);
          startBGM(); 
          lastActionTime.current = Date.now();
          playSound('start');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(cdInterval);
      if (timerRef.current) clearInterval(timerRef.current);
      stopBGM(); 
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
    // stairs[nextFloor]가 0일 때도 정상 동작하도록 비교 연산자 사용
    if (stairs[nextFloor] !== undefined && stairs[nextFloor] === nextFacing) {
      floorRef.current = nextFloor;
      facingRef.current = nextFacing;
      setFloor(nextFloor);
      setFacing(nextFacing);
      setIsMoving(true);
      if (type === 'up') playSound('jump');
      if (movingTimeoutRef.current) clearTimeout(movingTimeoutRef.current);
      movingTimeoutRef.current = setTimeout(() => setIsMoving(false), 150);
      setTimeLeft(prev => Math.min(20, prev + (isPractice ? 0.25 : 0.18))); 
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

  const currentPlayerX = useMemo(() => getStairX(floor, stairs), [floor, stairs, getStairX]);
  const goalX = useMemo(() => getStairX(GOAL_FLOOR, stairs), [GOAL_FLOOR, stairs, getStairX]);

  return (
    <div className={`fixed inset-0 overflow-hidden transition-colors duration-1000 ease-in-out ${getBackgroundClass()} flex flex-col items-center font-['Jua'] select-none`}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent pointer-events-none" />

      {/* 진행도 바 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-lg h-10 bg-black/20 rounded-2xl flex items-center px-4 z-[60] backdrop-blur-sm border-2 border-white/20">
         <div className="relative w-full h-2 bg-white/20 rounded-full">
            <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-300 z-10" style={{ left: `${Math.min(100, (floor / GOAL_FLOOR) * 100)}%` }}>
              <div className="w-8 h-8 -ml-4 flex items-center justify-center bg-white rounded-full shadow-lg border-2 border-pink-400">
                <CharacterSprite type={characterId} facing={1} isMoving={false} size={20} customImageUrl={customImageUrl} />
              </div>
            </div>
            {Object.values(opponentFloors).map((opp: OpponentData) => (
              <div key={opp.uid} className="absolute top-1/2 -translate-y-1/2 transition-all duration-300" style={{ left: `${Math.min(100, (opp.floor / GOAL_FLOOR) * 100)}%` }}>
                <div className="w-6 h-6 -ml-3 flex items-center justify-center bg-gray-200 rounded-full shadow-md border-2 border-gray-400 opacity-80">
                  <CharacterSprite type={opp.charId} facing={1} isMoving={false} size={15} customImageUrl={opp.customImageUrl} />
                </div>
              </div>
            ))}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 text-2xl">🏁</div>
         </div>
      </div>

      {/* 타임 에너지 바 */}
      <div className={`absolute top-16 left-1/2 -translate-x-1/2 w-[80%] max-w-md h-6 bg-white/30 rounded-full border-4 border-white shadow-lg z-50 overflow-hidden backdrop-blur-sm transition-all ${isDrainingFast ? 'animate-pulse border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.7)]' : ''}`}>
        <div className={`h-full transition-all duration-100 ease-linear ${isDrainingFast ? 'bg-red-600' : timeLeft < 5 ? 'bg-red-400' : isPractice ? 'bg-green-400' : 'bg-yellow-400'}`} style={{ width: `${(timeLeft / 20) * 100}%` }} />
      </div>

      {/* 현재 층수 표시 */}
      <div className="absolute top-16 left-6 z-40">
        <div className="bg-white/95 px-4 py-2 rounded-2xl font-bold text-3xl shadow-[0_4px_0_#ccc] text-[#333] border-2 border-white">
          {floor} <span className="text-sm">/ {GOAL_FLOOR}F</span>
        </div>
      </div>

      {/* 카운트다운 */}
      {countdown > 0 && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center">
           <div className="text-white text-9xl font-bold animate-ping drop-shadow-2xl">{countdown}</div>
        </div>
      )}

      {/* 결과 화면 */}
      {result && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center">
           <div className="bg-white p-8 rounded-[40px] shadow-2xl border-[12px] border-pink-100 animate-in zoom-in duration-500 w-full max-w-sm relative">
             <div className="text-8xl mb-4 animate-bounce">{result === 'win' ? '🥇' : '💨'}</div>
             <h2 className={`text-5xl font-black ${result === 'win' ? 'text-yellow-500' : 'text-gray-500'} mb-2`}>{result === 'win' ? '우승!!' : '아쉬워요!'}</h2>
             <p className="text-gray-400 font-bold mb-6">{result === 'win' ? `${GOAL_FLOOR}층에 먼저 도착했어요!` : '상대방이 먼저 가버렸어요.'}</p>
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

      {/* 게임 월드 */}
      <div className="flex-1 w-full relative flex items-center justify-center">
        <div className="relative transition-all duration-150 ease-out" style={{ transform: `translate(${-currentPlayerX}px, ${floor * 40 + 150}px)` }}>
          
          {/* 결승선 */}
          <div className="absolute w-[600px] h-4 z-0 flex flex-col items-center" style={{ bottom: `${GOAL_FLOOR * 40}px`, left: `${goalX}px`, transform: 'translateX(-50%)' }}>
             <div className="text-5xl mb-4 animate-bounce text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] whitespace-nowrap">🏁 {GOAL_FLOOR}F FINISH 🏁</div>
             <div className="w-full h-8 bg-[repeating-linear-gradient(45deg,#000,#000_20px,#fff_20px,#fff_40px)] shadow-2xl border-y-4 border-white" />
          </div>

          {/* 계단 렌더링 */}
          {Array.from({ length: 80 }).map((_, i) => {
            const stairIndex = floor - 20 + i;
            // stairs[stairIndex]가 0일 때도 정상적으로 렌더링되도록 undefined 체크 사용
            if (stairIndex < 0 || stairIndex > GOAL_FLOOR + 20 || stairs[stairIndex] === undefined) return null;
            const x = getStairX(stairIndex, stairs);
            const isGoalStair = stairIndex >= GOAL_FLOOR;
            return (
              <div 
                key={`stair-${stairIndex}`}
                className={`absolute w-32 sm:w-36 h-10 border-b-[6px] border-r-4 border-l-4 border-white/20 rounded-sm shadow-lg z-10 transition-colors ${isGoalStair ? 'bg-yellow-400 border-yellow-600' : 'bg-[#e74c3c] border-[#c0392b]'}`}
                style={{ bottom: `${stairIndex * 40}px`, left: `${x}px`, transform: 'translateX(-50%)', opacity: Math.max(0, 1 - Math.abs(stairIndex - floor) / 40) }}
              />
            );
          })}

          {/* 상대방 캐릭터 (Ghost) */}
          {!isPractice && Object.entries(opponentFloors).map(([id, data]: [string, OpponentData]) => {
            const x = getStairX(data.floor, stairs);
            return (
              <div key={`ghost-${id}`} className="absolute z-20 transition-all duration-300" style={{ bottom: `${data.floor * 40 + 40}px`, left: `${x}px`, transform: `translateX(-50%)` }}>
                <CharacterSprite type={data.charId} facing={data.facing} isMoving={false} size={60} opacity={0.6} customImageUrl={data.customImageUrl} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm whitespace-nowrap">{data.name}</div>
              </div>
            );
          })}

          {/* 내 캐릭터 */}
          <div className="absolute z-30 transition-transform duration-100" style={{ bottom: `${floor * 40 + 40}px`, left: `${currentPlayerX}px`, transform: `translateX(-50%)` }}>
            <CharacterSprite type={characterId} facing={facing} isMoving={isMoving} size={80} customImageUrl={customImageUrl} />
          </div>
        </div>
      </div>

      {/* 컨트롤 패널 */}
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
