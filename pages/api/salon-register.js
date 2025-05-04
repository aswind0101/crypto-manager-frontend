// pages/api/salon-register.js
import verifyToken from '../../backend/middleware/verifyToken.js';
import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  await verifyToken(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { firebase_uid, full_name, email, phone, role } = req.body;

    try {
      await pool.query(
        `INSERT INTO users (firebase_uid, full_name, email, phone, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [firebase_uid, full_name, email, phone, role]
      );

      res.status(201).json({ message: 'User registered' });
    } catch (error) {
      console.error('Register error:', error.message);
      res.status(500).json({ error: 'Registration failed' });
    }
  });
}
