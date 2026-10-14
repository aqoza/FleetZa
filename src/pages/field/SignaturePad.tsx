import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Eraser } from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";

/**
 * Signatures are ink on paper in either theme: the stored PNG is dark strokes
 * on a transparent background, so the pad and every place that shows a
 * signature sit on this fixed white (the same reasoning as the certificate's
 * document ink in docs/DESIGN_SYSTEM.md).
 */
export const SIGNATURE_PAPER = "#ffffff";
const INK = "#0f172a";
const HEIGHT = 160;

/** A signature image on its paper background. */
export function SignatureImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="inline-block rounded-lg border border-line p-2" style={{ background: SIGNATURE_PAPER }}>
      <img src={src} alt={alt} className="h-24 w-auto max-w-full" />
    </div>
  );
}

/**
 * Finger / stylus / mouse signature capture. Calls `onChange` with a PNG data
 * URL after each stroke, or null when cleared.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the element (capped at 2x so the PNG stays small).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(HEIGHT * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(e.currentTarget.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-line" style={{ background: SIGNATURE_PAPER }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("field.signatureLabel")}
          className="block w-full touch-none cursor-crosshair"
          style={{ height: HEIGHT }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs" style={{ color: "#64748b" }}>
            {t("field.signHere")}
          </span>
        )}
      </div>
      <div className="mt-1 flex justify-end">
        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={clear} disabled={empty}>
          <Eraser className="h-3.5 w-3.5" /> {t("field.clearSignature")}
        </Button>
      </div>
    </div>
  );
}
