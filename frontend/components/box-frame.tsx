'use client';

import { useRef } from 'react';
import { moveBox, resizeBox, type Box, type Handle } from '@/lib/split-boxes';

interface BoxFrameProps {
  imageUrl: string;
  alt: string;
  box: Box;
  onChange: (box: Box) => void;
  label: string;
}

interface Drag {
  mode: 'move' | Handle;
  startX: number;
  startY: number;
  start: Box;
}

const HANDLES: { handle: Handle; className: string }[] = [
  { handle: 'nw', className: '-left-2 -top-2 cursor-nwse-resize' },
  { handle: 'ne', className: '-right-2 -top-2 cursor-nesw-resize' },
  { handle: 'sw', className: '-bottom-2 -left-2 cursor-nesw-resize' },
  { handle: 'se', className: '-bottom-2 -right-2 cursor-nwse-resize' },
];

/** A photo with one box on it that can be moved and resized by pointer (so touch works). */
export function BoxFrame({ imageUrl, alt, box, onChange, label }: BoxFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const begin = (event: React.PointerEvent, mode: Drag['mode']) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: box };
  };

  const update = (event: React.PointerEvent) => {
    const active = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!active || !rect || rect.width === 0 || rect.height === 0) return;
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    onChange(
      active.mode === 'move'
        ? moveBox(active.start, dx, dy)
        : resizeBox(active.start, active.mode, dx, dy),
    );
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div ref={frame} className="relative inline-block max-w-full touch-none select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        draggable={false}
        className="block max-h-[50vh] w-auto max-w-full"
      />
      {/* everything outside the box is dimmed, so it is clear what will be sent */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute"
          style={{
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          }}
        />
      </div>
      <div
        role="group"
        aria-label={label}
        data-testid="crop-box"
        className="absolute cursor-move border-2 border-primary"
        style={{
          left: `${box.left * 100}%`,
          top: `${box.top * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
          touchAction: 'none',
        }}
        onPointerDown={(e) => begin(e, 'move')}
        onPointerMove={update}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {HANDLES.map(({ handle, className }) => (
          <span
            key={handle}
            aria-hidden="true"
            data-handle={handle}
            className={`absolute h-4 w-4 rounded-full border-2 border-primary bg-background ${className}`}
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => begin(e, handle)}
            onPointerMove={update}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
    </div>
  );
}
