
import React, { useState, useEffect } from 'react';
import { auth, db, rtdb } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { ref, set, push, onValue, remove, update } from 'firebase/database';
import { Auth } from './components/Auth';
import { Game } from './components/Game';
import { UserProfile, Room, PlayerState, CHARACTERS } from './types';
import { playSound } from './utils/audio';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [inGame, setInGame] = useState(false);
  const [rankings, setRankings] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'lobby' | 'ranking' | 'room'>('lobby');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docSnap = await getDoc(doc(db, 'users', u.uid));
        if (docSnap.exists()) {
          setProfile(docSnap.data() as UserProfile);
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

    const hash = window.location.hash.substring(1);
    if (hash.startsWith('room-')) {
      setCurrentRoomId(hash);
    }

    return () => {
      unsub();
      unsubRank();
    };
  }, []);

  useEffect(() => {
    if (currentRoomId) {
      const roomRef = ref(rtdb, `rooms/${currentRoomId}`);
      onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setRoom(data);
          if (data.status === 'playing') setInGame(true);
          else if (data.status === 'waiting') setInGame(false);
        } else {
          setRoom(null);
          setCurrentRoomId(null);
          window.location.hash = '';
        }
      });
    }
  }, [currentRoomId]);

  const createRoom = async () => {
    if (!profile) return;
    const newRoomRef = push(ref(rtdb, 'rooms'));
    const roomId = newRoomRef.key!;
    const roomData: Room = {
      id: roomId,
      hostId: profile.uid,
      hostName: profile.displayName,
      status: 'waiting',
      createdAt: Date.now(),
      players: {
        [profile.uid]: {
          uid: profile.uid,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          character: CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰',
          currentFloor: 0,
          isReady: false,
          isFinished: false
        }
      }
    };
    await set(newRoomRef, roomData);
    setCurrentRoomId(roomId);
    window.location.hash = roomId;
    setView('room');
  };

  const joinRoom = async (roomId: string) => {
    if (!profile) return;
    const player: PlayerState = {
      uid: profile.uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL,
      character: CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰',
      currentFloor: 0,
      isReady: false,
      isFinished: false
    };
    await update(ref(rtdb, `rooms/${roomId}/players`), {
      [profile.uid]: player
    });
    setCurrentRoomId(roomId);
    window.location.hash = roomId;
    setView('room');
  };

  const leaveRoom = async () => {
    if (currentRoomId && profile) {
      await remove(ref(rtdb, `rooms/${currentRoomId}/players/${profile.uid}`));
      setCurrentRoomId(null);
      setRoom(null);
      window.location.hash = '';
      setView('lobby');
    }
  };

  const startGame = async () => {
    if (currentRoomId) {
      await update(ref(rtdb, `rooms/${currentRoomId}`), { status: 'playing' });
    }
  };

  const selectCharacter = async (charId: string) => {
    if (!profile) return;
    await updateDoc(doc(db, 'users', profile.uid), { selectedCharacter: charId });
    setProfile(prev => prev ? { ...prev, selectedCharacter: charId } : null);
    
    if (currentRoomId) {
      const emoji = CHARACTERS.find(c => c.id === charId)?.emoji || '🐰';
      await update(ref(rtdb, `rooms/${currentRoomId}/players/${profile.uid}`), { character: emoji });
    }
  };

  const handleGameFinish = async (score: number) => {
    if (!profile || !room || !currentRoomId) return;
    
    setInGame(false);
    playSound('win');
    
    await updateDoc(doc(db, 'users', profile.uid), {
      totalGames: profile.totalGames + 1,
      // 승리 시 winCount 증가 로직 추가 (단순화: 50층 이상 시 승리 처리)
      winCount: score > 50 ? profile.winCount + 1 : profile.winCount
    });
    
    if (room.hostId === profile.uid) {
      setTimeout(async () => {
        await update(ref(rtdb, `rooms/${currentRoomId}`), { 
          status: 'waiting',
          players: Object.keys(room.players).reduce((acc, pid) => {
            acc[pid] = { ...room.players[pid], currentFloor: 0, isReady: false, isFinished: false };
            return acc;
          }, {} as any)
        });
      }, 5000);
    }
  };

  if (!user) return <Auth />;

  if (inGame && room && profile) {
    const myChar = CHARACTERS.find(c => c.id === profile.selectedCharacter)?.emoji || '🐰';
    return <Game roomId={room.id} uid={profile.uid} character={myChar} onFinish={handleGameFinish} />;
  }

  return (
    <div className="min-h-screen bg-pink-50 pb-20">
      <header className="bg-white p-4 shadow-sm flex items-center justify-between border-b-2 border-pink-100">
        <div className="flex items-center gap-2">
          <img src={profile?.photoURL} className="w-10 h-10 rounded-full border-2 border-pink-200 shadow-sm" alt="me" />
          <div>
            <p className="font-bold text-gray-700">{profile?.displayName}</p>
            <p className="text-xs text-pink-400 font-bold">✨ {profile?.winCount}승</p>
          </div>
        </div>
        <button onClick={() => auth.signOut()} className="text-gray-400 text-sm font-bold">로그아웃</button>
      </header>

      <main className="max-w-md mx-auto p-4 pt-8">
        {view === 'lobby' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-xl border-b-8 border-pink-100 text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">어떤 친구랑 놀까요?</h2>
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
            </div>

            <button 
              onClick={createRoom}
              className="w-full bg-pink-500 hover:bg-pink-600 text-white text-xl font-bold py-6 rounded-3xl shadow-lg transform transition active:scale-95 border-b-4 border-pink-700"
            >
              🌈 친구 초대해서 대결하기
            </button>

            <div className="bg-white p-6 rounded-3xl shadow-lg border-2 border-pink-100">
              <h3 className="font-bold text-lg mb-4 text-gray-700 flex items-center gap-2">
                🏆 누가 제일 높이 갔을까?
              </h3>
              <div className="space-y-3">
                {rankings.map((r, i) => (
                  <div key={r.uid} className="flex items-center justify-between p-2 rounded-xl bg-pink-50/50">
                    <div className="flex items-center gap-3">
                      <span className={`font-bold w-6 h-6 flex items-center justify-center rounded-full ${i === 0 ? 'bg-yellow-400 text-white' : 'text-pink-400'}`}>
                        {i + 1}
                      </span>
                      <img src={r.photoURL} className="w-8 h-8 rounded-full border border-pink-100" alt="" />
                      <span className="text-gray-700 font-bold">{r.displayName}</span>
                    </div>
                    <span className="font-bold text-pink-500">{r.winCount}승</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'room' && room && (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-xl text-center border-2 border-sky-100">
              <h2 className="text-2xl font-bold mb-2 text-sky-600">입장 완료!</h2>
              <p className="text-gray-400 text-sm mb-6 font-bold">친구들이 올 때까지 기다려주세요 ☁️</p>
              
              <div className="flex flex-wrap justify-center gap-4 mb-8">
                {(Object.values(room.players) as PlayerState[]).map(p => (
                  <div key={p.uid} className="flex flex-col items-center gap-1">
                    <div className="relative">
                      <img src={p.photoURL} className="w-16 h-16 rounded-full border-4 border-sky-100 shadow-sm" alt="" />
                      <span className="absolute -bottom-1 -right-1 text-3xl drop-shadow-md">{p.character}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-600">{p.displayName}</span>
                  </div>
                ))}
                {Array.from({ length: 4 - Object.keys(room.players).length }).map((_, i) => (
                  <div key={i} className="w-16 h-16 rounded-full border-4 border-dashed border-gray-100 flex items-center justify-center text-gray-200">
                    <span className="text-2xl">?</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    alert('초대 링크가 복사되었어요! 친구에게 보내주세요 ✨');
                  }}
                  className="w-full py-3 rounded-xl bg-sky-100 text-sky-600 font-bold border-2 border-sky-200 hover:bg-sky-200 transition"
                >
                  🔗 친구 초대 링크 복사하기
                </button>

                {room.hostId === profile?.uid ? (
                  <button 
                    onClick={startGame}
                    className="w-full py-4 rounded-xl bg-pink-500 text-white font-bold text-xl shadow-lg border-b-4 border-pink-700 active:translate-y-1 active:border-b-0 transition"
                  >
                    🎉 게임 시작!
                  </button>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-xl text-gray-500 font-bold animate-pulse border-2 border-dashed">
                    방장 친구가 시작하기를 기다려요...
                  </div>
                )}

                <button 
                  onClick={leaveRoom}
                  className="w-full py-2 text-gray-400 font-bold text-sm hover:text-gray-600"
                >
                  방 나가기
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div className="bg-white p-6 rounded-3xl shadow-xl border-2 border-pink-100">
             <h2 className="text-2xl font-bold text-center text-pink-500 mb-6">🏆 명예의 전당</h2>
             <div className="space-y-4">
               {rankings.map((r, i) => (
                  <div key={r.uid} className="flex items-center justify-between p-4 rounded-2xl bg-pink-50/30 border border-pink-100">
                    <div className="flex items-center gap-4">
                      <span className={`text-xl font-bold w-8 h-8 flex items-center justify-center rounded-full ${i === 0 ? 'bg-yellow-400 text-white' : i === 1 ? 'bg-gray-300 text-white' : i === 2 ? 'bg-orange-300 text-white' : 'text-pink-300'}`}>
                        {i + 1}
                      </span>
                      <img src={r.photoURL} className="w-10 h-10 rounded-full shadow-sm" alt="" />
                      <span className="font-bold text-gray-700">{r.displayName}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-pink-500 font-bold">{r.winCount}승</p>
                      <p className="text-[10px] text-gray-400">참여: {r.totalGames}회</p>
                    </div>
                  </div>
               ))}
             </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 h-16 flex items-center justify-around z-20 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setView('lobby')}
          className={`flex flex-col items-center gap-1 transition-all ${view === 'lobby' ? 'text-pink-500 scale-110' : 'text-gray-300'}`}
        >
          <span className="text-2xl">🏠</span>
          <span className="text-[10px] font-bold">홈</span>
        </button>
        <button 
          onClick={() => setView('ranking')}
          className={`flex flex-col items-center gap-1 transition-all ${view === 'ranking' ? 'text-pink-500 scale-110' : 'text-gray-300'}`}
        >
          <span className="text-2xl">🏆</span>
          <span className="text-[10px] font-bold">랭킹</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
