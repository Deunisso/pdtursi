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

// Controle Global
let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let detectorBarra = null;
let lanternaLigada = false;
let listaPendentesGlobal = [];

// 🔔 Som de Bip Feedback
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

// 🔦 Lanterna
async function alternarLanterna() {
  const stream = video.srcObject;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  try {
    lanternaLigada = !lanternaLigada;
    await track.applyConstraints({ advanced: [{ torch: lanternaLigada }] });
    if (btnLanterna) btnLanterna.classList.toggle('ativo', lanternaLigada);
  } catch (e) {
    alert("Lanterna não suportada neste dispositivo.");
  }
}

// Helper: Extrai estritamente caracteres numéricos (0-9)
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// 📊 Dashboard / Integração com Planilha
async function atualizarDashboard() {
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    
    if (document.getElementById('qtd-encontradas')) {
      document.getElementById('qtd-encontradas').innerText = data.encontradas || 0;
    }
    if (document.getElementById('qtd-faltam')) {
      document.getElementById('qtd-faltam').innerText = data.pendentes || 0;
    }

    if (data.lista_pendentes && Array.isArray(data.lista_pendentes)) {
      renderizarListaPendentes(data.lista_pendentes);
    }
  } catch (e) {
    console.error("Erro no dashboard:", e);
  }
}

function renderizarListaPendentes(lista) {
  listaPendentesGlobal = lista.map(item => extrairNumeros(item)).filter(item => item.length > 0);
  if (badgeContador) badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;

  if (listaPendentesGlobal.length === 0) {
    containerListaHus.innerHTML = `<div class="lista-vazia">🎉 Todas as HUs lidas!</div>`;
    return;
  }

  containerListaHus.innerHTML = listaPendentesGlobal.map(huCompleta => {
    const ultimos5 = huCompleta.length >= 5 ? huCompleta.slice(-5) : huCompleta;
    return `<div class="hu-chip" data-hu="${huCompleta}"><span>…${ultimos5}</span></div>`;
  }).join('');
}

function removerHuDaListaVisual(huEncontrada) {
  const huLimpa = extrairNumeros(huEncontrada);
  const ultimos5 = huLimpa.slice(-5);
  const chips = containerListaHus.querySelectorAll('.hu-chip');
  
  chips.forEach(chip => {
    const huAtributo = chip.getAttribute('data-hu');
    if (huAtributo === huLimpa || (huAtributo && huAtributo.endsWith(ultimos5))) {
      chip.classList.add('removendo');
      setTimeout(() => {
        chip.remove();
        listaPendentesGlobal = listaPendentesGlobal.filter(item => item !== huAtributo && !item.endsWith(ultimos5));
        if (badgeContador) badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
      }, 300);
    }
  });
}

// 📷 Inicialização da Câmera HD
navigator.mediaDevices.getUserMedia({ 
  video: { 
    facingMode: "environment", 
    width: { ideal: 1920, min: 1280 }, 
    height: { ideal: 1080, min: 720 }
  } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarSistemaLeitura();
})
.catch(err => {
  dicaStatusEl.innerText = "❌ Permita o acesso à câmera.";
  dicaStatusEl.style.color = "#ff5252";
});

// 🚀 Inicialização Dupla: Barcode Detector + OCR Numérico
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando leitor otimizado...";

  // 1. Ativa BarcodeDetector Nativo (se suportado pelo navegador/celular)
  if ('BarcodeDetector' in window) {
    try {
      detectorBarra = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a', 'data_matrix', 'qr_code']
      });
    } catch (e) {
      console.warn("BarcodeDetector não suportado no navegador.", e);
    }
  }

  // 2. Ativa OCR Tesseract com foco exclusivo em LINHA ÚNICA NUMÉRICA (PSM 7)
  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789', // Whitelist estrita (Apenas 0 a 9)
    tessedit_pageseg_mode: '7',           // Trata como uma linha única de texto
  });

  dicaStatusEl.innerText = "🟢 Alinhe a linha do SSCC ou código de barras";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// 🎨 Tratamento da Imagem: Upscaling (2x) + Binarização de Alto Contraste
function processarImagemDensa(ctx, cropX, cropY, cropW, cropH) {
  // Duplica a resolução no canvas para nitidez absoluta dos contornos
  canvas.width = cropW * 2;
  canvas.height = cropH * 2;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  // Binarização Adaptativa
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = gray < 130 ? 0 : 255; // Limiar limpo
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
}

