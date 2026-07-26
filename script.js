// ⚠️ URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let tamanhosValidosHUs = new Set(); // Guarda dinamicamente os tamanhos das suas HUs
let html5QrCode;
let aguardandoProcessamento = false;

// Remove caracteres não numéricos
function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

async function iniciarAplicacao() {
  document.getElementById('overlay-inicio').style.display = 'none';

  if (typeof Html5Qrcode === 'undefined') {
    exibirPainelInferior("❌ ERRO DE CARREGAMENTO", "BIBLIOTECA INDISPONÍVEL", "Recarregue a página.", "alerta");
    return;
  }

  await carregarDadosSilenciosamente();
  iniciarCamera();

  // Sincroniza a cada 10 segundos
  setInterval(carregarDadosSilenciosamente, 10000);
}

// Busca a lista na Planilha do Google e identifica o tamanho dos códigos
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
      
      // Mapeia automaticamente o tamanho das HUs cadastradas na planilha
      tamanhosValidosHUs.clear();
      listaHUs.forEach(item => {
        const limpo = limparCodigoHU(item.hu);
        if (limpo.length > 0) {
          tamanhosValidosHUs.add(limpo.length);
          tamanhosValidosHUs.add(limpo.length + 2); // Permite variação com prefixo "00"
        }
      });

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

// Leitura do Código de Barras
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);

  // Ignora ruídos rápidos de câmera com menos de 6 dígitos
  if (codigoLido.length < 6) return;

  // Se a planilha já carregou, valida se o código lido tem o tamanho exato dos códigos da planilha
  if (tamanhosValidosHUs.size > 0 && !tamanhosValidosHUs.has(codigoLido.length)) {
    console.warn(`Leitura parcial/inválida ignorada: ${codigoLido} (${codigoLido.length} dígitos)`);
    return; // Descarta leituras cortadas e continua lendo
  }

  // Busca Inteligente na Lista
  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    if (huPlanilha === codigoLido) return true;
    if (codigoLido.length === huPlanilha.length + 2 && codigoLido.startsWith('00') && codigoLido.endsWith(huPlanilha)) return true;
    if (huPlanilha.length === codigoLido.length + 2 && huPlanilha.startsWith('00') && huPlanilha.endsWith(codigoLido)) return true;
    return false;
  });

  if (navigator.vibrate) navigator.vibrate(100);

  if (!itemExistente) {
    exibirPainelInferior("⚠️ NÃO ENCONTRADO", codigoLido, "HU fora da lista de conferência", "alerta");
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

// Inicia a câmera com estabilidade universal
async function iniciarCamera() {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e){}
    }

    html5QrCode = new Html5Qrcode("reader");

    const config = { 
      fps: 20,
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        // Caixas de leitura largas ideais para etiquetas de galpão
        const width = Math.floor(viewfinderWidth * 0.90);
        const height = Math.floor(viewfinderHeight * 0.40);
        return { width: width, height: height };
      }
    };

    await html5QrCode.start(
      { facingMode: "environment" }, 
      config, 
      onScanSuccess, 
      () => {}
    );

  } catch (err) {
    console.warn("Tentando fallback de câmera...", err);
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        const cameraId = devices[devices.length - 1].id;
        await html5QrCode.start(cameraId, { fps: 20 }, onScanSuccess, () => {});
      }
    } catch (errFallback) {
      console.error("Erro ao abrir câmera:", errFallback);
      exibirPainelInferior("❌ ERRO DE CÂMERA", "SEM ACESSO", "Permita o uso da câmera no navegador.", "alerta");
    }
  }
}
