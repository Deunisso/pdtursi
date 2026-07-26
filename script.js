// =================================================================
// CONFIGURAÇÃO: URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Elementos DOM
const video = document.getElementById('webcam');
const spanNumsEstabilizados = document.getElementById('nums-estabilizados');
const spanNumsAtivos = document.getElementById('nums-ativos');
const contadorDigitosEl = document.getElementById('contador-digitos');
const modoLeituraEl = document.getElementById('modo-leitura');
const canvas = document.getElementById('canvas-processamento');

// Overlay HD
let canvasOverlay = document.getElementById('canvas-overlay');
if (!canvasOverlay) {
  canvasOverlay = document.createElement('canvas');
  canvasOverlay.id = 'canvas-overlay';
  canvasOverlay.style.position = 'absolute';
  canvasOverlay.style.top = '0';
  canvasOverlay.style.left = '0';
  canvasOverlay.style.width = '100%';
  canvasOverlay.style.height = '100%';
  canvasOverlay.style.pointerEvents = 'none';
  canvasOverlay.style.zIndex = '10';
  video.parentElement.appendChild(canvasOverlay);
}

let elementosHUDAtivos = [];
let animOffset = 0;
let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let detectorBarra = null;

function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

function tocarBip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch(e) {}
}

// Inicializa Câmera
navigator.mediaDevices.getUserMedia({ 
  video: { 
    facingMode: "environment", 
    width: { ideal: 1920 }, 
    height: { ideal: 1080 } 
  } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarSistemaLeitura();
  requestAnimationFrame(renderizarHUDLoop);
});

async function iniciarSistemaLeitura() {
  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({ 
        formats: ['code_128', 'code_39', 'ean_13', 'data_matrix', 'qr_code'] 
      });
    } catch (e) {}
  }

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '11', 
  });

  ocrAtivo = true;
  loopLeituraOCR();
}

// 🎨 ENGINE GRÁFICA HUD (60 FPS)
function renderizarHUDLoop() {
  const ctx = canvasOverlay.getContext('2d');
  canvasOverlay.width = video.clientWidth;
  canvasOverlay.height = video.clientHeight;

  ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

  animOffset += 2;
  if (animOffset > 100) animOffset = 0;

  if (video.videoWidth > 0 && elementosHUDAtivos.length > 0) {
    const scaleX = canvasOverlay.width / video.videoWidth;
    const scaleY = canvasOverlay.height / video.videoHeight;

    elementosHUDAtivos.forEach(item => {
      const { bbox, corRGB, tipo } = item;
      if (!bbox) return;

      const x = bbox.x0 * scaleX;
      const y = bbox.y0 * scaleY;
      const w = (bbox.x1 - bbox.x0) * scaleX;
      const h = (bbox.y1 - bbox.y0) * scaleY;

      // Retângulo com brilho
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${corRGB}, 0.9)`;
      ctx.strokeRect(x, y, w, h);

      if (tipo === 'TARGET') {
        const scanY = y + (h * (animOffset / 100));
        ctx.beginPath();
        ctx.moveTo(x, scanY);
        ctx.lineTo(x + w, scanY);
        ctx.strokeStyle = `rgba(${corRGB}, 1)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  requestAnimationFrame(renderizarHUDLoop);
}

// 🔍 LOOP DE PROCESSAMENTO (IA / OCR)
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 80);
    return;
  }

  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {
      const novosElementos = [];

      // BARCODE
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              const huEncontrada = matchBarra[0];
              processandoHU = true;

              novosElementos.push({
                bbox: {
                  x0: codigo.boundingBox.x,
                  y0: codigo.boundingBox.y,
                  x1: codigo.boundingBox.x + codigo.boundingBox.width,
                  y1: codigo.boundingBox.y + codigo.boundingBox.height
                },
                corRGB: "0, 230, 118",
                tipo: "TARGET"
              });

              elementosHUDAtivos = novosElementos;

              if (modoLeituraEl) modoLeituraEl.innerText = "LIDO!";
              if (spanNumsEstabilizados) spanNumsEstabilizados.innerText = huEncontrada;
              if (spanNumsAtivos) spanNumsAtivos.innerText = "";

              await verificarHU(huEncontrada);
              return;
            }
          }
        } catch (eBarra) {}
      }

      // TEXTO OCR
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, vw, vh);

      const result = await workerOCR.recognize(canvas);
      const words = result.data.words || [];

      const matchSSCC = words.find(w => {
        const numPuro = extrairNumeros(w.text);
        return numPuro.match(/1789\d{14}/);
      });

      if (matchSSCC && !processandoHU) {
        const huEncontrada = extrairNumeros(matchSSCC.text).match(/1789\d{14}/)[0];
        processandoHU = true;

        novosElementos.push({
          bbox: matchSSCC.bbox,
          corRGB: "0, 230, 118",
          tipo: "TARGET"
        });

        elementosHUDAtivos = novosElementos;

        if (modoLeituraEl) modoLeituraEl.innerText = "HU DETECTADA!";
        if (spanNumsEstabilizados) spanNumsEstabilizados.innerText = huEncontrada;
        if (spanNumsAtivos) spanNumsAtivos.innerText = "";

        await verificarHU(huEncontrada);
        return;
      } else {
        elementosHUDAtivos = novosElementos;
        if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (!processandoHU) {
      setTimeout(loopLeituraOCR, 90);
    }
  }
}

// CONEXÃO COM GOOGLE APPS SCRIPT
async function verificarHU(huCompleta) {
  const timerSeguranca = setTimeout(() => {
    if (processandoHU) resetarVisor();
  }, 5000);

  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ hu: huCompleta })
    });

    clearTimeout(timerSeguranca);
    tocarBip();
    setTimeout(resetarVisor, 1000);
  } catch (e) {
    clearTimeout(timerSeguranca);
    setTimeout(resetarVisor, 1000);
  }
}

function resetarVisor() {
  elementosHUDAtivos = [];
  if (spanNumsEstabilizados) spanNumsEstabilizados.innerText = "";
  if (spanNumsAtivos) spanNumsAtivos.innerText = ""; // Limpo sem os ????
  if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";

  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}
