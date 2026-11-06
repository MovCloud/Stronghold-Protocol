// ui/dragScroll.js — mouse drag scrolls a sideways container (a desktop has no swipe): past a few pixels the press
// becomes a drag and the click that ends it is swallowed, so a card is not picked by letting go. Touch and pen keep the
// browser's own scrolling. Spread the handlers onto the container (`...${dragScroll}`); the container must scroll
// sideways (`overflow-x: auto`) and render `.is-dragging` as a grabbing cursor.
import { useRef } from '../../vendor/hooks.module.js';

/**
 * Pointer handlers for a horizontally scrollable container.
 * @param {{skip?: string}} [opts] `skip` is the selector whose elements never start a drag (controls keep their own
 *   press behaviour).
 */
export function useDragScroll({ skip = 'select, input, textarea' } = {}) {
  const drag = useRef(null), swallow = useRef(false);
  const end = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    e.currentTarget.classList.remove('is-dragging');
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 0);
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target?.closest?.(skip)) return;
      drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(dx) < 6) return;
        d.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.classList.add('is-dragging');
      }
      e.currentTarget.scrollLeft = d.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e) => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
  };
}
