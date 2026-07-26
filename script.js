// ⚠️ URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

// Remove caracteres especiais e parênteses, deixando apenas os números
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

// 🎯 LEITURA RÍGIDA: APENAS CÓDIGOS GS1-128 QUE INICIAM COM (00)
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);

  // 🔒 TRAVA DE SEGURANÇA: Só aceita se tiver 20 dígitos E começar exatamente com "00"
  if (codigoLido.length !== 20 || !codigoLido.startsWith('00')) {
    // Ignora silenciosamente qualquer outro código de barras ou leitura parcial na caixa
    return; 
  }

  // Extrai os 18 dígitos da HU (removendo o prefixo "00") para cruzar com a planilha
  const huExtraida = codigoLido.substring(2);

  // Busca Inteligente: Procura na planilha tanto pelo número com "00" quanto pelos 18 dígitos
  const itemExistente = listaHUs.find(i => {
    const huPlanilha = limparCodigoHU(String(i.hu));
    return huPlanilha === codigoLido || huPlanilha === huExtraida;
  });

  if (navigator.vibrate) navigator.vibrate(100);

  // CÓDIGO GS1-128 VÁLIDO, MAS NÃO ESTÁ NA SUAS HUs PENDENTES
  if (!itemExistente) {
    exibirPainelInferior("⚠️ NÃO ENCONTRADO", `(00)${huExtraida}`, "Esta HU não está na lista de conferência", "alerta");
    return;
  }

  // CÓDIGO JÁ BIPADO
  if (itemExistente.encontrado) {
    exibirPainelInferior("⚠️ JÁ BIPADA", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "alerta");
    return;
  }

  // SUCESSO: HU ENCONTRADA!
  aguardandoProcessamento = true;
  itemExistente.encontrado = true;
  
  atualizarContadores();
  exibirPainelInferior("⚡ HU BIPADA!", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

  // Envia a baixa para a planilha
  try {
    const urlBip = `${APPS_SCRIPT_URL}?action=bipar&hu=${encodeURIComponent(itemExistente.hu)}`;
    await fetch(urlBip);
  } catch (err) {
    console.error("Erro ao gravar:", err);
  } finally {
    aguardandoProcessamento = false;
  }
}

// Configura a câmera focando 100% no padrão CODE_128 em alta performance
async function iniciarCamera() {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e){}
    }

    html5QrCode = new Html5Qrcode("reader", {
      formatsToSupport: [ Html5QrcodeSupportedFormats.CODE_128 ]
    });

    const config = { 
      fps: 30, // Máxima velocidade
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        // Mira bem larga, perfeita para enquadrar o código comprido direto
        return { 
          width: Math.floor(viewfinderWidth * 0.92), 
          height: Math.floor(viewfinderHeight * 0.35) 
        };
      },
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // Processamento ultra-rápido por hardware
      }
    };

    const videoConstraints = {
      facingMode: "environment",
      width: { min: 1280, ideal: 1920 },
      height: { min: 720, ideal: 1080 },
      focusMode: "continuous"
    };

    await html5QrCode.start(videoConstraints, config, onScanSuccess, () => {});

  } catch (err) {
    console.warn("Modo HD falhou, usando compatibilidade simples...", err);
    try {
      const configFallback = { fps: 20, qrbox: { width: 280, height: 100 } };
      await html5QrCode.start({ facingMode: "environment" }, configFallback, onScanSuccess, () => {});
    } catch (errFallback) {
      exibirPainelInferior("❌ ERRO DE CÂMERA", "SEM ACESSO", "Permita o uso da câmera no navegador.", "alerta");
    }
  }
}
