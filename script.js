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
  // Verificação de HTTPS antes de tentar ligar a câmera
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    exibirPainelInferior("⚠️ ERRO DE SEGURANÇA", "HTTPS NECESSÁRIO", "A câmera exige endereço HTTPS para funcionar (ex: GitHub Pages/Vercel).", "alerta");
  }

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
  if (dot) dot.className = "dot sincronizando";

  try {
    const urlBusca = `${APPS_SCRIPT_URL}?action=obterLista`;
    const response = await fetch(urlBusca);
    
    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}`);
    }

    const dados = await response.json();
    if (Array.isArray(dados)) {
      listaHUs = dados;
      atualizarContadores();
      if (dot) dot.className = "dot";
      if (texto) texto.innerText = "Sincronizado";
    } else {
      throw new Error("Resposta da planilha não é uma lista válida.");
    }
  } catch (err) {
    console.error("Erro na sincronização:", err);
    if (dot) dot.className = "dot erro";
    if (texto) texto.innerText = "Offline (Erro no Link do Script)";
  }
}

// Atualiza o contador flutuante do topo da tela
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

// Atualiza o painel HUD inferior com a informação da última HU bipada
function exibirPainelInferior(titulo, codigo, detalhes, tipo = 'sucesso') {
  const card = document.getElementById('card-ultimo-bip');
  const elTitulo = document.getElementById('bip-status-title');
  const elCodigo = document.getElementById('bip-hu-code');
  const elDetalhes = document.getElementById('bip-detalhes');

  if (card) card.className = `hud-bottom ${tipo}`;
  if (elTitulo) elTitulo.innerText = titulo;
  if (elCodigo) elCodigo.innerText = codigo;
  if (elDetalhes) elDetalhes.innerText = detalhes;

  // Animação de flash no laser
  const wrapper = document.getElementById('scanner-container');
  if (wrapper) {
    wrapper.classList.add('capturado');
    setTimeout(() => wrapper.classList.remove('capturado'), 1000);
  }
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
  
  exibirPainelInferior("⚡ HU BIPADA COM SUCESSO!", itemExistente.hu, `Bin: ${itemExistente.posicao} | Mat: ${itemExistente.material}`, "sucesso");

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
      },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    // Tenta abrir a câmera traseira de modo simples universal
    await html5QrCode.start(
      { facingMode: "environment" }, 
      config, 
      onScanSuccess, 
      () => {}
    );

  } catch (err) {
    console.warn("Tentando fallback por ID de dispositivo de câmera...", err);
    
    // Fallback: Busca a lista física de câmeras do celular e pega a principal
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        const cameraId = devices[devices.length - 1].id; // Pega a última câmera (traseira)
        await html5QrCode.start(cameraId, { fps: 20 }, onScanSuccess, () => {});
      } else {
        throw new Error("Nenhuma câmera encontrada no dispositivo.");
      }
    } catch (errFallback) {
      console.error("Erro final na câmera:", errFallback);
      exibirPainelInferior(
        "❌ ERRO NA CÂMERA", 
        "SEM PERMISSÃO OU SEM HTTPS", 
        "Permita o acesso à câmera no navegador ou rode o site via HTTPS.", 
        "alerta"
      );
    }
  }
}

window.addEventListener('DOMContentLoaded', inicializar);
