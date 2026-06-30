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

// Forzar mapeo correcto de números en PG
const { types } = require('pg');
types.setTypeParser(1700, val => parseFloat(val));

const initDB = async () => {
    try {
        // 1. Asegurar tabla de usuarios
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

        // Parche por si la tabla existía sin las columnas de los bancos
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_ibercaja NUMERIC(12, 2) DEFAULT 0.00`);
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_openbank NUMERIC(12, 2) DEFAULT 0.00`);
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_trade_republic NUMERIC(12, 2) DEFAULT 0.00`);

        // Inyectar usuarios iniciales garantizando IDs fijos para evitar desajustes
        await pool.query("INSERT INTO usuarios (id, username, password) VALUES (1, 'admin', '1234') ON CONFLICT (id) DO NOTHING");
        await pool.query("INSERT INTO usuarios (id, username, password) VALUES (2, 'jose', 'jose2026') ON CONFLICT (id) DO NOTHING");
        await pool.query("INSERT INTO usuarios (id, username, password) VALUES (3, 'arroyo', 'arroyo2026') ON CONFLICT (id) DO NOTHING");

        // 2. Crear o resetear la tabla de movimientos si tiene conflictos de llaves
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

        // Corrección de seguridad: si existían movimientos sin usuario_id asignado, los vinculamos al admin (1)
        await pool.query(`UPDATE movimientos SET usuario_id = 1 WHERE usuario_id IS NULL`);

        console.log('-> Estructuras alineadas y limpias en Render.');
    } catch (err) { 
        console.error('Error inicializando las tablas:', err.message); 
    }
};
initDB();

// Endpoints de la API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT id, username, saldo_ibercaja, saldo_openbank, saldo_trade_republic FROM usuarios WHERE username = $1 AND password = $2", 
            [username.toLowerCase().trim(), password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movimientos', async (req, res) => {
    const userId = req.query.usuario_id;
    if (!userId) return res.status(400).json({ error: "ID requerido" });
    try {
        const result = await pool.query("SELECT * FROM movimientos WHERE usuario_id = $1 ORDER BY fecha DESC", [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/movimientos', async (req, res) => {
    const { usuario_id, descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    if (!usuario_id) return res.status(400).json({ error: "Falta usuario_id" });
    try {
        let result;
        const insertFecha = (fecha_personalizada && fecha_personalizada.trim() !== "") ? `${fecha_personalizada} 12:00:00` : new Date();
        
        result = await pool.query(
            "INSERT INTO movimientos (usuario_id, descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [parseInt(usuario_id), descripcion, parseFloat(cantidad), tipo, categoria, insertFecha]
        );
        res.json({ success: true, movimiento: result.rows[0] });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/usuario/saldos', async (req, res) => {
    const { usuario_id, ibercaja, openbank, trade_republic } = req.body;
    try {
        await pool.query(
            "UPDATE usuarios SET saldo_ibercaja = $1, saldo_openbank = $2, saldo_trade_republic = $3 WHERE id = $4",
            [parseFloat(ibercaja) || 0, parseFloat(openbank) || 0, parseFloat(trade_republic) || 0, usuario_id]
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
