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

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT
            )
        `);

        const defaultUser = process.env.ADMIN_USER || 'admin';
        const defaultPass = process.env.ADMIN_PASS || '1234';

        const userCheck = await pool.query("SELECT COUNT(*) FROM usuarios WHERE username = $1", [defaultUser]);
        if (parseInt(userCheck.rows[0].count) === 0) {
            await pool.query("INSERT INTO usuarios (username, password) VALUES ($1, $2)", [defaultUser, defaultPass]);
            console.log('-> Infraestructura de usuarios configurada en Render.');
        }

        // Tabla robustecida con soporte para tipos de ahorro y subtipos extendidos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos (
                id SERIAL PRIMARY KEY,
                descripcion TEXT NOT NULL,
                cantidad NUMERIC(12, 2) NOT NULL,
                tipo TEXT NOT NULL,       
                categoria TEXT NOT NULL,  
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('-> Tablas PostgreSQL listas y sincronizadas.');
    } catch (err) {
        console.error('Error inicializando base de datos Remota:', err.message);
    }
};

initDB();

// API: Autenticación
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, username: result.rows[0].username });
        } else {
            res.status(401).json({ success: false, message: "Error de credenciales" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Obtener todo el historial con inyección de inversiones dinámicas a inicio de mes
app.get('/api/movimientos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        let datosMapeados = result.rows.map(row => ({
            ...row,
            cantidad: parseFloat(row.cantidad)
        }));

        // Automatización Inteligente: Simular / Proyectar Gastos de Inversiones automáticas al inicio de mes
        const hoy = new Date();
        if (hoy.getDate() <= 5) { 
            // Añadir visualmente un registro recordatorio inteligente si no hay uno creado este mes
            const tieneInversionFija = datosMapeados.some(m => m.categoria === 'inicio_mes_auto' && new Date(m.fecha).getMonth() === hoy.getMonth());
            if (!tieneInversionFija) {
                datosMapeados.unshift({
                    id: 0,
                    descripcion: "🤖 [Sugerencia Inicio de Mes] Aportación Fija Programada",
                    cantidad: 150.00,
                    tipo: "inversion",
                    categoria: "inicio_mes_auto",
                    fecha: hoy.toISOString(),
                    amount_formatted: "150.00"
                });
            }
        }

        res.json(datosMapeados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Registrar operaciones en PostgreSQL
app.post('/api/movimientos', async (req, res) => {
    const { descripcion, cantidad, tipo, categoria } = req.body;
    if (!descripcion || !cantidad || !tipo || !categoria) {
        return res.status(400).json({ error: "Faltan parámetros" });
    }
    try {
        const result = await pool.query(
            "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4) RETURNING *",
            [descripcion, cantidad, tipo, categoria]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API NUEVA: ENDPOINT ELIMINAR REGISTROS INDIVIDUALES POR ID
app.delete('/api/movimientos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [id]);
        res.json({ success: true, message: "Registro eliminado de forma irreversible." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor activo e inteligente en el puerto ${PORT}`);
});
