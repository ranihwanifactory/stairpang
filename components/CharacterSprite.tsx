
import React from 'react';

interface CharacterSpriteProps {
  type: string;
  facing: number; // 0: Left, 1: Right
  isMoving: boolean;
  size?: number;
  opacity?: number;
  customImageUrl?: string;
}

export const CharacterSprite: React.FC<CharacterSpriteProps> = ({ 
  type, 
  facing, 
  isMoving, 
  size = 80,
  opacity = 1,
  customImageUrl
}) => {
  const isRight = facing === 1;
  const isCustom = type === 'custom' && customImageUrl;

  // 동물별 색상 및 특징 설정
  const config: Record<string, { primary: string, secondary: string, earType: 'long' | 'pointy' | 'round' }> = {
    rabbit: { primary: '#FFB6C1', secondary: '#FF69B4', earType: 'long' },
    cat: { primary: '#FFD700', secondary: '#FFA500', earType: 'pointy' },
    bear: { primary: '#8B4513', secondary: '#A0522D', earType: 'round' },
    panda: { primary: '#FFFFFF', secondary: '#000000', earType: 'round' },
    frog: { primary: '#32CD32', secondary: '#228B22', earType: 'round' },
    monkey: { primary: '#DEB887', secondary: '#8B4513', earType: 'round' },
    chick: { primary: '#FFFF00', secondary: '#FFD700', earType: 'round' },
    fox: { primary: '#FF4500', secondary: '#FF8C00', earType: 'pointy' },
    custom: { primary: '#FFFFFF', secondary: '#FF69B4', earType: 'round' }
  };

  const c = config[type] || config.rabbit;

  return (
    <div 
      className="relative flex items-center justify-center transition-transform duration-300"
      style={{ 
        width: size, 
        height: size, 
        opacity,
        transform: `scaleX(${isRight ? 1 : -1})` 
      }}
    >
      <style>
        {`
          @keyframes climbLeg {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px) rotate(10deg); }
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
          .animate-body { animation: bounce 1.5s ease-in-out infinite; }
          .sprite-container { 
            animation: ${isMoving ? 'climbLeg 0.2s infinite' : 'bounce 1.5s ease-in-out infinite'}; 
          }
        `}
      </style>

      {isCustom ? (
        <div className="sprite-container relative flex items-center justify-center">
          {/* 커스텀 이미지 장식 */}
          <div className="absolute -top-1 -right-1 text-2xl z-10">✨</div>
          <div className="rounded-full overflow-hidden border-4 border-white shadow-xl bg-pink-100" style={{ width: size * 0.8, height: size * 0.8 }}>
            <img 
              src={customImageUrl} 
              alt="Custom Character" 
              className="w-full h-full object-cover"
              style={{ transform: isRight ? 'none' : 'scaleX(-1)' }} // 이미지는 방향에 맞춰 한번 더 반전
            />
          </div>
          {/* 하단 발 모양 장식 */}
          <div className="absolute -bottom-2 flex gap-4">
             <div className="w-4 h-4 bg-pink-400 rounded-full"></div>
             <div className="w-4 h-4 bg-pink-400 rounded-full"></div>
          </div>
        </div>
      ) : (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg overflow-visible">
          <g className="animate-body">
            {/* 꼬리 */}
            <circle cx="20" cy="70" r="8" fill={c.secondary} />
            {/* 다리 */}
            <ellipse cx="35" cy="85" rx="8" ry="12" fill={c.secondary} />
            <ellipse cx="65" cy="85" rx="8" ry="12" fill={c.secondary} />
            {/* 몸통 */}
            <ellipse cx="45" cy="65" rx="25" ry="25" fill={c.primary} stroke={c.secondary} strokeWidth="2" />
            {/* 팔 */}
            <ellipse cx="28" cy="60" rx="6" ry="15" fill={c.secondary} />
            <ellipse cx="68" cy="60" rx="6" ry="15" fill={c.secondary} />
            {/* 머리 */}
            <g style={{ transform: 'translateX(8px)' }}>
              {c.earType === 'long' && (
                <>
                  <ellipse cx="35" cy="15" rx="6" ry="20" fill={c.primary} transform="rotate(-10 35 15)" />
                  <ellipse cx="60" cy="12" rx="6" ry="22" fill={c.primary} transform="rotate(15 60 12)" />
                </>
              )}
              {c.earType === 'pointy' && (
                <>
                  <path d="M25 25 L35 5 L45 25 Z" fill={c.primary} />
                  <path d="M50 25 L65 3 L75 25 Z" fill={c.primary} />
                </>
              )}
              {c.earType === 'round' && (
                <>
                  <circle cx="30" cy="25" r="10" fill={c.secondary} />
                  <circle cx="70" cy="22" r="11" fill={c.secondary} />
                </>
              )}
              <circle cx="50" cy="35" r="28" fill={c.primary} stroke={c.secondary} strokeWidth="2" />
              <g transform="translateX(12)">
                <circle cx="38" cy="30" r="3" fill="#333" />
                <circle cx="68" cy="30" r="5" fill="#333" />
                <circle cx="35" cy="42" r="4" fill="#FFB6C1" opacity="0.4" />
                <circle cx="75" cy="42" r="6" fill="#FFB6C1" opacity="0.6" />
                <circle cx="78" cy="38" r="4" fill={c.secondary} />
              </g>
            </g>
          </g>
        </svg>
      )}
    </div>
  );
};
