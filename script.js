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

// Variáveis Globais de Controle
let ocrAtivo = false;
let processandoHU = false;
let workerOCR = null;
let lanternaLigada = false;
let listaPendentesGlobal = [];

// CACHE ACUMULATIVO
let cacheDigitos = new Array(18).fill(null); 
let historicoPosicoes = Array.from({ length: 18 }, () => ({}));
let tempoUltimaAtualizacao = Date.now();

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

// 🔦 Controle da Lanterna
async function alternarLanterna() {
  const stream = video.srcObject;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  try {
    lanternaLigada = !lanternaLigada;
    await track.applyConstraints({
      advanced: [{ torch: lanternaLigada }]
    });

    if (btnLanterna) {
      btnLanterna.classList.toggle('ativo', lanternaLigada);
    }
  } catch (e) {
    alert("Lanterna não suportada neste dispositivo.");
  }
}

// Extrai apenas números
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Reseta o cache de dígitos
function resetarCacheAcumulativo() {
  cacheDigitos = new Array(18).fill(null);
  historicoPosicoes = Array.from({ length: 18 }, () => ({}));
}

// Atualiza Dashboard
async function atualizarDashboard() {
  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    
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

// Lista de Pendentes
function renderizarListaPendentes(lista) {
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

  containerListaHus.innerHTML = listaPendentesGlobal.map(huCompleta => {
    const ultimos5 = huCompleta.length >= 5 ? huCompleta.slice(-5) : huCompleta;
    return `
      <div class="hu-chip" data-hu="${huCompleta}">
        <span>…${ultimos5}</span>
      </div>`;
  }).join('');
}

// Remove card ao bipar
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
        
        if (badgeContador) {
          badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
        }

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

// Inicia Câmera
navigator.mediaDevices.getUserMedia({ 
  video: { 
    facingMode: "environment", 
    width: { ideal: 1920 }, 
    height: { ideal: 1080 } 
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

// Inicializa Tesseract SEM WHITELIST RÍGIDA
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando leitor com Âncora WMS...";

  workerOCR = await Tesseract.createWorker('eng');
  // Sem restrição de letras/números para conseguir ler a marcação WMS!
  await workerOCR.setParameters({
    tessedit_pageseg_mode: '6', // Trata como bloco de texto estruturado
  });

  dicaStatusEl.innerText = "🟢 Enquadre o WMS e o código na mira";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// Loop com Busca por Âncora WMS + Regex de 18 dígitos
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 60);
    return;
  }

  try {
    miraBox.classList.add('lendo');
    
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    if (vw > 0 && vh > 0) {
      // Recorte amplo pegando desde o WMS até os números
      const CROP_W = vw * 0.85;  
      const CROP_H = vh * 0.35;  
      const CROP_X = vw * 0.02;  
      const CROP_Y = vh * 0.12;  

      const SCALE = 1.5;
      canvas.width = CROP_W * SCALE;
      canvas.height = CROP_H * SCALE;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        video, 
        CROP_X, CROP_Y, CROP_W, CROP_H, 
        0, 0, CROP_W * SCALE, CROP_H * SCALE
      );

      // Reconhecimento do texto completo na área
      const result = await workerOCR.recognize(canvas);
      const textoBruto = result.data.text || "";

      // 🔍 TENTA ENCONTRAR A ÂNCORA 'WMS' OU NÚMERO 1789
      const temWMS = /WMS|WM5|VMS/i.test(textoBruto);
      const numerosApenas = extrairNumeros(textoBruto);
      const index1789 = numerosApenas.indexOf('1789');

      if (index1789 !== -1) {
        const blocoLido = numerosApenas.substring(index1789, index1789 + 18);

        // Processa o Cache
        for (let i = 0; i < blocoLido.length; i++) {
          const char = blocoLido[i];
          if (!cacheDigitos[i]) {
            historicoPosicoes[i][char] = (historicoPosicoes[i][char] || 0) + 1;
            
            if (historicoPosicoes[i][char] >= 2) {
              cacheDigitos[i] = char;
            }
          }
        }

        tempoUltimaAtualizacao = Date.now();

        let textoConfirmado = "";
        let textoPendente = "";
        let contagemConfirmados = 0;

        for (let i = 0; i < 18; i++) {
          if (cacheDigitos[i]) {
            textoConfirmado += cacheDigitos[i];
            contagemConfirmados++;
          } else if (i < blocoLido.length) {
            textoPendente += blocoLido[i]; 
          } else {
            textoPendente += "?"; 
          }
        }

        modoLeituraEl.innerText = temWMS ? "🎯 ÂNCORA WMS LOCALIZADA" : "BUSCANDO 1789...";
        spanNumsEstabilizados.innerText = textoConfirmado;
        spanNumsAtivos.innerText = textoPendente;
        contadorDigitosEl.innerText = `${contagemConfirmados} / 18`;

        dicaStatusEl.innerText = "👁️ Mantenha firme na etiqueta...";
        dicaStatusEl.style.color = "#ffd700";

        // Confirmação final dos 18 dígitos
        if (cacheDigitos.every(d => d !== null) && !processandoHU) {
          const huCompleta = cacheDigitos.join('');
          processandoHU = true;

          modoLeituraEl.innerText = "🔒 HU CONFIRMADA!";
          dicaStatusEl.innerText = "✓ LEITURA CONCLUÍDA!";
          dicaStatusEl.style.color = "#00e676";

          spanNumsEstabilizados.innerText = huCompleta;
          spanNumsAtivos.innerText = "";
          contadorDigitosEl.innerText = "18 / 18";

          miraBox.classList.remove('lendo');
          miraBox.classList.add('sucesso');

          await verificarHU(huCompleta);
          return;
        }

      } else {
        if (Date.now() - tempoUltimaAtualizacao > 1200) {
          resetarCacheAcumulativo();
          spanNumsEstabilizados.innerText = "";
          spanNumsAtivos.innerText = "1789????????????";
          contadorDigitosEl.innerText = "0 / 18";
          
          modoLeituraEl.innerText = temWMS ? "🎯 WMS DETECTADO! Alinhe o 1789..." : "LEITOR: MIRA NO WMS / 1789";
          dicaStatusEl.innerText = "🟢 Enquadre o WMS e o código na mira";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
    miraBox.classList.remove('lendo');
  } catch (e) {
    console.error("Erro no loop OCR:", e);
  }

  if (!processandoHU) {
    setTimeout(loopLeituraOCR, 60);
  }
}

// Valida a HU na Planilha
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

// Reseta o Visor
function resetarVisor() {
  miraBox.classList.remove('sucesso');
  
  spanNumsEstabilizados.innerText = "";
  spanNumsAtivos.innerText = "1789????????????";
  
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "LEITOR: MIRA NO WMS / 1789";
  dicaStatusEl.innerText = "🟢 Enquadre o WMS e o código na mira";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  resetarCacheAcumulativo();
  processandoHU = false;
  setTimeout(loopLeituraOCR, 100);
}

// Inicialização
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
