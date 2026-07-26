// ⚠️ URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

async function iniciarAplicacao() {
  const overlay = document.getElementById('overlay-inicio');
  if (overlay) overlay.style.display = 'none';

  await carregarDadosSilenciosamente();
  iniciarCameraHD();

  setInterval(carregarDadosSilenciosamente, 10000);
}

async function carregarDadosSilenciosamente() {
  if (aguardandoProcessamento) return;
  const dot = document.getElementById('sync-dot');
  const texto = document.getElementById('sync-texto');
  if (dot) dot.className = "dot sincronizando";

  try {
    const urlBusca = `${APPS_SCRIPT_URL}?action=obterLista`;
    const response = await fetch(urlBusca);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const dados = await response.json();
    if (Array.isArray(dados)) {
      listaHUs = dados;
      atualizarContadores();
      if (dot) dot.className = "dot";
      if (texto) texto.innerText = "OK";
    }
  } catch (err) {
    if (dot) dot.className = "dot erro";
    if (texto) texto.innerText = "Offline";
  }
}

function atualizarContadores() {
  if (!Array.isArray(listaHUs)) return;
  const total = listaHUs.length;
  const encontrados = listaHUs.filter(item => item.encontrado).length;
  const restantes = total - encontrados;

  const elRestante = document.getElementById('qtd-restante');
  const elTotal = document.getElementById('qtd-total');

  if (elRestante) elRestante.innerText = restantes;
  if (elTotal) elTotal.innerText = `de ${total} pendentes`;
}

function exibirPainelInferior(titulo, codigo, detalhes, tipo = 'sucesso') {
  const card = document.getElementById('card-ultimo-bip');
  const elTitulo = document.getElementById('bip-status-title');
  const elCodigo = document.getElementById('bip-hu-code');
  const elDetalhes = document.getElementById('bip-detalhes');

  if (card) card.className = `hud-bottom ${tipo}`;
  if (elTitulo) elTitulo.innerText = titulo;
  if (elCodigo) elCodigo.innerText = codigo;
  if (elDetalhes) elDetalhes.innerText = detalhes;

  const wrapper = document.getElementById('scanner-container');
  if (wrapper) {
    wrapper.classList.add('capturado');
    setTimeout(() => wrapper.classList.remove('capturado'), 800);
  }
}

async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);
  if (codigoLido.length < 5) return;

  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    return huPlanilha === codigoLido || 
           codigoLido.endsWith(huPlanilha) || 
           huPlanilha.endsWith(codigoLido);
  });

  if (navigator.vibrate) navigator.vibrate(100);

  if (!itemExistente) {
    exibirPainelInferior("⚠️ NÃO ENCONTRADO", codigoLido, "Código fora da lista", "alerta");
    return;
  }

  if (itemExistente.encontrado) {
    exibirPainelInferior("⚠️ JÁ BIPADA", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "alerta");
    return;
  }

  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  
  atualizarContadores();
  exibirPainelInferior("⚡ HU BIPADA!", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    await fetch(urlBip);
  } catch (err) {
    console.error("Erro ao gravar:", err);
  } finally {
    aguardandoProcessamento = false;
  }
}

// 📷 CÂMERA TURBINADA (Sem restrição de enquadramento + Foco total)
async function iniciarCameraHD() {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e){}
    }

    html5QrCode = new Html5Qrcode("reader");

    const config = { 
      fps: 25,
      // Sem 'qrbox' = Lê a tela inteira sem cortar o código de barras
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // Ativa motor nativo de IA do Android/Chrome
      }
    };

    // Solicita alta resolução para a câmera conseguir ver barras muito finas
    const cameraConfig = {
      facingMode: "environment",
      width: { min: 1280, ideal: 1920 },
      height: { min: 720, ideal: 1080 }
    };

    await html5QrCode.start(cameraConfig, config, onScanSuccess, () => {});

  } catch (err) {
    console.warn("Modo HD falhou, iniciando em modo simples...", err);
    try {
      await html5QrCode.start({ facingMode: "environment" }, { fps: 15 }, onScanSuccess, () => {});
    } catch (e) {
      exibirPainelInferior("❌ ERRO DE CÂMERA", "SEM ACESSO", "Verifique as permissões da câmera.", "alerta");
    }
  }
}
