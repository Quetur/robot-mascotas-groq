import 'dotenv/config';
import mysql from 'mysql2/promise';
import axios from 'axios';

async function probarConexionReal() {
    // Tomamos los datos directamente de tu .env
    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT) || 3306
    };

    const API_URL = `${process.env.API_URL}/api/mascota_chat_graba`;

    console.log("\n🏁 --- TEST DE TELEMETRÍA (DATOS .ENV) ---");
    console.log(`📡 Host: ${config.host}`);
    console.log(`🔌 Puerto DB: ${config.port}`);
    console.log(`🌐 API Target: ${API_URL}`);
    console.log("-------------------------------------------\n");

    // --- PRUEBA 1: BASE DE DATOS ---
    try {
        console.log("🛢️  1. Intentando conexión directa a MySQL...");
        const conn = await mysql.createConnection(config);
        console.log("✅ ¡CONEXIÓN A DB EXITOSA! Los datos del .env son correctos.");
        
        const [rows] = await conn.execute('SELECT COUNT(*) as total FROM mascota');
        console.log(`📊 La tabla 'mascota' tiene ${rows[0].total} registros.`);
        await conn.end();
    } catch (err) {
        console.error("❌ ERROR EN DB:");
        console.log(`   Detalle: ${err.message}`);
        if (err.code === 'ETIMEDOUT') {
            console.log("   👉 El puerto 3306 está bloqueado en el firewall de Oracle.");
        }
    }

    console.log("\n-------------------------------------------");

    // --- PRUEBA 2: API (PUERTO 4020) ---
    try {
        console.log(`📡 2. Intentando ping a la API (Puerto 4020)...`);
        // Probamos un GET a la IP directamente
        const res = await axios.get(`http://${config.host}:4020`, { timeout: 5000 });
        console.log("✅ ¡API RESPONDE! El puerto 4020 está abierto y escuchando.");
    } catch (err) {
        console.error("❌ ERROR EN API:");
        console.log(`   Detalle: ${err.message}`);
        if (err.code === 'ECONNABORTED') {
            console.log("   👉 Tiempo agotado: El puerto 4020 está CERRADO en Oracle Cloud.");
        } else if (err.code === 'ECONNREFUSED') {
            console.log("   👉 El puerto está abierto pero tu app de Node no está corriendo en el servidor.");
        }
    }
}

probarConexionReal();