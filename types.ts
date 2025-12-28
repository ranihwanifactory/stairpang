
export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  winCount: number;
  totalGames: number;
  selectedCharacter: string;
}

export interface Room {
  id: string;
  hostId: string;
  hostName: string;
  status: 'waiting' | 'playing' | 'finished';
  players: Record<string, PlayerState>;
  createdAt: number;
}

export interface PlayerState {
  uid: string;
  displayName: string;
  photoURL: string;
  character: string;
  currentFloor: number;
  isReady: boolean;
  isFinished: boolean;
}

export const CHARACTERS = [
  { id: 'rabbit', emoji: '🐰', name: '깡충 토끼' },
  { id: 'cat', emoji: '🐱', name: '야옹 고양이' },
  { id: 'bear', emoji: '🐻', name: '둥둥 곰돌이' },
  { id: 'panda', emoji: '🐼', name: '냠냠 판다' },
  { id: 'frog', emoji: '🐸', name: '개굴 개구리' },
  { id: 'monkey', emoji: '🐵', name: '재주 원숭이' },
  { id: 'chick', emoji: '🐥', name: '삐약 병아리' },
  { id: 'fox', emoji: '🦊', name: '똑똑 여우' }
];
