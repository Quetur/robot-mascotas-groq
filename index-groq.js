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

function obtenerGPS(barrioIA) {
    if (!barrioIA) return { lat: -34.658, lng: -58.668, id: 1 };
    const busqueda = barrioIA.toLowerCase().trim();
    const match = localidadesBA.find(l => 
        busqueda.includes(l.descripcion.toLowerCase()) || 
        l.descripcion.toLowerCase().includes(busqueda)
    );
    return match ? { lat: match.lati, lng: match.longi, id: match.id_localidad } : { lat: -34.658, lng: -58.668, id: 1 };
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

const mapearIDs = (datos) => {
    // 🏁 NUEVOS IDS DE CATEGORÍA: 10 Encontrado, 20 Perdido, 23 Adopción
    const categorias = { 
        "ENCONTRADO": 10, 
        "PERDIDO": 20, 
        "ADOPCION": 23 
    };
    
    // 🏁 NUEVOS IDS DE TIPO: 10 Perro, 20 Gato, 30 Otro
    const tipos = { 
        "PERRO": 10, 
        "GATO": 20, 
        "OTRO": 30 
    };

    return {
        id_categoria: categorias[datos.id_categoria?.toUpperCase()] || 20,
        id_tipo: tipos[datos.id_tipo?.toUpperCase()] || 10
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
    console.log(`🚀 MasPerdida Robot PRO (Race Config) -> ${API_URL}`);
    console.log("------------------------------------------");

    await cargarLocalidades();

    try {
        const run = await apifyClient.actor("apify/facebook-groups-scraper").call({
            "startUrls": [{ "url": "https://www.facebook.com/groups/783567165045030" }],
            "resultsLimit": 10
        });

        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        if (items.length === 0) return;

        console.log(`📑 Analizando ${items.length} publicaciones de Ituzaingó...`);

        for (const [index, post] of items.entries()) {
            const textoOriginal = post.text || post.sharedPost?.text || post.description || "";
            const imageUrl = buscarImagenRecursiva(post);
            const urlFb = post.url || `https://www.facebook.com/${post.id}`;
            
            console.log(`\n🔗 Procesando Post: ${urlFb}`);

            if (await existePost(urlFb)) {
                console.log(`⏭️  Saltando duplicado.`);
                continue;
            }

            if (!imageUrl || textoOriginal.length < 10) continue;

            let rutaLocal = "";
            try {
                const nombreFoto = `${Date.now()}_${index}.jpg`;
                rutaLocal = await descargarImagen(imageUrl, nombreFoto);
                if (!rutaLocal || !fs.existsSync(rutaLocal)) continue;
                
                console.log(`🤖 Analizando datos de: ${post.user?.name || 'FB'}`);

                const prompt = `Analiza este post en Ituzaingó: "${textoOriginal}". 
                Responde JSON: { 
                    "id_categoria": "PERDIDO/ENCONTRADO/ADOPCION", 
                    "id_tipo": "PERRO/GATO", 
                    "sexo": "Macho/Hembra", 
                    "titulo": "Resumen corto", 
                    "barrio": "Barrio específico",
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
                const gps = obtenerGPS(resIA.barrio);
                const fechaReal = post.time ? new Date(post.time).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                const celularLimpio = (resIA.celular || "0").replace(/\D/g, "");

                const form = new FormData();
                form.append('id_categoria', String(ids.id_categoria));
                form.append('id_tipo', String(ids.id_tipo));
                form.append('id_raza', '10'); 
                form.append('titulo', (resIA.titulo || "Mascota").substring(0, 70));
                form.append('sexo', (resIA.sexo?.toLowerCase().includes("hembra") ? "Hembra" : "Macho"));
                
                const direccionCompleta = `${resIA.barrio || ''} ${resIA.calle || ''}`.trim() || "Ituzaingó";
                form.append('calle', direccionCompleta.substring(0, 95));
                
                form.append('celular', celularLimpio);
                form.append('id_usuario', celularLimpio); 
                form.append('nombre_contacto', post.user?.name || 'Usuario FB');
                form.append('nota', `Tel: ${celularLimpio} | Link FB: ${urlFb}`);
                
                form.append('foto2', fs.createReadStream(rutaLocal));
                form.append('fecha_suceso', fechaReal); 
                
                form.append('latitud', String(gps.lat));
                form.append('longitud', String(gps.lng));
                form.append('id_localidad', String(gps.id));

                const apiRes = await axios.post(API_URL, form, { headers: { ...form.getHeaders() } });

                if (apiRes.data.success) {
                    console.log(`✅ PUBLICADO: ID ${apiRes.data.insertId} | Cat: ${ids.id_categoria} | Tipo: ${ids.id_tipo}`);
                }

                await esperarConReloj(8);

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