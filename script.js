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
