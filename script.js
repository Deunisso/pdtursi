// ⚠️ COLE AQUI A URL DO SEU GOOGLE APPS SCRIPT
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvKN1zlgTn2F-iY-CgqU9bcSuvBgRvtAMQGeMsa9psE2B7snJ6d8Ov1dCLbiL0YVWt_A/exec";

let listaHUs = [];
let html5QrCode;
let aguardandoProcessamento = false;

// Remove parênteses e caracteres não numéricos do código lido
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

  // Sincroniza com a planilha a cada 10 segundos
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

// MOTOR DE BUSCA HÍBRIDO (Tolerante a falhas físicas)
async function onScanSuccess(decodedText) {
  if (aguardandoProcessamento) return;

  const codigoLido = limparCodigoHU(decodedText);

  // Descarta leituras acidentais muito curtas
  if (codigoLido.length < 4) return;

  // Busca Inteligente na Lista (ignora prefixos 00 automaticamente)
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
    exibirPainelInferior("⚠️ NÃO ENCONTRADO", codigoLido, "Código/HU fora da lista de conferência", "alerta");
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

// Inicia a câmera focada na estabilidade e nitidez (High Density Barcodes)
async function iniciarCamera() {
  try {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e){}
    }

    // Aceita múltiplos formatos logísticos 1D
    html5QrCode = new Html5Qrcode("reader", {
      formatsToSupport: [ 
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF
      ]
    });

    const config = { 
      fps: 20, // Velocidade moderada para garantir foco nítido
      disableFlip: false,
      // Mira larga, mas deixa 10% de margem branca nas laterais
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        const width = Math.floor(viewfinderWidth * 0.88);
        const height = Math.floor(viewfinderHeight * 0.40);
        return { width: width, height: height };
      },
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // Processamento nativo por hardware
      }
    };

    // Pedido de câmera simplificado para compatibilidade universal
    const videoConstraints = {
      facingMode: "environment",
      focusMode: "continuous" // Força o foco contínuo para evitar borrão
    };

    await html5QrCode.start(videoConstraints, config, onScanSuccess, () => {});

  } catch (err) {
    console.warn("Falha na inicialização avançada, usando modo simples...", err);
    try {
      // Modo de compatibilidade total para celulares antigos
      const configFallback = { fps: 15, qrbox: { width: 260, height: 120 } };
      await html5QrCode.start({ facingMode: "environment" }, configFallback, onScanSuccess, () => {});
    } catch (errFallback) {
      exibirPainelInferior("❌ ERRO DE CÂMERA", "SEM ACESSO", "Permita o uso da câmera no navegador.", "alerta");
    }
  }
}
