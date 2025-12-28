
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

        {/* 꼬리 (뒤쪽임을 알 수 있게 뒤편에 배치) */}
        <circle className="animate-body" cx="20" cy="70" r="8" fill={c.secondary} />

        {/* 다리 */}
        <ellipse className="animate-leg" cx="35" cy="85" rx="8" ry="12" fill={c.secondary} />
        <ellipse className="animate-leg" cx="65" cy="85" rx="8" ry="12" fill={c.secondary} style={{ animationDelay: '0.1s' }} />

        {/* 몸통 */}
        <ellipse className="animate-body" cx="45" cy="65" rx="25" ry="25" fill={c.primary} stroke={c.secondary} strokeWidth="2" />
        
        {/* 팔 */}
        <ellipse className="animate-arm" cx="28" cy="60" rx="6" ry="15" fill={c.secondary} />
        <ellipse className="animate-arm" cx="68" cy="60" rx="6" ry="15" fill={c.secondary} style={{ animationDelay: '0.1s' }} />

        {/* 머리 - 방향성을 위해 진행 방향으로 더 밀어줌 */}
        <g className="animate-body" style={{ transform: 'translateX(8px)' }}>
          {/* 귀 */}
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
          
          {/* 얼굴 요소 - 앞쪽으로 과감하게 쏠리게 배치 (시선 처리 극대화) */}
          <g transform="translateX(12)">
            {/* 눈 - 앞쪽 눈을 더 크게 배치 */}
            <circle cx="38" cy="30" r="3" fill="#333" />
            <circle cx="68" cy="30" r="5" fill="#333" />
            {/* 눈동자 하이라이트 */}
            <circle cx="70" cy="28" r="2" fill="white" />
            
            {/* 볼터치 */}
            <circle cx="35" cy="42" r="4" fill="#FFB6C1" opacity="0.4" />
            <circle cx="75" cy="42" r="6" fill="#FFB6C1" opacity="0.6" />
            
            {/* 코/입 - 가장 앞쪽에 배치 */}
            <circle cx="78" cy="38" r="4" fill={c.secondary} />
            <path d="M 75 45 Q 78 48 81 45" stroke="#333" fill="none" strokeWidth="1.5" />
          </g>
        </g>
      </svg>
    </div>
  );
};
