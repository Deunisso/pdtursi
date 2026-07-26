// Script.js

// =================================================================
// ⚠️ CONFIGURAÇÃO: Insira a sua URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "SUA_URL_DO_GOOGLE_APPS_SCRIPT_AQUI";

// Mapeamento dos elementos da tela (DOM)
const video = document.getElementById('webcam');
const miraBox = document.getElementById('mira-box');
const numerosLidosEl = document.getElementById('numeros-lidos');
const contadorDigitosEl = document.getElementById('contador-digitos');
const dicaStatusEl = document.getElementById('dica-status');
const modoLeituraEl = document.getElementById('modo-leitura');
const notificacaoEl = document.getElementById('notificacao-discreta');
const huNotificacaoTexto = document.getElementById('hu-notificacao-texto');
const btnLanterna = document.getElementById('btn-lanterna');
const containerListaHus = document.getElementById('container-lista-hus');
const badgeContador = document.getElementById('badge-contador');
const canvas = document.getElementById('canvas-processamento');

let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let lanternaLigada = false;
let listaPendentesGlobal = [];

// Som de bip do leitor
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

// Controle da Lanterna do dispositivo
async function alternarLanterna() {
  const stream = video.srcObject;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  try {
    const capabilities = track.getCapabilities();
    if (capabilities.torch) {
      lanternaLigada = !lanternaLigada;
      await track.applyConstraints({ advanced: [{ torch: lanternaLigada }] });
      btnLanterna.classList.toggle('ativo', lanternaLigada);
    } else {
      alert("Lanterna não suportada neste dispositivo.");
    }
  } catch(e) {}
}

// Atualização da Planilha e Dashboard
async function atualizarDashboard() {
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    
    document.getElementById('qtd-encontradas').innerText = data.encontradas;
    document.getElementById('qtd-faltam').innerText = data.pendentes;

    if (data.lista_pendentes) {
      renderizarListaPendentes(data.lista_pendentes);
    }
  } catch (e) {
    console.error("Erro ao atualizar dashboard:", e);
  }
}

// Desenha a lista de HUs pendentes exibindo APENAS os 5 ÚLTIMOS DÍGITOS
function renderizarListaPendentes(lista) {
  listaPendentesGlobal = lista.map(item => String(item).trim());
  badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;

  if (listaPendentesGlobal.length === 0) {
    containerListaHus.innerHTML = `
      <div class="lista-vazia">
        <span>🎉 PARABÉNS!</span>
        <span>Todas as HUs foram bipadas com sucesso.</span>
      </div>`;
    return;
  }

  containerListaHus.innerHTML = listaPendentesGlobal.map(hu => {
    const huStr = String(hu).trim();
    // Extrai exatamente os últimos 5 dígitos da HU
    const ultimos5 = huStr.length >= 5 ? huStr.slice(-5) : huStr;

    return `
      <div class="hu-chip" id="chip-${huStr}" data-hu="${huStr}">
        <span class="sufixo">…${ultimos5}</span>
      </div>`;
  }).join('');
}

// Remove a HU da lista visual instantaneamente quando encontrada
function removerHuDaListaVisual(huEncontrada) {
  const huLimpa = String(huEncontrada).trim();
  
  // Tenta localizar o elemento pelo ID ou pelo atributo data-hu
  let chip = document.getElementById(`chip-${huLimpa}`);
  if (!chip) {
    chip = document.querySelector(`[data-hu="${huLimpa}"]`);
  }

  if (chip) {
    chip.classList.add('removendo');
    setTimeout(() => {
      chip.remove();
      listaPendentesGlobal = listaPendentesGlobal.filter(item => item !== huLimpa);
      badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
      
      if (listaPendentesGlobal.length === 0) {
        renderizarListaPendentes([]);
      }
    }, 300);
  }
}

// Inicializa a Câmera
navigator.mediaDevices.getUserMedia({ 
  video: { 
    facingMode: "environment", 
    width: { ideal: 1920 }, 
    height: { ideal: 1080 },
    focusMode: "continuous"
  } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarOCR();
})
.catch(err => {
  dicaStatusEl.innerText = "❌ Permita o acesso à câmera.";
  dicaStatusEl.style.color = "#ff5252";
});

// Inicializa Tesseract OCR
async function iniciarOCR() {
  dicaStatusEl.innerText = "⚡ Carregando Reconhecedor Otimizado...";
  
  workerOCR = await Tesseract.createWorker('eng');
  
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789()WMSwms',
    tessedit_pageseg_mode: '6',
  });

  dicaStatusEl.innerText = "🟢 Aponte a mira para o número 1789...";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopOCR();
}

