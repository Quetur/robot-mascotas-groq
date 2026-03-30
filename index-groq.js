import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import Groq from "groq-sdk";
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import mysql from 'mysql2/promise';

// --- CONFIGURACIÓN BASE ---
const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const folderDescargas = './descargas_mascotas';
const API_BASE_URL = process.env.API_URL;

if (!fs.existsSync(folderDescargas)) fs.mkdirSync(folderDescargas);

// --- CONEXIÓN A BASE DE DATOS ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

// --- MEMORIA GEOGRÁFICA ---
let localidadesBA = [];

// --- CURIOSIDADES F1 ---
const curiosidades = [
    "Enzo Ferrari firmaba siempre con tinta violeta en honor a su padre.",
    "El 'Cavallino Rampante' era el símbolo de un piloto de caza italiano.",
    "Ferrari es la única escudería presente en todos los mundiales de F1.",
    "El color original de Ferrari era el amarillo, el rojo era por reglamento."
];

const esperarConReloj = async (segundos) => {
    const dato = curiosidades[Math.floor(Math.random() * curiosidades.length)];
    console.log(`\n🏎️  DATO F1: ${dato}`);
    for (let i = segundos; i > 0; i--) {
        process.stdout.write(`⏳ Enfriando motor Groq: ${i}s... \r`);
        await new Promise(res => setTimeout(res, 1000));
    }
    console.log('\n🟢 ¡Pista libre!                                ');
};

// --- REINTENTOS ---
async function conReintentos(fn, intentos = 3, espera = 2000) {
    for (let i = 0; i < intentos; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === intentos - 1) throw e;
            console.warn(`⚠️  Reintento ${i + 1}/${intentos - 1} en ${espera / 1000}s... (${e.message})`);
            await new Promise(r => setTimeout(r, espera));
        }
    }
}

// --- LEER CONFIGURACIÓN DESDE LA API EXTERNA ---
async function obtenerConfigRobot() {
    try {
        const res = await axios.get(`${API_BASE_URL}/api/robot_config`, { timeout: 10000 });
        if (!res.data.success) throw new Error("La API devolvió success: false");
        const config = res.data;
        console.log(`⚙️  Config: [${config.nombre}] | URL: ${config.url} | Límite: ${config.limite}`);
        return config;
    } catch (e) {
        console.error(`❌ No se pudo obtener config del robot: ${e.message}`);
        console.warn(`⚠️  Usando valores de fallback.`);
        return {
            nombre: "Grupo FB (fallback)",
            url: "https://www.facebook.com/groups/783567165045030",
            limite: 10,
            latitud: 0,
            longitud: 0
        };
    }
}

// --- FUNCIONES DE BASE DE DATOS ---

async function cargarLocalidades() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            'SELECT id_localidad, descripcion, lati, longi FROM localidad WHERE provincia = "AR-B"'
        );
        await connection.end();
        localidadesBA = rows;
        console.log(`📍 GPS: ${localidadesBA.length} localidades de Buenos Aires cargadas.`);
    } catch (error) {
        console.error("❌ Error cargando GPS:", error.message);
    }
}

async function existePost(urlFb) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            'SELECT id_mascota FROM mascota WHERE des LIKE ? OR nota LIKE ?',
            [`%${urlFb}%`, `%${urlFb}%`]
        );
        await connection.end();
        return rows.length > 0;
    } catch (error) {
        return false;
    }
}

// GPS por barrio detectado por la IA.
// Si no matchea ninguna localidad, usa las coords que vienen de la config del grupo.
function obtenerGPS(barrioIA, gpsDefault) {
    if (!barrioIA) return gpsDefault;
    const busqueda = barrioIA.toLowerCase().trim();
    const match = localidadesBA.find(l =>
        busqueda.includes(l.descripcion.toLowerCase()) ||
        l.descripcion.toLowerCase().includes(busqueda)
    );
    return match
        ? { lat: match.lati, lng: match.longi, id: match.id_localidad }
        : gpsDefault;
}

