const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const statusLabel = document.getElementById("statusLabel");
const huResult = document.getElementById("huResult");

const btnRestart = document.getElementById("btnRestart");
const btnTorch = document.getElementById("btnTorch");

const beep = document.getElementById("beep");

let stream = null;
let track = null;

let scanning = true;
let torch = false;

let codeReader = null;

let animationId = null;

function vibrar() {
    if (navigator.vibrate) {
        navigator.vibrate(120);
    }
}

function tocarBeep() {

    if (beep) {
        beep.currentTime = 0;
        beep.play().catch(() => {});
        return;
    }

    try {

        const audio = new (window.AudioContext || window.webkitAudioContext)();

        const osc = audio.createOscillator();
        const gain = audio.createGain();

        osc.frequency.value = 1800;

        gain.gain.value = 0.08;

        osc.connect(gain);
        gain.connect(audio.destination);

        osc.start();

        osc.stop(audio.currentTime + 0.08);

    } catch (e) {}

}

async function iniciarCamera() {

    try {

        stream = await navigator.mediaDevices.getUserMedia({

            video: {

                facingMode: {
                    ideal: "environment"
                },

                width: {
                    ideal: 1920
                },

                height: {
                    ideal: 1080
                }

            }

        });

        video.srcObject = stream;

        track = stream.getVideoTracks()[0];

        const caps = track.getCapabilities();

        const advanced = [];

        if (caps.focusMode) {

            advanced.push({
                focusMode: "continuous"
            });

        }

        if (caps.zoom) {

            advanced.push({

                zoom: Math.min(
                    Math.max(2, caps.zoom.min),
                    caps.zoom.max
                )

            });

        }

        if (advanced.length > 0) {

            await track.applyConstraints({
                advanced
            });

        }

        await video.play();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        statusLabel.innerText = "Procurando etiqueta";

        iniciarLeitor();

    } catch (erro) {

        console.error(erro);

        statusLabel.innerText = "Erro";

        huResult.innerText = "Não foi possível abrir a câmera.";

    }

}



// ======================
// LEITOR ZXING
// ======================

function iniciarLeitor() {

    codeReader = new ZXing.BrowserMultiFormatReader();

    codeReader.decodeFromVideoDevice(
        null,
        video,
        (result, err) => {

            if (!scanning) return;

            desenharOverlay();

            if (!result) return;

            const texto = result.getText();

            processarCodigo(texto);

        }
    );

}

// ======================
// PROCESSA O CÓDIGO
// ======================

function processarCodigo(texto) {

    const somenteNumeros = texto.replace(/\D/g, "");

    const match = somenteNumeros.match(/(?:00)?(\d{18})/);

    if (!match) return;

    scanning = false;

    tocarBeep();

    vibrar();

    statusLabel.innerText = "HU Capturada";

    huResult.innerText = "(00) " + match[1];

}

// ======================
// DESENHA A ÁREA VERDE
// ======================

function desenharOverlay() {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const largura = canvas.width * 0.72;
    const altura = 180;

    const x = (canvas.width - largura) / 2;
    const y = (canvas.height - altura) / 2;

    ctx.lineWidth = 5;
    ctx.strokeStyle = "#30d158";

    ctx.shadowColor = "#30d158";
    ctx.shadowBlur = 18;

    ctx.strokeRect(x, y, largura, altura);

}

// ======================
// NOVA LEITURA
// ======================

btnRestart.onclick = () => {

    scanning = true;

    statusLabel.innerText = "Procurando etiqueta";

    huResult.innerText = "Aguardando...";

};

// ======================
// REDIMENSIONA O CANVAS
// ======================

window.addEventListener("resize", () => {

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

});



// ======================
// LANTERNA
// ======================

btnTorch.onclick = async () => {

    if (!track) return;

    const caps = track.getCapabilities();

    if (!caps.torch) {

        alert("Seu aparelho não possui controle de lanterna.");

        return;

    }

    torch = !torch;

    try {

        await track.applyConstraints({

            advanced: [

                {
                    torch: torch
                }

            ]

        });

        btnTorch.innerText = torch ? "Lanterna ON" : "Lanterna";

    } catch (e) {

        console.log(e);

    }

};

// ======================
// EVITA LEITURAS REPETIDAS
// ======================

let ultimaHU = "";
let ultimoHorario = 0;

function processarCodigo(texto) {

    const numeros = texto.replace(/\D/g, "");

    const match = numeros.match(/(?:00)?(\d{18})/);

    if (!match) return;

    const hu = match[1];

    const agora = Date.now();

    if (ultimaHU === hu && (agora - ultimoHorario) < 3000) {

        return;

    }

    ultimaHU = hu;
    ultimoHorario = agora;

    scanning = false;

    tocarBeep();

    vibrar();

    statusLabel.innerText = "HU Capturada";

    huResult.innerText = "(00) " + hu;

    // Aqui futuramente:
    // buscarHU(hu);

}

// ======================
// RECONEXÃO AUTOMÁTICA
// ======================

setInterval(() => {

    if (!video.srcObject) {

        iniciarCamera();

    }

},5000);

// ======================
// DESENHO CONTÍNUO
// ======================

function animacao(){

    desenharOverlay();

    animationId=requestAnimationFrame(animacao);

}

animacao();

// ======================
// INICIAR
// ======================

window.onload=()=>{

    iniciarCamera();

};

// ======================
// FINALIZAR
// ======================

window.addEventListener("beforeunload",()=>{

    if(animationId){

        cancelAnimationFrame(animationId);

    }

    if(stream){

        stream.getTracks().forEach(track=>track.stop());

    }

});
