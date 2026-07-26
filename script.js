// =================================================================
// ⚠️ CONFIGURAÇÃO: URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Elementos do DOM
const video = document.getElementById('webcam');
const miraBox = document.getElementById('mira-box');
const spanNumsEstabilizados = document.getElementById('nums-estabilizados');
const spanNumsAtivos = document.getElementById('nums-ativos');
const contadorDigitosEl = document.getElementById('contador-digitos');
const dicaStatusEl = document.getElementById('dica-status');
const modoLeituraEl = document.getElementById('modo-leitura');
const notificacaoEl = document.getElementById('notificacao-discreta');
const huNotificacaoTexto = document.getElementById('hu-notificacao-texto');
const btnLanterna = document.getElementById('btn-lanterna');
const containerListaHus = document.getElementById('container-lista-hus');
const badgeContador = document.getElementById('badge-contador');
const canvas = document.getElementById('canvas-processamento');

// Canvas Overlay para desenhar os contornos dinâmicos sobre o vídeo
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
  video.parentElement.appendChild(canvasOverlay);
}

// Controle Global
let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let detectorBarra = null;
let lanternaLigada = false;

// Helper: Extrai estritamente caracteres numéricos
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// 🔔 Som de Bip
function tocarBip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch(e) {}
}

// 📷 Inicialização Câmera HD
navigator.mediaDevices.getUserMedia({ 
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarSistemaLeitura();
})
.catch(() => {
  dicaStatusEl.innerText = "❌ Permita o acesso à câmera.";
});

// 🚀 Inicialização com Suporte a Letras e Números (Modo Leitura Completa)
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando leitor com Ancoragem WMS...";

  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({ formats: ['code_128', 'ea_13', 'data_matrix', 'qr_code'] });
    } catch (e) {}
  }

  // Tesseract configurado para ler letras (WMS) e dígitos numéricos
  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '11', // PSM 11: Encontra o máximo de texto espalhado para detectar a âncora "WMS"
  });

  dicaStatusEl.innerText = "🟢 Aponta para a etiqueta (Buscando WMS)";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// 🎨 Limpa/Desenha o Contorno em volta do texto detectado na tela
function desenharContornoNaTela(bbox, videoWidth, videoHeight, cor = "#00e676") {
  const ctx = canvasOverlay.getContext('2d');
  canvasOverlay.width = video.clientWidth;
  canvasOverlay.height = video.clientHeight;

  ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

  if (!bbox) return;

  const scaleX = canvasOverlay.width / videoWidth;
  const scaleY = canvasOverlay.height / videoHeight;

  const x = bbox.x0 * scaleX;
  const y = bbox.y0 * scaleY;
  const w = (bbox.x1 - bbox.x0) * scaleX;
  const h = (bbox.y1 - bbox.y0) * scaleY;

  // Desenha caixa de destaque
  ctx.strokeStyle = cor;
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);

  // Preenchimento translúcido
  ctx.fillStyle = cor === "#00e676" ? "rgba(0, 230, 118, 0.2)" : "rgba(255, 215, 0, 0.2)";
  ctx.fillRect(x, y, w, h);
}

// 🔍 LOOP DE LEITURA COM ANCORAGEM PELO "WMS"
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 80);
    return;
  }

  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {

      // Preparação do Canvas para OCR Total
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, vw, vh);

      // OCR da tela inteira
      const result = await workerOCR.recognize(canvas);
      const words = result.data.words || [];

      // 1. TENTA ENCONTRAR A ÂNCORA "WMS"
      const anchorWMS = words.find(w => w.text.toUpperCase().includes("WMS"));

      if (anchorWMS) {
        modoLeituraEl.innerText = "📍 ETIQUETA WMS LOCALIZADA!";
        dicaStatusEl.innerText = "👁️ Lendo linha do SSCC...";
        dicaStatusEl.style.color = "#ffd700";

        // Desenha contorno amarelo sobre a palavra WMS encontrada
        desenharContornoNaTela(anchorWMS.bbox, vw, vh, "#ffd700");

        // 2. BUSCA O CÓDIGO 1789... DENTRO DAS PALAVRAS/LINHAS ABAIXO DO WMS
        const matchSSCC = words.find(w => {
          const numPuro = extrairNumeros(w.text);
          return numPuro.match(/1789\d{14}/);
        });

        if (matchSSCC && !processandoHU) {
          const numerosPuros = extrairNumeros(matchSSCC.text);
          const huEncontrada = numerosPuros.match(/1789\d{14}/)[0];

          processandoHU = true;

          // Desenha caixa VERDE no SSCC lido
          desenharContornoNaTela(matchSSCC.bbox, vw, vh, "#00e676");

          modoLeituraEl.innerText = "🔒 HU TEXTO LIDA COM SUCESSO!";
          spanNumsEstabilizados.innerText = huEncontrada;
          spanNumsAtivos.innerText = "";
          contadorDigitosEl.innerText = "18 / 18";

          dicaStatusEl.innerText = "✓ LEITURA ANCORADA CONCLUÍDA!";
          dicaStatusEl.style.color = "#00e676";

          await verificarHU(huEncontrada);
          return;
        }
      } else {
        // Se não achou a palavra WMS explícita, tenta busca direta por expressão regular global
        const textGlobal = result.data.text || "";
        const numerosPuros = extrairNumeros(textGlobal);
        const matchGlobal = numerosPuros.match(/1789\d{14}/);

        if (matchGlobal && !processandoHU) {
          const huEncontrada = matchGlobal[0];
          processandoHU = true;

          modoLeituraEl.innerText = "🔒 HU TEXTO LIDA!";
          spanNumsEstabilizados.innerText = huEncontrada;
          contadorDigitosEl.innerText = "18 / 18";

          await verificarHU(huEncontrada);
          return;
        } else {
          desenharContornoNaTela(null); // Limpa os retângulos se não houver leitura
          modoLeituraEl.innerText = "BUSCANDO WMS...";
          dicaStatusEl.innerText = "🟢 Enquadre o topo da etiqueta (WMS)";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
  } catch (e) {
    console.error("Erro no loop OCR:", e);
  } finally {
    if (!processandoHU) {
      setTimeout(loopLeituraOCR, 100);
    }
  }
}

// 📡 Envio para Planilha
async function verificarHU(huCompleta) {
  const timerSeguranca = setTimeout(() => {
    if (processandoHU) resetarVisor();
  }, 5000);

  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    const data = await res.json();
    clearTimeout(timerSeguranca);

    if (data.status === "sucesso") {
      tocarBip();
      setTimeout(resetarVisor, 1400);
    } else {
      setTimeout(resetarVisor, 1400);
    }
  } catch (e) {
    clearTimeout(timerSeguranca);
    setTimeout(resetarVisor, 1400);
  }
}

// 🔄 Reset do Estado
function resetarVisor() {
  desenharContornoNaTela(null);
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
  dicaStatusEl.innerText = "🟢 Enquadre a etiqueta WMS";
  dicaStatusEl.style.color = "#00e676";

  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}
