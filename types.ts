
export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  winCount: number;
  totalGames: number;
  selectedCharacter: string;
  customCharacterURL?: string; // 사용자가 업로드한 커스텀 이미지
}

export interface Room {
  id: string;
  shortCode: string;
  hostId: string;
  hostName: string;
  status: 'waiting' | 'playing' | 'finished';
  players: Record<string, PlayerState>;
  stairSequence?: number[]; // 모든 플레이어가 공유할 계단 배열 (0: 왼쪽, 1: 오른쪽)
  createdAt: number;
}

export interface PlayerState {
  uid: string;
  displayName: string;
  photoURL: string;
  characterId: string; 
  currentFloor: number;
  isReady: boolean;
  isFinished: boolean;
  facing?: number;
  customCharacterURL?: string; 
}

export const CHARACTERS = [
  { id: 'rabbit', emoji: '🐰', name: '깡충 토끼' },
  { id: 'cat', emoji: '🐱', name: '야옹 고양이' },
  { id: 'bear', emoji: '🐻', name: '둥둥 곰돌이' },
  { id: 'panda', emoji: '🐼', name: '냠냠 판다' },
  { id: 'frog', emoji: '🐸', name: '개굴 개구리' },
  { id: 'monkey', emoji: '🐵', name: '재주 원숭이' },
  { id: 'chick', emoji: '🐥', name: '삐약 병아리' },
  { id: 'fox', emoji: '🦊', name: '똑똑 여우' },
  { id: 'custom', emoji: '📸', name: '내 사진' }
];
