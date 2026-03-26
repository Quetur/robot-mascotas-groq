import 'dotenv/config';
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function probarMotor() {
    console.log("🏎️  PROBANDO MOTOR GROQ DESDE WINDOWS...");

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "Extraé datos de este post de Facebook. Devolvé solo un JSON con: especie, raza, color, zona y contacto."
                },
                {
                    role: "user",
                    content: "Se encontró un perrito salchicha marrón en la colectora de Acceso Oeste, altura Ituzaingó. Muy asustado. Llamar al 1144556677."
                }
            ],
            model: "llama-3.3-70b-versatile",
        });

        console.log("✅ ANÁLISIS EXITOSO:");
        console.log(completion.choices[0].message.content);

    } catch (e) {
        console.log("❌ ERROR:", e.message);
    }
}

probarMotor();