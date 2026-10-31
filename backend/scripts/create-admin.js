const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { hashPassword } = require('../marketing');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const role = process.env.ADMIN_ROLE || 'admin';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Define ADMIN_EMAIL con un correo válido.');
  }
  if (password.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  if (!['admin', 'analyst', 'sales'].includes(role)) throw new Error('ADMIN_ROLE debe ser admin, analyst o sales.');
  if (!process.env.DATABASE_URL) throw new Error('Define DATABASE_URL antes de crear usuarios.');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await client.query(schema);
    const passwordHash = await hashPassword(password);
    const result = await client.query(
      `INSERT INTO marketing_admin_users (email, password_hash, role_id, active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         role_id = EXCLUDED.role_id, active = TRUE
       RETURNING id, email, role_id`,
      [email, passwordHash, role]
    );
    await client.query('COMMIT');
    console.log(`Usuario ${result.rows[0].email} listo con rol ${result.rows[0].role_id}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === 'ECONNREFUSED') {
      throw new Error('No se pudo conectar con PostgreSQL. Comprueba que el servicio esté iniciado y DATABASE_URL apunte al puerto y base correctos.');
    }
    if (error.code === '3D000') {
      throw new Error('La base de datos configurada en DATABASE_URL no existe. Créala en PostgreSQL y vuelve a ejecutar el comando.');
    }
    if (error.code === '28P01' || error.code === '28000') {
      throw new Error('PostgreSQL rechazó las credenciales de DATABASE_URL. Revisa usuario y contraseña en backend/.env.');
    }
    if (error.code === '42501') {
      throw new Error('El usuario de DATABASE_URL no tiene permisos para crear las tablas del panel. Concede permisos de esquema o ejecuta backend/schema.sql con un usuario administrador de PostgreSQL.');
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
