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

// 🔦 Controle da Lanterna Universal (Android/Chrome e iOS/Safari)
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
    console.error("Erro ao ativar lanterna:", e);
    alert("A lanterna não é suportada ou está sendo bloqueada neste dispositivo/navegador.");
  }
}

if (btnLanterna) {
  btnLanterna.addEventListener('click', alternarLanterna);
}

// Extrai estritamente caracteres numéricos
function extrairNumeros(str) {
  return String(str || '').replace(/[^\d]/g, '').trim();
}

// Algoritmo de Binarização Pura (Preto e Branco sem ruídos)
function binarizarImagem(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const limiar = 135; // Corte de luminância

  for (let i = 0; i < data.length; i += 4) {
    const luminancia = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const cor = luminancia < limiar ? 0 : 255;
    data[i] = cor;     // Red
    data[i + 1] = cor; // Green
    data[i + 2] = cor; // Blue
  }
  ctx.putImageData(imgData, 0, 0);
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

// Inicialização do Tesseract OCR
async function iniciarSistemaLeitura() {
  dicaStatusEl.innerText = "⚡ Calibrando leitor de números...";

  workerOCR = await Tesseract.createWorker('eng');
  await workerOCR.setParameters({
    tessedit_char_whitelist: '0123456789', // Apenas dígitos
    tessedit_pageseg_mode: '7',            // PSM 7: Trata a imagem como uma ÚNICA LINHA de texto
  });

  dicaStatusEl.innerText = "🟢 Posicione os números '1789...' na mira";
  dicaStatusEl.style.color = "#00e676";
  ocrAtivo = true;

  loopLeituraOCR();
}

// Loop Principal focado 100% em OCR Numérico
async function loopLeituraOCR() {
  if (!ocrAtivo || processandoHU) {
    setTimeout(loopLeituraOCR, 100);
    return;
  }

  try {
    miraBox.classList.add('lendo');
    
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    if (vw > 0 && vh > 0) {
      // 🎯 CORTE CIRÚRGICO DA LINHA DO SSCC (1789...)
      const CROP_W = vw * 0.52;  // Metade esquerda da etiqueta (evita QUANTITY e BATCH)
      const CROP_H = vh * 0.18;  // Focado apenas na linha do 1789
      const CROP_X = vw * 0.04;  // Margem esquerda
      const CROP_Y = vh * 0.24;  // Abaixo do WMS e acima do MATERIAL

      const SCALE = 2.2;
      const PADDING = 20;

      canvas.width = (CROP_W * SCALE) + (PADDING * 2);
      canvas.height = (CROP_H * SCALE) + (PADDING * 2);
      
      const ctx = canvas.getContext('2d');
      
      // Fundo branco
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Desenha a imagem recortada
      ctx.drawImage(
        video, 
        CROP_X, CROP_Y, CROP_W, CROP_H, 
        PADDING, PADDING, CROP_W * SCALE, CROP_H * SCALE
      );

      // Aplica processamento de alto contraste Preto e Branco
      binarizarImagem(ctx, canvas.width, canvas.height);

      // Executa a leitura visual
      const result = await workerOCR.recognize(canvas);
      const apenasNumeros = extrairNumeros(result.data.text || "");

      // Validação: precisa começar com 1789 e ter exatamente 18 dígitos
      const REGEX_SSCC_EXATO = /1789\d{14}/;
      const matchOCR = apenasNumeros.match(REGEX_SSCC_EXATO);

      if (matchOCR && matchOCR[0].length === 18 && !processandoHU) {
        const huValida = matchOCR[0];
        processandoHU = true;

        modoLeituraEl.innerText = "🔢 SSCC 18 DÍGITOS DETECTADO";
        dicaStatusEl.innerText = "✓ HU VÁLIDA ENCONTRADA!";

        spanNumsEstabilizados.innerText = huValida;
        spanNumsAtivos.innerText = "";
        
        contadorDigitosEl.innerText = "18 / 18";
        dicaStatusEl.style.color = "#00e676";

        miraBox.classList.remove('lendo');
        miraBox.classList.add('sucesso');

        await verificarHU(huValida);
        return;

      } else if (!processandoHU) {
        const indexInicio = apenasNumeros.indexOf('1789');

        modoLeituraEl.innerText = "PADRÃO SSCC: 1789... (18 DÍGITOS)";

        if (indexInicio !== -1) {
          const parcialLida = apenasNumeros.substring(indexInicio, indexInicio + 18);
          const totalLido = parcialLida.length;

          let estabilizado = parcialLida.substring(0, Math.min(4, totalLido)); // Mostra '1789'
          let ativo = parcialLida.substring(estabilizado.length);

          let mascaraRestante = '';
          if (totalLido < 18) {
            const faltam = 18 - totalLido;
            for (let k = 0; k < faltam; k++) {
              mascaraRestante += Math.floor(Math.random() * 10).toString();
            }
          }

          spanNumsEstabilizados.innerText = estabilizado;
          spanNumsAtivos.innerText = ativo + mascaraRestante;

          contadorDigitosEl.innerText = `${totalLido} / 18`;
          dicaStatusEl.innerText = "👁️ Lendo números 1789...";
          dicaStatusEl.style.color = "#ffd700";
        } else {
          spanNumsEstabilizados.innerText = "Aguardando";
          spanNumsAtivos.innerText = "...";
          
          contadorDigitosEl.innerText = "0 / 18";
          dicaStatusEl.innerText = "🟢 Enquadre o número '1789...' na mira";
          dicaStatusEl.style.color = "#00e676";
        }
      }
    }
    miraBox.classList.remove('lendo');
  } catch (e) {
    console.error("Erro no loop OCR:", e);
  }

  if (!processandoHU) {
    setTimeout(loopLeituraOCR, 100);
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
  modoLeituraEl.innerText = "PADRÃO SSCC: 1789... (18 DÍGITOS)";
  dicaStatusEl.innerText = "🟢 Enquadre o número '1789...' na mira";
  dicaStatusEl.style.color = "#00e676";
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // LIBERA A CÂMERA E REINICIA O LOOP
  processandoHU = false;
  setTimeout(loopLeituraOCR, 200);
}

// Atualização Inicial do Dashboard
atualizarDashboard();
setInterval(atualizarDashboard, 5000);
