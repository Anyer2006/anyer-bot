const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const mongoose = require('mongoose');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');

// --- CONFIGURACIÓN ---
const MONGO_URL = process.env.MONGO_URL; 
const GROQ_KEY = process.env.GROQ_KEY; 
const groq = new Groq({ apiKey: GROQ_KEY });

async function iniciarBot() {
    console.log("--- [SISTEMA] AnyerBot Online (Versión 100% Adaptativa) ---");

    if (!MONGO_URL || !GROQ_KEY) {
        console.error("❌ ERROR: Faltan variables de entorno.");
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGO_URL);
        console.log("✅ [DB] MongoDB Conectado");
    } catch (err) {
        console.error("❌ [DB] Error:", err.message);
        setTimeout(iniciarBot, 10000); 
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['AnyerBot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("\n🔗 QR: " + `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            console.log('🚀 [EXITO] AnyerBot está activo y aprendiendo.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const pushName = m.pushName || "alguien"; 
        const userText = m.message.conversation || m.message.extendedTextMessage?.text;

        if (userText) {
            console.log(`📩 De ${pushName}: ${userText}`);
            
            try {
                await sock.sendPresenceUpdate('composing', jid);
                
                const completion = await groq.chat.completions.create({
                    messages: [
                        { 
                            role: "system", 
                            content: `Eres la versión digital de Anyer Mora. Tu objetivo es ser un clon virtual que se adapta a CUALQUIER tema de conversación de forma natural.

                            1. PERSONALIDAD Y TONO:
                            - Eres un estudiante de Ingeniería de Sistemas de Venezuela. Hablas como un chamo de aquí (usa "mano", "pana", "fino", "de pana", "brutal").
                            - Sé un ESPEJO: Si te hablan serio de trabajo, responde serio. Si te echan joda, síguela al 100%.

                            2. NÚCLEO FAMILIAR (REAL):
                            - Vives con tu mamá, tu papá y tu hermana. NO tienes esposa ni hijos. 
                            - Si preguntan por ellos: "Están bien gracias a Dios", "Mi vieja anda fina", "Mi hermana en lo suyo". No des nombres por seguridad.

                            3. TRABAJO Y ESTUDIOS:
                            - Estás dándole a tu tesis de ingeniería.
                            - Programas en C# (Farmacia.exe) y haces un sistema escolar.
                            - Te gusta la ciberseguridad, auditar redes con Kali Linux o BlackArch.

                            4. HARDWARE Y OCIO:
                            - Presume tu laptop si sale el tema: ASUS TUF A16 con Ryzen AI 9 y una RTX 5070.
                            - Juegos: Fanático del GTA (SAMP/FiveM), CoD Warzone y Blood Strike.
                            - Música: Vallenato puro, sobre todo Diomedes Díaz. Recomienda temas si te preguntan qué escuchas.

                            5. REGLAS DE ORO:
                            - Si no sabes algo personal o te preguntan algo muy privado, dile: "Mano, dame chance que ando metido en un código (o jugando GTA) y no puedo hablar de eso por aquí, luego te aviso".
                            - Mantén las respuestas cortas y directas como un chat de WhatsApp real.` 
                        },
                        { role: "user", content: `Soy ${pushName}. Mi mensaje: ${userText}` }
                    ],
                    model: "llama-3.1-8b-instant",
                });

                const aiResponse = completion.choices[0].message.content;
                await delay(1500); 
                await sock.sendMessage(jid, { text: aiResponse });

            } catch (error) {
                console.error("❌ [IA ERROR]:", error.message);
            }
        }
    });
}

// Servidor para Render
const port = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('AnyerBot Live'); }).listen(port);

iniciarBot();
