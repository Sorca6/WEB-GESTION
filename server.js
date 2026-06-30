const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configuración segura del Pool de PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Inicialización de la infraestructura relacional
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
        }

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
        console.log('-> Estructura PostgreSQL activa, verificada y protegida.');
    } catch (err) {
        console.error('Error inicializando base de datos:', err.message);
    }
};

initDB();

// Lógica de Automatización de Gastos/Inversiones Fijas Recurrentes
const procesarAutomatizacionesMes = async () => {
    try {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();

        // Tu estrategia de inversión automatizada descrita
        const estrategiaInversiones = [
            { desc: "🤖 [Auto] Compra MSCI World USD (acc)", cant: 100.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra NASDAQ-100 EUR (acc)", cant: 30.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra FTSE Emerging Markets", cant: 20.00, tipo: "inversion", cat: "inicio_mes_auto" },
            { desc: "🤖 [Auto] Compra Ethereum (ETH)", cant: 15.00, tipo: "inversion", cat: "inicio_mes_auto" }
        ];

        for (const activo of estrategiaInversiones) {
            // Evitar duplicaciones del mismo mes/año comprobando la descripción exacta
            const check = await pool.query(
                `SELECT * FROM movimientos 
                 WHERE descripcion = $1 
                 AND EXTRACT(MONTH FROM fecha) = $2 
                 AND EXTRACT(YEAR FROM fecha) = $3`,
                [activo.desc, mesActual, anioActual]
            );

            // Si el mes en curso aún no cuenta con el registro, el sistema lo inyecta autónomamente
            if (check.rows.length === 0) {
                await pool.query(
                    "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4)",
                    [activo.desc, activo.cant, activo.tipo, activo.cat]
                );
                console.log(`-> Inyección automatizada mensual completada con éxito: ${activo.desc}`);
            }
        }
    } catch (err) {
        console.error("Error en el motor secundario de automatizaciones:", err.message);
    }
};

// API: Login de acceso
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Lectura y verificación de flujo latente mensual
app.get('/api/movimientos', async (req, res) => {
    try {
        // Ejecución en segundo plano de compras fijas al iniciar o consultar la app
        await procesarAutomatizacionesMes();

        const result = await pool.query("SELECT * FROM movimientos ORDER BY fecha DESC");
        const datosMapeados = result.rows.map(row => ({
            ...row,
            cantidad: parseFloat(row.cantidad)
        }));
        res.json(datosMapeados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Creación con soporte para fechas personalizadas del calendario
app.post('/api/movimientos', async (req, res) => {
    const { descripcion, cantidad, tipo, categoria, fecha_personalizada } = req.body;
    try {
        let result;
        if (fecha_personalizada) {
            // Almacenar fecha elegida por el usuario con marca de tiempo limpia
            result = await pool.query(
                "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria, fecha) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                [descripcion, cantidad, tipo, categoria, `${fecha_personalizada} 12:00:00`]
            );
        } else {
            // Registro inmediato con marca temporal automática del servidor (hoy)
            result = await pool.query(
                "INSERT INTO movimientos (descripcion, cantidad, tipo, categoria) VALUES ($1, $2, $3, $4) RETURNING *",
                [descripcion, cantidad, tipo, categoria]
            );
        }
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// API: Eliminación
app.delete('/api/movimientos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM movimientos WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Servidor de Finanzas Quantum activo y operativo en el puerto ${PORT}`);
});
