const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

const video = document.getElementById('webcam');
const modoLeituraEl = document.getElementById('modo-leitura');
const contadorDigitosEl = document.getElementById('contador-digitos');
const containerListaHus = document.getElementById('container-lista-hus');
const logTerminalEl = document.getElementById('log-terminal');
const logMensagensEl = document.getElementById('log-mensagens');
const canvas = document.getElementById('canvas-processamento');

let audioCtx = null;

function inicializarAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function tocarBipInstantaneo() {
  try {
    inicializarAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1800, audioCtx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch(e) {}
}

document.body.addEventListener('touchstart', inicializarAudio, { once: true });
document.body.addEventListener('click', inicializarAudio, { once: true });

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

function logTerminal(mensagem, tipo = 'info') {
  if (!logMensagensEl) return;
  if (tipo === 'error') {
    if (logTerminalEl) logTerminalEl.classList.remove('oculto');
  }
  const div = document.createElement('div');
  div.className = `log-${tipo}`;
  div.innerText = `[${new Date().toLocaleTimeString()}] ${mensagem}`;
  logMensagensEl.appendChild(div);
  logMensagensEl.scrollTop = logMensagensEl.scrollHeight;
}

function ocultarTerminalLog() {
  if (logTerminalEl) logTerminalEl.classList.add('oculto');
}

function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// 🔄 SINCRONIZAÇÃO EM TEMPO REAL
async function carregarDadosPlanilha() {
  try {
    const res = await fetch(`${SCRIPT_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    ocultarTerminalLog();

    if (contadorDigitosEl) {
      contadorDigitosEl.innerText = `${data.pendentes || 0} RESTANTES`;
    }

    if (containerListaHus) {
      if (data.lista_pendentes && data.lista_pendentes.length > 0) {
        containerListaHus.innerHTML = data.lista_pendentes
          .map(hu => {
            const ultimos5 = String(hu).slice(-5); // Exibe apenas os 5 últimos dígitos
            return `<div class="hu-chip" title="${hu}">...${ultimos5}</div>`;
          })
          .join('');
      } else {
        containerListaHus.innerHTML = `<div class="hu-chip" style="color:#00e676; border-color:#00e676;">0 PENDENTES</div>`;
      }
    }
  } catch (err) {
    logTerminal(`Falha na conexão: ${err.message}`, "error");
  }
}

navigator.mediaDevices.getUserMedia({ 
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
})
.then(stream => {
  video.srcObject = stream;
  
  carregarDadosPlanilha();
  setInterval(carregarDadosPlanilha, 4000);

  iniciarSistemaLeitura();
  requestAnimationFrame(renderizarHUDLoop);
})
.catch(err => logTerminal("Erro ao abrir Câmera: " + err.message, "error"));

async function iniciarSistemaLeitura() {
  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'data_matrix', 'qr_code'] });
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
      ctx.fillStyle = 'rgba(0, 230, 118, 0.25)';
      ctx.strokeRect(x, y, w, h);
      ctx.fillRect(x, y, w, h);
    });
  }

  requestAnimationFrame(renderizarHUDLoop);
}

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

      // Barcode
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              processandoHU = true;
              tocarBipInstantaneo();

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

              await enviarParaAppsScript(matchBarra[0]);
              return;
            }
          }
        } catch (eBarra) {}
      }

      // OCR
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
        processandoHU = true;
        tocarBipInstantaneo();

        const huEncontrada = extrairNumeros(matchSSCC.text).match(/1789\d{14}/)[0];

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

async function enviarParaAppsScript(huCompleta) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    
    await carregarDadosPlanilha();
  } catch (e) {
    logTerminal(`Erro ao enviar: ${e.message}`, 'error');
  } finally {
    setTimeout(resetarVisor, 1000);
  }
}

function resetarVisor() {
  elementosHUDAtivos = [];
  if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";
  processandoHU = false;
  ocrAtivo = true;
  setTimeout(loopLeituraOCR, 100);
}
