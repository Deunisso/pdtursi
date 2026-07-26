// ⚠️ SUBSTITUA COM A URL DA SUA IMPLANTAÇÃO DO GOOGLE APPS SCRIPT (TERMINANDO EM /exec)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

// Função para imprimir logs na tela (painel de diagnóstico)
function logNaTela(mensagem, tipo = 'normal') {
  const painel = document.getElementById('painel-logs');
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-entry';
  
  let corClasse = '';
  if (tipo === 'erro') corClasse = 'log-erro';
  if (tipo === 'aviso') corClasse = 'log-aviso';
  if (tipo === 'info') corClasse = 'log-info';

  div.innerHTML = `<span class="log-time">[${time}]</span> <span class="${corClasse}">${mensagem}</span>`;
  painel.prepend(div);
  console.log(`[${time}] ${mensagem}`);
}

// Tratamento bruto de texto: limpa caracteres especiais, parênteses (00) e prefixos GS1
function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

// Efeito visual no scanner quando captura uma HU válida (Piscada Verde)
function piscarScannerSucesso() {
  const wrapper = document.getElementById('scanner-container');
  const txt = document.getElementById('scanner-text');
  
  wrapper.classList.add('capturado');
  txt.innerText = "⚡ CÓDIGO CAPTURADO!";
  txt.style.background = "rgba(0, 255, 102, 0.8)";
  txt.style.color = "#000";
  
  setTimeout(() => {
    wrapper.classList.remove('capturado');
    txt.innerText = "🔍 BUSCANDO CÓDIGO DE BARRAS...";
    txt.style.background = "rgba(0, 0, 0, 0.6)";
    txt.style.color = "#fff";
  }, 1200);
}

// Inicializa a aplicação
async function inicializar() {
  await carregarDadosSilenciosamente();
  iniciarCamera();
  
  // Atualiza a lista a cada 10 segundos
  setInterval(carregarDadosSilenciosamente, 10000);
}

// Busca a lista atualizada no Google Sheets
async function carregarDadosSilenciosamente() {
  if (aguardandoProcessamento) return;
  const dot = document.getElementById('sync-dot');
  const texto = document.getElementById('sync-texto');
  dot.className = "dot sincronizando";

  try {
    const urlBusca = `${APPS_SCRIPT_URL}?action=obterLista`;
    const response = await fetch(urlBusca);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const novosDados = await response.json();
    if (JSON.stringify(novosDados) !== JSON.stringify(listaHUs)) {
      listaHUs = novosDados;
      renderizarLista();
    }
    dot.className = "dot";
    texto.innerText = "Sincronizado";
  } catch (err) {
    dot.className = "dot erro";
    texto.innerText = "Offline";
  }
}

// Renderiza os cards das HUs na tela
function renderizarLista() {
  const container = document.getElementById('lista-container');
  container.innerHTML = '';
  let encontrados = 0;

  if (!Array.isArray(listaHUs) || listaHUs.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color:#5f6368;">Nenhuma HU na planilha.</div>';
    return;
  }

  listaHUs.forEach(item => {
    if (item.encontrado) encontrados++;
    const card = document.createElement('div');
    card.id = `hu-${limparCodigoHU(item.hu)}`;
    card.className = `hu-card ${item.encontrado ? 'encontrado' : ''}`;
    card.innerHTML = `
      <div class="hu-info">
        <div class="hu-codigo">HU: ${item.hu}</div>
        <div class="hu-detalhe"><strong>Bin:</strong> ${item.posicao} | <strong>Mat:</strong> ${item.material}</div>
        <div class="hu-detalhe">${item.descricao}</div>
      </div>
      <div><span class="badge">${item.encontrado ? '✓ OK' : 'Pendente'}</span></div>
    `;
    container.appendChild(card);
  });

  const total = listaHUs.length;
  const pct = total > 0 ? Math.round((encontrados / total) * 100) : 0;
  document.getElementById('progresso-texto').innerText = `${encontrados} de ${total} encontrados (${pct}%)`;
  document.getElementById('progress-bar').style.width = `${pct}%`;
}

