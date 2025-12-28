
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auth, db, rtdb } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
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
  const [copyFeedback, setCopyFeedback] = useState(false);
  
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
          const docRef = doc(db, 'users', u.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile({
              ...data,
              uid: u.uid,
              displayName: data.displayName || u.displayName || '익명 친구',
              photoURL: data.photoURL || u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`,
              winCount: data.winCount || 0,
              totalGames: data.totalGames || 0,
              selectedCharacter: data.selectedCharacter || 'rabbit'
            });
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
            await setDoc(docRef, newProfile);
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
      setInGame(false);
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
          // 상태 감시 및 자동 화면 전환
          if (data.status === 'playing') {
            setInGame(true);
          } else if (data.status === 'waiting') {
            // 방장이 재대결을 눌러 상태가 waiting이 되면 모든 플레이어를 대기실로 보냄
            setInGame(false);
          }
          firstLoad = false;
        } else if (!firstLoad) {
          setRoom(null);
          setCurrentRoomId(null);
          window.location.hash = '';
          setView('lobby');
          setInGame(false);
        }
      });
      return () => off(roomRef, 'value', listener);
    }
  }, [currentRoomId]);

  const leaveRoom = async (isManualExit = true) => {
    const currentUser = auth.currentUser;
    if (!currentRoomId || !currentUser) {
      window.location.hash = '';
      setView('lobby');
      setInGame(false);
      setCurrentRoomId(null);
      setRoom(null);
      return;
    }

    if (isManualExit && room?.hostId === currentUser.uid) {
      const confirmLeave = window.confirm("방장이 나가면 방이 완전히 사라져요! 정말 나갈까요? 😢");
      if (!confirmLeave) return;
    }

    setIsProcessing(true);
    try {
      const myUid = currentUser.uid;
      const playersCount = Object.keys(room?.players || {}).length;
      
      if (room?.hostId === myUid || playersCount <= 1) {
        await remove(ref(rtdb, `rooms/${currentRoomId}`));
      } else {
        await remove(ref(rtdb, `rooms/${currentRoomId}/players/${myUid}`));
      }
      
      setCurrentRoomId(null);
      setRoom(null);
      setInGame(false);
      window.location.hash = '';
      setView('lobby');
    } catch (e) {
      console.error("Leave error:", e);
    } finally {
      setIsProcessing(false);
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
        id: roomId || "",
        shortCode: shortCode,
        hostId: myUid,
        hostName: profile.displayName || '익명',
        status: 'waiting',
        createdAt: Date.now(),
        players: {
          [myUid]: {
            uid: myUid,
            displayName: profile.displayName || '익명',
            photoURL: profile.photoURL || "",
            characterId: profile.selectedCharacter || "rabbit",
            customCharacterURL: profile.customCharacterURL || null,
            currentFloor: 0,
            isReady: false,
            isFinished: false,
            facing: 1
          }
        }
      };

      await set(newRoomRef, roomData);
      window.location.hash = roomId || '';
    } catch (e: any) {
      console.error("Room create error:", e);
      alert('방을 만들지 못했습니다. 잠시 후 다시 시도해주세요!');
    } finally {
      setIsProcessing(false);
    }
  };

  const shareRoom = async () => {
    if (!currentRoomId || !room) return;
    const shareUrl = `${window.location.origin}/#${currentRoomId}`;
    const shareData = {
      title: '무한의 계단 대결 초대! 🐰',
      text: `${profile?.displayName}님이 대결을 신청했어요! 방 번호: ${room.shortCode}`,
      url: shareUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      }
    } catch (err) {
      console.error('Share failed:', err);
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
      
      const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
      if (!roomSnap.exists()) {
        alert('사라진 방입니다! 💨');
        return;
      }

      await set(playerRef, {
        uid: myUid,
        displayName: profile.displayName || '익명',
        photoURL: profile.photoURL || "",
        characterId: profile.selectedCharacter || "rabbit",
        customCharacterURL: profile.customCharacterURL || null,
        currentFloor: 0,
        isReady: false,
        isFinished: false,
        facing: 1
      });
      
      window.location.hash = roomId;
    } catch (e: any) {
      console.error("Join room error:", e);
      alert('방 입장에 실패했습니다!');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode.length !== 4 || isProcessing) return;
    
    setIsProcessing(true);
    try {
      const roomsSnap = await get(ref(rtdb, 'rooms'));
      const roomsData = roomsSnap.val();
      
      if (roomsData) {
        const targetEntry = Object.entries(roomsData).find(
          ([_, r]: [string, any]) => r && r.shortCode === inputCode && r.status === 'waiting'
        );
        
        if (targetEntry) {
          setIsProcessing(false);
          joinRoom(targetEntry[0]);
          setInputCode('');
        } else {
          alert('방 번호를 찾을 수 없습니다! 🔍');
          setIsProcessing(false);
        }
      } else {
        alert('현재 대기 중인 방이 없습니다!');
        setIsProcessing(false);
      }
    } catch (e) {
      console.error("Join by code error:", e);
      setIsProcessing(false);
    }
  };

  const startGame = async () => {
    // 상태 체크 완화: waiting 또는 finished 상태에서 시작 가능
    if (currentRoomId && room && (room.status === 'waiting' || room.status === 'finished') && !isProcessing) {
      const playerIds = Object.keys(room.players || {});
      if (playerIds.length < 2) {
        alert('친구와 함께하려면 최소 2명이 필요해요!');
        return;
      }
      setIsProcessing(true);
      try {
        const startDir = 1;
        const sequence = [startDir, startDir];
        let currentX = startDir;
        for (let i = 2; i < 1000; i++) {
          if (Math.random() > 0.7) currentX = currentX === 1 ? 0 : 1;
          sequence.push(currentX);
        }

        const updatedPlayers: Record<string, any> = {};
        playerIds.forEach(id => {
          updatedPlayers[id] = {
            ...room.players[id],
            currentFloor: 0,
            facing: 1,
            isFinished: false,
            isReady: false
          };
        });

        await update(ref(rtdb, `rooms/${currentRoomId}`), { 
          status: 'playing',
          stairSequence: sequence,
          players: updatedPlayers,
          winnerId: null,
          loserId: null
        });
      } catch (e) {
        console.error("Start game error:", e);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleGameFinish = async (score: number, isWinner: boolean, action: 'rematch' | 'lobby') => {
    const currentUser = auth.currentUser;
    if (!currentUser || !profile) return;
    
    if (isPractice) {
      setInGame(false);
      setIsPractice(false);
      return;
    }

    if (!room || !currentRoomId) return;

    // 점수 업데이트 (Firestore)
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        totalGames: increment(1),
        winCount: isWinner ? increment(1) : increment(0)
      });
    } catch (e) { console.error(e); }

    if (action === 'lobby') {
      await leaveRoom(false);
    } else {
      // 재대결(Rematch) 선택 시
      if (room.hostId === currentUser.uid) {
        setIsProcessing(true);
        try {
          const resetPlayers: Record<string, any> = {};
          Object.keys(room.players).forEach(pid => {
            resetPlayers[pid] = {
              ...room.players[pid],
              currentFloor: 0,
              isReady: false,
              isFinished: false,
              facing: 1
            };
          });
          
          // 방 상태를 waiting으로 돌림 -> 리스너에 의해 모두 lobby로 이동
          await update(ref(rtdb, `rooms/${currentRoomId}`), { 
            status: 'waiting',
            players: resetPlayers,
            stairSequence: null,
            winnerId: null,
            loserId: null
          });
        } catch (e) {
          console.error("Room reset error:", e);
        } finally {
          setIsProcessing(false);
        }
      } else {
        // 방장이 아니면 본인 화면만 lobby로 전환 (방장이 상태를 바꿀 때까지 대기)
        setInGame(false);
      }
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
        customCharacterURL: charId === 'custom' ? profile.customCharacterURL : null
      });
    }
  };

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
          <img src={profile?.photoURL} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-pink-200 bg-white object-cover" alt="me" />
          <div>
            <p className="font-bold text-gray-700 leading-tight text-sm sm:text-base md:text-lg">{profile?.displayName}</p>
            <p className="text-[10px] sm:text-xs text-pink-400 font-bold">✨ {profile?.winCount}번 승리!</p>
          </div>
        </div>
        <button onClick={() => auth.signOut()} className="text-gray-400 text-[10px] sm:text-xs font-bold bg-gray-50 px-3 py-1.5 rounded-full hover:bg-gray-100">로그아웃</button>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {view === 'lobby' && (
          <>
            <section className="bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-b-8 border-pink-100 text-center relative overflow-hidden">
              <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
              <canvas ref={canvasRef} className="hidden" />
              <h2 className="text-lg font-bold text-gray-800 mb-3">캐릭터 선택</h2>
              <div className="grid grid-cols-5 gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {CHARACTERS.map(char => (
                  <button 
                    key={char.id}
                    onClick={() => selectCharacter(char.id)}
                    className={`p-2 rounded-2xl transition-all flex flex-col items-center justify-center min-w-[64px] ${profile?.selectedCharacter === char.id ? 'bg-pink-100 border-2 border-pink-400 scale-105 shadow-inner' : 'bg-gray-50 hover:bg-gray-100'}`}
                  >
                    <span className="text-3xl">
                      {char.id === 'custom' && profile?.customCharacterURL ? (
                        <img src={profile.customCharacterURL} className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm" alt="custom" />
                      ) : char.emoji}
                    </span>
                    <span className="text-[10px] mt-1 text-gray-500 font-bold">{char.id === 'custom' ? '내 사진' : char.name.split(' ')[1]}</span>
                  </button>
                ))}
              </div>
              
              {showPhotoOptions && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-4 z-40 animate-in fade-in duration-300">
                  <h3 className="text-xl font-bold text-pink-500 mb-6">나만의 캐릭터 만들기</h3>
                  <div className="grid grid-cols-2 gap-4 w-full max-w-[280px]">
                    <button onClick={openCamera} className="bg-sky-400 text-white p-4 rounded-3xl shadow-lg flex flex-col items-center gap-2 active:scale-95 transition-transform">
                       <span className="text-4xl">📸</span><span className="font-bold">사진 찍기</span>
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="bg-pink-400 text-white p-4 rounded-3xl shadow-lg flex flex-col items-center gap-2 active:scale-95 transition-transform">
                       <span className="text-4xl">🖼️</span><span className="font-bold">앨범 선택</span>
                    </button>
                  </div>
                  <button onClick={() => setShowPhotoOptions(false)} className="mt-8 text-gray-400 font-bold hover:text-gray-600">나중에 할래요</button>
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
              <button disabled={isProcessing || !profile} onClick={createRoom} className="bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white text-lg sm:text-xl font-bold py-5 sm:py-6 rounded-3xl shadow-lg border-b-4 border-pink-700 active:translate-y-1 active:border-b-0 transition-all">방 만들기</button>
              <button onClick={startPractice} className="bg-green-500 hover:bg-green-600 text-white text-lg sm:text-xl font-bold py-5 sm:py-6 rounded-3xl shadow-lg border-b-4 border-green-700 active:translate-y-1 active:border-b-0 transition-all">혼자 연습</button>
            </div>

            <section className="bg-yellow-100 p-4 sm:p-6 rounded-3xl shadow-lg border-2 border-yellow-200">
               <h3 className="text-center font-bold text-yellow-700 mb-3 text-sm sm:text-base">🔢 초대 코드로 입장하기</h3>
               <form onSubmit={handleJoinByCode} className="flex gap-2 items-stretch h-14">
                 <input 
                   type="text" inputMode="numeric" maxLength={4} placeholder="숫자 4자리"
                   className="flex-1 w-full min-w-0 p-3 rounded-2xl border-2 border-yellow-300 text-center text-xl font-bold text-yellow-700 focus:outline-none focus:border-yellow-500"
                   value={inputCode}
                   onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, ''))}
                 />
                 <button disabled={isProcessing || inputCode.length !== 4} className="bg-yellow-500 disabled:bg-yellow-200 text-white px-5 rounded-2xl font-bold active:scale-95 transition-transform shrink-0">입장</button>
               </form>
            </section>

            <section className="bg-white p-4 sm:p-6 rounded-3xl shadow-lg border-2 border-sky-100">
              <h3 className="font-bold text-lg mb-3 text-sky-600 flex items-center gap-2">
                <span className="animate-pulse">●</span> 현재 대기 중인 방
              </h3>
              <div className="space-y-3">
                {availableRooms.length === 0 ? (
                  <div className="py-8 text-center text-gray-300 font-bold bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">대기 중인 방이 없습니다.</div>
                ) : (
                  availableRooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-4 rounded-2xl bg-sky-50 border border-sky-100 animate-in slide-in-from-bottom-2 duration-300">
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-gray-700 text-base sm:text-lg truncate block">{r.hostName}님의 방</span>
                        <span className="text-[10px] sm:text-xs text-sky-400 font-bold uppercase tracking-tight">Code: {r.shortCode} • {Object.keys(r.players || {}).length}명</span>
                      </div>
                      <button onClick={() => joinRoom(r.id)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl font-bold text-xs sm:text-sm shadow-md active:scale-95 transition-transform shrink-0">입장!</button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {view === 'room' && room && (
          <div className="bg-white p-6 rounded-3xl shadow-xl text-center border-2 border-sky-100 animate-in zoom-in duration-300 relative">
            <div className="bg-yellow-100 py-4 rounded-2xl mb-4 border-2 border-yellow-200 relative group">
              <p className="text-xs text-yellow-600 font-bold mb-1">우리 방 번호</p>
              <h2 className="text-4xl sm:text-5xl font-black text-yellow-700 tracking-widest">{room.shortCode}</h2>
            </div>

            <button 
              onClick={shareRoom}
              className="w-full flex items-center justify-center gap-2 bg-sky-100 text-sky-600 py-3 rounded-2xl font-bold text-sm mb-6 hover:bg-sky-200 transition-colors active:scale-95"
            >
              <span>{copyFeedback ? '✅ 복사 완료!' : '🔗 친구 초대 링크 보내기'}</span>
            </button>
            
            <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-10">
              {Object.values(room.players || {}).map((p: any) => (
                <div key={p.uid} className="flex flex-col items-center gap-2 p-3 sm:p-4 bg-gray-50 rounded-2xl relative animate-in fade-in duration-500">
                  {p.uid === room.hostId && <span className="absolute -top-2 -left-2 text-xl sm:text-2xl drop-shadow-md">👑</span>}
                  <div className="relative">
                     <img src={p.customCharacterURL || p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 border-white shadow-md object-cover bg-white" alt="" />
                     <span className="absolute -bottom-1 -right-1 bg-white rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center shadow-md border border-gray-100 text-lg sm:text-xl">
                       {CHARACTERS.find(c => c.id === p.characterId)?.emoji || '🐰'}
                     </span>
                  </div>
                  <span className="text-sm sm:text-base font-bold text-gray-700 truncate w-full">{p.displayName}</span>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              {room.hostId === auth.currentUser?.uid ? (
                <button 
                  onClick={startGame} 
                  disabled={Object.keys(room.players || {}).length < 2 || isProcessing || room.status === 'playing'} 
                  className={`w-full py-4 sm:py-5 rounded-3xl text-white font-bold text-xl sm:text-2xl shadow-lg border-b-8 transition-all active:translate-y-2 active:border-b-0 ${Object.keys(room.players || {}).length < 2 || isProcessing || room.status === 'playing' ? 'bg-gray-300 border-gray-400 cursor-not-allowed' : 'bg-pink-500 border-pink-700 hover:bg-pink-600'}`}
                >
                  {Object.keys(room.players || {}).length < 2 ? '친구를 더 기다려요' : isProcessing ? '준비 중...' : '게임 시작! 🎉'}
                </button>
              ) : (
                <div className="p-5 sm:p-6 bg-sky-50 rounded-3xl text-sky-500 font-bold animate-pulse text-base sm:text-lg border-2 border-sky-100">방장이 시작하길 기다리고 있어요...</div>
              )}
              <button onClick={() => leaveRoom(true)} className="w-full py-2 text-gray-400 font-bold hover:text-gray-600 transition">방 나가기</button>
            </div>
          </div>
        )}

        {view === 'ranking' && (
          <div className="bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-2 border-pink-100 animate-in slide-in-from-right-4 duration-300">
             <h2 className="text-xl sm:text-2xl font-bold text-center text-pink-500 mb-6 flex items-center justify-center gap-3">
               <span className="text-2xl sm:text-3xl">🏆</span> 명예의 전당
             </h2>
             <div className="space-y-3 sm:y-4">
               {rankings.length === 0 ? (
                 <p className="text-center text-gray-400 py-10 font-bold">아직 기록이 없습니다!</p>
               ) : (
                 rankings.map((r, i) => (
                  <div key={r.uid} className="flex items-center justify-between p-3 sm:p-4 rounded-2xl bg-pink-50/30 border border-pink-100 hover:bg-pink-50 transition-colors">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <span className={`text-base sm:text-xl font-bold w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full shadow-sm ${i === 0 ? 'bg-yellow-400 text-white' : i === 1 ? 'bg-gray-200 text-gray-600' : i === 2 ? 'bg-orange-200 text-orange-700' : 'bg-white text-pink-300'}`}>{i + 1}</span>
                      <img src={r.customCharacterURL || r.photoURL} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-white object-cover bg-white shadow-sm" alt="" />
                      <span className="font-bold text-gray-700 text-sm sm:text-base">{r.displayName}</span>
                    </div>
                    <span className="text-pink-500 font-bold text-lg sm:text-xl">{r.winCount}승</span>
                  </div>
                 ))
               )}
             </div>
          </div>
        )}

        <div className="flex flex-col items-center py-4 mt-6 overflow-hidden">
          <span className="text-[10px] text-gray-300 font-bold mb-1 uppercase tracking-widest">Advertisement</span>
          <div className="bg-white/50 rounded-xl p-1 shadow-inner">
            <ins className="kakao_ad_area" style={{ display: 'none' }}
              data-ad-unit="DAN-R5KFaFpjBe5JJu3n"
              data-ad-width="320"
              data-ad-height="100"></ins>
          </div>
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-pink-50 h-20 flex items-center justify-around z-50 shadow-2xl px-4 rounded-t-3xl">
        <button onClick={() => setView('lobby')} className={`flex flex-col items-center gap-1 flex-1 py-2 rounded-2xl transition-all ${view === 'lobby' ? 'text-pink-500 bg-pink-50 scale-105' : 'text-gray-300 hover:text-pink-200'}`}>
          <span className="text-2xl sm:text-3xl transition-transform active:scale-90">🏠</span><span className="text-[10px] sm:text-xs font-bold">홈</span>
        </button>
        <button onClick={() => setView('ranking')} className={`flex flex-col items-center gap-1 flex-1 py-2 rounded-2xl transition-all ${view === 'ranking' ? 'text-pink-500 bg-pink-50 scale-105' : 'text-gray-300 hover:text-pink-200'}`}>
          <span className="text-2xl sm:text-3xl transition-transform active:scale-90">🏆</span><span className="text-[10px] sm:text-xs font-bold">랭킹</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
