// ⚠️ COLE AQUI A URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

// Disparado ao clicar no botão "LIGAR CÂMERA"
async function iniciarAplicacao() {
  document.getElementById('overlay-inicio').style.display = 'none';

  // Verifica se a biblioteca html5-qrcode carregou corretamente
  if (typeof Html5Qrcode === 'undefined') {
    exibirPainelInferior("❌ ERRO DE CARREGAMENTO", "BIBLIOTECA INDISPONÍVEL", "Recarregue a página. O script da câmera não baixou.", "alerta");
    return;
  }

  await carregarDadosSilenciosamente();
  iniciarCamera();

  // Sincroniza a contagem a cada 10 segundos
  setInterval(carregarDadosSilenciosamente, 10000);
}

// Busca a lista na Planilha do Google
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
      if (texto) texto.innerText = "Sincronizado";
    } else {
      throw new Error("Formato inválido retornado pelo Apps Script.");
    }
  } catch (err) {
    console.error("Erro Apps Script:", err);
    if (dot) dot.className = "dot erro";
    if (texto) texto.innerText = "Offline (Erro Apps Script)";
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
  if (elTotal) elTotal.innerText = `de ${total} itens pendentes`;
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
    setTimeout(() => wrapper.classList.remove('capturado'), 1000);
  }
}

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

  if (!itemExistente) {
    exibirPainelInferior("⚠️ CÓDIGO NÃO ENCONTRADO", codigoLido, "Esta HU não pertence a esta lista!", "alerta");
    return;
  }

  if (itemExistente.encontrado) {
    exibirPainelInferior("⚠️ HU JÁ BIPADA", itemExistente.hu, `Posição: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "alerta");
    return;
  }

  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  
  atualizarContadores();
  exibirPainelInferior("⚡ HU BIPADA COM SUCESSO!", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    await fetch(urlBip);
  } catch (err) {
    console.error("Erro ao gravar no Sheets:", err);
  } finally {
    aguardandoProcessamento = false;
  }
}

// Inicia a câmera com tolerância universal a falhas
async function iniciarCamera() {
  try {
    html5QrCode = new Html5Qrcode("reader");

    const config = { 
      fps: 25,
      disableFlip: false,
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        const width = Math.floor(viewfinderWidth * 0.85);
        const height = Math.floor(viewfinderHeight * 0.45);
        return { width: width, height: height };
      }
    };

    // Tenta iniciar câmera traseira
    await html5QrCode.start(
      { facingMode: "environment" }, 
      config, 
      onScanSuccess, 
      () => {}
    );

  } catch (err) {
    console.warn("Tentando fallback de câmera simples...", err);
    
    try {
      // Fallback: Busca a lista de câmeras físicas do aparelho e usa a traseira
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        const cameraId = devices[devices.length - 1].id;
        await html5QrCode.start(cameraId, { fps: 20 }, onScanSuccess, () => {});
      } else {
        throw new Error("Nenhuma câmera encontrada.");
      }
    } catch (errFallback) {
      console.error("Erro crítico na câmera:", errFallback);
      exibirPainelInferior(
        "❌ PERMISSÃO NEGADA", 
        "SEM ACESSO À CÂMERA", 
        "Permita o uso da câmera nas configurações do navegador do seu celular.", 
        "alerta"
      );
    }
  }
}
