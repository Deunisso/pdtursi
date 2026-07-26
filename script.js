// =================================================================
// ⚠️ CONFIGURAÇÃO: Insira a sua URL do Google Apps Script
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

// 🧠 SISTEMA DE CACHE DE ACUMULAÇÃO DIGIT-BY-DIGIT
let cacheDigitos = new Array(18).fill(null); 
let historicoPosicoes = Array.from({ length: 18 }, () => ({}));
let tempoUltimaAtualizacao = Date.now();

// Som de Bip ao confirmar a HU
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

// 🔦 Controle da Lanterna Universal
async function alternarLanterna() {
  const stream = video.srcObject;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  try {
    const novoEstado = !lanternaLigada;
    await track.applyConstraints({
      advanced: [{ torch: novoEstado }]
    });

    lanternaLigada = novoEstado;
    if (btnLanterna) {
      btnLanterna.classList.toggle('ativo', lanternaLigada);
    }
  } catch (e) {
    alert("Lanterna não suportada neste dispositivo.");
  }
}

if (btnLanterna) {
  btnLanterna.addEventListener('click', alternarLanterna);
}

// Extrai estritamente caracteres numéricos
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Limpa o cache acumulativo
function resetarCacheAcumulativo() {
  cacheDigitos = new Array(18).fill(null);
  historicoPosicoes = Array.from({ length: 18 }, () => ({}));
}

// Busca e Atualiza o Dashboard
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

// Exibe na lista inferior os 5 últimos dígitos
function renderizarListaPendentes(lista) {
  listaPendentesGlobal = lista.map(item => extrairNumeros(item)).filter(item => item.length > 0);
  
  if (badgeContador) {
    badgeContador.innerText = `${listaPendentesGlobal.length} RESTANTES`;
  }

  if (listaPendentesGlobal.length === 0) {
    containerListaHus.innerHTML = `
      <div class="lista-vazia">
        <span>🎉 PARABÉNS!</span>
        <span>Todas as HUs foram bipadas com sucesso.</span>
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

// Remove o card visual ao bipar
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

// Ativa a Câmera
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

// Inicialização do Tesseract
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando IA com Cache por Dígito...";

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789', 
    tessedit_pageseg_mode: '7', // Modo linha contínua de números
  });

  dicaStatusEl.innerText = "🟢 Alinhe os números na mira";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// Loop de Leitura com Cache Progressivo
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
      // Recorte focado na linha dos números
      const CROP_W = vw * 0.75;  
      const CROP_H = vh * 0.18;  
      const CROP_X = vw * 0.02;  
      const CROP_Y = vh * 0.20;  

      const SCALE = 2.0;
      canvas.width = CROP_W * SCALE;
      canvas.height = CROP_H * SCALE;
      
      const ctx = canvas.getContext('2d');

      ctx.drawImage(
        video, 
        CROP_X, CROP_Y, CROP_W, CROP_H, 
        0, 0, CROP_W * SCALE, CROP_H * SCALE
      );

      // Leitura OCR
      const result = await workerOCR.recognize(canvas);
      const numerosCapturados = extrairNumeros(result.data.text || "");

      // Procura a ocorrência de 1789
      const index1789 = numerosCapturados.indexOf('1789');

      if (index1789 !== -1) {
        const blocoNumerico = numerosCapturados.substring(index1789, index1789 + 18);

        // 🛡️ SE MUDOU A ETIQUETA/HU, RESETA O CACHE
        if (cacheDigitos[0] && cacheDigitos[0] !== '1') {
          resetarCacheAcumulativo();
        }

        // 🧠 PROCESSAMENTO DO CACHE POR POSIÇÃO
        for (let i = 0; i < blocoNumerico.length; i++) {
          const digitoLido = blocoNumerico[i];

          // Se essa posição ainda não estiver 100% fixada
          if (!cacheDigitos[i]) {
            historicoPosicoes[i][digitoLido] = (historicoPosicoes[i][digitoLido] || 0) + 1;

            // Se o mesmo dígito apareceu 2x na mesma posição, FIXA NO CACHE!
            if (historicoPosicoes[i][digitoLido] >= 2) {
              cacheDigitos[i] = digitoLido;
            }
          }
        }

        tempoUltimaAtualizacao = Date.now();

        // CONSTRÓI A STRING FINAL UNINDO O CACHE + O QUE FOI LIDO
        let huResultado = "";
        let confirmadosCount = 0;

        for (let i = 0; i < 18; i++) {
          if (cacheDigitos[i]) {
            huResultado += cacheDigitos[i];
            confirmadosCount++;
          } else if (i < blocoNumerico.length) {
            huResultado += blocoNumerico[i]; // Dígito temporário/ainda não confirmado
          }
        }

        // Atualiza a tela com o progresso do cache
        modoLeituraEl.innerText = `CACHE INTELIGENTE: ${confirmadosCount}/18 DÍGITOS FIXOS`;
        
        spanNumsEstabilizados.innerText = huResultado.substring(0, confirmadosCount);
        spanNumsAtivos.innerText = huResultado.substring(confirmadosCount);
        contadorDigitosEl.innerText = `${huResultado.length} / 18`;

        dicaStatusEl.innerText = "🧠 Mantenha a câmera firme...";
        dicaStatusEl.style.color = "#ffd700";

        // 🎉 SE COMPLETOU OS 18 DÍGITOS NO CACHE -> APROVA A HU!
        if (cacheDigitos.every(d => d !== null) && cacheDigitos.length === 18 && !processandoHU) {
          const huCompleta = cacheDigitos.join('');
          processandoHU = true;

          modoLeituraEl.innerText = "🔒 HU COMPLETA E CONFIRMADA!";
          dicaStatusEl.innerText = "✓ LEITURA 100% PRECISA!";
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
        // Se ficou 1.5s sem ver o padrão 1789, limpa o cache acumulado
        if (Date.now() - tempoUltimaAtualizacao > 1500) {
          resetarCacheAcumulativo();
          spanNumsEstabilizados.innerText = "Aguardando";
          spanNumsAtivos.innerText = "...";
          contadorDigitosEl.innerText = "0 / 18";
          
          modoLeituraEl.innerText = "MODO IA: CACHE DINÂMICO";
          dicaStatusEl.innerText = "🟢 Posicione o número '1789...' na mira";
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

// Envia a HU para a Planilha e Reseta
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

// Reseta a Interface e Limpa o Cache
function resetarVisor() {
  miraBox.classList.remove('sucesso');
  
  if (spanNumsEstabilizados && spanNumsAtivos) {
    spanNumsEstabilizados.innerText = "Aguardando";
    spanNumsAtivos.innerText = "...";
  }
  
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "MODO IA: CACHE DINÂMICO";
  dicaStatusEl.innerText = "🟢 Posicione o número '1789...' na mira";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  resetarCacheAcumulativo();
  processandoHU = false;
  setTimeout(loopLeituraOCR, 100);
}

// Atualização Inicial do Dashboard
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
