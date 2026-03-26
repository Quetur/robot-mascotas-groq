import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

async function simularPostman() {
    // Tomamos la URL del .env (Asegurate que sea http://137.131.159.251:4020)
    const API_URL = `${process.env.API_URL}/api/mascota_chat_graba`;

    console.log(`🚀 SIMULANDO POSTMAN HACIA: ${API_URL}`);

    const form = new FormData();
    form.append('id_categoria', '1'); // PERDIDO
    form.append('id_tipo', '1');      // PERRO
    form.append('id_raza', 'Caniche');
    form.append('titulo', 'TEST POSTMAN DESDE WINDOWS');
    form.append('sexo', 'Macho');
    form.append('latitud', '-34.658');
    form.append('longitud', '-58.668');
    form.append('calle', 'Barcala y Ratti, Ituzaingó');
    form.append('celular', '1122334455');
    form.append('nombre_contacto', 'Jesús Test');

    // Si tenés una imagen de prueba en la carpeta, la mandamos. 
    // Si no, la API usará la de por defecto según tu código.
    // form.append('foto2', fs.createReadStream('./test.jpg')); 

    try {
        const response = await axios.post(API_URL, form, {
            headers: { ...form.getHeaders() },
            timeout: 10000 
        });

        console.log("------------------------------------------");
        console.log("✅ ¡RESPUESTA DEL SERVIDOR!");
        console.log("Status:", response.status);
        console.log("Data:", response.data);
        console.log("------------------------------------------");
        
        if(response.data.success) {
            console.log(`🏆 Mascota de prueba grabada con ID: ${response.data.insertId}`);
        }

    } catch (error) {
        console.error("❌ ERROR EN EL ENVÍO:");
        if (error.code === 'ECONNABORTED') {
            console.log("👉 TIMEOUT: El puerto 4020 sigue cerrado en Oracle Cloud.");
        } else if (error.response) {
            console.log("👉 El servidor respondió pero con error:", error.response.data);
        } else {
            console.log("👉 Detalle:", error.message);
        }
    }
}

simularPostman();