// Filtro P&B de alto contraste
function aplicarBinarizacaoOtsu(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    data[i] = data[i+1] = data[i+2] = gray;
    histogram[gray]++;
  }

  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] < threshold ? 0 : 255;
    data[i] = data[i+1] = data[i+2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
}

// Loop principal de leitura da imagem
async function loopOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopOCR, 150);
    return;
  }

  try {
    miraBox.classList.add('lendo');
    
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    if (vw > 0 && vh > 0) {
      const CROP_W = vw * 0.92;
      const CROP_H = vh * 0.38;
      
      canvas.width = CROP_W * 2;
      canvas.height = CROP_H * 2;
      const ctx = canvas.getContext('2d');
      
      ctx.drawImage(video, vw * 0.04, vh * 0.28, CROP_W, CROP_H, 0, 0, canvas.width, canvas.height);
      aplicarBinarizacaoOtsu(ctx, canvas.width, canvas.height);

      const result = await workerOCR.recognize(canvas);
      const rawText = result.data.text || "";

      const REGEX_SSCC = /1789\d{14}/;
      const textoLimpo = rawText.replace(/[^\d]/g, '');
      const match = textoLimpo.match(REGEX_SSCC);

      let huEncontrada = match ? match[0] : null;

      if (huEncontrada) {
        numerosLidosEl.innerText = huEncontrada;
        contadorDigitosEl.innerText = "18 / 18";
        modoLeituraEl.innerText = "🎯 DÍGITOS 1789 RECONHECIDOS";
        dicaStatusEl.innerText = "✓ SSCC Confirmado!";
        dicaStatusEl.style.color = "#00e676";
        
        miraBox.classList.remove('lendo');
        miraBox.classList.add('sucesso');
        
        await verificarHU(huEncontrada);
      } else {
        const indexInicio = textoLimpo.indexOf('1789');

        if (indexInicio !== -1) {
          const parcial = textoLimpo.substring(indexInicio, indexInicio + 18);
          numerosLidosEl.innerText = parcial;
          contadorDigitosEl.innerText = `${parcial.length} / 18`;
          dicaStatusEl.innerText = "👁️ Lendo sequência 1789...";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          numerosLidosEl.innerText = "Aguardando 1789...";
          contadorDigitosEl.innerText = "0 / 18";
          dicaStatusEl.innerText = "🟢 Enquadre o código de 18 dígitos";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
    miraBox.classList.remove('lendo');
  } catch (e) {
    console.error(e);
  }

  setTimeout(loopOCR, 150);
}

// Valida a HU na Planilha
async function verificarHU(hu) {
  processandoHU = true;
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: hu })
    });
    const data = await res.json();

    if (data.status === "sucesso") {
      tocarBip();
      
      huNotificacaoTexto.innerText = hu;
      notificacaoEl.style.display = 'block';
      
      // Remove a HU da lista visual instantaneamente
      removerHuDaListaVisual(hu);
      atualizarDashboard();

      setTimeout(() => {
        notificacaoEl.style.display = 'none';
        resetarVisor();
        processandoHU = false;
      }, 2500);

    } else if (data.status === "ja_lido") {
      dicaStatusEl.innerText = `⚠️ HU ${hu} JÁ FOI LIDA!`;
      dicaStatusEl.style.color = "#ff9800";
      setTimeout(() => { resetarVisor(); processandoHU = false; }, 2000);
    } else {
      dicaStatusEl.innerText = `❌ HU ${hu} não pertence à lista!`;
      dicaStatusEl.style.color = "#ff5252";
      setTimeout(() => { resetarVisor(); processandoHU = false; }, 2000);
    }
  } catch (e) {
    dicaStatusEl.innerText = "❌ Erro ao conectar com a Planilha.";
    dicaStatusEl.style.color = "#ff5252";
    setTimeout(() => { resetarVisor(); processandoHU = false; }, 2000);
  }
}

function resetarVisor() {
  miraBox.classList.remove('sucesso');
  numerosLidosEl.innerText = "Aguardando 1789...";
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PADRÃO GS1: 1789... (18 DÍGITOS)";
  dicaStatusEl.innerText = "🟢 Aponte a mira para o número 1789...";
  dicaStatusEl.style.color = "#00e676";
}

// Inicialização
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
