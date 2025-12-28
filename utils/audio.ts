
const sounds = {
  jump: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3', // 톡톡 튀는 점프 소리
  turn: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3', // 짧은 클릭/전환 소리
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  lose: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
  start: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  bonus: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'
};

export const playSound = (type: keyof typeof sounds) => {
  try {
    const audio = new Audio(sounds[type]);
    audio.volume = 0.2;
    // 연속 입력 시 소리가 씹히지 않도록 오디오 재생 직전에 시간을 초기화하거나 새 인스턴스를 활용
    audio.play().catch(e => console.log('Audio blocked', e));
  } catch (e) {
    console.error('Audio play error', e);
  }
};
