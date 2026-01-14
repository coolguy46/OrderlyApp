'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface EggHatchingProps {
  progress: number; // 0-100
  size?: number;
}

export function EggHatching({ progress, size = 200 }: EggHatchingProps) {
  const stage = progress < 25 ? 0 : progress < 50 ? 1 : progress < 75 ? 2 : progress < 100 ? 3 : 4;

  return (
    <div 
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Background glow */}
      <motion.div
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.3, 0.5, 0.3]
        }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 blur-xl"
      />

      {/* Nest */}
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full"
        style={{ filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))' }}
      >
        {/* Nest base */}
        <ellipse
          cx="100"
          cy="160"
          rx="70"
          ry="25"
          fill="#8B4513"
          opacity="0.8"
        />
        <ellipse
          cx="100"
          cy="155"
          rx="60"
          ry="20"
          fill="#A0522D"
        />

        {/* Egg */}
        <motion.g
          animate={stage >= 3 ? { 
            rotate: [-2, 2, -2],
            x: [-1, 1, -1]
          } : {}}
          transition={{ duration: 0.3, repeat: Infinity }}
        >
          {/* Egg shadow */}
          <ellipse
            cx="100"
            cy="150"
            rx="35"
            ry="10"
            fill="rgba(0,0,0,0.2)"
          />

          {/* Main egg */}
          <motion.ellipse
            cx="100"
            cy="110"
            rx="40"
            ry="55"
            fill="url(#eggGradient)"
            animate={{ 
              scale: stage === 4 ? [1, 0] : 1,
            }}
            transition={{ duration: 0.5 }}
          />

          {/* Cracks based on progress */}
          {stage >= 1 && (
            <motion.path
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              d="M 85 80 L 90 95 L 82 110 L 88 125"
              stroke="#654321"
              strokeWidth="2"
              fill="none"
            />
          )}
          {stage >= 2 && (
            <motion.path
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              d="M 115 75 L 108 90 L 118 105 L 110 120"
              stroke="#654321"
              strokeWidth="2"
              fill="none"
            />
          )}
          {stage >= 3 && (
            <motion.path
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              d="M 70 100 L 80 95 L 75 110 L 85 115"
              stroke="#654321"
              strokeWidth="2"
              fill="none"
            />
          )}
        </motion.g>

        {/* Hatched creature (appears at 100%) */}
        {stage === 4 && (
          <motion.g
            initial={{ scale: 0, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.5, type: 'spring' }}
          >
            {/* Body */}
            <ellipse cx="100" cy="110" rx="30" ry="35" fill="#FFD700" />
            {/* Head */}
            <circle cx="100" cy="70" r="25" fill="#FFD700" />
            {/* Eyes */}
            <circle cx="92" cy="65" r="6" fill="white" />
            <circle cx="108" cy="65" r="6" fill="white" />
            <circle cx="93" cy="66" r="3" fill="black" />
            <circle cx="109" cy="66" r="3" fill="black" />
            {/* Beak */}
            <path d="M 95 75 L 100 85 L 105 75 Z" fill="#FF8C00" />
            {/* Wings */}
            <motion.ellipse
              cx="70"
              cy="100"
              rx="12"
              ry="20"
              fill="#FFA500"
              animate={{ rotate: [-10, 10, -10] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
            <motion.ellipse
              cx="130"
              cy="100"
              rx="12"
              ry="20"
              fill="#FFA500"
              animate={{ rotate: [10, -10, 10] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
          </motion.g>
        )}

        {/* Gradient definitions */}
        <defs>
          <linearGradient id="eggGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFF8E7" />
            <stop offset="50%" stopColor="#F5E6D3" />
            <stop offset="100%" stopColor="#E8D4C4" />
          </linearGradient>
        </defs>
      </svg>

      {/* Progress text */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
        <p className="text-2xl font-bold text-white">{Math.round(progress)}%</p>
        <p className="text-xs text-gray-400">
          {stage === 4 ? '🎉 Hatched!' : stage === 3 ? 'Almost there!' : stage === 2 ? 'Cracking...' : stage === 1 ? 'Starting to crack' : 'Incubating...'}
        </p>
      </div>
    </div>
  );
}

interface IceMeltingProps {
  progress: number; // 0-100
  size?: number;
}

export function IceMelting({ progress, size = 200 }: IceMeltingProps) {
  const meltLevel = (progress / 100) * 80; // Max melt is 80% of height

  return (
    <div 
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Background glow */}
      <motion.div
        animate={{ 
          scale: [1, 1.05, 1],
          opacity: [0.2, 0.4, 0.2]
        }}
        transition={{ duration: 3, repeat: Infinity }}
        className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 blur-xl"
      />

      <svg viewBox="0 0 200 200" className="w-full h-full">
        {/* Water puddle (grows with progress) */}
        <motion.ellipse
          cx="100"
          cy="175"
          rx={30 + progress * 0.4}
          ry={8 + progress * 0.1}
          fill="url(#waterGradient)"
          initial={{ opacity: 0 }}
          animate={{ opacity: progress > 10 ? 0.8 : 0 }}
        />

        {/* Ice cube group */}
        <motion.g
          animate={{ y: meltLevel * 0.2 }}
          transition={{ duration: 0.5 }}
        >
          {/* Ice cube - main body */}
          <motion.path
            d={`
              M 60 ${50 + meltLevel * 0.3}
              L 50 ${100 + meltLevel * 0.5}
              L 60 ${150 - meltLevel * 0.4}
              L 140 ${150 - meltLevel * 0.4}
              L 150 ${100 + meltLevel * 0.5}
              L 140 ${50 + meltLevel * 0.3}
              Z
            `}
            fill="url(#iceGradient)"
            opacity={1 - progress * 0.005}
            style={{ filter: 'drop-shadow(0 5px 15px rgba(0,200,255,0.3))' }}
          />

          {/* Ice cube - top face */}
          <motion.path
            d={`
              M 60 ${50 + meltLevel * 0.3}
              L 100 ${30 + meltLevel * 0.2}
              L 140 ${50 + meltLevel * 0.3}
              L 100 ${40 + meltLevel * 0.25}
              Z
            `}
            fill="url(#iceTopGradient)"
            opacity={1 - progress * 0.008}
          />

          {/* Shine effects */}
          <motion.rect
            x="75"
            y={60 + meltLevel * 0.3}
            width="8"
            height={30 - meltLevel * 0.2}
            fill="rgba(255,255,255,0.4)"
            rx="4"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.rect
            x="90"
            y={70 + meltLevel * 0.35}
            width="5"
            height={20 - meltLevel * 0.15}
            fill="rgba(255,255,255,0.3)"
            rx="2.5"
            animate={{ opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 2.5, repeat: Infinity }}
          />

          {/* Water drops falling */}
          {progress > 20 && (
            <>
              <motion.circle
                cx="80"
                r="3"
                fill="#4FC3F7"
                animate={{ 
                  cy: [150 - meltLevel * 0.4, 175],
                  opacity: [1, 0]
                }}
                transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.5 }}
              />
              <motion.circle
                cx="120"
                r="2"
                fill="#4FC3F7"
                animate={{ 
                  cy: [150 - meltLevel * 0.4, 175],
                  opacity: [1, 0]
                }}
                transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 0.8 }}
              />
            </>
          )}
        </motion.g>

        {/* Sun (appears as progress increases) */}
        <motion.g
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ 
            opacity: progress > 30 ? 0.8 : 0,
            scale: progress > 30 ? 1 : 0.5
          }}
        >
          <motion.circle
            cx="160"
            cy="35"
            r="20"
            fill="#FFD700"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          {/* Sun rays */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
            <motion.line
              key={i}
              x1={160 + Math.cos(angle * Math.PI / 180) * 25}
              y1={35 + Math.sin(angle * Math.PI / 180) * 25}
              x2={160 + Math.cos(angle * Math.PI / 180) * 35}
              y2={35 + Math.sin(angle * Math.PI / 180) * 35}
              stroke="#FFD700"
              strokeWidth="2"
              strokeLinecap="round"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
            />
          ))}
        </motion.g>

        {/* Gradients */}
        <defs>
          <linearGradient id="iceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E0F7FA" />
            <stop offset="50%" stopColor="#80DEEA" />
            <stop offset="100%" stopColor="#4DD0E1" />
          </linearGradient>
          <linearGradient id="iceTopGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#B2EBF2" />
            <stop offset="100%" stopColor="#80DEEA" />
          </linearGradient>
          <linearGradient id="waterGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4FC3F7" />
            <stop offset="100%" stopColor="#0288D1" />
          </linearGradient>
        </defs>
      </svg>

      {/* Progress text */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
        <p className="text-2xl font-bold text-white">{Math.round(progress)}%</p>
        <p className="text-xs text-gray-400">
          {progress >= 100 ? '💧 Fully melted!' : progress >= 75 ? 'Almost melted!' : progress >= 50 ? 'Melting fast...' : progress >= 25 ? 'Starting to melt' : 'Frozen solid'}
        </p>
      </div>
    </div>
  );
}
