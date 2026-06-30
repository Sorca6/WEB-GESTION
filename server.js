const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT)`);
        const defaultUser = process.env.ADMIN_USER || 'admin';
        const defaultPass = process.env.ADMIN_PASS || '1234';
        const userCheck = await pool.query("SELECT COUNT(*) FROM usuarios WHERE username = $1", [defaultUser]);
        if (parseInt(userCheck.rows[0].count) === 0) {
            await pool.query("INSERT INTO usuarios (username, password) VALUES ($1, $2)", [defaultUser, defaultPass]);
        }
        await pool.query(`CREATE TABLE IF NOT EXISTS movimientos (id SERIAL PRIMARY KEY, descripcion TEXT NOT NULL, cantidad NUMERIC(12, 2) NOT NULL, tipo TEXT NOT NULL, categoria TEXT NOT NULL, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log('-> Servidor PostgreSQL activo.');
    } catch (err) { console.error('Error DB:', err.message); }
};
initDB();

// 🤖 VIGILANTE AUTOMÁTICO DE TELEGRAM
const UMBRAL_ALERTA_ETH_BAJO = 2000.00; // Umbral de aviso ajustado
let ultimaAlertaEnviada = 0;

const enviarMensajeTelegram = (texto) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(texto)}`;
    https.get(url, (res) => {}).on('error', (e) => console.error("Error Telegram:", e.message));
};

setInterval(() => {
    https.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHEUR', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const precioETH = parseFloat(JSON.parse(data).price);
                const ahora = Date.now();
                if (precioETH < UMBRAL_ALERTA_ETH_BAJO && (ahora - ultimaAlertaEnviada > 6 * 60 * 60 * 1000)) {
                    enviarMensajeTelegram(`⚠️ ¡ALERTA QUANTUM! Ethereum (ETH) ha caído por debajo del límite. Precio actual: ${precioETH.toFixed(2)} EUR.`);
                    ultimaAlertaEnviada = ahora;
                }
            } catch(e){}
        });
    }).on('error', (e) => {});
}, 3600000);

// Automatización Mensual
const procesarAutomatizacionesMes = async () => {
    try {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();
        const estrategia = [
            { desc: "🤖 [Auto] Compra MSCI World USD (acc)", cant: 100.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra NASDAQ-100 EUR (acc)", cant: 30.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra FTSE Emerging Markets", cant: 20.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra Ethereum (ETH)", cant: 15.00, tipo: "inversion", cat: "inicio_mes_auto" }
        ];
        for (const activo of estrategia) {
            const check = await pool.query(`SELECT * FROM movimientos WHERE descripcion = $1 AND EXTRACT(MONTH FROM fecha) = $2 AND EXTRACT(YEAR FROM fecha) = $3`, [activo.desc, mesActual, anioActual]);
            if (check.rows.length === 0) {
                await pool.query("INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4)", [activo.desc, activo.cant, activo.tipo, activo.cat]);
            }
        }
    } catch (err) { console.error("Error autos:", err.message); }
};

// APIs
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) res.json({ success: true });
        else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movimientos', async (req, res) => {
    try {
        await procesarAutomatizacionesMes();
        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        res.json(result.rows.map(row => ({ ...row, cantidad: parseFloat(row.cantidad) })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/movimientos', async (req, res) => {
    const { descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    try {
        let result;
        if (fecha_personalizada) {
            result = await pool.query("INSERT INTO movimientos (descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5) RETURNING *", [descripcion, cantidad, tipo, categoria, `${fecha_personalizada} 12:00:00`]);
        } else {
            result = await pool.query("INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4) RETURNING *", [descripcion, cantidad, tipo, categoria]);
        }
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/movimientos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Servidor Quantum Financiero activo en puerto ${PORT}`));
