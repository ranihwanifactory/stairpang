
import React, { useState, useEffect, useCallback } from 'react';
import { auth, db, rtdb } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { ref, set, push, onValue, remove, update, off } from 'firebase/database';
import { Auth } from './components/Auth';
import { Game } from './components/Game';
import { UserProfile, Room, PlayerState, CHARACTERS } from './types';
import { playSound } from './utils/audio';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [inGame, setInGame] = useState(false);
  const [isPractice, setIsPractice] = useState(false);
  const [rankings, setRankings] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'lobby' | 'ranking' | 'room'>('lobby');
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputCode, setInputCode] = useState('');

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docSnap = await getDoc(doc(db, 'users', u.uid));
        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile({ ...data, uid: u.uid });
        } else {
          setProfile({
            uid: u.uid,
            displayName: u.displayName || '익명 친구',
            email: u.email || '',
            photoURL: u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`,
            winCount: 0,
            totalGames: 0,
            selectedCharacter: 'rabbit'
          });
        }
      } else {
        setProfile(null);
      }
    });

    const q = query(collection(db, 'users'), orderBy('winCount', 'desc'), limit(10));
    const unsubRank = onSnapshot(q, (snapshot) => {
      const ranks: UserProfile[] = [];
      snapshot.forEach(doc => ranks.push({ ...doc.data(), uid: doc.id } as UserProfile));
      setRankings(ranks);
    });

    const roomsRef = ref(rtdb, 'rooms');
    onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const waitingRooms = Object.entries(data)
          .filter(([_, r]: [string, any]) => r && r.status === 'waiting')
          .map(([id, r]: [string, any]) => ({ ...r, id }) as Room);
        setAvailableRooms(waitingRooms);
      } else {
        setAvailableRooms([]);
      }
    });

    return () => {
      unsubAuth();
      unsubRank();
      off(roomsRef);
    };
  }, []);

  const handleHashChange = useCallback(() => {
    const hash = window.location.hash.substring(1);
    if (hash && hash.length > 5) {
      setCurrentRoomId(hash);
      setView('room');
    } else {
      setCurrentRoomId(null);
      setView('lobby');
    }
  }, []);

  useEffect(() => {
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [handleHashChange]);

  useEffect(() => {
    if (currentRoomId) {
      const roomRef = ref(rtdb, `rooms/${currentRoomId}`);
      const listener = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setRoom(data);
          setInGame(data.status === 'playing');
        } else {
          setRoom(null);
          setCurrentRoomId(null);
          window.location.hash = '';
          setView('lobby');
        }
      });
      return () => off(roomRef, 'value', listener);
    }
  }, [currentRoomId]);

  const createRoom = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const newRoomRef = push(ref(rtdb, 'rooms'));
      const roomId = newRoomRef.key;
      const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
      if (!roomId || !myUid) throw new Error("ID 생성 실패");
      const roomData = {
        id: roomId,
        shortCode: shortCode,
        hostId: myUid,
        hostName: profile.displayName || currentUser.displayName || '익명',
        status: 'waiting',
        createdAt: Date.now(),
        players: {
          [myUid]: {
            uid: myUid,
            displayName: profile.displayName || currentUser.displayName || '익명',
            photoURL: profile.photoURL || currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${myUid}`,
            characterId: profile.selectedCharacter,
            currentFloor: 0,
            isReady: false,
            isFinished: false
          }
        }
      };
      await set(newRoomRef, roomData);
      window.location.hash = roomId;
    } catch (e: any) {
      alert('방 생성 실패!');
    } finally {
      setIsProcessing(false);
    }
  };

  const startPractice = () => {
    setIsPractice(true);
    setInGame(true);
  };

  const joinRoom = async (roomId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const player = {
        uid: myUid,
        displayName: profile.displayName || currentUser.displayName || '익명',
        photoURL: profile.photoURL || currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${myUid}`,
        characterId: profile.selectedCharacter,
        currentFloor: 0,
        isReady: false,
        isFinished: false
      };
      await update(ref(rtdb, `rooms/${roomId}/players`), { [myUid]: player });
      window.location.hash = roomId;
    } catch (e: any) {
      alert('입장 실패!');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const targetRoom = availableRooms.find(r => r.shortCode === inputCode);
    if (targetRoom) {
      joinRoom(targetRoom.id);
      setInputCode('');
    } else {
      alert('방 번호를 다시 확인해주세요! 🔍');
    }
  };

  const leaveRoom = async () => {
    const currentUser = auth.currentUser;
    if (!currentRoomId || !currentUser || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const roomPlayers = room?.players || {};
      if (Object.keys(roomPlayers).length <= 1) {
        await remove(ref(rtdb, `rooms/${currentRoomId}`));
      } else {
        await remove(ref(rtdb, `rooms/${currentRoomId}/players/${myUid}`));
      }
      window.location.hash = '';
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const startGame = async () => {
    if (currentRoomId && room) {
      if (Object.keys(room.players).length < 2) {
        alert('최소 2명이 필요해요! 친구를 초대하세요.');
        return;
      }
      await update(ref(rtdb, `rooms/${currentRoomId}`), { status: 'playing' });
    }
  };

  const selectCharacter = async (charId: string) => {
    const currentUser = auth.currentUser;
    if (!profile || !currentUser) return;
    const newProfile = { ...profile, selectedCharacter: charId };
    setProfile(newProfile);
    await updateDoc(doc(db, 'users', currentUser.uid), { selectedCharacter: charId });
    if (currentRoomId) {
      await update(ref(rtdb, `rooms/${currentRoomId}/players/${currentUser.uid}`), { characterId: charId });
    }
  };

  const handleGameFinish = async (score: number) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile) return;
    
    setInGame(false);
    
    if (isPractice) {
      setIsPractice(false);
      return;
    }

    if (!room || !currentRoomId) return;

    playSound('win');
    await updateDoc(doc(db, 'users', currentUser.uid), {
      totalGames: (profile.totalGames || 0) + 1,
      winCount: score > 30 ? (profile.winCount || 0) + 1 : (profile.winCount || 0)
    });

    if (room.hostId === currentUser.uid) {
      setTimeout(async () => {
        const resetPlayers: Record<string, any> = {};
        Object.keys(room.players).forEach(pid => {
          resetPlayers[pid] = {
            ...room.players[pid],
            currentFloor: 0,
            isReady: false,
            isFinished: false
          };
        });
        await update(ref(rtdb, `rooms/${currentRoomId}`), { 
          status: 'waiting',
          players: resetPlayers
        });
      }, 3000);
    }
  };

  if (!user) return <Auth />;
  if (inGame && profile) {
    return <Game 
      roomId={isPractice ? 'practice' : currentRoomId || ''} 
      uid={user.uid} 
      characterId={profile.selectedCharacter} 
      onFinish={handleGameFinish} 
    />;
  }

  return (
    <div className="min-h-screen bg-pink-50 pb-24 font-['Jua']">
      <header className="bg-white p-3 sm:p-4 shadow-sm flex items-center justify-between border-b-2 border-pink-100 sticky top-0 z-30">
        <div className="flex items-center gap-2 sm:gap-3">
          <img src={profile?.photoURL} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-pink-200 shadow-sm bg-pink-50" alt="me" />
          <div>
            <p className="font-bold text-gray-700 leading-tight text-base sm:text-lg">{profile?.displayName}</p>
            <p className="text-[10px] sm:text-xs text-pink-400 font-bold">✨ {profile?.winCount}번 이겼어요!</p>
          </div>
        </div>
        <button onClick={() => auth.signOut()} className="text-gray-400 text-[10px] sm:text-xs font-bold bg-gray-50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full hover:bg-gray-100">로그아웃</button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4 sm:space-y-6">
        {view === 'lobby' && (
          <>
            <section className="bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-b-8 border-pink-100 text-center">
              <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">내 캐릭터 바꾸기</h2>
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {CHARACTERS.map(char => (
                  <button 
                    key={char.id}
                    onClick={() => selectCharacter(char.id)}
                    className={`p-2 sm:p-3 rounded-2xl text-2xl sm:text-3xl transition-all flex items-center justify-center h-14 sm:h-16 ${profile?.selectedCharacter === char.id ? 'bg-pink-100 border-2 border-pink-400 scale-105 sm:scale-110 shadow-md' : 'bg-gray-50'}`}
                  >
                    <span className="text-3xl sm:text-4xl">{char.emoji}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <button disabled={isProcessing} onClick={createRoom} className="bg-pink-500 hover:bg-pink-600 text-white text-lg sm:text-xl font-bold py-4 sm:py-6 rounded-3xl shadow-lg border-b-4 border-pink-700 flex flex-col items-center justify-center gap-1 sm:gap-2">
                <span className="text-2xl sm:text-3xl">🎮</span>
                <span>방 만들기</span>
              </button>
              <button onClick={startPractice} className="bg-green-500 hover:bg-green-600 text-white text-lg sm:text-xl font-bold py-4 sm:py-6 rounded-3xl shadow-lg border-b-4 border-green-700 flex flex-col items-center justify-center gap-1 sm:gap-2">
                <span className="text-2xl sm:text-3xl">🌱</span>
                <span>혼자 연습</span>
              </button>
            </div>

            {/* 방 번호로 입장 섹션: 위치 이동 및 모바일 최적화 */}
            <section className="bg-yellow-100 p-4 sm:p-6 rounded-3xl shadow-lg border-2 border-yellow-200">
               <h3 className="text-center font-bold text-yellow-700 mb-3 text-sm sm:text-base flex items-center justify-center gap-2">
                 <span className="text-xl">🔢</span> 친구 방 번호로 입장!
               </h3>
               <form onSubmit={handleJoinByCode} className="flex gap-2 w-full">
                 <input 
                   type="text" 
                   inputMode="numeric"
                   pattern="[0-9]*"
                   maxLength={4} 
                   placeholder="번호 4자리"
                   className="flex-1 min-w-0 p-3 sm:p-4 rounded-2xl border-2 border-yellow-300 text-center text-xl sm:text-2xl font-bold text-yellow-700 focus:outline-none focus:ring-4 focus:ring-yellow-200 placeholder:text-yellow-300 placeholder:text-sm sm:placeholder:text-base"
                   value={inputCode}
                   onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, ''))}
                 />
                 <button className="bg-yellow-500 text-white px-4 sm:px-6 py-2 rounded-2xl font-bold shadow-md hover:bg-yellow-600 active:scale-95 transition text-sm sm:text-lg flex-shrink-0">
                   입장
                 </button>
               </form>
            </section>

            <section className="bg-white p-4 sm:p-6 rounded-3xl shadow-lg border-2 border-sky-100">
              <h3 className="font-bold text-base sm:text-lg mb-3 text-sky-600">☁️ 현재 대기 중인 방</h3>
              <div className="space-y-2 sm:space-y-3">
                {availableRooms.length === 0 ? (
                  <div className="py-8 sm:py-10 text-center text-gray-300 font-bold bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100 text-sm sm:text-base">심심해요... 방을 만들어보세요!</div>
                ) : (
                  availableRooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-3 sm:p-5 rounded-2xl bg-sky-50 border border-sky-100">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="font-bold text-gray-700 text-sm sm:text-lg truncate block">{r.hostName}님의 방</span>
                        <div className="flex flex-wrap gap-1 sm:gap-2 mt-1">
                          <span className="bg-white px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] text-sky-400 font-bold border border-sky-100">번호: {r.shortCode}</span>
                          <span className="bg-white px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] text-sky-400 font-bold border border-sky-100">인원: {Object.keys(r.players).length}/4</span>
                        </div>
                      </div>
                      <button onClick={() => joinRoom(r.id)} className="bg-sky-500 text-white px-3 sm:px-6 py-1.5 sm:py-2 rounded-xl font-bold text-xs sm:text-sm shadow-md flex-shrink-0">입장!</button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {view === 'room' && room && (
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl text-center border-2 border-sky-100">
              <div className="bg-yellow-100 py-3 rounded-2xl mb-4 sm:mb-6 border-2 border-yellow-200">
                <p className="text-xs sm:text-sm text-yellow-600 font-bold mb-1">우리 방 번호</p>
                <h2 className="text-4xl sm:text-5xl font-black text-yellow-700 tracking-widest">{room.shortCode}</h2>
              </div>
              
              <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10">
                {Object.values(room.players).map((p: any) => (
                  <div key={p.uid} className="flex flex-col items-center gap-1 sm:gap-2 p-3 sm:p-4 bg-gray-50 rounded-2xl relative">
                    {p.uid === room.hostId && <span className="absolute -top-1 -left-1 sm:-top-2 sm:-left-2 text-xl sm:text-2xl">👑</span>}
                    <img src={p.photoURL} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 border-white shadow-md bg-white" alt="" />
                    <span className="absolute bottom-10 right-3 sm:bottom-12 sm:right-4 drop-shadow-lg">
                       {CHARACTERS.find(c => c.id === p.characterId)?.emoji || '🐰'}
                    </span>
                    <span className="text-sm sm:text-base font-bold text-gray-700 truncate w-full">{p.displayName}</span>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - Object.keys(room.players).length) }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 sm:gap-2 p-3 sm:p-4 border-2 border-dashed border-gray-100 rounded-2xl opacity-40">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gray-100 flex items-center justify-center"><span className="text-2xl sm:text-3xl text-gray-300">?</span></div>
                    <span className="text-[10px] sm:text-xs text-gray-300 font-bold">기다리는 중</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 sm:space-y-4">
                {room.hostId === auth.currentUser?.uid ? (
                  <button onClick={startGame} disabled={Object.keys(room.players).length < 2} className={`w-full py-4 sm:py-5 rounded-2xl text-white font-bold text-xl sm:text-2xl shadow-lg border-b-4 ${Object.keys(room.players).length < 2 ? 'bg-gray-300 border-gray-400 opacity-70' : 'bg-pink-500 border-pink-700'}`}>
                    {Object.keys(room.players).length < 2 ? '친구를 더 기다려요' : '게임 시작! 🎉'}
                  </button>
                ) : (
                  <div className="p-4 sm:p-5 bg-sky-50 rounded-2xl text-sky-500 font-bold animate-pulse text-sm sm:text-base">방장이 시작하길 기다리고 있어요...</div>
                )}
                <button onClick={leaveRoom} className="w-full py-2 text-gray-400 font-bold text-xs sm:text-sm">나가기</button>
              </div>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-2 border-pink-100">
             <h2 className="text-xl sm:text-2xl font-bold text-center text-pink-500 mb-4 sm:mb-6 flex items-center justify-center gap-2 sm:gap-3">
               <span className="text-2xl sm:text-3xl">🏆</span> 명예의 전당
             </h2>
             <div className="space-y-3 sm:space-y-4">
               {rankings.map((r, i) => (
                  <div key={r.uid} className="flex items-center justify-between p-3 sm:p-4 rounded-2xl bg-pink-50/30 border border-pink-100">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <span className={`text-lg sm:text-xl font-bold w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full ${i === 0 ? 'bg-yellow-400 text-white' : 'bg-white text-pink-300'}`}>{i + 1}</span>
                      <img src={r.photoURL} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-white" alt="" />
                      <span className="font-bold text-gray-700 text-sm sm:text-base">{r.displayName}</span>
                    </div>
                    <span className="text-pink-500 font-bold text-lg sm:text-xl">{r.winCount}승</span>
                  </div>
               ))}
             </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-pink-50 h-16 sm:h-20 flex items-center justify-around z-50">
        <button onClick={() => setView('lobby')} className={`flex flex-col items-center gap-0.5 sm:gap-1 flex-1 ${view === 'lobby' ? 'text-pink-500' : 'text-gray-300'}`}>
          <span className="text-2xl sm:text-3xl">🏠</span><span className="text-[10px] sm:text-xs font-bold">홈</span>
        </button>
        <button onClick={() => setView('ranking')} className={`flex flex-col items-center gap-0.5 sm:gap-1 flex-1 ${view === 'ranking' ? 'text-pink-500' : 'text-gray-300'}`}>
          <span className="text-2xl sm:text-3xl">🏆</span><span className="text-[10px] sm:text-xs font-bold">랭킹</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
