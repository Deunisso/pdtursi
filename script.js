// ⚠️ URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

// Limpa caracteres especiais deixando apenas os dígitos do código lido
function limparCodigoHU(textoRaw) {
  return String(textoRaw).replace(/[^\d]/g, '').trim();
}

async function iniciarAplicacao() {
  const overlay = document.getElementById('overlay-inicio');
  if (overlay) overlay.style.display = 'none';

  if (typeof Html5Qrcode === 'undefined') {
    exibirPainelInferior("❌ ERRO DE CARREGAMENTO", "BIBLIOTECA INDISPONÍVEL", "Recarregue a página.", "alerta");
    return;
  }

  await carregarDadosSilenciosamente();
  iniciarCamera();

  // Sincroniza a cada 10 segundos com a planilha
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

// 🔍 MOTOR DE LEITURA E PROCESSAMENTO
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);

  // Ignora ruídos menores que 4 dígitos
  if (codigoLido.length < 4) return;

  // Busca Inteligente: Cruza HU curta e Código GS1-128 longo com (00)
  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    if (huPlanilha === codigoLido) return true;
    if (codigoLido.length >= 18 && codigoLido.endsWith(huPlanilha)) return true;
    if (huPlanilha.length >= 18 && huPlanilha.endsWith(codigoLido)) return true;
    return false;
  });

  if (navigator.vibrate) navigator.vibrate(100);

  // CÓDIGO NÃO LOCALIZADO NA LISTA
  if (!itemExistente) {
    exibirPainelInferior("⚠️ NÃO ENCONTRADO", codigoLido, "Código fora da lista de conferência", "alerta");
    return;
  }

  // CÓDIGO JÁ BIPADO
  if (itemExistente.encontrado) {
    exibirPainelInferior("⚠️ JÁ BIPADA", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "alerta");
    return;
  }

  // SUCESSO AO BIPAR
  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  
  atualizarContadores();
  exibirPainelInferior("⚡ HU BIPADA!", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

  // Envia a baixa para o Google Sheets
  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    await fetch(urlBip);
  } catch (err) {
    console.error("Erro ao gravar:", err);
  } finally {
    aguardandoProcessamento = false;
  }
}

// 📷 INICIALIZAÇÃO INFALÍVEL DA CÂMERA
async function iniciarCamera() {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e){}
    }

    html5QrCode = new Html5Qrcode("reader");

    const config = { 
      fps: 15,
      qrbox: { width: 280, height: 120 }
    };

    // Tenta abrir a câmera traseira de forma padrão
    await html5QrCode.start(
      { facingMode: "environment" }, 
      config, 
      onScanSuccess, 
      () => {}
    );

  } catch (err) {
    console.warn("Falha no método padrão de câmera, tentando via ID de dispositivo...", err);
    try {
      // Método Fallback: Lista todas as câmeras do celular e pega a principal
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        const backCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('traseira')) || devices[devices.length - 1];
        await html5QrCode.start(
          backCamera.id, 
          { fps: 15, qrbox: { width: 260, height: 110 } }, 
          onScanSuccess, 
          () => {}
        );
      } else {
        throw new Error("Nenhuma câmera encontrada no dispositivo.");
      }
    } catch (errFallback) {
      console.error("Erro fatal de câmera:", errFallback);
      exibirPainelInferior("❌ ERRO DE CÂMERA", "SEM ACESSO", "Acesse via HTTPS ou permita a câmera no navegador.", "alerta");
    }
  }
}
