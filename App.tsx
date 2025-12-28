
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auth, db, rtdb } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
// Fix: Added missing setDoc to the imports from firebase/firestore
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, onSnapshot, increment } from 'firebase/firestore';
import { ref, set, push, onValue, remove, update, off, get } from 'firebase/database';
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
  
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const docSnap = await getDoc(doc(db, 'users', u.uid));
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile({ ...data, uid: u.uid });
          } else {
            const newProfile = {
              uid: u.uid,
              displayName: u.displayName || '익명 친구',
              email: u.email || '',
              photoURL: u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`,
              winCount: 0,
              totalGames: 0,
              selectedCharacter: 'rabbit'
            };
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setProfile(newProfile);
          }
        } catch (e) {
          console.error("Profile fetch error:", e);
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
      setRoom(null);
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
      let firstLoad = true;
      const listener = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setRoom(data);
          setInGame(data.status === 'playing');
          firstLoad = false;
        } else if (!firstLoad) {
          // 데이터가 있다가 없어진 경우에만 퇴장 처리 (생성 직후 찰나의 null 방지)
          setRoom(null);
          setCurrentRoomId(null);
          window.location.hash = '';
          setView('lobby');
        }
      });
      return () => off(roomRef, 'value', listener);
    }
  }, [currentRoomId]);

  const processAndSaveImage = async (imageSrc: string) => {
    if (!user || !profile) return;
    setIsProcessing(true);
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const minSide = Math.min(img.width, img.height);
        const startX = (img.width - minSide) / 2;
        const startY = (img.height - minSide) / 2;
        ctx.drawImage(img, startX, startY, minSide, minSide, 0, 0, size, size);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        await updateDoc(doc(db, 'users', user.uid), {
          customCharacterURL: compressedBase64,
          selectedCharacter: 'custom'
        });
        setProfile({ ...profile, customCharacterURL: compressedBase64, selectedCharacter: 'custom' });
        if (currentRoomId) {
          await update(ref(rtdb, `rooms/${currentRoomId}/players/${user.uid}`), {
            characterId: 'custom',
            customCharacterURL: compressedBase64
          });
        }
      }
      setIsProcessing(false);
      setShowPhotoOptions(false);
    };
    img.src = imageSrc;
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) processAndSaveImage(event.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const openCamera = async () => {
    setIsCameraOpen(true);
    setShowPhotoOptions(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert('카메라를 사용할 수 없습니다. 권한 설정을 확인해주세요!');
      setIsCameraOpen(false);
    }
  };

  const closeCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const startX = (video.videoWidth - size) / 2;
        const startY = (video.videoHeight - size) / 2;
        ctx.drawImage(video, startX, startY, size, size, 0, 0, size, size);
        processAndSaveImage(canvas.toDataURL('image/jpeg'));
        closeCamera();
      }
    }
  };

  const createRoom = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const roomsListRef = ref(rtdb, 'rooms');
      const newRoomRef = push(roomsListRef);
      const roomId = newRoomRef.key;
      const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
      
      const roomData = {
        id: roomId,
        shortCode,
        hostId: myUid,
        hostName: profile.displayName || '익명',
        status: 'waiting',
        createdAt: Date.now(),
        players: {
          [myUid]: {
            uid: myUid,
            displayName: profile.displayName || '익명',
            photoURL: profile.photoURL,
            characterId: profile.selectedCharacter,
            customCharacterURL: profile.customCharacterURL || null,
            currentFloor: 0,
            isReady: false,
            isFinished: false
          }
        }
      };

      // 데이터 저장 완료를 확실히 기다림
      await set(newRoomRef, roomData);
      
      // 저장 후 해시 변경 (setCurrentRoomId를 트리거함)
      window.location.hash = roomId || '';
    } catch (e: any) {
      console.error("Room create error:", e);
      alert('방을 만들지 못했습니다. 인터넷 연결을 확인해주세요! 😭');
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
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${myUid}`);
      
      // 방이 존재하는지 먼저 확인
      const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
      if (!roomSnap.exists()) {
        alert('이미 사라진 방인 것 같아요! 💨');
        return;
      }

      await set(playerRef, {
        uid: myUid,
        displayName: profile.displayName || '익명',
        photoURL: profile.photoURL,
        characterId: profile.selectedCharacter,
        customCharacterURL: profile.customCharacterURL || null,
        currentFloor: 0,
        isReady: false,
        isFinished: false
      });
      
      window.location.hash = roomId;
    } catch (e: any) {
      console.error("Join room error:", e);
      alert('방에 들어가지 못했습니다. 다시 시도해주세요! ⚠️');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode.length !== 4) return;
    
    setIsProcessing(true);
    try {
      // 최신 방 목록을 직접 조회 (동기화 지연 방지)
      const roomsSnap = await get(ref(rtdb, 'rooms'));
      const roomsData = roomsSnap.val();
      
      if (roomsData) {
        const targetEntry = Object.entries(roomsData).find(
          ([_, r]: [string, any]) => r && r.shortCode === inputCode && r.status === 'waiting'
        );
        
        if (targetEntry) {
          joinRoom(targetEntry[0]);
          setInputCode('');
        } else {
          alert('방 번호를 찾을 수 없거나 이미 시작된 게임이에요! 🔍');
        }
      } else {
        alert('현재 대기 중인 방이 없습니다. 직접 방을 만들어보세요!');
      }
    } catch (e) {
      console.error("Join by code error:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  const leaveRoom = async () => {
    const currentUser = auth.currentUser;
    if (!currentRoomId || !currentUser || isProcessing) return;
    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const playersCount = Object.keys(room?.players || {}).length;
      if (playersCount <= 1) {
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
        alert('최소 2명이 필요해요! 친구를 초대해보세요.');
        return;
      }
      const startDir = 1;
      const sequence = [startDir, startDir];
      let currentX = startDir;
      for (let i = 2; i < 1000; i++) {
        if (Math.random() > 0.7) currentX = currentX === 1 ? 0 : 1;
        sequence.push(currentX);
      }
      await update(ref(rtdb, `rooms/${currentRoomId}`), { 
        status: 'playing',
        stairSequence: sequence,
        winnerId: null,
        loserId: null
      });
    }
  };

  const selectCharacter = async (charId: string) => {
    if (charId === 'custom') { setShowPhotoOptions(true); return; }
    const currentUser = auth.currentUser;
    if (!profile || !currentUser) return;
    setProfile({ ...profile, selectedCharacter: charId });
    await updateDoc(doc(db, 'users', currentUser.uid), { selectedCharacter: charId });
    if (currentRoomId) {
      await update(ref(rtdb, `rooms/${currentRoomId}/players/${currentUser.uid}`), {
        characterId: charId,
        customCharacterURL: null
      });
    }
  };

  const handleGameFinish = async (score: number, isWinner: boolean) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile) return;
    
    setInGame(false);
    
    if (isPractice) {
      setIsPractice(false);
      return;
    }

    if (!room || !currentRoomId) return;

    await updateDoc(doc(db, 'users', currentUser.uid), {
      totalGames: increment(1),
      winCount: isWinner ? increment(1) : increment(0)
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
          players: resetPlayers,
          stairSequence: null,
          winnerId: null,
          loserId: null
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
      customImageUrl={profile.customCharacterURL}
      stairSequence={room?.stairSequence}
    />;
  }

  return (
    <div className="min-h-screen bg-pink-50 pb-24 font-['Jua']">
      <header className="bg-white p-3 sm:p-4 shadow-sm flex items-center justify-between border-b-2 border-pink-100 sticky top-0 z-30">
        <div className="flex items-center gap-2 sm:gap-3">
          <img src={profile?.photoURL} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-pink-200 bg-pink-50" alt="me" />
          <div>
            <p className="font-bold text-gray-700 leading-tight text-base sm:text-lg">{profile?.displayName}</p>
            <p className="text-[10px] sm:text-xs text-pink-400 font-bold">✨ {profile?.winCount}번 이겼어요!</p>
          </div>
        </div>
        <button onClick={() => auth.signOut()} className="text-gray-400 text-[10px] sm:text-xs font-bold bg-gray-50 px-3 py-1.5 rounded-full">로그아웃</button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {view === 'lobby' && (
          <>
            <section className="bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-b-8 border-pink-100 text-center relative overflow-hidden">
              <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
              <canvas ref={canvasRef} className="hidden" />
              <h2 className="text-lg font-bold text-gray-800 mb-3">내 캐릭터 바꾸기</h2>
              <div className="grid grid-cols-5 gap-2 overflow-x-auto pb-2">
                {CHARACTERS.map(char => (
                  <button 
                    key={char.id}
                    onClick={() => selectCharacter(char.id)}
                    className={`p-2 rounded-2xl transition-all flex flex-col items-center justify-center min-w-[60px] ${profile?.selectedCharacter === char.id ? 'bg-pink-100 border-2 border-pink-400 scale-105' : 'bg-gray-50'}`}
                  >
                    <span className="text-3xl">
                      {char.id === 'custom' && profile?.customCharacterURL ? (
                        <img src={profile.customCharacterURL} className="w-10 h-10 rounded-full object-cover border-2 border-white" alt="custom" />
                      ) : char.emoji}
                    </span>
                    <span className="text-[10px] mt-1 text-gray-400 font-bold">{char.id === 'custom' ? '내 사진' : char.name.split(' ')[1]}</span>
                  </button>
                ))}
              </div>
              
              {showPhotoOptions && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-4 z-40">
                  <h3 className="text-xl font-bold text-pink-500 mb-6">사진 가져오기</h3>
                  <div className="grid grid-cols-2 gap-4 w-full max-w-[280px]">
                    <button onClick={openCamera} className="bg-sky-400 text-white p-4 rounded-3xl shadow-lg flex flex-col items-center gap-2">
                       <span className="text-4xl">📸</span><span className="font-bold">사진 찍기</span>
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="bg-pink-400 text-white p-4 rounded-3xl shadow-lg flex flex-col items-center gap-2">
                       <span className="text-4xl">🖼️</span><span className="font-bold">앨범 선택</span>
                    </button>
                  </div>
                  <button onClick={() => setShowPhotoOptions(false)} className="mt-8 text-gray-400 font-bold">닫기</button>
                </div>
              )}

              {isCameraOpen && (
                <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center">
                  <div className="relative w-full aspect-square max-w-sm overflow-hidden border-4 border-white rounded-[40px] shadow-2xl">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                    <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none flex items-center justify-center">
                       <div className="w-64 h-64 border-4 border-dashed border-white/60 rounded-full" />
                    </div>
                  </div>
                  <div className="mt-12 flex gap-8 items-center">
                    <button onClick={closeCamera} className="w-16 h-16 rounded-full bg-white/20 text-white text-3xl flex items-center justify-center">✕</button>
                    <button onClick={capturePhoto} className="w-24 h-24 rounded-full bg-pink-500 border-8 border-white flex items-center justify-center active:scale-90 transition-transform">
                       <div className="w-12 h-12 bg-white rounded-full" />
                    </button>
                    <div className="w-16 h-16 invisible" />
                  </div>
                </div>
              )}
            </section>

            <div className="grid grid-cols-2 gap-4">
              <button disabled={isProcessing} onClick={createRoom} className="bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white text-xl font-bold py-6 rounded-3xl shadow-lg border-b-4 border-pink-700 active:translate-y-1 active:border-b-0 transition-all">방 만들기</button>
              <button onClick={startPractice} className="bg-green-500 hover:bg-green-600 text-white text-xl font-bold py-6 rounded-3xl shadow-lg border-b-4 border-green-700 active:translate-y-1 active:border-b-0 transition-all">혼자 연습</button>
            </div>

            <section className="bg-yellow-100 p-6 rounded-3xl shadow-lg border-2 border-yellow-200">
               <h3 className="text-center font-bold text-yellow-700 mb-3">🔢 친구 방 번호로 입장!</h3>
               <form onSubmit={handleJoinByCode} className="flex gap-2">
                 <input 
                   type="text" inputMode="numeric" maxLength={4} placeholder="번호 4자리"
                   className="flex-1 p-4 rounded-2xl border-2 border-yellow-300 text-center text-2xl font-bold text-yellow-700 focus:outline-none"
                   value={inputCode}
                   onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, ''))}
                 />
                 <button disabled={isProcessing} className="bg-yellow-500 disabled:bg-yellow-200 text-white px-6 py-2 rounded-2xl font-bold">입장</button>
               </form>
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-lg border-2 border-sky-100">
              <h3 className="font-bold text-lg mb-3 text-sky-600">☁️ 현재 대기 중인 방</h3>
              <div className="space-y-3">
                {availableRooms.length === 0 ? (
                  <div className="py-10 text-center text-gray-300 font-bold bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">현재 대기중인 방이 없어요.</div>
                ) : (
                  availableRooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-4 rounded-2xl bg-sky-50 border border-sky-100">
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-gray-700 text-lg truncate block">{r.hostName}님의 방</span>
                        <span className="text-xs text-sky-400 font-bold">번호: {r.shortCode} | 인원: {Object.keys(r.players).length}/4</span>
                      </div>
                      <button onClick={() => joinRoom(r.id)} className="bg-sky-500 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-md">입장!</button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {view === 'room' && room && (
          <div className="bg-white p-6 rounded-3xl shadow-xl text-center border-2 border-sky-100">
            <div className="bg-yellow-100 py-4 rounded-2xl mb-6 border-2 border-yellow-200">
              <p className="text-xs text-yellow-600 font-bold mb-1">우리 방 번호</p>
              <h2 className="text-5xl font-black text-yellow-700 tracking-widest">{room.shortCode}</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-6 mb-10">
              {Object.values(room.players).map((p: any) => (
                <div key={p.uid} className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-2xl relative">
                  {p.uid === room.hostId && <span className="absolute -top-2 -left-2 text-2xl">👑</span>}
                  <div className="relative">
                     <img src={p.customCharacterURL || p.photoURL} className="w-20 h-20 rounded-full border-4 border-white shadow-md object-cover bg-white" alt="" />
                     <span className="absolute -bottom-1 -right-1 bg-white rounded-full w-8 h-8 flex items-center justify-center shadow-md border border-gray-100">
                       {CHARACTERS.find(c => c.id === p.characterId)?.emoji || '🐰'}
                     </span>
                  </div>
                  <span className="text-base font-bold text-gray-700 truncate w-full">{p.displayName}</span>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              {room.hostId === auth.currentUser?.uid ? (
                <button onClick={startGame} disabled={Object.keys(room.players).length < 2} className={`w-full py-5 rounded-2xl text-white font-bold text-2xl shadow-lg border-b-4 ${Object.keys(room.players).length < 2 ? 'bg-gray-300 border-gray-400' : 'bg-pink-500 border-pink-700 hover:bg-pink-600'}`}>
                  {Object.keys(room.players).length < 2 ? '친구를 더 기다려요' : '게임 시작! 🎉'}
                </button>
              ) : (
                <div className="p-5 bg-sky-50 rounded-2xl text-sky-500 font-bold animate-pulse">방장이 시작하길 기다리고 있어요...</div>
              )}
              <button onClick={leaveRoom} className="w-full py-2 text-gray-400 font-bold hover:text-gray-600 transition">나가기</button>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div className="bg-white p-6 rounded-3xl shadow-xl border-2 border-pink-100">
             <h2 className="text-2xl font-bold text-center text-pink-500 mb-6 flex items-center justify-center gap-3">
               <span className="text-3xl">🏆</span> 명예의 전당
             </h2>
             <div className="space-y-4">
               {rankings.map((r, i) => (
                  <div key={r.uid} className="flex items-center justify-between p-4 rounded-2xl bg-pink-50/30 border border-pink-100">
                    <div className="flex items-center gap-4">
                      <span className={`text-xl font-bold w-10 h-10 flex items-center justify-center rounded-full ${i === 0 ? 'bg-yellow-400 text-white' : 'bg-white text-pink-300'}`}>{i + 1}</span>
                      <img src={r.customCharacterURL || r.photoURL} className="w-12 h-12 rounded-full border-2 border-white object-cover bg-white" alt="" />
                      <span className="font-bold text-gray-700">{r.displayName}</span>
                    </div>
                    <span className="text-pink-500 font-bold text-xl">{r.winCount}승</span>
                  </div>
               ))}
             </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-pink-50 h-20 flex items-center justify-around z-50 shadow-lg">
        <button onClick={() => setView('lobby')} className={`flex flex-col items-center gap-1 flex-1 ${view === 'lobby' ? 'text-pink-500' : 'text-gray-300'}`}>
          <span className="text-3xl transition-transform active:scale-90">🏠</span><span className="text-xs font-bold">홈</span>
        </button>
        <button onClick={() => setView('ranking')} className={`flex flex-col items-center gap-1 flex-1 ${view === 'ranking' ? 'text-pink-500' : 'text-gray-300'}`}>
          <span className="text-3xl transition-transform active:scale-90">🏆</span><span className="text-xs font-bold">랭킹</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
