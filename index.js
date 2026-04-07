const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeInMemoryStore // <--- Importante para la memoria
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

// Configuración del Almacén de Mensajes (Store)
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function iniciarBot() {
    console.log("--- [SISTEMA] AnyerBot Online (Memoria de Historial Activada) ---");

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

    // Vincular el store al socket para que registre los mensajes
    store.bind(sock.ev);

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
            console.log('🚀 [EXITO] AnyerBot está activo y analizando historiales.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const pushName = m.pushName || "alguien"; 
        const userText = m.message.conversation || m.message.extendedTextMessage?.text;

        if (userText) {
            try {
                await sock.sendPresenceUpdate('composing', jid);

                // --- 🧠 LÓGICA DE MEMORIA DINÁMICA ---
                // Buscamos los últimos mensajes de este chat específico en el store
                const rawMessages = await store.loadMessages(jid, 10);
                
                // Formateamos los mensajes previos para la IA
                let chatHistory = rawMessages.map(msg => {
                    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
                    if (!content) return null;
                    return {
                        role: msg.key.fromMe ? "assistant" : "user",
                        content: content
                    };
                }).filter(Boolean);

                // Si por alguna razón el historial está vacío, metemos el mensaje actual
                if (chatHistory.length === 0) {
                    chatHistory.push({ role: "user", content: userText });
                }

                const completion = await groq.chat.completions.create({
                    messages: [
                        { 
                            role: "system", 
                            content: `Eres Anyer Mora, estudiante de sistemas en Venezuela. 
                            Tu misión es actuar como un clon exacto basándote en el historial de chat que verás abajo.
                            
                            INSTRUCCIONES DE ADN:
                            - Analiza cómo escribe Anyer (asistente) y cómo responde el usuario.
                            - Imita el tono: si Anyer escribe en minúsculas, sin puntos finales y usa "mano" o "jaja", hazlo IGUAL.
                            - Si el usuario te habla de hardware, familia o universidad, usa los datos de Anyer (ASUS TUF A16, vive con padres y hermana, estudia sistemas).
                            - No digas que eres una IA. Eres Anyer continuando la charla.` 
                        },
                        ...chatHistory // Inyectamos los últimos 10 mensajes aquí
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

// Servidor para mantener vivo en Render
const port = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('AnyerBot Live'); }).listen(port);

iniciarBot();
