// =================================================================
// ⚠️ CONFIGURAÇÃO: Insira a sua URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Mapeamento dos elementos do DOM
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

// Som de Bip
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

// Controle de Lanterna
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

// Função utilitária para extrair apenas números de uma HU
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Atualização do Dashboard e Quantidades
async function atualizarDashboard() {
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    
    // Atualiza contadores numéricos
    const qtdEncontradas = parseInt(data.encontradas || 0, 10);
    const qtdPendentes = parseInt(data.pendentes || 0, 10);

    if (document.getElementById('qtd-encontradas')) {
      document.getElementById('qtd-encontradas').innerText = qtdEncontradas;
    }
    if (document.getElementById('qtd-faltam')) {
      document.getElementById('qtd-faltam').innerText = qtdPendentes;
    }

    if (data.lista_pendentes && Array.isArray(data.lista_pendentes)) {
      renderizarListaPendentes(data.lista_pendentes);
    }
  } catch (e) {
    console.error("Erro ao atualizar dashboard:", e);
  }
}

// Renderiza APENAS os 5 últimos dígitos nos chips da lista de pendentes
function renderizarListaPendentes(lista) {
  // Salva na memória global a HU original
  listaPendentesGlobal = lista.map(item => extrairNumeros(item)).filter(item => item.length > 0);
  
  if (badgeContador) {
    badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
  }

  if (listaPendentesGlobal.length === 0) {
    containerListaHus.innerHTML = `
      <div class="lista-vazia">
        <span>🎉 PARABÉNS!</span>
        <span>Todas as HUs foram bipadas.</span>
      </div>`;
    return;
  }

  // Gera os quadros exibindo apenas os 5 últimos dígitos da HU completa
  containerListaHus.innerHTML = listaPendentesGlobal.map(huCompleta => {
    // Pega exatamente os últimos 5 dígitos (ex: de '178910240423291973' pega '91973')
    const ultimos5 = huCompleta.length >= 5 ? huCompleta.slice(-5) : huCompleta;

    return `
      <div class="hu-chip" data-hu="${huCompleta}">
        <span>…${ultimos5}</span>
      </div>`;
  }).join('');
}

// Remove instantaneamente o chip da tela quando a HU é lida
function removerHuDaListaVisual(huEncontrada) {
  const huLimpa = extrairNumeros(huEncontrada);
  const ultimos5 = huLimpa.slice(-5);
  
  const chips = containerListaHus.querySelectorAll('.hu-chip');
  
  chips.forEach(chip => {
    const huAtributo = chip.getAttribute('data-hu');
    
    // Compara a HU inteira de 18 dígitos OU o final de 5 dígitos
    if (huAtributo === huLimpa || (huAtributo && huAtributo.endsWith(ultimos5))) {
      chip.classList.add('removendo');
      setTimeout(() => {
        chip.remove();
        
        // Atualiza a lista na memória
        listaPendentesGlobal = listaPendentesGlobal.filter(item => item !== huAtributo && !item.endsWith(ultimos5));
        
        if (badgeContador) {
          badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
        }

        // Atualiza contadores do topo em tempo real
        const elFaltam = document.getElementById('qtd-faltam');
        const elEncontradas = document.getElementById('qtd-encontradas');
        
        if (elFaltam && elEncontradas) {
          let faltam = parseInt(elFaltam.innerText || "0", 10);
          let encontradas = parseInt(elEncontradas.innerText || "0", 10);
          
          if (faltam > 0) elFaltam.innerText = faltam - 1;
          elEncontradas.innerText = encontradas + 1;
        }

        if (listaPendentesGlobal.length === 0) {
          renderizarListaPendentes([]);
        }
      }, 300);
    }
  });
}

// Câmera
navigator.mediaDevices.getUserMedia({ 
  video: { 
    facingMode: "environment", 
    width: { ideal: 1920 }, 
    height: { ideal: 1080 } 
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

// Inicialização Tesseract OCR
async function iniciarOCR() {
  dicaStatusEl.innerText = "⚡ Carregando leitor de código...";
  
  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '6',
  });

  dicaStatusEl.innerText = "🟢 Aponte para a HU (18 DÍGITOS - 1789...)";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopOCR();
}

// Processamento de imagem em P&B para leitura rápida
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

// Loop de Leitura da Câmera (PROCURA OS 18 CARACTERES)
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
      const CROP_H = vh * 0.22;
      
      canvas.width = CROP_W * 2;
      canvas.height = CROP_H * 2;
      const ctx = canvas.getContext('2d');
      
      ctx.drawImage(video, vw * 0.04, vh * 0.28, CROP_W, CROP_H, 0, 0, canvas.width, canvas.height);
      aplicarBinarizacaoOtsu(ctx, canvas.width, canvas.height);

      const result = await workerOCR.recognize(canvas);
      const rawText = result.data.text || "";
      const textoLimpo = rawText.replace(/[^\d]/g, '');

      // PROCURA OBRIGATORIAMENTE O CÓDIGO DE 18 DÍGITOS COMEÇANDO COM 1789
      const REGEX_HU_18 = /1789\d{14}/;
      const match = textoLimpo.match(REGEX_HU_18);

      let huEncontrada = match ? match[0] : null;

      if (huEncontrada) {
        numerosLidosEl.innerText = huEncontrada;
        contadorDigitosEl.innerText = "18 / 18";
        modoLeituraEl.innerText = "🎯 HU 18 DÍGITOS RECONHECIDA";
        dicaStatusEl.innerText = "✓ Validando HU...";
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
          dicaStatusEl.innerText = "👁️ Lendo HU (1789...)";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          numerosLidosEl.innerText = "Aguardando 1789...";
          contadorDigitosEl.innerText = "0 / 18";
          dicaStatusEl.innerText = "🟢 Enquadre a HU de 18 dígitos";
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

// Envia a HU inteira (18 dígitos) para a planilha
async function verificarHU(huCompleta) {
  processandoHU = true;
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    const data = await res.json();

    if (data.status === "sucesso") {
      tocarBip();
      
      const ultimos5 = huCompleta.slice(-5);
      huNotificacaoTexto.innerText = `HU: ...${ultimos5}`;
      notificacaoEl.style.display = 'block';
      
      // Remove da lista de pendentes e atualiza os cards de topo
      removerHuDaListaVisual(huCompleta);

      setTimeout(() => {
        notificacaoEl.style.display = 'none';
        resetarVisor();
        processandoHU = false;
      }, 1800);

    } else if (data.status === "ja_lido") {
      dicaStatusEl.innerText = `⚠️ HU ${huCompleta.slice(-5)} já foi bipada!`;
      dicaStatusEl.style.color = "#ff9800";
      setTimeout(() => { resetarVisor(); processandoHU = false; }, 1800);
    } else {
      dicaStatusEl.innerText = `❌ HU ${huCompleta.slice(-5)} não está na lista!`;
      dicaStatusEl.style.color = "#ff5252";
      setTimeout(() => { resetarVisor(); processandoHU = false; }, 1800);
    }
  } catch (e) {
    dicaStatusEl.innerText = "❌ Erro ao comunicar com a Planilha.";
    dicaStatusEl.style.color = "#ff5252";
    setTimeout(() => { resetarVisor(); processandoHU = false; }, 1800);
  }
}

function resetarVisor() {
  miraBox.classList.remove('sucesso');
  numerosLidosEl.innerText = "Aguardando 1789...";
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PADRÃO GS1: 1789... (18 DÍGITOS)";
  dicaStatusEl.innerText = "🟢 Aponte para a HU (1789...)";
  dicaStatusEl.style.color = "#00e676";
}

// Chamadas iniciais
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
