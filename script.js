// =================================================================
// ⚠️ CONFIGURAÇÃO: URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Mapeamento dos elementos do DOM
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

// Variáveis Globais
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

// Extrai estritamente números
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Atualização de Dashboard
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
    console.error("Erro ao atualizar dashboard:", e);
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
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
})
.then(stream => {
  video.srcObject = stream;
  iniciarSistemaLeitura();
})
.catch(err => {
  dicaStatusEl.innerText = "❌ Permita o acesso à câmera.";
  dicaStatusEl.style.color = "#ff5252";
});

// Inicialização Tesseract Otimizada
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando IA...";

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789', // Apenas números
    tessedit_pageseg_mode: '6',           // Trata como bloco de texto
  });

  dicaStatusEl.innerText = "🟢 Alinhe os 18 dígitos do 1789 na mira";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// Loop de Leitura com Truncagem Focada
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
      // Recorte mais focado no meio (evita ler laterais)
      const CROP_W = vw * 0.70;  
      const CROP_H = vh * 0.20;  
      const CROP_X = vw * 0.15;  
      const CROP_Y = vh * 0.20;  

      const SCALE = 2.0;
      canvas.width = CROP_W * SCALE;
      canvas.height = CROP_H * SCALE;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, CROP_X, CROP_Y, CROP_W, CROP_H, 0, 0, CROP_W * SCALE, CROP_H * SCALE);

      // Tratamento Suave em Grayscale (Sem estouro de contraste)
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = data[i + 1] = data[i + 2] = avg; // Escala de cinza limpa
      }
      ctx.putImageData(imgData, 0, 0);

      // Leitura Tesseract
      const result = await workerOCR.recognize(canvas);
      const numerosPuros = extrairNumeros(result.data.text || "");

      // Procura o padrão 1789 com 18 dígitos no total
      const match = numerosPuros.match(/1789\d{14}/);

      if (match && !processandoHU) {
        const huEncontrada = match[0];
        processandoHU = true;

        modoLeituraEl.innerText = "🔒 HU CONFIRMADA!";
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

          modoLeituraEl.innerText = "LENDO DÍGITOS...";
          dicaStatusEl.innerText = "👁️ Mantenha firme na linha do 1789!";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          spanNumsEstabilizados.innerText = "";
          spanNumsAtivos.innerText = "1789????????????";
          contadorDigitosEl.innerText = "0 / 18";

          modoLeituraEl.innerText = "AGUARDANDO CÓDIGO 1789...";
          dicaStatusEl.innerText = "🟢 Alinhe o número 1789 na mira";
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

// Comunicação com o Google Sheets
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
  modoLeituraEl.innerText = "AGUARDANDO CÓDIGO 1789...";
  dicaStatusEl.innerText = "🟢 Alinhe o número 1789 na mira";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  processandoHU = false;
  setTimeout(loopLeituraOCR, 100);
}

// Start
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
