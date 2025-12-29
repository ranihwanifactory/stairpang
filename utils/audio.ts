
const sounds = {
  jump: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3', // 톡톡 튀는 점프 소리
  turn: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3', // 짧은 클릭/전환 소리
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  lose: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
  start: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  bonus: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'
};

const BGM_URL = 'https://assets.mixkit.co/music/preview/mixkit-game-level-music-689.mp3';
let bgmInstance: HTMLAudioElement | null = null;

export const playSound = (type: keyof typeof sounds) => {
  try {
    const audio = new Audio(sounds[type]);
    audio.volume = 0.2;
    audio.play().catch(e => console.log('Audio blocked', e));
  } catch (e) {
    console.error('Audio play error', e);
  }
};

export const startBGM = () => {
  try {
    if (!bgmInstance) {
      bgmInstance = new Audio(BGM_URL);
      bgmInstance.loop = true;
      bgmInstance.volume = 0.1; // BGM은 효과음을 방해하지 않게 작게 설정
    }
    bgmInstance.currentTime = 0;
    bgmInstance.play().catch(e => console.log('BGM blocked by browser policy', e));
  } catch (e) {
    console.error('BGM play error', e);
  }
};

export const stopBGM = () => {
  if (bgmInstance) {
    bgmInstance.pause();
    bgmInstance.currentTime = 0;
  }
};
