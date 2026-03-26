import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import Groq from "groq-sdk";
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import mysql from 'mysql2/promise';

// --- CONFIGURACIÓN ---
const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const folderDescargas = './descargas_mascotas';
const API_URL = `${process.env.API_URL}/api/mascota_chat_graba`; 

if (!fs.existsSync(folderDescargas)) fs.mkdirSync(folderDescargas);

// --- CONEXIÓN DIRECTA PARA ANTI-DUPLICADOS ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

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

// --- FUNCIONES AUXILIARES ---

async function existePost(urlFb) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        // Ajustamos a la columna 'des' que es donde suele guardarse la info del contacto/link
        const [rows] = await connection.execute(
            'SELECT id_mascota FROM mascota WHERE des LIKE ?', 
            [`%${urlFb}%`]
        );
        await connection.end();
        return rows.length > 0;
    } catch (error) {
        // Si falla la conexión, no bloqueamos el robot pero avisamos
        console.error("⚠️ Error chequeando duplicado en DB:", error.message);
        return false; 
    }
}

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

const mapearIDs = (datos) => {
    const categorias = { "PERDIDO": 1, "ENCONTRADO": 2, "ADOPCION": 3 };
    const tipos = { "PERRO": 1, "GATO": 2, "OTRO": 3 };
    return {
        id_categoria: categorias[datos.id_categoria?.toUpperCase()] || 1,
        id_tipo: tipos[datos.id_tipo?.toUpperCase()] || 1
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

// --- LÓGICA PRINCIPAL ---

async function iniciarRobot() {
    console.log("------------------------------------------");
    console.log(`🚀 MasPerdida Robot PRO (Sprint Final) -> ${API_URL}`);
    console.log("------------------------------------------");

    try {
        const run = await apifyClient.actor("apify/facebook-groups-scraper").call({
            "startUrls": [{ "url": "https://www.facebook.com/groups/783567165045030" }],
            "resultsLimit": 10
        });

        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        if (items.length === 0) return;

        console.log(`📑 Analizando ${items.length} publicaciones...`);

        for (const [index, post] of items.entries()) {
            const textoOriginal = post.text || post.sharedPost?.text || post.description || "";
            const imageUrl = buscarImagenRecursiva(post);
            const urlFb = post.url || `https://www.facebook.com/${post.id}`;
            
            // 1. Chequeo de duplicados (Ahora funcional)
            if (await existePost(urlFb)) {
                console.log(`\n⏭️  Saltando duplicado: ${urlFb}`);
                continue;
            }

            if (!imageUrl || textoOriginal.length < 10) continue;

            let rutaLocal = "";
            try {
                const nombreFoto = `${Date.now()}_${index}.jpg`;
                rutaLocal = await descargarImagen(imageUrl, nombreFoto);
                if (!rutaLocal || !fs.existsSync(rutaLocal)) continue;
                
                console.log(`\n🤖 [${index + 1}/${items.length}] Procesando post de: ${post.user?.name || 'FB'}`);

                const prompt = `Analiza este post en Ituzaingó: "${textoOriginal}". 
                Responde JSON: { 
                    "id_categoria": "PERDIDO/ENCONTRADO/ADOPCION", 
                    "id_tipo": "PERRO/GATO", 
                    "sexo": "Macho/Hembra", 
                    "titulo": "Resumen corto", 
                    "barrio": "Barrio específico de Ituzaingó",
                    "calle": "Calle exacta", 
                    "celular": "solo numeros" 
                }`;

                const result = await groq.chat.completions.create({
                    messages: [{ role: "user", content: prompt }],
                    model: "llama-3.3-70b-versatile",
                    response_format: { type: "json_object" }
                });

                const resIA = JSON.parse(result.choices[0].message.content);
                const ids = mapearIDs(resIA);
                const fechaReal = post.time ? new Date(post.time).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

                const form = new FormData();
                form.append('id_categoria', ids.id_categoria);
                form.append('id_tipo', ids.id_tipo);
                form.append('titulo', (resIA.titulo || "Mascota").substring(0, 70));
                form.append('sexo', (resIA.sexo?.toLowerCase().includes("hembra") ? "Hembra" : "Macho"));
                
                // Unimos Barrio y Calle para el campo 'direccion' (NOT NULL)
                const direccionCompleta = `${resIA.barrio || ''} ${resIA.calle || ''}`.trim() || "Ituzaingó";
                form.append('calle', direccionCompleta.substring(0, 95));
                
                form.append('celular', (resIA.celular || "0").replace(/\D/g, ""));
                form.append('nombre_contacto', `${post.user?.name || 'Usuario FB'} (Link: ${urlFb})`);
                form.append('foto2', fs.createReadStream(rutaLocal));
                form.append('fecha_suceso', fechaReal); 

                const apiRes = await axios.post(API_URL, form, { headers: { ...form.getHeaders() } });

                if (apiRes.data.success) {
                    console.log(`✅ PUBLICADO OK: ID ${apiRes.data.insertId} | Zona: ${resIA.barrio || 'Centro'}`);
                }

                await esperarConReloj(8);

            } catch (err) {
                console.error("❌ Error en post:", err.response?.data || err.message);
            } finally {
                if (rutaLocal && fs.existsSync(rutaLocal)) {
                    try { fs.unlinkSync(rutaLocal); } catch(e) {}
                }
            }
        }
        console.log("\n🏁 Proceso finalizado. El robot descansa en el paddock.");
    } catch (e) {
        console.error("❌ ERROR CRÍTICO:", e.message);
    }
}

iniciarRobot();