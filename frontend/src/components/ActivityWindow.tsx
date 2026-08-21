import { useEffect, useRef, useState } from "react";

import { CloseButton } from "./CloseButton";

export type ActivityEvent = {
  id: string;
  timestamp: string;
  phase: "validation" | "cache" | "acquisition" | "publication" | "error";
  message: string;
};

const EDGE_GUTTER = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;

export function ActivityWindow({
  events,
  onClose,
}: {
  events: ActivityEvent[];
  onClose: () => void;
}) {
  const [position, setPosition] = useState({ right: 72, bottom: 46 });
  const [size, setSize] = useState({ width: 360, height: 300 });
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);
  const resize = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  } | null>(null);
  useEffect(() => {
    function move(event: PointerEvent) {
      if (drag.current) {
        const deltaX = event.clientX - drag.current.x;
        const deltaY = event.clientY - drag.current.y;
        const maxRight = Math.max(EDGE_GUTTER, window.innerWidth - size.width - EDGE_GUTTER);
        const maxBottom = Math.max(EDGE_GUTTER, window.innerHeight - size.height - EDGE_GUTTER);
        setPosition({
          right: clamp(drag.current.right - deltaX, EDGE_GUTTER, maxRight),
          bottom: clamp(drag.current.bottom - deltaY, EDGE_GUTTER, maxBottom),
        });
      }
      if (resize.current) {
        const deltaX = event.clientX - resize.current.x;
        const deltaY = event.clientY - resize.current.y;
        setSize({
          width: clamp(
            resize.current.width + deltaX,
            MIN_WIDTH,
            Math.max(MIN_WIDTH, window.innerWidth - resize.current.right - EDGE_GUTTER),
          ),
          height: clamp(
            resize.current.height + deltaY,
            MIN_HEIGHT,
            Math.max(MIN_HEIGHT, window.innerHeight - resize.current.bottom - EDGE_GUTTER),
          ),
        });
      }
    }
    function end() {
      drag.current = null;
      resize.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [size]);
  return (
    <aside
      className="activityWindow"
      style={{ ...position, ...size }}
      aria-label="AOI preparation activity"
    >
      <div
        className="activityTitlebar"
        onPointerDown={(event) => {
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            right: position.right,
            bottom: position.bottom,
          };
        }}
      >
        <strong>Activity</strong>
        <CloseButton
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          ariaLabel="Close activity window"
          title="Close activity window"
        />
      </div>
      {events.length ? (
        <ol className="activityEvents">
          {events.map((event) => (
            <li key={event.id}>
              <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
              <strong>{event.phase}</strong>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No AOI request has run in this session.</p>
      )}
      <button
        type="button"
        className="activityResizeHandle"
        aria-label="Resize activity window"
        title="Drag to resize activity window"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resize.current = {
            x: event.clientX,
            y: event.clientY,
            width: size.width,
            height: size.height,
            right: position.right,
            bottom: position.bottom,
          };
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 20 : 10;
          if (event.key === "ArrowRight") {
            setSize((current) => ({
              ...current,
              width: clamp(
                current.width + step,
                MIN_WIDTH,
                Math.max(MIN_WIDTH, window.innerWidth - position.right - EDGE_GUTTER),
              ),
            }));
          } else if (event.key === "ArrowLeft") {
            setSize((current) => ({
              ...current,
              width: Math.max(MIN_WIDTH, current.width - step),
            }));
          } else if (event.key === "ArrowDown") {
            setSize((current) => ({
              ...current,
              height: clamp(
                current.height + step,
                MIN_HEIGHT,
                Math.max(MIN_HEIGHT, window.innerHeight - position.bottom - EDGE_GUTTER),
              ),
            }));
          } else if (event.key === "ArrowUp") {
            setSize((current) => ({
              ...current,
              height: Math.max(MIN_HEIGHT, current.height - step),
            }));
          } else {
            return;
          }
          event.preventDefault();
        }}
      />
    </aside>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
