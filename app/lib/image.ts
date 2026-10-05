export interface PreparedImage {
  canvas: HTMLCanvasElement;
  previewUrl: string;
}

/** Decodes the picked file once, capped in size: phone photos are often 12+ MP, which only slows OCR down. */
export async function prepareImage(file: Blob, maxDim = 2200): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  // White background so transparent screenshots don't read as black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { canvas, previewUrl: canvas.toDataURL("image/jpeg", 0.85) };
}
