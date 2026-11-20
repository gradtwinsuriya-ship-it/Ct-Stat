import React, { useCallback, useRef, useState } from 'react';
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  type HTMLMotionProps,
} from 'motion/react';
import { playTactileSound } from '../../utils/hapticSound';
import { prefersReducedMotion } from '../../utils/webglDetect';

interface RippleBurst {
  id: number;
  x: number;
  y: number;
}

const SPRING_BUTTON = { type: 'spring' as const, stiffness: 460, damping: 24, mass: 0.7 };
const SPRING_CARD = { type: 'spring' as const, stiffness: 360, damping: 24, mass: 0.85 };

interface TactileButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'
  > {
  variant?: 'primary' | 'secondary' | 'active' | 'ghost';
  soundVariant?: 'click' | 'confirm' | 'alert';
  magnetic?: boolean;
}

export const TactileButton: React.FC<TactileButtonProps> = ({
  variant = 'secondary',
  soundVariant = 'click',
  magnetic = true,
  className = '',
  onClick,
  children,
  disabled,
  type = 'button',
  ...rest
}) => {
  const reduced = prefersReducedMotion();
  const [ripples, setRipples] = useState<RippleBurst[]>([]);
  const nextId = useRef(0);

  const rawRx = useMotionValue(0);
  const rawRy = useMotionValue(0);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const rx = useSpring(rawRx, SPRING_BUTTON);
  const ry = useSpring(rawRy, SPRING_BUTTON);
  const mx = useSpring(rawX, SPRING_BUTTON);
  const my = useSpring(rawY, SPRING_BUTTON);

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!magnetic || disabled || reduced || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = (e.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    rawX.set(nx * 5);
    rawY.set(ny * 4);
    rawRx.set(-ny * 14);
    rawRy.set(nx * 14);
  };

  const handlePointerLeave = () => {
    rawX.set(0);
    rawY.set(0);
    rawRx.set(0);
    rawRy.set(0);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
    const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
    const id = ++nextId.current;
    setRipples((prev) => [...prev.slice(-3), { id, x, y }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 520);

    playTactileSound(soundVariant);
    onClick?.(e);
  };

  const variantClasses =
    variant === 'primary'
      ? 'btn-3d btn-3d-primary'
      : variant === 'active'
      ? 'btn-3d btn-3d-active'
      : variant === 'ghost'
      ? 'btn-3d text-[#565278] hover:text-[#1E1B3A] hover:bg-[#EDE9FE]/85 border border-transparent hover:border-[#DDD6FE]'
      : 'btn-3d btn-3d-secondary';

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      whileHover={
        disabled || reduced
          ? undefined
          : {
              scale: 1.055,
              y: -2.5,
              z: 18,
              transition: SPRING_BUTTON,
            }
      }
      whileTap={
        disabled || reduced
          ? undefined
          : {
              scale: 0.96,
              y: 2,
              z: -6,
              transition: { type: 'spring', stiffness: 600, damping: 28 },
            }
      }
      style={
        reduced
          ? undefined
          : {
              transformPerspective: 700,
              transformStyle: 'preserve-3d',
              rotateX: rx,
              rotateY: ry,
              x: mx,
              y: my,
            }
      }
      className={`${variantClasses} hover:z-20 ${className}`}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          style={{ left: r.x, top: r.y }}
          className={`pointer-events-none absolute w-16 h-16 rounded-full animate-hemastat-ripple ${
            variant === 'primary' ? 'bg-white/65' : 'bg-violet-400/40'
          }`}
        />
      ))}
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5 w-full">
        {children}
      </span>
    </motion.button>
  );
};

interface PopOutButton3DProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'
  > {
  selected?: boolean;
  glowColor?: string;
  soundVariant?: 'click' | 'confirm' | 'alert';
}

/**
 * Rich Framer Motion 3D pop-out button for multi-line sidebar list items and command triggers.
 * Physically tilts toward cursor, lifts along Z-depth, and scales smoothly on mouse hover.
 */
