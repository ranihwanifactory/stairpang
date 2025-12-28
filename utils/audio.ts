
const sounds = {
  tap: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  lose: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3',
  start: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'
};

export const playSound = (type: keyof typeof sounds) => {
  const audio = new Audio(sounds[type]);
  audio.volume = 0.4;
  audio.play().catch(e => console.log('Audio blocked', e));
};
