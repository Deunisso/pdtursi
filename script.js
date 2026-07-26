// =================================================================
// ⚠️ CONFIGURAÇÃO: Insira a sua URL do Google Apps Script
// =================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

// Carregamento dinâmico da biblioteca ZXing (Leitor de Código de Barras)
(function carregarZXing() {
  if (!window.ZXing) {
    const script = document.createElement('script');
    script.src = "https://unpkg.com/@zxing/library@latest";
    script.async = true;
    document.head.appendChild(script);
  }
})();

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
let codeReader = null;
let lanternaLigada = false;
let listaPendentesGlobal = [];

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

// Controle da Lanterna do Celular
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

// Higieniza strings para extrair apenas números
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Busca e Atualiza o Dashboard e as HUs na Planilha
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

// Exibe na lista inferior os 5 últimos dígitos de cada HU pendente
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

// Inicializa ZXing + Tesseract Otimizado para Números (1789...)
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Inicializando leitor WMS/HU...";
  
  if (window.ZXing) {
    codeReader = new ZXing.BrowserMultiFormatReader();
  }

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    // Permite estritamente os dígitos e a palavra WMS
    tessedit_char_whitelist: '0123456789WMSwms',
    // PSM 6: Trata a imagem como um bloco de texto uniforme
    tessedit_pageseg_mode: '6',
  });

  dicaStatusEl.innerText = "🟢 Enquadre a etiqueta WMS / 1789";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraHibrida();
}

