
import React from 'react';

interface CharacterSpriteProps {
  type: string;
  facing: number; // 0: Left, 1: Right
  isMoving: boolean;
  size?: number;
  opacity?: number;
}

export const CharacterSprite: React.FC<CharacterSpriteProps> = ({ 
  type, 
  facing, 
  isMoving, 
  size = 80,
  opacity = 1 
}) => {
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
  };

  const c = config[type] || config.rabbit;
  const isRight = facing === 1;

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
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg overflow-visible">
        <style>
          {`
            @keyframes climbLeg {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-10px) rotate(10deg); }
            }
            @keyframes climbArm {
              0%, 100% { transform: rotate(0deg); }
              50% { transform: rotate(-30deg); }
            }
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-3px); }
            }
            .animate-leg { animation: ${isMoving ? 'climbLeg 0.2s infinite' : 'none'}; }
            .animate-arm { animation: ${isMoving ? 'climbArm 0.2s infinite' : 'none'}; transform-origin: top; }
            .animate-body { animation: bounce 1.5s ease-in-out infinite; }
          `}
        </style>

        {/* 다리 */}
        <ellipse className="animate-leg" cx="35" cy="85" rx="8" ry="12" fill={c.secondary} />
        <ellipse className="animate-leg" cx="65" cy="85" rx="8" ry="12" fill={c.secondary} style={{ animationDelay: '0.1s' }} />

        {/* 몸통 */}
        <ellipse className="animate-body" cx="50" cy="65" rx="25" ry="25" fill={c.primary} stroke={c.secondary} strokeWidth="2" />
        
        {/* 팔 */}
        <ellipse className="animate-arm" cx="28" cy="60" rx="6" ry="15" fill={c.secondary} />
        <ellipse className="animate-arm" cx="72" cy="60" rx="6" ry="15" fill={c.secondary} style={{ animationDelay: '0.1s' }} />

        {/* 머리 - 고개 돌리기 시각화를 위해 약간 앞으로 쏠림 */}
        <g className="animate-body" style={{ transform: 'translateX(3px)' }}>
          {/* 귀 */}
          {c.earType === 'long' && (
            <>
              <ellipse cx="35" cy="15" rx="6" ry="20" fill={c.primary} transform="rotate(-10 35 15)" />
              <ellipse cx="65" cy="15" rx="6" ry="20" fill={c.primary} transform="rotate(10 65 15)" />
            </>
          )}
          {c.earType === 'pointy' && (
            <>
              <path d="M25 25 L35 5 L45 25 Z" fill={c.primary} />
              <path d="M55 25 L65 5 L75 25 Z" fill={c.primary} />
            </>
          )}
          {c.earType === 'round' && (
            <>
              <circle cx="30" cy="25" r="10" fill={c.secondary} />
              <circle cx="70" cy="25" r="10" fill={c.secondary} />
            </>
          )}

          <circle cx="50" cy="35" r="28" fill={c.primary} stroke={c.secondary} strokeWidth="2" />
          
          {/* 얼굴 요소 - 진행 방향으로 쏠림 (시선 처리) */}
          <g transform="translateX(5)">
            {/* 눈 */}
            <circle cx="40" cy="30" r="4" fill="#333" />
            <circle cx="65" cy="30" r="4" fill="#333" />
            {/* 눈동자 하이라이트 */}
            <circle cx="41" cy="29" r="1.5" fill="white" />
            <circle cx="66" cy="29" r="1.5" fill="white" />
            
            {/* 볼터치 */}
            <circle cx="35" cy="40" r="5" fill="#FFB6C1" opacity="0.6" />
            <circle cx="70" cy="40" r="5" fill="#FFB6C1" opacity="0.6" />
            
            {/* 코/입 */}
            <circle cx="52" cy="42" r="3" fill={c.secondary} />
          </g>
        </g>
      </svg>
    </div>
  );
};
