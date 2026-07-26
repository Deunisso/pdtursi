// =================================================================
// ⚠️ CONFIGURAÇÃO: URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Elementos DOM
const video = document.getElementById('webcam');
const spanNumsEstabilizados = document.getElementById('nums-estabilizados');
const spanNumsAtivos = document.getElementById('nums-ativos');
const contadorDigitosEl = document.getElementById('contador-digitos');
const dicaStatusEl = document.getElementById('dica-status');
const modoLeituraEl = document.getElementById('modo-leitura');
const canvas = document.getElementById('canvas-processamento');

// Controle de estado
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
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarSistemaLeitura();
});

async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Carregando visão...";

  // Inicializa o leitor nativo de código de barras
  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({ 
        formats: ['code_128', 'code_39', 'ean_13', 'data_matrix', 'qr_code'] 
      });
    } catch (e) {}
  }

  // Inicializa o Tesseract para OCR de texto
  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '11', 
  });

  dicaStatusEl.innerText = "🟢 VISOR PRONTO: Aponte para a etiqueta WMS";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// 🔍 LOOP DE PROCESSAMENTO (BARCODE + OCR)
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 80);
    return;
  }

  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {

      // 📌 1. LEITURA RÁPIDA VIA CÓDIGO DE BARRAS (Hardware native)
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              const huEncontrada = matchBarra[0];
              processarHUEncontrada(huEncontrada, "⚡ BARCODE LIDO!");
              return;
            }
          }
        } catch (eBarra) {}
      }

      // 📌 2. LEITURA VIA OCR (Texto impresso)
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, vw, vh);

      const result = await workerOCR.recognize(canvas);
      const textoCompleto = result.data.text || "";
      const numerosTexto = extrairNumeros(textoCompleto);
      const matchTexto = numerosTexto.match(/1789\d{14}/);

      if (matchTexto && !processandoHU) {
        const huEncontrada = matchTexto[0];
        processarHUEncontrada(huEncontrada, "🔒 HU TEXTO LIDA!");
        return;
      } else {
        modoLeituraEl.innerText = "PROCURANDO...";
        dicaStatusEl.innerText = "🟢 Aponte a câmera para a etiqueta WMS";
        dicaStatusEl.style.color = "#00e676";
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

function processarHUEncontrada(huEncontrada, modoTexto) {
  processandoHU = true;
  modoLeituraEl.innerText = modoTexto;
  spanNumsEstabilizados.innerText = huEncontrada;
  spanNumsAtivos.innerText = "";
  contadorDigitosEl.innerText = "18 / 18";

  verificarHU(huEncontrada);
}

async function verificarHU(huCompleta) {
  const timerSeguranca = setTimeout(() => {
    if (processandoHU) resetarVisor();
  }, 5000);

  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    await res.json();
    clearTimeout(timerSeguranca);

    tocarBip();
    setTimeout(resetarVisor, 1000);
  } catch (e) {
    clearTimeout(timerSeguranca);
    setTimeout(resetarVisor, 1000);
  }
}

function resetarVisor() {
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
  dicaStatusEl.innerText = "🟢 Aponte para a etiqueta WMS";
  dicaStatusEl.style.color = "#00e676";

  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}