// Loop Principal de Leitura: Ajuste Fino de Imagem + Reconhecimento Numérico
async function loopLeituraHibrida() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraHibrida, 120);
    return;
  }

  try {
    miraBox.classList.add('lendo');
    
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    if (vw > 0 && vh > 0) {
      // Região de corte centralizada (Pega o topo WMS e o SSCC 1789)
      const CROP_W = vw * 0.90;
      const CROP_H = vh * 0.30; 
      const CROP_X = vw * 0.05;
      const CROP_Y = vh * 0.28;

      // Upscaling 2.5x para aumentar os DPIs dos números e evitar confusão de 3, 8, 9 e 0
      const SCALE = 2.5;
      canvas.width = CROP_W * SCALE;
      canvas.height = CROP_H * SCALE;
      const ctx = canvas.getContext('2d');

      // Aplica filtro de nitidez nativo de alta velocidade
      ctx.filter = 'grayscale(100%) contrast(220%) brightness(105%)';
      ctx.drawImage(video, CROP_X, CROP_Y, CROP_W, CROP_H, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';

      // =================================================================
      // 📊 PRIORIDADE 1: CÓDIGO DE BARRAS (ZXing)
      // =================================================================
      if (codeReader && !processandoHU) {
        try {
          const barcodeResult = await codeReader.decodeFromCanvas(canvas);
          if (barcodeResult && barcodeResult.text) {
            const textoBarras = extrairNumeros(barcodeResult.text);
            const matchBarras = textoBarras.match(/1789\d{14}/);

            if (matchBarras) {
              processandoHU = true;
              modoLeituraEl.innerText = "📊 CÓDIGO DE BARRAS DETECTADO";
              
              spanNumsEstabilizados.innerText = matchBarras[0];
              spanNumsAtivos.innerText = "";
              
              contadorDigitosEl.innerText = "18 / 18";
              dicaStatusEl.innerText = "⚡ BARRAS LIDO COM SUCESSO!";
              dicaStatusEl.style.color = "#00e676";

              miraBox.classList.remove('lendo');
              miraBox.classList.add('sucesso');
              
              await verificarHU(matchBarras[0]);
              return;
            }
          }
        } catch (e) {}
      }

      if (processandoHU) return;

      // =================================================================
      // 🏷️ PRIORIDADE 2: OCR NUMÉRICO ESTREITO (BUSCA 1789 + 14 DÍGITOS)
      // =================================================================
      const result = await workerOCR.recognize(canvas);
      const rawText = result.data.text || "";

      const temWMS = /WMS/i.test(rawText);
      const apenasNumeros = extrairNumeros(rawText);

      // Validação exata do padrão GS1/SSCC (1789 + 14 dígitos)
      const REGEX_HU_18 = /1789\d{14}/;
      const matchOCR = apenasNumeros.match(REGEX_HU_18);
      let huEncontrada = matchOCR ? matchOCR[0] : null;

      if (huEncontrada && !processandoHU) {
        processandoHU = true;

        if (temWMS) {
          modoLeituraEl.innerText = "🏷️ ETIQUETA WMS DETECTADA";
          dicaStatusEl.innerText = "✓ WMS & HU VALIDADA!";
        } else {
          modoLeituraEl.innerText = "🔢 LEITURA DIRETA (1789)";
          dicaStatusEl.innerText = "✓ HU COMPLETA ENCONTRADA!";
        }

        spanNumsEstabilizados.innerText = huEncontrada;
        spanNumsAtivos.innerText = "";
        
        contadorDigitosEl.innerText = "18 / 18";
        dicaStatusEl.style.color = "#00e676";

        miraBox.classList.remove('lendo');
        miraBox.classList.add('sucesso');

        await verificarHU(huEncontrada);
        return;

      } else if (!processandoHU) {
        const indexInicio = apenasNumeros.indexOf('1789');

        if (temWMS) {
          modoLeituraEl.innerText = "🏷️ WMS DETECTADO - Buscando 1789...";
        } else {
          modoLeituraEl.innerText = "PADRÃO GS1: 1789... (18 DÍGITOS)";
        }

        if (indexInicio !== -1) {
          const parcialLida = apenasNumeros.substring(indexInicio, indexInicio + 18);
          const totalLido = parcialLida.length;

          let estabilizado = parcialLida.substring(0, Math.min(4, totalLido)); // '1789'
          let ativo = parcialLida.substring(estabilizado.length);

          let lixoSimulado = '';
          if (totalLido < 18) {
            const digitosFaltantes = 18 - totalLido;
            for (let k = 0; k < digitosFaltantes; k++) {
              lixoSimulado += Math.floor(Math.random() * 10).toString();
            }
          }

          spanNumsEstabilizados.innerText = estabilizado;
          spanNumsAtivos.innerText = ativo + lixoSimulado;

          contadorDigitosEl.innerText = `${totalLido} / 18`;
          dicaStatusEl.innerText = temWMS ? "🏷️ WMS OK! Decifrando 1789..." : "👁️ Identificando Sequência 1789...";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          spanNumsEstabilizados.innerText = "Aguardando";
          spanNumsAtivos.innerText = "...";
          
          contadorDigitosEl.innerText = "0 / 18";
          dicaStatusEl.innerText = temWMS ? "🏷️ WMS Detectado! Centralize os números" : "🟢 Enquadre a etiqueta WMS / 1789";
          dicaStatusEl.style.color = temWMS ? "#ffd700" : "#00e676";
        }
      }
    }
    miraBox.classList.remove('lendo');
  } catch (e) {
    console.error("Erro no loop:", e);
  }

  if (!processandoHU) {
    setTimeout(loopLeituraHibrida, 120);
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
      }, 1500);

    } else if (data.status === "ja_lido") {
      dicaStatusEl.innerText = `⚠️ HU ${huCompleta.slice(-5)} já foi lida!`;
      dicaStatusEl.style.color = "#ff9800";
      setTimeout(() => { resetarVisor(); }, 1500);
    } else {
      dicaStatusEl.innerText = `❌ HU ${huCompleta.slice(-5)} não está na lista!`;
      dicaStatusEl.style.color = "#ff5252";
      setTimeout(() => { resetarVisor(); }, 1500);
    }
  } catch (e) {
    dicaStatusEl.innerText = "❌ Erro de conexão com a Planilha.";
    dicaStatusEl.style.color = "#ff5252";
    setTimeout(() => { resetarVisor(); }, 1500);
  }
}

// Reseta a Interface e DESTRAVA o Leitor
function resetarVisor() {
  miraBox.classList.remove('sucesso');
  
  if (spanNumsEstabilizados && spanNumsAtivos) {
    spanNumsEstabilizados.innerText = "Aguardando";
    spanNumsAtivos.innerText = "...";
  }
  
  contadorDigitosEl.innerText = "0 / 18";
  modoLeituraEl.innerText = "PADRÃO GS1: 1789... (18 DÍGITOS)";
  dicaStatusEl.innerText = "🟢 Enquadre a etiqueta WMS / 1789";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // LIBERA A CÂMERA E REINICIA O LOOP
  processandoHU = false;
  setTimeout(loopLeituraHibrida, 200);
}

// Atualização Inicial do Dashboard
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
