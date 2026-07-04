import { useEffect, useRef, type CSSProperties } from 'react';
import type { PreviewData } from '../../ipc.ts';
import { base64ToBytes } from '../api/client.ts';

/**
 * Draws an embedded map preview (raw RGB bytes from the main process) onto a
 * canvas via putImageData — spec §4 step 2 of the imagery chain.
 */
export function PreviewCanvas({ data, style }: { data: PreviewData; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const rgb = base64ToBytes(data.rgbBase64);
    const pixels = data.width * data.height;
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      rgba[i * 4] = rgb[i * 3] ?? 0;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    ctx.putImageData(new ImageData(rgba, data.width, data.height), 0, 0);
  }, [data]);

  return (
    <canvas
      ref={ref}
      width={data.width}
      height={data.height}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}
