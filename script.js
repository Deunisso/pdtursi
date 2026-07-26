// ⚠️ URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

// Remove caracteres especiais deixando apenas os dígitos do código
function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

async function inicializar() {
  await carregarDadosSilenciosamente();
  iniciarCamera();
  // Sincroniza a contagem a cada 10 segundos
  setInterval(carregarDadosSilenciosamente, 10000);
}

// Busca a lista para calcular quantos faltam
async function carregarDadosSilenciosamente() {
  if (aguardandoProcessamento) return;
  const dot = document.getElementById('sync-dot');
  const texto = document.getElementById('sync-texto');
  dot.className = "dot sincronizando";

  try {
    const urlBusca = `${APPS_SCRIPT_URL}?action=obterLista`;
    const response = await fetch(urlBusca);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    listaHUs = await response.json();
    atualizarContadores();

    dot.className = "dot";
    texto.innerText = "Sincronizado";
  } catch (err) {
    dot.className = "dot erro";
    texto.innerText = "Offline";
  }
}

// Atualiza o contador flutuante do topo da tela
function atualizarContadores() {
  if (!Array.isArray(listaHUs)) return;

  const total = listaHUs.length;
  const encontrados = listaHUs.filter(item => item.encontrado).length;
  const restantes = total - encontrados;

  document.getElementById('qtd-restante').innerText = restantes;
  document.getElementById('qtd-total').innerText = `de ${total} itens pendentes`;
}

// Atualiza o painel HUD inferior com a informação da última HU bipada
function exibirPainelInferior(titulo, codigo, detalhes, tipo = 'sucesso') {
  const card = document.getElementById('card-ultimo-bip');
  const elTitulo = document.getElementById('bip-status-title');
  const elCodigo = document.getElementById('bip-hu-code');
  const elDetalhes = document.getElementById('bip-detalhes');

  card.className = `hud-bottom ${tipo}`;
  elTitulo.innerText = titulo;
  elCodigo.innerText = codigo;
  elDetalhes.innerText = detalhes;

  // Animação de flash no laser
  const wrapper = document.getElementById('scanner-container');
  wrapper.classList.add('capturado');
  setTimeout(() => wrapper.classList.remove('capturado'), 1000);
}

// Leitura do Código de Barras
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);

  // Busca Inteligente (trata GS1-128 com ou sem prefixo 00)
  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    if (huPlanilha === codigoLido) return true;
    if (codigoLido.length === 20 && codigoLido.startsWith('00') && huPlanilha === codigoLido.substring(2)) return true;
    if (huPlanilha.length === 20 && huPlanilha.startsWith('00') && codigoLido === huPlanilha.substring(2)) return true;
    return false;
  });

  if (navigator.vibrate) navigator.vibrate(150);

  // CÓDIGO NÃO EXISTE NA PLANILHA
  if (!itemExistente) {
    exibirPainelInferior("⚠️ CÓDIGO NÃO ENCONTRADO", codigoLido, "Esta HU não pertence a esta lista!", "alerta");
    return;
  }

  // CÓDIGO JÁ FOI BIPADO
  if (itemExistente.encontrado) {
    exibirPainelInferior("⚠️ HU JÁ BIPADA", itemExistente.hu, `Posição: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "alerta");
    return;
  }

  // SUCESSO: HU ENCONTRADA E PENDENTE
  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  
  // Atualiza instantaneamente a contagem na tela
  atualizarContadores();
  
  exibirPainelInferior("⚡ HU BIPADA COM SUCESSO!", itemExistente.hu, `Bin/Posição: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

  // Envia a confirmação para a Planilha do Google
  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    await fetch(urlBip);
  } catch (err) {
    console.error("Erro ao salvar no Sheets:", err);
  } finally {
    aguardandoProcessamento = false;
  }
}

// Inicia a câmera Fullscreen em Full HD
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
    fps: 30,
    disableFlip: false,
    // Mira proporcional para tela inteira (ótima na horizontal/paisagem)
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const width = Math.floor(viewfinderWidth * 0.85);
      const height = Math.floor(viewfinderHeight * 0.40);
      return { width: width, height: height };
    },
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  const videoConstraints = {
    facingMode: "environment",
    width: { min: 1280, ideal: 1920, max: 3840 },
    height: { min: 720, ideal: 1080, max: 2160 },
    focusMode: "continuous"
  };

  try {
    await html5QrCode.start(videoConstraints, config, onScanSuccess, () => {});
  } catch (err) {
    await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
  }
}

window.addEventListener('DOMContentLoaded', inicializar);
