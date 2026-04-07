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

// --- CONFIGURACIÓN DINÁMICA (Prioriza Variables de Entorno) ---
const MONGO_URL = process.env.MONGO_URL; 
const GROQ_KEY = process.env.GROQ_KEY; 

const groq = new Groq({ apiKey: GROQ_KEY });

async function iniciarBot() {
    console.log("--- [SISTEMA] Iniciando AnyerBot (Versión Render-Cloud) ---");

    // 1. Validar Variables de Entorno
    if (!MONGO_URL || !GROQ_KEY) {
        console.error("❌ ERROR CRÍTICO: Faltan variables de entorno (MONGO_URL o GROQ_KEY) en Render.");
        process.exit(1);
    }

    // 2. Conexión a MongoDB
    try {
        await mongoose.connect(MONGO_URL);
        console.log("✅ [DB] Conectado exitosamente a MongoDB Atlas");
    } catch (err) {
        console.error("❌ [DB] Error de conexión:", err.message);
        setTimeout(iniciarBot, 10000); // Reintentar en 10 seg
        return;
    }

    // 3. Configuración de Autenticación
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    // 4. Configuración del Socket de WhatsApp
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Lo manejamos manualmente para asegurar legibilidad
        browser: ['AnyerBot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    // 5. Gestión de Conexión y QR
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

      if (qr) {
            console.log("\n" + "=".repeat(50));
            console.log("🔗 ENLACE DIRECTO AL QR (HAZ CLIC AQUÍ):");
            // Este link genera una imagen PNG real, no texto
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            console.log("=".repeat(50));
            
            // Mantenemos el de texto por si acaso
            console.log("\n📢 O intenta escanear este (Zoom 60%):");
            qrcode.generate(qr, { small: true });
            console.log("=".repeat(50) + "\n");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`🔄 Conexión cerrada. Reintentando: ${shouldReconnect}`);
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            console.log('🚀 [EXITO] AnyerBot está EN LÍNEA y listo.');
        }
    });

    // 6. Lógica de Respuesta con IA (Groq)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const userText = m.message.conversation || m.message.extendedTextMessage?.text;

        if (userText) {
            console.log(`📩 Mensaje de ${jid}: ${userText}`);
            
            try {
                // Simulación de escritura
                await sock.sendPresenceUpdate('composing', jid);
                
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Eres Anyer Mora, un experto en sistemas de Venezuela. Responde de forma técnica pero amable y breve. Si te preguntan algo complejo, menciona que estás analizando los protocolos." },
                        { role: "user", content: userText }
                    ],
                    model: "llama3-8b-8192",
                });

                const aiResponse = completion.choices[0].message.content;
                await delay(2000); // Pausa natural
                await sock.sendMessage(jid, { text: aiResponse });

            } catch (error) {
                console.error("❌ [IA ERROR]:", error.message);
            }
        }
    });
}

// Arrancar el sistema
iniciarBot();
