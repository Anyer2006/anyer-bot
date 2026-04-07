const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const mongoose = require('mongoose');
const pino = require('pino');

// --- CONFIGURACIÓN ---
const MONGO_URL = 'TU_ENLACE_QUE_ME_PASASTE'; 
const GROQ_KEY = 'TU_API_KEY_DE_GROQ'; // Cámbiala por la gsk_...

const groq = new Groq({ apiKey: GROQ_KEY });

async function iniciarBot() {
    await mongoose.connect(MONGO_URL);
    console.log("✅ Conectado a la base de datos MongoDB");

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Anyer AI', 'MacOS', '3.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text;

        if (text) {
            console.log(`📩 Mensaje de ${remoteJid}: ${text}`);

            // Simulación humana: "Escribiendo..." y delay aleatorio
            await sock.sendPresenceUpdate('composing', remoteJid);
            await delay(Math.floor(Math.random() * 5000) + 3000); 

            try {
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Eres Anyer Mora, un experto en sistemas y desarrollador de Venezuela. Responde de forma amable, inteligente y breve. Si no puedes atender en el momento, dile que la IA de Anyer está procesando su duda." },
                        { role: "user", content: text }
                    ],
                    model: "llama3-8b-8192",
                });

                const respuestaIA = completion.choices[0].message.content;
                await sock.sendMessage(remoteJid, { text: respuestaIA });

            } catch (error) {
                console.error("❌ Error en Groq IA:", error);
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            console.log('🚀 Sistema de Anyer conectado a WhatsApp');
        }
    });
}

iniciarBot();