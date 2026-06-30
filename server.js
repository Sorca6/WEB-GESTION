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
        // 1. Tabla de Usuarios
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT)`);
        
        // Inserción de tu usuario Administrador
        const defaultUser = process.env.ADMIN_USER || 'admin';
        const defaultPass = process.env.ADMIN_PASS || '1234';
        await pool.query("INSERT INTO usuarios (username, password) ON CONFLICT (username) DO NOTHING VALUES ($1, $2)", [defaultUser, defaultPass]);

        // 👤 INSERCIÓN AUTOMÁTICA DEL USUARIO JOSE (Contraseña por defecto: jose2026)
        await pool.query("INSERT INTO usuarios (username, password) ON CONFLICT (username) DO NOTHING VALUES ($1, $2)", ['jose', 'jose2026']);

        // 2. Tabla de Movimientos (Actualizada con enlace de usuario)
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
        
        console.log('-> Servidor PostgreSQL Quantum Multi-User Activo.');
    } catch (err) { console.error('Error DB:', err.message); }
};
initDB();

// Automatización Mensual por cada usuario individual
const procesarAutomatizacionesMes = async (usuarioId) => {
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
            const check = await pool.query(`
                SELECT * FROM movimientos 
                WHERE usuario_id = $1 AND descripcion = $2 AND EXTRACT(MONTH FROM fecha) = $3 AND EXTRACT(YEAR FROM fecha) = $4
            `, [usuarioId, activo.desc, mesActual, anioActual]);
            
            if (check.rows.length === 0) {
                await pool.query("INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5)", [usuarioId, activo.desc, activo.cant, activo.tipo, activo.cat]);
            }
        }
    } catch (err) { console.error("Error autos:", err.message); }
};

// Rutas de la API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT id, username FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movimientos', async (req, res) => {
    const userId = req.query.usuario_id;
    if (!userId) return res.status(400).json({ error: "Falta ID de usuario" });
    try {
        await procesarAutomatizacionesMes(userId);
        const result = await pool.query("SELECT * FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC", [userId]);
        res.json(result.rows.map(row => ({ ...row, cantidad: parseFloat(row.cantidad) })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/movimientos', async (req, res) => {
    const { usuario_id, descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    if (!usuario_id) return res.status(400).json({ error: "Falta ID de usuario" });
    try {
        let result;
        if (fecha_personalizada) {
            result = await pool.query("INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [usuario_id, descripcion, cantidad, tipo, categoria, `${fecha_personalizada} 12:00:00`]);
        } else {
            result = await pool.query("INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4, $5) RETURNING *", [usuario_id, descripcion, cantidad, tipo, categoria]);
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

app.listen(PORT, () => console.log(`Servidor Quantum Financiero Multi-Usuario en puerto ${PORT}`));
