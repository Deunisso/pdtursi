const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

const video = document.getElementById('webcam');
const modoLeituraEl = document.getElementById('modo-leitura');
const contadorDigitosEl = document.getElementById('contador-digitos');
const containerListaHus = document.getElementById('container-lista-hus');
const logTerminalEl = document.getElementById('log-terminal');
const logMensagensEl = document.getElementById('log-mensagens');
const canvas = document.getElementById('canvas-processamento');
const popupLeituraEl = document.getElementById('popup-leitura');
const canvasFogos = document.getElementById('canvas-fogos');

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

let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let detectorBarra = null;

// 🎆 LÓGICA DE FOGOS DE ARTIFÍCIO
function soltarFogos() {
  if (!canvasFogos) return;
  const ctx = canvasFogos.getContext('2d');
  canvasFogos.width = canvasFogos.parentElement.clientWidth;
  canvasFogos.height = canvasFogos.parentElement.clientHeight;

  const particulas = [];
  const cores = ['#00e676', '#ffd700', '#00d2ff', '#ff1744', '#ffffff'];

  for (let i = 0; i < 40; i++) {
    particulas.push({
      x: canvasFogos.width / 2,
      y: canvasFogos.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      cor: cores[Math.floor(Math.random() * cores.length)],
      tamanho: Math.random() * 4 + 2,
      alpha: 1
    });
  }

  function animar() {
    ctx.clearRect(0, 0, canvasFogos.width, canvasFogos.height);
    let restam = false;

    particulas.forEach(p => {
      if (p.alpha > 0) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.04;
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.cor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.tamanho, 0, Math.PI * 2);
        ctx.fill();
        restam = true;
      }
    });

    if (restam) {
      requestAnimationFrame(animar);
    } else {
      ctx.clearRect(0, 0, canvasFogos.width, canvasFogos.height);
    }
  }

  animar();
}

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

// ✨ EXIBE O NÚMERO COMPLETO NO CENTRO
function exibirAnimacaoCentral(codigoCompleto) {
  if (!popupLeituraEl) return;
  popupLeituraEl.innerText = codigoCompleto; // Exibe o número inteiro
  popupLeituraEl.classList.add('ativo');
}

function ocultarAnimacaoCentral() {
  if (popupLeituraEl) {
    popupLeituraEl.classList.remove('ativo');
  }
}

// 🔄 SINCRONIZAÇÃO DA PLANILHA
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
            const ultimos5 = String(hu).slice(-5);
            return `<div class="hu-chip" title="${hu}">${ultimos5}</div>`;
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

async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 60);
    return;
  }

  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {

      // 1. Barcode Detector
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              processandoHU = true;
              tocarBipInstantaneo();
              soltarFogos(); // Comemoração de fogos!
              exibirAnimacaoCentral(matchBarra[0]);

              if (modoLeituraEl) modoLeituraEl.innerText = "LIDO!";

              await enviarParaAppsScript(matchBarra[0]);
              return;
            }
          }
        } catch (eBarra) {}
      }

      // 2. OCR Fallback
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
        soltarFogos(); // Comemoração de fogos!

        const huEncontrada = extrairNumeros(matchSSCC.text).match(/1789\d{14}/)[0];
        exibirAnimacaoCentral(huEncontrada);

        if (modoLeituraEl) modoLeituraEl.innerText = "LIDO!";

        await enviarParaAppsScript(huEncontrada);
        return;
      } else {
        if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (!processandoHU) {
      setTimeout(loopLeituraOCR, 60);
    }
  }
}

async function enviarParaAppsScript(huCompleta) {
  try {
    // Dispara o envio sem bloquear a interface de forma demorada
    fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    }).then(() => carregarDadosPlanilha());

  } catch (e) {
    logTerminal(`Erro ao enviar: ${e.message}`, 'error');
  } finally {
    // 🚀 SAÍDA SUPER RÁPIDA: Reduzido para 1200ms para permitir escaneamento em massa!
    setTimeout(resetarVisor, 1200);
  }
}

function resetarVisor() {
  ocultarAnimacaoCentral();
  if (modoLeituraEl) modoLeituraEl.innerText = "ESCANEANDO...";
  processandoHU = false;
  ocrAtivo = true;
  setTimeout(loopLeituraOCR, 50);
}