// --- EXTRACCIÓN DE TELÉFONO POR REGEX ---
// Tiene prioridad sobre la IA. Cubre los formatos más comunes en Argentina/GBA:
// 011 15-4523-8891 | +54 9 11 4523 8891 | 15 4523-8891 | 1145238891
function extraerTelefonoArgentino(texto) {
    const patrones = [
        // Con prefijo celular/whatsapp explícito
        /(?:cel(?:ular)?|whatsapp|wp|wsp|tel(?:éfono)?)[^\d]{0,5}(\+?54\s*9?\s*)?(?:011\s*)?(?:15[\s\-]?)?\d{4}[\s\-]?\d{4}/gi,
        // Formato +54 9 11 XXXX XXXX
        /\+54\s*9\s*\d{2,4}[\s\-]?\d{4}[\s\-]?\d{4}/g,
        // Formato 011-15-XXXX-XXXX o 011 15 XXXX XXXX
        /0?11[\s\-]?15[\s\-]?\d{4}[\s\-]?\d{4}/g,
        // Formato 15-XXXX-XXXX (zona GBA sin prefijo)
        /\b15[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
        // 10 u 11 dígitos seguidos (número completo)
        /\b\d{10,11}\b/g,
    ];

    for (const patron of patrones) {
        const matches = texto.match(patron);
        if (matches) {
            const soloDigitos = matches[0].replace(/\D/g, '');
            if (soloDigitos.length >= 8) return soloDigitos;
        }
    }
    return null;
}

// --- FUNCIONES AUXILIARES ---

function buscarImagenRecursiva(obj) {
    const clavesPrioritarias = ['source', 'uri', 'src', 'url'];
    if (typeof obj === 'string' && (obj.includes('scontent') || obj.match(/\.(jpg|jpeg|png|webp)/i))) {
        if (!obj.includes('s40x40') && !obj.includes('profile')) return obj;
    }
    if (obj && typeof obj === 'object') {
        for (let k of clavesPrioritarias) {
            if (obj[k] && typeof obj[k] === 'string' && obj[k].includes('scontent')) {
                if (!obj[k].includes('s40x40')) return obj[k];
            }
        }
        for (let k in obj) {
            const encontrada = buscarImagenRecursiva(obj[k]);
            if (encontrada) return encontrada;
        }
    }
    return null;
}

const mapearIDs = (datosTexto, datosVision = {}) => {
    const categorias = { "ENCONTRADO": 10, "PERDIDO": 20, "ADOPCION": 23 };
    const tipos = { "PERRO": 10, "GATO": 20, "OTRO": 30 };

    // El texto tiene prioridad. Vision entra solo si el texto devolvió OTRO o nada.
    const tipoTexto = datosTexto.id_tipo?.toUpperCase();
    const tipoFinal = (tipoTexto && tipoTexto !== 'OTRO')
        ? tipoTexto
        : datosVision.id_tipo?.toUpperCase() || 'OTRO';

    return {
        id_categoria: categorias[datosTexto.id_categoria?.toUpperCase()] || 20,
        id_tipo: tipos[tipoFinal] || 10
    };
};

async function descargarImagen(url, nombreArchivo) {
    const ruta = path.join(folderDescargas, nombreArchivo);
    try {
        const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 15000 });
        const writer = fs.createWriteStream(ruta);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(ruta));
            writer.on('error', reject);
        });
    } catch (e) { return null; }
}

// --- PASO 1: ANÁLISIS DE TEXTO CON GROQ LLM ---
// Fuente de verdad principal. La vision solo enriquece lo que esto no pudo resolver.
async function analizarTexto(textoOriginal, telRegex) {
    const prompt = `Analizá este post de Facebook de un grupo de mascotas de Buenos Aires, Argentina:

"${textoOriginal}"

Respondé SOLO con un JSON válido con estos campos:
{
  "id_categoria": "PERDIDO", "ENCONTRADO" o "ADOPCION",
  "id_tipo": "PERRO", "GATO" o "OTRO",
  "sexo": "Macho" o "Hembra",
  "titulo": "resumen corto de máximo 60 caracteres describiendo la situación",
  "barrio": "barrio o zona específica mencionada, o null si no se menciona",
  "calle": "calle o dirección exacta mencionada, o null si no se menciona",
  "celular": "número de teléfono en solo dígitos, o null si no aparece"
}

${telRegex
        ? `El teléfono ya fue detectado automáticamente: ${telRegex}. Usalo en el campo "celular".`
        : 'Intentá extraer el teléfono del texto si aparece, en solo dígitos sin espacios ni guiones.'}`;

    const result = await conReintentos(() => groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" }
    }));

    return JSON.parse(result.choices[0].message.content);
}

