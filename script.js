// =================================================================
// ⚠️ ATENÇÃO: Cole a URL da Nova Implantação do seu Apps Script aqui
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Elementos DOM
const video = document.getElementById('webcam');
const modoLeituraEl = document.getElementById('modo-leitura');
const contadorDigitosEl = document.getElementById('contador-digitos');
const containerListaHus = document.getElementById('container-lista-hus');
const logMensagensEl = document.getElementById('log-mensagens');
const canvas = document.getElementById('canvas-processamento');

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

// Terminal de logs central
function logTerminal(mensagem, tipo = 'info') {
  if (!logMensagensEl) return;
  const div = document.createElement('div');
  div.className = `log-${tipo}`;
  div.innerText = `[${new Date().toLocaleTimeString()}] ${mensagem}`;
  logMensagensEl.appendChild(div);
  logMensagensEl.scrollTop = logMensagensEl.scrollHeight;
}

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

// 🔄 BUSCA HUS PENDENTES DA PLANILHA NO INÍCIO
async function carregarDadosPlanilha() {
  logTerminal("Conectando à planilha...", "warn");
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    
    logTerminal(`Conectado! ${data.pendentes} HUs pendentes.`, "info");
    
    if (contadorDigitosEl) {
      contadorDigitosEl.innerText = `${data.pendentes} RESTANTES`;
    }

    if (containerListaHus) {
      if (data.lista_pendentes && data.lista_pendentes.length > 0) {
        containerListaHus.innerHTML = data.lista_pendentes
          .map(hu => `<div class="hu-chip" id="chip-${hu}">${hu}</div>`)
          .join('');
      } else {
        containerListaHus.innerHTML = `<div class="hu-chip" style="color:#00e676;">TODAS LIDAS!</div>`;
      }
    }
  } catch (err) {
    logTerminal(`Erro ao ler planilha: ${err.message}`, "error");
  }
}

// Inicializa a câmera e carrega dados
navigator.mediaDevices.getUserMedia({ 
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
})
.then(stream => {
  video.srcObject = stream;
  carregarDadosPlanilha();
  iniciarSistemaLeitura();
  requestAnimationFrame(renderizarHUDLoop);
})
.catch(err => logTerminal("Erro na Câmera: " + err.message, "error"));

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
      ctx.fillStyle = 'rgba(0, 230, 118, 0.2)';
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

      // 1. BARCODE
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

      // 2. OCR
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

// 📤 ENVIO E ATUALIZAÇÃO DA PLANILHA
async function enviarParaAppsScript(huCompleta) {
  logTerminal(`Enviando HU: ${huCompleta}...`, 'warn');

  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    
    const resposta = await res.json();

    if (resposta.status === 'sucesso') {
      logTerminal(`✅ HU ${huCompleta} salva na planilha!`, 'info');
      tocarBip();
      carregarDadosPlanilha(); // Atualiza lista e contador automaticamente
    } else if (resposta.status === 'ja_lido') {
      logTerminal(`⚠️ HU ${huCompleta} já havia sido lida.`, 'warn');
      tocarBip();
    } else if (resposta.status === 'nao_encontrado') {
      logTerminal(`❌ HU ${huCompleta} não está na lista!`, 'error');
    } else {
      logTerminal(`Erro retornado: ${JSON.stringify(resposta)}`, 'error');
    }
  } catch (e) {
    logTerminal(`Falha no envio POST: ${e.message}`, 'error');
  } finally {
    setTimeout(resetarVisor, 1500);
  }
}

function resetarVisor() {
  elementosHUDAtivos = [];
  if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";
  processandoHU = false;
  ocrAtivo = true;
  setTimeout(loopLeituraOCR, 100);
}
