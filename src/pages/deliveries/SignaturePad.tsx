import { useEffect, useRef, type PointerEvent } from "react";
import { useT } from "../../i18n";
import { Button } from "../../components/ui";

/**
 * Finger / mouse signature on a canvas. Reports a PNG data URL after each
 * stroke (null once cleared). Drawn in ink on white so the stored image reads
 * the same in either theme.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        dir="ltr"
        className="h-36 w-full touch-none rounded-lg border border-line"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d");
          const p = point(e);
          drawing.current = true;
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
          ctx?.lineTo(p.x + 0.1, p.y + 0.1);
          ctx?.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d");
          const p = point(e);
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
          dirty.current = true;
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          dirty.current = true;
          onChange(e.currentTarget.toDataURL("image/png"));
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-3">{t("deliveries.signatureHint")}</span>
        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={clear}>
          {t("deliveries.signatureClear")}
        </Button>
      </div>
    </div>
  );
}
