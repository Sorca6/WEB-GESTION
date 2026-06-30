const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Forzar a PostgreSQL a devolver los campos NUMERIC como floats automáticamente
const { types } = require('pg');
types.setTypeParser(1700, val => parseFloat(val));

const initDB = async () => {
    try {
        // 1. Tabla de Usuarios
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT)`);
        
        // Usuarios por defecto obligatorios
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('admin', '1234') ON CONFLICT (username) DO NOTHING");
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('jose', 'jose2026') ON CONFLICT (username) DO NOTHING");
        await pool.query("INSERT INTO usuarios (username, password) VALUES ('arroyo', 'arroyo2026') ON CONFLICT (username) DO NOTHING");

        // 2. Tabla de Movimientos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos (
                id SERIAL PRIMARY KEY, 
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                descripcion TEXT NOT NULL, 
                cantidad NUMERIC(12, 2) NOT NULL, 
                tipo TEXT NOT NULL, 
                categoria TEXT NOT NULL, 
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('-> Servidor Quantum Multi-User Activo y Saneado.');
    } catch (err) { 
        console.error('Error Crítico DB:', err.message); 
    }
};
initDB();

// Automatización Mensual Optimizada
const procesarAutomatizacionesMes = async (usuarioId) => {
    try {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();
        
        const estrategia = [
            { desc: "🤖 [Auto] Compra MSCI World USD (acc)", cant: 100.00, tipo: "inversion", cat: "Inversión" },
            { desc: "🤖 [Auto] Compra NASDAQ-100 EUR (acc)", cant: 30.00, tipo: "inversion", cat: "Inversión" },
            { desc: "🤖 [Auto] Compra FTSE Emerging Markets", cant: 20.00, tipo: "inversion", cat: "Inversión" },
            { desc: "🤖 [Auto] Compra Ethereum (ETH)", cant: 15.00, tipo: "inversion", cat: "Inversión" }
        ];

        // Verificación masiva en una sola consulta para no ralentizar el chat ni el servidor
        const check = await pool.query(`
            SELECT descripcion FROM movimientos 
            WHERE usuario_id = $1 AND EXTRACT(MONTH FROM fecha) = $2 AND EXTRACT(YEAR FROM fecha) = $3
        `, [usuarioId, mesActual, anioActual]);

        const descripcionesExistentes = check.rows.map(r => r.descripcion);

        for (const activo of estrategia) {
            if (!descripcionesExistentes.includes(activo.desc)) {
                await pool.query(
                    "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5)",
                    [usuarioId, activo.desc, activo.cant, activo.tipo, activo.cat]
                );
            }
        }
    } catch (err) { 
        console.error("Error autos:", err.message); 
    }
};

// APIs Endpoints
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT id, username FROM usuarios WHERE username = $1 AND password = $2", [username.toLowerCase().trim(), password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Usuario o contraseña incorrectos" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movimientos', async (req, res) => {
    const userId = req.query.usuario_id;
    if (!userId) return res.status(400).json({ error: "Falta ID de usuario" });
    try {
        await procesarAutomatizacionesMes(userId);
        const result = await pool.query("SELECT * FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC", [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/movimientos', async (req, res) => {
    const { usuario_id, descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    if (!usuario_id) return res.status(400).json({ error: "Falta ID" });
    try {
        let result;
        if (fecha_personalizada) {
            result = await pool.query(
                "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [usuario_id, descripcion, parseFloat(cantidad), tipo, categoria, `${fecha_personalizada} 12:00:00`]
            );
        } else {
            result = await pool.query(
                "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                [usuario_id, descripcion, parseFloat(cantidad), tipo, categoria]
            );
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

// Asegurar que cualquier otra ruta cargue el index.html sin dar errores 404
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Online en puerto ${PORT}`));
