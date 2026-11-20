let readerLibrary;

function loadReader() {
  readerLibrary ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./zxing-browser.js", import.meta.url).href;
    script.onload = () => {
      const Reader = globalThis.ZXingBrowser?.BrowserMultiFormatReader;
      if (Reader) resolve(Reader);
      else reject(new Error("Barkod okuyucu yüklenemedi."));
    };
    script.onerror = () => reject(new Error("Barkod okuyucu yüklenemedi."));
    document.head.append(script);
  }).catch(error => {
    readerLibrary = undefined;
    throw error;
  });
  return readerLibrary;
}

export async function scanBarcode(video, signal, onReady) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Kamera için HTTPS veya bu cihazda localhost kullan. Barkodu elle de girebilirsin.");
  }
  const Reader = await loadReader();
  signal.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
  });
  const stop = () => {
    stream.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    video.srcObject = stream;
    await video.play();
    signal.throwIfAborted();
    const decoder = new Reader();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Kamera görüntüsü işlenemedi. Barkodu elle girebilirsin.");
    onReady();

    return await new Promise((resolve, reject) => {
      let timer;
      const track = stream.getVideoTracks()[0];
      const finish = (error, result) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        track.removeEventListener("ended", interrupted);
        if (error) reject(error);
        else resolve(result);
      };
      const cancel = () => finish(signal.reason);
      const interrupted = () => finish(new Error("Kamera kapandı. Tekrar açabilir veya barkodu elle girebilirsin."));
      const readFrame = () => {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
          const width = Math.round(video.videoWidth * scale);
          const height = Math.round(video.videoHeight * scale);
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          try {
            context.drawImage(video, 0, 0, width, height);
          } catch {
            finish(new Error("Kamera görüntüsü alınamadı. Barkodu elle girebilirsin."));
            return;
          }
          let value;
          try {
            value = decoder.decodeFromCanvas(canvas).getText();
          } catch {
            // Most frames do not contain a readable barcode.
          }
          if (value) {
            finish(null, value);
            return;
          }
        }
        timer = setTimeout(readFrame, 150);
      };
      signal.addEventListener("abort", cancel, { once: true });
      track.addEventListener("ended", interrupted, { once: true });
      readFrame();
    });
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
