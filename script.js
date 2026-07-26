// =================================================================
// CONFIGURAÇÃO: URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Elementos DOM
const video = document.getElementById('webcam');
const modoLeituraEl = document.getElementById('modo-leitura');
const contadorDigitosEl = document.getElementById('contador-digitos');
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

// Inicia a câmera
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
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    tessedit_pageseg_mode: '11', 
  });

  ocrAtivo = true;
  loopLeituraOCR();
}

// Borda verde desenhada na tela sobre o número lido
function renderizarHUDLoop() {
  const ctx = canvasOverlay.getContext('2d');
  canvasOverlay.width = video.clientWidth;
  canvasOverlay.height = video.clientHeight;

  ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

  if (video.videoWidth > 0 && elementosHUDAtivos.length > 0) {
    const scaleX = canvasOverlay.width / video.videoWidth;
    const scaleY = canvasOverlay.height / video.videoHeight;

    elementosHUDAtivos.forEach(item => {
      const { bbox } = item;
      if (!bbox) return;

      const x = bbox.x0 * scaleX;
      const y = bbox.y0 * scaleY;
      const w = (bbox.x1 - bbox.x0) * scaleX;
      const h = (bbox.y1 - bbox.y0) * scaleY;

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#00e676';
      ctx.fillStyle = 'rgba(0, 230, 118, 0.15)';
      ctx.strokeRect(x, y, w, h);
      ctx.fillRect(x, y, w, h);
    });
  }

  requestAnimationFrame(renderizarHUDLoop);
}

// Processamento OCR
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

      // 1. Leitura por Código de Barras
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
                }
              });

              elementosHUDAtivos = novosElementos;
              if (modoLeituraEl) modoLeituraEl.innerText = "LIDO!";

              await enviarParaAppsScript(huEncontrada);
              return;
            }
          }
        } catch (eBarra) {}
      }

      // 2. Leitura OCR por Texto (SSCC)
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

        novosElementos.push({ bbox: matchSSCC.bbox });
        elementosHUDAtivos = novosElementos;

        if (modoLeituraEl) modoLeituraEl.innerText = "LIDO!";

        await enviarParaAppsScript(huEncontrada);
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

// 🟢 CONEXÃO GARANTIDA COM O GOOGLE APPS SCRIPT
async function enviarParaAppsScript(huCompleta) {
  const timerSeguranca = setTimeout(() => {
    if (processandoHU) resetarVisor();
  }, 4000);

  try {
    // Usando URLSearchParams + no-cors para contornar qualquer bloqueio da planilha
    const dados = new URLSearchParams();
    dados.append('hu', huCompleta);

    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: dados
    });

    clearTimeout(timerSeguranca);
    tocarBip();
    setTimeout(resetarVisor, 1200);
  } catch (e) {
    console.error("Erro no envio:", e);
    clearTimeout(timerSeguranca);
    setTimeout(resetarVisor, 1200);
  }
}

function resetarVisor() {
  elementosHUDAtivos = [];
  if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";

  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}
