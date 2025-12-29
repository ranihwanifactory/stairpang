
import React from 'react';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider, db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const Auth: React.FC = () => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLogin, setIsLogin] = React.useState(true);
  const [error, setError] = React.useState('');

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName || '익명 친구',
          email: user.email,
          photoURL: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
          winCount: 0,
          totalGames: 0,
          selectedCharacter: 'rabbit'
        });
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          displayName: email.split('@')[0],
          email,
          photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${result.user.uid}`,
          winCount: 0,
          totalGames: 0,
          selectedCharacter: 'rabbit'
        });
      }
    } catch (err: any) {
      setError('이메일 또는 비밀번호가 올바르지 않아요!');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border-4 border-pink-200">
        <h1 className="text-5xl font-bold text-pink-500 mb-8 text-center float-anim drop-shadow-md">🏆 100계단</h1>
        <p className="text-center text-gray-500 mb-6 font-bold">100층까지 누가 더 빠를까?</p>
        
        <form onSubmit={handleAuth} className="space-y-4">
          <input
            type="email"
            placeholder="이메일 주소"
            className="w-full p-3 rounded-xl border-2 border-pink-100 focus:border-pink-300 outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="비밀번호"
            className="w-full p-3 rounded-xl border-2 border-pink-100 focus:border-pink-300 outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="w-full bg-pink-500 text-white font-bold py-3 rounded-xl hover:bg-pink-600 transition shadow-lg">
            {isLogin ? '로그인' : '가입하기'}
          </button>
        </form>

        <div className="mt-6 space-y-3">
          <button 
            onClick={handleGoogleLogin}
            className="w-full bg-white border-2 border-gray-100 flex items-center justify-center gap-3 py-3 rounded-xl hover:bg-gray-50 transition"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="google" />
            <span className="font-semibold text-gray-600">구글로 시작하기</span>
          </button>

          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="w-full text-pink-400 font-bold py-2"
          >
            {isLogin ? '처음이신가요? 가입하기' : '계정이 있나요? 로그인'}
          </button>
        </div>

        {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}
      </div>
    </div>
  );
};