// --- PASO 2: ANÁLISIS DE IMAGEN CON GROQ VISION ---
// Valida que la imagen sea una mascota y completa lo que el texto no pudo determinar.
async function analizarImagenConVision(rutaLocal, ext, contextoTexto = "") {
    try {
        const imagenBase64 = fs.readFileSync(rutaLocal, { encoding: 'base64' });
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        const resultVision = await conReintentos(() => groq.chat.completions.create({
            model: "llama-3.2-11b-vision-preview",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:${mimeType};base64,${imagenBase64}` }
                    },
                    {
                        type: "text",
                        text: `Sos un asistente que ayuda a identificar mascotas perdidas en Argentina.
${contextoTexto ? `Contexto del post: "${contextoTexto}"` : ''}

Analizá la imagen y respondé SOLO con un JSON válido:
{
  "es_mascota": true o false,
  "id_tipo": "PERRO", "GATO" o "OTRO",
  "sexo_visual": "Macho", "Hembra" o "Desconocido",
  "descripcion_visual": "color, tamaño y características físicas del animal en una frase corta"
}
Si la imagen no muestra un animal claramente (es un flyer, texto, persona, paisaje, etc.), devolvé es_mascota: false.`
                    }
                ]
            }],
            response_format: { type: "json_object" },
            max_tokens: 200
        }));

        return JSON.parse(resultVision.choices[0].message.content);
    } catch (e) {
        // Vision falla → no bloqueamos, el texto ya tiene los datos principales
        console.warn(`⚠️  Vision falló, continuando sin análisis visual: ${e.message}`);
        return { es_mascota: true, id_tipo: null, sexo_visual: "Desconocido", descripcion_visual: "" };
    }
}

// --- LÓGICA PRINCIPAL ---

async function iniciarRobot() {
    console.log("------------------------------------------");
    console.log(`🚀 MasPerdida Robot PRO (Texto → Vision)`);
    console.log("------------------------------------------");

    // PASO 0A: Leer config del robot desde la API externa
    const config = await obtenerConfigRobot();
    const FB_GROUP_URL = config.url;
    const POSTS_LIMIT = config.limite || 10;

    // GPS por defecto: viene de la config. Si la API devuelve 0,0, usa Ituzaingó centro.
    const gpsDefault = {
        lat: config.latitud && config.latitud !== 0 ? config.latitud : -34.658,
        lng: config.longitud && config.longitud !== 0 ? config.longitud : -58.668,
        id: 1
    };
    console.log(`📌 GPS por defecto: ${gpsDefault.lat}, ${gpsDefault.lng}`);

    // PASO 0B: Cargar localidades de la DB para geocodificación por barrio
    await cargarLocalidades();

    try {
        const run = await apifyClient.actor("apify/facebook-groups-scraper").call({
            "startUrls": [{ "url": FB_GROUP_URL }],
            "resultsLimit": POSTS_LIMIT
        });

        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        if (items.length === 0) {
            console.log("📭 No hay publicaciones nuevas.");
            return;
        }

        console.log(`📑 ${items.length} publicaciones de "${config.nombre}"...`);

        for (const [index, post] of items.entries()) {
            const textoOriginal = post.text || post.sharedPost?.text || post.description || "";
            const imageUrl = buscarImagenRecursiva(post);
            const urlFb = post.url || `https://www.facebook.com/${post.id}`;

            console.log(`\n🔗 [${index + 1}/${items.length}] ${urlFb}`);

            if (await existePost(urlFb)) {
                console.log(`⏭️  Duplicado, saltando.`);
                continue;
            }

            if (!imageUrl || textoOriginal.length < 10) {
                console.log(`⏭️  Sin imagen o texto insuficiente, saltando.`);
                continue;
            }

            const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1]?.toLowerCase() || 'jpg';
            const nombreFoto = `${Date.now()}_${index}.${ext}`;

            let rutaLocal = "";
            try {
                rutaLocal = await descargarImagen(imageUrl, nombreFoto);
                if (!rutaLocal || !fs.existsSync(rutaLocal)) {
                    console.log(`⏭️  No se pudo descargar la imagen.`);
                    continue;
                }

                // =============================
                // PASO 1: REGEX DE TELÉFONO
                // =============================
                const telRegex = extraerTelefonoArgentino(textoOriginal);
                console.log(telRegex
                    ? `📱 Teléfono por regex: ${telRegex}`
                    : `📱 Sin teléfono por regex, lo buscará la IA.`
                );

                // =============================
                // PASO 2: ANÁLISIS DE TEXTO (fuente principal)
                // =============================
                console.log(`🤖 Analizando texto...`);
                const resIA = await analizarTexto(textoOriginal, telRegex);
                console.log(`   → Cat: ${resIA.id_categoria} | Tipo: ${resIA.id_tipo} | Sexo: ${resIA.sexo} | Barrio: ${resIA.barrio || 'n/d'}`);

                // =============================
                // PASO 3: ANÁLISIS VISUAL (validación + enriquecimiento)
                // Valida que la imagen sea una mascota. Si el texto ya resolvió
                // tipo y sexo, vision solo agrega descripcion_visual al título.
                // =============================
                console.log(`👁️  Validando imagen con Groq Vision...`);
                const resVision = await analizarImagenConVision(rutaLocal, ext, textoOriginal.substring(0, 200));

                if (resVision.es_mascota === false) {
                    console.log(`🚫 Imagen rechazada (flyer/texto/persona). Saltando.`);
                    continue;
                }

                console.log(`🐾 Vision: ${resVision.id_tipo || '?'} | ${resVision.descripcion_visual || 'sin descripción'}`);

                // =============================
                // PASO 4: COMBINAR — TEXTO TIENE PRIORIDAD
                // =============================
                const celularFinal = telRegex || (resIA.celular || "0").replace(/\D/g, "");

                const ids = mapearIDs(resIA, resVision);

                const sexoFinal = (() => {
                    const s = resIA.sexo?.toLowerCase() || "";
                    if (s.includes("hembra")) return "Hembra";
                    if (s.includes("macho")) return "Macho";
                    return resVision.sexo_visual === "Hembra" ? "Hembra" : "Macho";
                })();

                // Título base del texto + descripción visual como sufijo si suma info
                const tituloBase = resIA.titulo || "Mascota sin nombre";
                const tituloFinal = resVision.descripcion_visual
                    ? `${tituloBase} - ${resVision.descripcion_visual}`.substring(0, 70)
                    : tituloBase.substring(0, 70);

                const gps = obtenerGPS(resIA.barrio, gpsDefault);
                const fechaReal = post.time
                    ? new Date(post.time).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0];

                // =============================
                // PASO 5: ENVIAR A LA API
                // =============================
                const form = new FormData();
                form.append('id_categoria', String(ids.id_categoria));
                form.append('id_tipo', String(ids.id_tipo));
                form.append('id_raza', '10');
                form.append('titulo', tituloFinal);
                form.append('sexo', sexoFinal);

                const direccionCompleta = `${resIA.barrio || ''} ${resIA.calle || ''}`.trim() || config.nombre;
                form.append('calle', direccionCompleta.substring(0, 95));

                form.append('celular', celularFinal);
                form.append('id_usuario', celularFinal);
                form.append('nombre_contacto', post.user?.name || 'Usuario FB');
                form.append('nota', `Tel: ${celularFinal} | Link FB: ${urlFb}`);
                form.append('foto2', fs.createReadStream(rutaLocal));
                form.append('fecha_suceso', fechaReal);
                form.append('latitud', String(gps.lat));
                form.append('longitud', String(gps.lng));
                form.append('id_localidad', String(gps.id));

                const apiRes = await conReintentos(() =>
                    axios.post(`${API_BASE_URL}/api/mascota_chat_graba`, form, {
                        headers: { ...form.getHeaders() }
                    })
                );

                if (apiRes.data.success) {
                    console.log(`✅ PUBLICADO: ID ${apiRes.data.insertId} | Cat: ${ids.id_categoria} | Tipo: ${ids.id_tipo} | Tel: ${celularFinal}`);
                } else {
                    console.warn(`⚠️  API respondió sin éxito:`, apiRes.data);
                }

                await esperarConReloj(10);

            } catch (err) {
                console.error("❌ Error en post:", err.response?.data || err.message);
            } finally {
                if (rutaLocal && fs.existsSync(rutaLocal)) fs.unlinkSync(rutaLocal);
            }
        }

        console.log("\n🏁 Fin del circuito. Robot a boxes.");

    } catch (e) {
        console.error("❌ ERROR CRÍTICO:", e.message);
    }
}

iniciarRobot();