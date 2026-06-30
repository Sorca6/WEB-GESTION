
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

// Parche global: Forzar a PostgreSQL a devolver números reales (no cadenas de texto)
const { types } = require('pg');
types.setTypeParser(1700, val => parseFloat(val));

const initDB = async () => {
    try {
        // 1. Tabla de Usuarios (Ampliada con campos para tus bancos)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY, 
                username TEXT UNIQUE, 
                password TEXT,
                saldo_ibercaja NUMERIC(12, 2) DEFAULT 0.00,
                saldo_openbank NUMERIC(12, 2) DEFAULT 0.00,
                saldo_trade_republic NUMERIC(12, 2) DEFAULT 0.00
            )
        `);
        
        // Inyección segura de usuarios
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
        
        console.log('-> Servidor Quantum Multi-User Activo, Saneado y con Soporte Bancario.');
    } catch (err) { 
        console.error('Error Crítico DB:', err.message); 
    }
};
initDB();

// API: Login (Retorna también los saldos de los bancos)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT id, username, saldo_ibercaja, saldo_openbank, saldo_trade_republic FROM usuarios WHERE username = $1 AND password = $2", [username.toLowerCase().trim(), password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Obtener movimientos de un usuario
app.get('/api/movimientos', async (req, res) => {
    const userId = req.query.usuario_id;
    if (!userId) return res.status(400).json({ error: "Falta ID" });
    try {
        const result = await pool.query("SELECT * FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC", [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Guardar movimiento (¡CORREGIDO CON ASYNC/AWAIT SEGURO!)
app.post('/api/movimientos', async (req, res) => {
    const { usuario_id, descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
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
        res.json({ success: true, movimiento: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Actualizar los saldos manuales de las 3 entidades bancarias
app.post('/api/usuario/saldos', async (req, res) => {
    const { usuario_id, ibercaja, openbank, trade_republic } = req.body;
    try {
        await pool.query(
            "UPDATE usuarios SET saldo_ibercaja = $1, saldo_openbank = $2, saldo_trade_republic = $3 WHERE id = $4",
            [parseFloat(ibercaja), parseFloat(openbank), parseFloat(trade_republic), usuario_id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/movimientos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Online en puerto ${PORT}`));