// Executado quando a câmera lê um código com sucesso
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);
  logNaTela(`Leitura Bruta: "${decodedText}" ➔ Limpo: "${codigoLido}"`, "info");

  // 🧠 BUSCA CORINGA: Cruza os dados independente de ter o AI (00) com 20 dígitos ou apenas os 18 dígitos
  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    
    // 1. Exatamente igual (seja 18 com 18 ou 20 com 20)
    if (huPlanilha === codigoLido) return true;
    
    // 2. Lido tem 20 dígitos (com 00) e Planilha tem 18
    if (codigoLido.length === 20 && codigoLido.startsWith('00') && huPlanilha === codigoLido.substring(2)) return true;
    
    // 3. Planilha tem 20 dígitos (com 00) e Lido veio com 18
    if (huPlanilha.length === 20 && huPlanilha.startsWith('00') && codigoLido === huPlanilha.substring(2)) return true;

    return false;
  });

  if (navigator.vibrate) navigator.vibrate(150);

  if (!itemExistente) {
    mostrarFeedback(`HU ${codigoLido} não está na lista!`, false);
    logNaTela(`ALERTA: HU ${codigoLido} não encontrada na lista atual.`, "aviso");
    return;
  }

  if (itemExistente.encontrado) {
    mostrarFeedback(`HU já foi bipada anteriormente!`, false);
    return;
  }

  // Ativa o flash verde no scanner
  piscarScannerSucesso();

  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  renderizarLista();
  
  const huId = limparCodigoHU(itemExistente.hu);
  const elementoHU = document.getElementById(`hu-${huId}`);
  if (elementoHU) elementoHU.scrollIntoView({ behavior: 'smooth', block: 'center' });

  mostrarFeedback(`HU ${huId} ENCONTRADA!`, true);

  try {
    // Envia para o backend o código exatamente como estava no cadastro para não dar erro de chave
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    const response = await fetch(urlBip);
    const res = await response.json();

    if (res.sucesso) {
      logNaTela(`✓ HU ${itemExistente.hu} gravada com sucesso!`, "normal");
    } else {
      logNaTela(`Erro na planilha: ${res.mensagem}`, "erro");
    }
  } catch (err) {
    logNaTela(`Erro ao enviar bip: ${err.message}`, "erro");
  } finally {
    aguardandoProcessamento = false;
  }
}

// Mostra notificações temporárias na tela
function mostrarFeedback(texto, sucesso) {
  const fb = document.getElementById('feedback');
  fb.innerText = texto;
  fb.className = sucesso ? 'sucesso' : 'erro';
  fb.style.display = 'block';
  setTimeout(() => { fb.style.display = 'none'; }, 3500);
}

// Configura e inicia a câmera com resolução máxima para ler códigos densos (GS1-128 / SSCC)
async function iniciarCamera() {
  html5QrCode = new Html5Qrcode("reader", {
    formatsToSupport: [ 
      Html5QrcodeSupportedFormats.CODE_128, 
      Html5QrcodeSupportedFormats.EAN_13, 
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.ITF 
    ]
  });

  // 🚀 CONFIGURAÇÃO DE ALTA DEFINIÇÃO PARA CÓDIGOS COMPRIDOS
  const config = { 
    fps: 30, // Aumentado para 30 quadros por segundo (mais agilidade)
    aspectRatio: 2.0,
    disableFlip: false,
    // Mira dinâmica: ocupa 88% da largura da tela para caber o código lateralmente sem cortar margens
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const width = Math.floor(viewfinderWidth * 0.88);
      return { width: width, height: 90 };
    },
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true // Usa o leitor de hardware nativo do Android/Chrome se disponível
    }
  };

  // Pedido agressivo de hardware: Força resolução Full HD (1080p) e foco automático contínuo
  const videoConstraints = {
    facingMode: "environment",
    width: { min: 1280, ideal: 1920, max: 3840 },
    height: { min: 720, ideal: 1080, max: 2160 },
    focusMode: "continuous"
  };

  try {
    await html5QrCode.start(videoConstraints, config, onScanSuccess, () => {});
    logNaTela("Scanner HD ativado (otimizado para GS1-128).", "normal");
  } catch (err) {
    logNaTela(`Tentando fallback de câmera simples...`, "aviso");
    try {
      // Se o celular não aceitar o comando Full HD, tenta ligar no modo padrão
      await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
      logNaTela("Scanner padrão ativado.", "normal");
    } catch (errFallback) {
      logNaTela(`Erro ao iniciar câmera: ${errFallback}`, "erro");
      mostrarFeedback("Erro ao acessar a câmera.", false);
    }
  }
}

// Dispara a inicialização assim que a página carrega
window.addEventListener('DOMContentLoaded', inicializar);
