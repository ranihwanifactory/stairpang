
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
  const [rankings, setRankings] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'lobby' | 'ranking' | 'room'>('lobby');
  const [isProcessing, setIsProcessing] = useState(false);

  // Authentication & Global Data
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docSnap = await getDoc(doc(db, 'users', u.uid));
        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile({ ...data, uid: u.uid }); // Ensure uid is present
        } else {
          // If profile doesn't exist yet, create a temporary one to avoid crashes
          setProfile({
            uid: u.uid,
            displayName: u.displayName || '익명 친구',
            email: u.email || '',
            photoURL: u.photoURL || '',
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
      snapshot.forEach(doc => ranks.push(doc.data() as UserProfile));
      setRankings(ranks);
    });

    const roomsRef = ref(rtdb, 'rooms');
    onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const waitingRooms = Object.values(data)
          .filter((r: any) => r && r.status === 'waiting')
          .map((r: any) => r as Room);
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

  // Hash Routing Logic
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

  // Room Sync Logic
  useEffect(() => {
    if (currentRoomId) {
      const roomRef = ref(rtdb, `rooms/${currentRoomId}`);
      const listener = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setRoom(data);
          if (data.status === 'playing') {
            setInGame(true);
          } else {
            setInGame(false);
          }
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
    if (!user || !profile || isProcessing) return;
    setIsProcessing(true);
    try {
      const newRoomRef = push(ref(rtdb, 'rooms'));
      const roomId = newRoomRef.key!;
      const myUid = user.uid; // Use auth uid directly to avoid undefined
      
      const roomData = {
        id: roomId,
        hostId: myUid,
        hostName: profile.displayName || '익명',
        status: 'waiting',
        createdAt: Date.now(),
        players: {
          [myUid]: {
            uid: myUid,
            displayName: profile.displayName || '익명',
            photoURL: profile.photoURL || '',
            character: CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰',
            currentFloor: 0,
            isReady: false,
            isFinished: false
          }
        }
      };
      await set(newRoomRef, roomData);
      window.location.hash = roomId;
    } catch (e: any) {
      console.error('Room Creation Error:', e);
      alert('방을 만들지 못했어요: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user || !profile || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = user.uid;
      const player: PlayerState = {
        uid: myUid,
        displayName: profile.displayName || '익명',
        photoURL: profile.photoURL || '',
        character: CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰',
        currentFloor: 0,
        isReady: false,
        isFinished: false
      };
      await update(ref(rtdb, `rooms/${roomId}/players`), {
        [myUid]: player
      });
      window.location.hash = roomId;
    } catch (e: any) {
      console.error('Join Room Error:', e);
      alert('방에 입장할 수 없어요.');
    } finally {
      setIsProcessing(false);
    }
  };

  const leaveRoom = async () => {
    if (!currentRoomId || !user || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = user.uid;
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
      const playerCount = Object.keys(room.players).length;
      if (playerCount < 2) {
        alert('혼자서는 대결할 수 없어요! 친구를 초대해주세요. 🤜🤛');
        return;
      }
      await update(ref(rtdb, `rooms/${currentRoomId}`), { status: 'playing' });
    }
  };

  const selectCharacter = async (charId: string) => {
    if (!profile || !user) return;
    const newProfile = { ...profile, selectedCharacter: charId };
    setProfile(newProfile);
    await updateDoc(doc(db, 'users', user.uid), { selectedCharacter: charId });
    
    if (currentRoomId) {
      const emoji = CHARACTERS.find(c => c.id === charId)?.emoji || '🐰';
      await update(ref(rtdb, `rooms/${currentRoomId}/players/${user.uid}`), { character: emoji });
    }
  };

  const handleGameFinish = async (score: number) => {
    if (!user || !profile || !room || !currentRoomId) return;
    
    setInGame(false);
    playSound('win');
    
    await updateDoc(doc(db, 'users', user.uid), {
      totalGames: profile.totalGames + 1,
      winCount: score > 30 ? profile.winCount + 1 : profile.winCount
    });
    
    if (room.hostId === user.uid) {
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

  if (inGame && room && profile) {
    const myChar = CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰';
    return <Game roomId={room.id} uid={user.uid} character={myChar} onFinish={handleGameFinish} />;
  }

  return (
    <div className="min-h-screen bg-pink-50 pb-24 font-['Jua']">
      {/* Header */}
      <header className="bg-white p-4 shadow-sm flex items-center justify-between border-b-2 border-pink-100 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <img src={profile?.photoURL} className="w-10 h-10 rounded-full border-2 border-pink-200 shadow-sm bg-pink-50" alt="me" />
          <div>
            <p className="font-bold text-gray-700 leading-tight text-lg">{profile?.displayName}</p>
            <p className="text-xs text-pink-400 font-bold">✨ {profile?.winCount}번 이겼어요!</p>
          </div>
        </div>
        <button 
          onClick={() => auth.signOut()} 
          className="text-gray-400 text-xs font-bold bg-gray-50 px-4 py-2 rounded-full hover:bg-gray-100 transition"
        >
          로그아웃
        </button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6">
        {view === 'lobby' && (
          <>
            {/* Character Selection */}
            <section className="bg-white p-6 rounded-3xl shadow-xl border-b-8 border-pink-100 text-center transform hover:scale-[1.02] transition-transform">
              <h2 className="text-xl font-bold text-gray-800 mb-4">내 캐릭터 바꾸기</h2>
              <div className="grid grid-cols-4 gap-3">
                {CHARACTERS.map(char => (
                  <button 
                    key={char.id}
                    onClick={() => selectCharacter(char.id)}
                    className={`p-3 rounded-2xl text-3xl transition-all ${profile?.selectedCharacter === char.id ? 'bg-pink-100 border-2 border-pink-400 scale-110 shadow-md' : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'}`}
                  >
                    {char.emoji}
                  </button>
                ))}
              </div>
            </section>

            {/* Create Room Button */}
            <button 
              disabled={isProcessing}
              onClick={createRoom}
              className={`w-full bg-pink-500 hover:bg-pink-600 text-white text-2xl font-bold py-6 rounded-3xl shadow-lg transform transition active:scale-95 border-b-4 border-pink-700 flex items-center justify-center gap-3 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className="text-3xl">🎮</span>
              <span>방 만들기</span>
            </button>

            {/* Room List */}
            <section className="bg-white p-6 rounded-3xl shadow-lg border-2 border-sky-100">
              <h3 className="font-bold text-lg mb-4 text-sky-600 flex items-center gap-2">
                <span className="animate-bounce">☁️</span> 대기 중인 친구들
              </h3>
              <div className="space-y-3">
                {availableRooms.length === 0 ? (
                  <div className="py-10 text-center text-gray-300 font-bold border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/50">
                    심심해요...<br/>방을 만들고 친구를 기다려볼까요?
                  </div>
                ) : (
                  availableRooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-5 rounded-2xl bg-sky-50 border border-sky-100 hover:border-sky-300 transition-all group">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-700 text-lg">{r.hostName}님의 방</span>
                        <span className="text-xs text-sky-400 font-bold">참여 인원: {Object.keys(r.players).length} / 4</span>
                      </div>
                      <button 
                        disabled={isProcessing}
                        onClick={() => joinRoom(r.id)}
                        className="bg-sky-500 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-sky-600 active:scale-95 transition"
                      >
                        입장!
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {view === 'room' && room && (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-xl text-center border-2 border-sky-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-sky-100"></div>
              <h2 className="text-2xl font-bold mb-2 text-sky-600">준비 대기실</h2>
              <p className="text-gray-400 text-sm mb-8 font-bold">친구들이 2명 이상 모여야 시작해요! 👫</p>
              
              <div className="grid grid-cols-2 gap-6 mb-10">
                {(Object.values(room.players) as PlayerState[]).map(p => (
                  <div key={p.uid} className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-2xl border-2 border-transparent hover:border-sky-100 transition-all">
                    <div className="relative">
                      <img src={p.photoURL} className="w-20 h-20 rounded-full border-4 border-white shadow-md bg-white" alt="" />
                      <span className="absolute -bottom-2 -right-2 text-4xl drop-shadow-lg animate-pulse">{p.character}</span>
                    </div>
                    <span className="text-base font-bold text-gray-700 truncate w-full">{p.displayName}</span>
                    <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">Ready</span>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - Object.keys(room.players).length) }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-gray-100 rounded-2xl opacity-40">
                    <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                       <span className="text-4xl text-gray-300">?</span>
                    </div>
                    <span className="text-xs text-gray-300 font-bold">기다리는 중</span>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => {
                    const url = `${window.location.origin}/#${room.id}`;
                    navigator.clipboard.writeText(url);
                    alert('친구 초대 링크가 복사되었어요! 💌');
                  }}
                  className="w-full py-4 rounded-2xl bg-sky-50 text-sky-600 font-bold border-2 border-sky-100 hover:bg-sky-100 transition flex items-center justify-center gap-2"
                >
                  <span>🔗</span> 초대 링크 복사하기
                </button>

                {room.hostId === user?.uid ? (
                  <div className="space-y-2">
                    <button 
                      onClick={startGame}
                      disabled={Object.keys(room.players).length < 2}
                      className={`w-full py-5 rounded-2xl text-white font-bold text-2xl shadow-lg border-b-4 transition-all ${
                        Object.keys(room.players).length < 2 
                        ? 'bg-gray-300 border-gray-400 cursor-not-allowed opacity-70' 
                        : 'bg-pink-500 border-pink-700 hover:bg-pink-600 active:translate-y-1 active:border-b-0'
                      }`}
                    >
                      {Object.keys(room.players).length < 2 ? '친구를 기다려요' : '시작하기! 🎉'}
                    </button>
                    {Object.keys(room.players).length < 2 && (
                      <p className="text-pink-400 text-xs font-bold animate-bounce">최소 2명이 모여야 시작할 수 있어요!</p>
                    )}
                  </div>
                ) : (
                  <div className="p-5 bg-sky-50 rounded-2xl text-sky-500 font-bold animate-pulse border-2 border-sky-100">
                    방장 친구가 게임을 시작하길 기다리고 있어요... ⌛
                  </div>
                )}

                <button 
                  disabled={isProcessing}
                  onClick={leaveRoom}
                  className="w-full py-2 text-gray-400 font-bold text-sm hover:text-red-400 transition-colors"
                >
                  나가기
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div className="bg-white p-6 rounded-3xl shadow-xl border-2 border-pink-100">
             <h2 className="text-2xl font-bold text-center text-pink-500 mb-6 flex items-center justify-center gap-3">
               <span className="text-3xl">🏆</span> 명예의 전당
             </h2>
             <div className="space-y-4">
               {rankings.length === 0 ? (
                 <p className="text-center text-gray-300 py-10">아직 순위가 없어요. 첫 번째 주인공이 되어보세요!</p>
               ) : (
                 rankings.map((r, i) => (
                    <div key={r.uid} className="flex items-center justify-between p-4 rounded-2xl bg-pink-50/30 border border-pink-100 transform hover:scale-[1.02] transition-transform">
                      <div className="flex items-center gap-4">
                        <span className={`text-xl font-bold w-10 h-10 flex items-center justify-center rounded-full shadow-sm ${i === 0 ? 'bg-yellow-400 text-white' : i === 1 ? 'bg-gray-300 text-white' : i === 2 ? 'bg-orange-300 text-white' : 'bg-white text-pink-300 border border-pink-100'}`}>
                          {i + 1}
                        </span>
                        <img src={r.photoURL} className="w-12 h-12 rounded-full shadow-sm border-2 border-white" alt="" />
                        <span className="font-bold text-gray-700 text-lg">{r.displayName}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-pink-500 font-bold text-xl">{r.winCount}승</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Total: {r.totalGames}</p>
                      </div>
                    </div>
                 ))
               )}
             </div>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-pink-50 h-20 flex items-center justify-around z-50 shadow-[0_-8px_20px_rgba(0,0,0,0.05)] px-6">
        <button 
          onClick={() => setView('lobby')}
          className={`flex flex-col items-center gap-1 transition-all flex-1 py-2 rounded-2xl ${view === 'lobby' ? 'text-pink-500 bg-pink-50 scale-105' : 'text-gray-300 hover:text-pink-200'}`}
        >
          <span className="text-3xl">🏠</span>
          <span className="text-xs font-bold">홈</span>
        </button>
        <button 
          onClick={() => setView('ranking')}
          className={`flex flex-col items-center gap-1 transition-all flex-1 py-2 rounded-2xl ${view === 'ranking' ? 'text-pink-500 bg-pink-50 scale-105' : 'text-gray-300 hover:text-pink-200'}`}
        >
          <span className="text-3xl">🏆</span>
          <span className="text-xs font-bold">랭킹</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