export const PopOutButton3D: React.FC<PopOutButton3DProps> = ({
  selected = false,
  glowColor = 'rgba(139, 124, 246, 0.28)',
  soundVariant = 'click',
  className = '',
  onClick,
  children,
  disabled,
  type = 'button',
  ...rest
}) => {
  const reduced = prefersReducedMotion();
  const [hovering, setHovering] = useState(false);

  const rawRx = useMotionValue(0);
  const rawRy = useMotionValue(0);
  const rawSx = useMotionValue(50);
  const rawSy = useMotionValue(50);

  const rx = useSpring(rawRx, SPRING_CARD);
  const ry = useSpring(rawRy, SPRING_CARD);
  const sx = useSpring(rawSx, { stiffness: 260, damping: 26 });
  const sy = useSpring(rawSy, { stiffness: 260, damping: 26 });

  const sheenBg = useMotionTemplate`radial-gradient(circle 200px at ${sx}% ${sy}%, ${glowColor}, transparent 72%)`;

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || reduced || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    rawRy.set((px - 0.5) * 18);
    rawRx.set(-(py - 0.5) * 14);
    rawSx.set(px * 100);
    rawSy.set(py * 100);
    if (!hovering) setHovering(true);
  };

  const handlePointerLeave = () => {
    rawRx.set(0);
    rawRy.set(0);
    setHovering(false);
  };

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={(e) => {
        if (disabled) return;
        playTactileSound(soundVariant);
        onClick?.(e);
      }}
      whileHover={
        disabled || reduced
          ? undefined
          : {
              scale: 1.036,
              y: -3,
              z: 24,
              transition: SPRING_CARD,
            }
      }
      whileTap={
        disabled || reduced
          ? undefined
          : {
              scale: 0.975,
              y: 1.5,
              z: -6,
              transition: { type: 'spring', stiffness: 580, damping: 26 },
            }
      }
      style={
        reduced
          ? undefined
          : {
              transformPerspective: 900,
              transformStyle: 'preserve-3d',
              rotateX: rx,
              rotateY: ry,
            }
      }
      className={`relative overflow-hidden transition-[border-color,box-shadow,background] duration-150 hover:z-30 ${
        selected ? 'z-10' : ''
      } ${className}`}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      <motion.div
        aria-hidden="true"
        style={{ background: sheenBg, opacity: hovering ? 1 : 0 }}
        className="pointer-events-none absolute inset-0 rounded-lg z-0 transition-opacity duration-150"
      />
      <div className="relative z-10 flex items-center gap-3 w-full">{children}</div>
    </motion.button>
  );
};

interface TiltCard3DProps {
  children: React.ReactNode;
  className?: string;
  maxTiltDeg?: number;
  popScale?: number;
  glowColor?: string;
  active?: boolean;
  onClick?: () => void;
}

export const TiltCard3D: React.FC<TiltCard3DProps> = ({
  children,
  className = '',
  maxTiltDeg = 9,
  popScale = 1.034,
  glowColor = 'rgba(167, 139, 250, 0.3)',
  active = false,
  onClick,
}) => {
  const reduced = prefersReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextRippleId = useRef(0);
  const [cardRipples, setCardRipples] = useState<RippleBurst[]>([]);
  const [hovering, setHovering] = useState(false);

  const rawRx = useMotionValue(0);
  const rawRy = useMotionValue(0);
  const rawSx = useMotionValue(50);
  const rawSy = useMotionValue(50);

  const rx = useSpring(rawRx, SPRING_CARD);
  const ry = useSpring(rawRy, SPRING_CARD);
  const sx = useSpring(rawSx, { stiffness: 260, damping: 26 });
  const sy = useSpring(rawSy, { stiffness: 260, damping: 26 });

  const spotlightBg = useMotionTemplate`radial-gradient(circle 250px at ${sx}% ${sy}%, ${glowColor}, transparent 72%)`;

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduced || e.pointerType === 'touch') return;
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const py = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      rawRy.set((px - 0.5) * 2 * maxTiltDeg);
      rawRx.set(-(py - 0.5) * 2 * maxTiltDeg);
      rawSx.set(px * 100);
      rawSy.set(py * 100);
      if (!hovering) setHovering(true);
    },
    [hovering, maxTiltDeg, rawRx, rawRy, rawSx, rawSy, reduced]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const id = ++nextRippleId.current;
      setCardRipples((prev) => [
        ...prev.slice(-2),
        { id, x: e.clientX - rect.left, y: e.clientY - rect.top },
      ]);
      window.setTimeout(() => {
        setCardRipples((prev) => prev.filter((r) => r.id !== id));
      }, 540);
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    rawRx.set(0);
    rawRy.set(0);
    setHovering(false);
  }, [rawRx, rawRy]);

  return (
    <motion.div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onClick={() => {
        if (onClick) {
          playTactileSound('click');
          onClick();
        }
      }}
      whileHover={
        reduced
          ? undefined
          : {
              scale: popScale,
              y: -4,
              z: 26,
              transition: SPRING_CARD,
            }
      }
      whileTap={
        onClick && !reduced
          ? {
              scale: 0.98,
              y: 1.5,
              z: -8,
              transition: { type: 'spring', stiffness: 580, damping: 26 },
            }
          : undefined
      }
      style={
        reduced
          ? undefined
          : {
              transformPerspective: 1050,
              transformStyle: 'preserve-3d',
              rotateX: rx,
              rotateY: ry,
            }
      }
      className={`relative surface-3d rounded-xl border overflow-hidden transition-[border-color,box-shadow] duration-150 hover:z-30 ${
        active
          ? 'border-[#8B7CF6] shadow-[0_22px_42px_-12px_rgba(124,111,246,0.38)]'
          : 'border-[#E3DCF5] hover:border-[#A78BFA] hover:shadow-[0_26px_46px_-14px_rgba(91,75,138,0.34)]'
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Tactile Touch-Ripple Wave on Card Surface */}
      {cardRipples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          style={{ left: r.x, top: r.y }}
          className="pointer-events-none absolute w-28 h-28 rounded-full bg-violet-300/35 animate-hemastat-ripple z-20"
        />
      ))}

      {/* Luminous Cursor Spotlight */}
      <motion.div
        aria-hidden="true"
        style={{
          opacity: hovering ? 1 : 0,
          background: spotlightBg,
        }}
        className="pointer-events-none absolute inset-0 rounded-xl z-0 transition-opacity duration-150"
      />
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  );
};