// 🔍 LOOP CONTINUO DE LEITURA (SEM TRAVAMENTOS)
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 80);
    return;
  }

  try {
    miraBox.classList.add('lendo');
    
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    if (vw > 0 && vh > 0) {

      // 📌 CAMADA 1: DETECÇÃO DIRETA DE CÓDIGO DE BARRAS (Instantâneo)
      if (detectorBarra) {
        try {
          const codigos = await detectorBarra.detect(video);
          for (const codigo of codigos) {
            const numerosBarra = extrairNumeros(codigo.rawValue);
            const matchBarra = numerosBarra.match(/1789\d{14}/);

            if (matchBarra && !processandoHU) {
              const huEncontrada = matchBarra[0];
              processandoHU = true;

              modoLeituraEl.innerText = "⚡ BARCODE LIDO COM SUCESSO!";
              spanNumsEstabilizados.innerText = huEncontrada;
              spanNumsAtivos.innerText = "";
              contadorDigitosEl.innerText = "18 / 18";

              dicaStatusEl.innerText = "✓ CÓDIGO DE BARRAS CAPTURADO!";
              dicaStatusEl.style.color = "#00e676";

              miraBox.classList.remove('lendo');
              miraBox.classList.add('sucesso');

              await verificarHU(huEncontrada);
              return;
            }
          }
        } catch (eBarra) {
          console.warn("Falha temporária no leitor de código de barras:", eBarra);
        }
      }

      // 📌 CAMADA 2: RECORTE ESTREITO EXCLUSIVO DA LINHA DO SSCC (1789...)
      // Ignora o texto MATERIAL ABR... abaixo e as quantidades à direita
      const CROP_W = vw * 0.55;  
      const CROP_H = vh * 0.12;  
      const CROP_X = vw * 0.05;  
      const CROP_Y = vh * 0.23;  

      const ctx = canvas.getContext('2d');
      processarImagemDensa(ctx, CROP_X, CROP_Y, CROP_W, CROP_H);

      // OCR da Linha
      const result = await workerOCR.recognize(canvas);
      const numerosPuros = extrairNumeros(result.data.text);

      // Validação Severa: Prefix '1789' + 14 Dígitos (Total 18)
      const matchOCR = numerosPuros.match(/1789\d{14}/);

      if (matchOCR && !processandoHU) {
        const huEncontrada = matchOCR[0];

        if (huEncontrada.length === 18) {
          processandoHU = true;

          modoLeituraEl.innerText = "🔒 HU TEXTO LIDA COM SUCESSO!";
          spanNumsEstabilizados.innerText = huEncontrada;
          spanNumsAtivos.innerText = "";
          contadorDigitosEl.innerText = "18 / 18";

          dicaStatusEl.innerText = "✓ LEITURA TEXTUAL CONCLUÍDA!";
          dicaStatusEl.style.color = "#00e676";

          miraBox.classList.remove('lendo');
          miraBox.classList.add('sucesso');

          await verificarHU(huEncontrada);
          return;
        }
      } else {
        const pos1789 = numerosPuros.indexOf('1789');

        if (pos1789 !== -1) {
          const parcial = numerosPuros.substring(pos1789, pos1789 + 18);
          const faltam = 18 - parcial.length;

          spanNumsEstabilizados.innerText = parcial;
          spanNumsAtivos.innerText = "?".repeat(Math.max(0, faltam));
          contadorDigitosEl.innerText = `${parcial.length} / 18`;

          modoLeituraEl.innerText = "FOCANDO NO 1789...";
          dicaStatusEl.innerText = "👁️ Segure firme...";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          spanNumsEstabilizados.innerText = "";
          spanNumsAtivos.innerText = "1789????????????";
          contadorDigitosEl.innerText = "0 / 18";

          modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
          dicaStatusEl.innerText = "🟢 Enquadre a linha do SSCC";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
  } catch (e) {
    console.error("Erro no processamento:", e);
  } finally {
    miraBox.classList.remove('lendo');
    // Força a continuidade do loop caso nenhuma HU tenha sido validada neste frame
    if (!processandoHU) {
      setTimeout(loopLeituraOCR, 80);
    }
  }
}

// 📡 Comunicação com a Planilha (Google Apps Script)
async function verificarHU(huCompleta) {
  // Trava de Segurança (Watchdog): Destrava o leitor em 5s se o servidor não responder
  const timerSeguranca = setTimeout(() => {
    if (processandoHU) {
      dicaStatusEl.innerText = "⚠️ Servidor lento. Reiniciando leitor...";
      dicaStatusEl.style.color = "#ff9800";
      setTimeout(resetarVisor, 1200);
    }
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
      
      const ultimos5 = huCompleta.slice(-5);
      huNotificacaoTexto.innerText = `...${ultimos5} (${huCompleta})`;
      notificacaoEl.style.display = 'block';
      
      removerHuDaListaVisual(huCompleta);

      setTimeout(() => {
        notificacaoEl.style.display = 'none';
        resetarVisor();
      }, 1400);

    } else if (data.status === "ja_lido") {
      dicaStatusEl.innerText = `⚠️ HU ${huCompleta.slice(-5)} já foi lida!`;
      dicaStatusEl.style.color = "#ff9800";
      setTimeout(resetarVisor, 1400);
    } else {
      dicaStatusEl.innerText = `❌ HU ${huCompleta.slice(-5)} não está na lista!`;
      dicaStatusEl.style.color = "#ff5252";
      setTimeout(resetarVisor, 1400);
    }
  } catch (e) {
    clearTimeout(timerSeguranca);
    dicaStatusEl.innerText = "❌ Erro de conexão com a Planilha.";
    dicaStatusEl.style.color = "#ff5252";
    setTimeout(resetarVisor, 1400);
  }
}

// 🔄 Reset do Visor e Liberação para Próxima Leitura
function resetarVisor() {
  miraBox.classList.remove('sucesso', 'lendo');
  
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
  dicaStatusEl.innerText = "🟢 Enquadre a linha do SSCC";
  dicaStatusEl.style.color = "#00e676";
  
  // Limpa o Canvas de processamento
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Destrava as flags e reativa a câmera para próxima leitura
  processandoHU = false;
  ocrAtivo = true;

  setTimeout(loopLeituraOCR, 100);
}

// 🚀 Start das Requisições do Dashboard
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
