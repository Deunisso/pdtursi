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

// Tratador de código GS1-128 / SSCC
function limparCodigoHU(textoRaw) {
  let limpo = textoRaw.replace(/[^\d]/g, '');
  if (limpo.length === 20 && limpo.startsWith('00')) {
    limpo = limpo.substring(2);
  }
  return limpo;
}

// Efeito visual no scanner quando captura uma HU válida
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
    card.id = `hu-${item.hu}`;
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
  logNaTela(`Leitura Bruta: "${decodedText}" ➔ HU Tratada: "${codigoLido}"`, "info");

  const itemExistente = listaHUs.find(i => String(i.hu).trim() === codigoLido);

  if (navigator.vibrate) navigator.vibrate(150);

  if (!itemExistente) {
    mostrarFeedback(`HU ${codigoLido} não está na lista!`, false);
    logNaTela(`ALERTA: HU ${codigoLido} não encontrada.`, "aviso");
    return;
  }

  if (itemExistente.encontrado) {
    mostrarFeedback(`HU ${codigoLido} já foi bipada!`, false);
    return;
  }

  // Ativa o feedback visual no leitor (laser verde)
  piscarScannerSucesso();

  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  renderizarLista();
  
  const elementoHU = document.getElementById(`hu-${codigoLido}`);
  if (elementoHU) elementoHU.scrollIntoView({ behavior: 'smooth', block: 'center' });

  mostrarFeedback(`HU ${codigoLido} ENCONTRADA!`, true);

  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(codigoLido)}`;
    const response = await fetch(urlBip);
    const res = await response.json();

    if (res.sucesso) {
      logNaTela(`✓ HU ${codigoLido} gravada no Sheets com sucesso!`, "normal");
    } else {
      logNaTela(`Erro na planilha: ${res.mensagem}`, "erro");
    }
  } catch (err) {
    logNaTela(`Erro ao enviar bip: ${err.message}`, "erro");
  } finally {
    aguardandoProcessamento = false;
  }
}

// Mostra notificações temporárias
function mostrarFeedback(texto, sucesso) {
  const fb = document.getElementById('feedback');
  fb.innerText = texto;
  fb.className = sucesso ? 'sucesso' : 'erro';
  fb.style.display = 'block';
  setTimeout(() => { fb.style.display = 'none'; }, 3500);
}

// Configura e inicia a câmera
async function iniciarCamera() {
  html5QrCode = new Html5Qrcode("reader", {
    formatsToSupport: [ 
      Html5QrcodeSupportedFormats.CODE_128, 
      Html5QrcodeSupportedFormats.EAN_13, 
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.ITF 
    ]
  });

  const config = { 
    fps: 20, 
    qrbox: { width: 280, height: 80 },
    aspectRatio: 2.0,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true 
    }
  };

  try {
    await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
    logNaTela("Scanner visual em modo tarja iniciado.", "normal");
  } catch (err) {
    logNaTela(`Erro ao iniciar câmera: ${err}`, "erro");
    mostrarFeedback("Erro ao acessar a câmera.", false);
  }
}

// Dispara a inicialização assim que a página carrega
window.addEventListener('DOMContentLoaded', inicializar);
