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

// Canvas Overlay HUD (Sobreposição Futurista)
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

// Controle Global
let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let detectorBarra = null;
let lanternaLigada = false;

// Extrai apenas números
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// 🔔 Som de Feedback
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

// 📷 Câmera
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

// 🚀 Inicialização com OCR e Barcode Simultâneos
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Ativando HUD de Visão Computacional...";

  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({ 
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'data_matrix', 'qr_code'] 
      });
    } catch (e) {
      console.warn("BarcodeDetector indisponível.", e);
    }
  }

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '11', 
  });

  dicaStatusEl.innerText = "🟢 HUD ONLINE: Escaneando Barcode / WMS";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// 🎨 RENDERIZADOR HUD ESTILO HOMEM DE FERRO (Canto Técnico + Label Neon)
function desenharElementosHUD(elementos) {
  const ctx = canvasOverlay.getContext('2d');
  canvasOverlay.width = video.clientWidth;
  canvasOverlay.height = video.clientHeight;

  ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

  if (!elementos || elementos.length === 0) return;

  const scaleX = canvasOverlay.width / video.videoWidth;
  const scaleY = canvasOverlay.height / video.videoHeight;

  elementos.forEach(item => {
    const { bbox, rotulo, cor } = item;
    if (!bbox) return;

    const x = bbox.x0 * scaleX;
    const y = bbox.y0 * scaleY;
    const w = (bbox.x1 - bbox.x0) * scaleX;
    const h = (bbox.y1 - bbox.y0) * scaleY;

    // 1. Preenchimento Translúcido
    ctx.fillStyle = cor.replace('1)', '0.15)');
    ctx.fillRect(x, y, w, h);

    // 2. Borda Principal com Brilho Neon (Glow Effect)
    ctx.shadowColor = cor;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // 3. Marcadores de Canto Futuristas (Corner Brackets)
    const lineLen = Math.min(w, h) * 0.25;
    ctx.lineWidth = 3.5;

    // Canto Superior Esquerdo
    ctx.beginPath(); ctx.moveTo(x, y + lineLen); ctx.lineTo(x, y); ctx.lineTo(x + lineLen, y); ctx.stroke();
    // Canto Superior Direito
    ctx.beginPath(); ctx.moveTo(x + w - lineLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + lineLen); ctx.stroke();
    // Canto Inferior Esquerdo
    ctx.beginPath(); ctx.moveTo(x, y + h - lineLen); ctx.lineTo(x, y + h); ctx.lineTo(x + lineLen, y + h); ctx.stroke();
    // Canto Inferior Direito
    ctx.beginPath(); ctx.moveTo(x + w - lineLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - lineLen); ctx.stroke();

    // 4. Rótulo Tag / Badge Superior
    ctx.shadowBlur = 0; // Desliga glow para o texto ficar limpo
    ctx.font = "bold 11px 'Courier New', monospace";
    const textWidth = ctx.measureText(rotulo).width;
    
    // Fundo da Tag
    ctx.fillStyle = cor;
    ctx.fillRect(x, Math.max(0, y - 18), textWidth + 10, 18);
    
    // Texto da Tag
    ctx.fillStyle = "#000000";
    ctx.fillText(rotulo, x + 5, Math.max(12, y - 5));
  });
}

// 🔍 LOOP DE PROCESSAMENTO HÍBRIDO E VISUAL
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 80);
    return;
  }

  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {
      const elementosHUD = [];

      // 📌 CAMADA 1: DADOS DO CÓDIGO DE BARRAS
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              const huEncontrada = matchBarra[0];
              processandoHU = true;

              // Converte a boundingBox nativa do BarcodeDetector para o formato do HUD
              const boxBarra = {
                x0: codigo.boundingBox.x,
                y0: codigo.boundingBox.y,
                x1: codigo.boundingBox.x + codigo.boundingBox.width,
                y1: codigo.boundingBox.y + codigo.boundingBox.height
              };

              elementosHUD.push({ bbox: boxBarra, rotulo: "⚡ BARCODE DETECTED", cor: "rgba(0, 229, 255, 1)" });
              desenharElementosHUD(elementosHUD);

              modoLeituraEl.innerText = "⚡ BARCODE CAPTURADO!";
              spanNumsEstabilizados.innerText = huEncontrada;
              spanNumsAtivos.innerText = "";
              contadorDigitosEl.innerText = "18 / 18";

              await verificarHU(huEncontrada);
              return;
            }
          }
        } catch (eBarra) {}
      }

      // 📌 CAMADA 2: OCR ANCORADO NO WMS
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, vw, vh);

      const result = await workerOCR.recognize(canvas);
      const words = result.data.words || [];

      // Procura a palavra "WMS"
      const anchorWMS = words.find(w => w.text.toUpperCase().includes("WMS"));

      if (anchorWMS) {
        elementosHUD.push({ bbox: anchorWMS.bbox, rotulo: "📍 ANCHOR: WMS", cor: "rgba(255, 215, 0, 1)" });
      }

      // Procura o SSCC de 18 dígitos que inicia em 1789
      const matchSSCC = words.find(w => {
        const numPuro = extrairNumeros(w.text);
        return numPuro.match(/1789\d{14}/);
      });

      if (matchSSCC && !processandoHU) {
        const huEncontrada = extrairNumeros(matchSSCC.text).match(/1789\d{14}/)[0];
        processandoHU = true;

        elementosHUD.push({ bbox: matchSSCC.bbox, rotulo: "🎯 TARGET: SSCC 1789", cor: "rgba(0, 230, 118, 1)" });
        desenharElementosHUD(elementosHUD);

        modoLeituraEl.innerText = "🔒 HU TEXTO LIDA COM SUCESSO!";
        spanNumsEstabilizados.innerText = huEncontrada;
        spanNumsAtivos.innerText = "";
        contadorDigitosEl.innerText = "18 / 18";

        await verificarHU(huEncontrada);
        return;
      } else {
        // Se achou o WMS mas ainda está alinhando o SSCC
        if (anchorWMS) {
          modoLeituraEl.innerText = "FOCANDO NO SSCC...";
          dicaStatusEl.innerText = "👁️ WMS Detectado. Mantenha firme...";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          modoLeituraEl.innerText = "HUD PROCURANDO...";
          dicaStatusEl.innerText = "🟢 Aponta para a etiqueta";
          dicaStatusEl.style.color = "#00e676";
        }
        
        // Renderiza o HUD atualizado com o que foi encontrado
        desenharElementosHUD(elementosHUD);
      }
    }
  } catch (e) {
    console.error("Erro no loop HUD/OCR:", e);
  } finally {
    if (!processandoHU) {
      setTimeout(loopLeituraOCR, 90);
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

// 🔄 Reset do Visor HUD
function resetarVisor() {
  desenharElementosHUD([]); // Limpa as caixas da tela
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
  dicaStatusEl.innerText = "🟢 Aponta para a etiqueta WMS";
  dicaStatusEl.style.color = "#00e676";

  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}
