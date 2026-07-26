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

function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

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

// Câmera HD
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

// Inicialização Sem Trava de Whitelist (Permite leitura natural de longe)
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Modo Longa Distância Ativado...";

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_pageseg_mode: '11', // PSM 11: Detecta textos soltos de longe sem se perder na estrutura da tabela
  });

  dicaStatusEl.innerText = "🟢 Aponta para a etiqueta (Qualquer distância)";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// Loop com Ampla Visão
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
      // Captura ampla para ler mesmo se a etiqueta estiver pequena/distante
      const CROP_W = vw * 0.90;  
      const CROP_H = vh * 0.70;  
      const CROP_X = vw * 0.05;  
      const CROP_Y = vh * 0.15;  

      canvas.width = CROP_W;
      canvas.height = CROP_H;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, CROP_X, CROP_Y, CROP_W, CROP_H, 0, 0, canvas.width, canvas.height);

      // Leitura nativa
      const result = await workerOCR.recognize(canvas);
      const textoBruto = result.data.text || "";
      const numerosPuros = extrairNumeros(textoBruto);

      // PROCURA O PADRÃO: 1789 + 14 números (Total 18)
      const match = numerosPuros.match(/1789\d{14}/);

      if (match && !processandoHU) {
        const huEncontrada = match[0];
        processandoHU = true;

        modoLeituraEl.innerText = "🔒 HU LIDA COM SUCESSO!";
        spanNumsEstabilizados.innerText = huEncontrada;
        spanNumsAtivos.innerText = "";
        contadorDigitosEl.innerText = "18 / 18";

        dicaStatusEl.innerText = "✓ LEITURA CONCLUÍDA!";
        dicaStatusEl.style.color = "#00e676";

        miraBox.classList.remove('lendo');
        miraBox.classList.add('sucesso');

        await verificarHU(huEncontrada);
        return;

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
          dicaStatusEl.innerText = "🟢 Aponta para a etiqueta";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
    miraBox.classList.remove('lendo');
  } catch (e) {
    console.error("Erro no OCR:", e);
  }

  if (!processandoHU) {
    setTimeout(loopLeituraOCR, 80);
  }
}

// Comunicação Planilha
async function verificarHU(huCompleta) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ hu: huCompleta })
    });
    const data = await res.json();

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
      setTimeout(() => { resetarVisor(); }, 1400);
    } else {
      dicaStatusEl.innerText = `❌ HU ${huCompleta.slice(-5)} não está na lista!`;
      dicaStatusEl.style.color = "#ff5252";
      setTimeout(() => { resetarVisor(); }, 1400);
    }
  } catch (e) {
    dicaStatusEl.innerText = "❌ Erro de conexão com a Planilha.";
    dicaStatusEl.style.color = "#ff5252";
    setTimeout(() => { resetarVisor(); }, 1400);
  }
}

function resetarVisor() {
  miraBox.classList.remove('sucesso');
  
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PROCURANDO ETIQUETA...";
  dicaStatusEl.innerText = "🟢 Aponta para a etiqueta";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  processandoHU = false;
  setTimeout(loopLeituraOCR, 100);
}

// Start
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
