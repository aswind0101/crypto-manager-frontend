
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import pkg from "pg";
const { Pool } = pkg; // ✅ Chính xác

import verifyToken from "./middleware/verifyToken.js"; // nhớ thêm .js

dotenv.config({ path: "./backend/.env" }); // hoặc ".env" nếu bạn dùng file đó
// ==== server.js ====
//const express = require("express");
//const cors = require("cors");
//require("dotenv").config();
//const { Pool } = require("pg");
//const verifyToken = require("./middleware/verifyToken");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Get Portfolio (authenticated)
app.get("/api/portfolio", verifyToken, async (req, res) => {
    const userId = req.user.uid;

    try {
        const result = await pool.query(
            `SELECT 
        coin_symbol, 
        SUM(CASE WHEN transaction_type = 'buy' THEN quantity ELSE -quantity END) AS total_quantity,
        SUM(CASE WHEN transaction_type = 'buy' THEN quantity * price ELSE 0 END) AS total_invested,
        SUM(CASE WHEN transaction_type = 'sell' THEN quantity * price ELSE 0 END) AS total_sold
      FROM transactions
      WHERE user_id = $1
      GROUP BY coin_symbol
      ORDER BY total_invested DESC;`,
            [userId]
        );

        //const coinPrices = await getCoinPrices();Thay thế dòng này bằng:
        const coinPrices = await getCoinPrices(symbols);
        const portfolio = result.rows.map((coin) => {
            const currentPrice = coinPrices[coin.coin_symbol.toUpperCase()] || 0;
            const currentValue = coin.total_quantity * currentPrice;
            const profitLoss = currentValue - (coin.total_invested - coin.total_sold);

            return {
                coin_symbol: coin.coin_symbol,
                total_quantity: parseFloat(coin.total_quantity),
                total_invested: parseFloat(coin.total_invested),
                total_sold: parseFloat(coin.total_sold),
                current_price: currentPrice,
                current_value: currentValue,
                profit_loss: profitLoss,
            };
        });

        const totalInvested = portfolio.reduce((sum, coin) => sum + coin.total_invested, 0);
        const totalProfitLoss = portfolio.reduce((sum, coin) => sum + coin.profit_loss, 0);

        res.json({ portfolio, totalInvested, totalProfitLoss });
    } catch (error) {
        console.error("Error fetching portfolio:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Transactions CRUD
app.get("/api/transactions", verifyToken, async (req, res) => {
    const userId = req.user.uid;
    try {
        const result = await pool.query(
            "SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_date DESC",
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post("/api/transactions", verifyToken, async (req, res) => {
    const userId = req.user.uid;
    const { coin_symbol, quantity, price, transaction_type } = req.body;

    if (!coin_symbol || !quantity || !price || !transaction_type) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO transactions (coin_symbol, quantity, price, transaction_type, user_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [coin_symbol, quantity, price, transaction_type, userId]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Error adding transaction:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete("/api/transactions/:id", verifyToken, async (req, res) => {
    const transactionId = req.params.id;
    const userId = req.user.uid;

    try {
        const result = await pool.query(
            "DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING *",
            [transactionId, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Transaction not found or unauthorized" });
        }

        res.json({ message: "Transaction deleted successfully", deletedTransaction: result.rows[0] });
    } catch (error) {
        console.error("Error deleting transaction:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Get Coin Prices
async function getCoinPrices(symbols = []) {
    try {
        // 1. Gọi CoinGecko để lấy danh sách ID/Symbol
        const res = await fetch("https://api.coingecko.com/api/v3/coins/list");
        const allCoins = await res.json(); // [{ id, symbol, name }]

        // 2. Mapping: symbol từ DB => id của CoinGecko
        const ids = symbols
            .map(symbol => {
                const match = allCoins.find(coin => coin.symbol.toLowerCase() === symbol.toLowerCase());
                return match?.id || null;
            })
            .filter(Boolean);

        if (ids.length === 0) return {};

        // 3. Gọi API giá
        const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`
        );
        const priceData = await priceRes.json(); // { bitcoin: { usd: 68000 }, ... }

        // 4. Trả ra map { BTC: 68000 }
        const priceMap = {};
        symbols.forEach(symbol => {
            const matched = allCoins.find(c => c.symbol.toLowerCase() === symbol.toLowerCase());
            const id = matched?.id;
            if (id && priceData[id]) {
                priceMap[symbol.toUpperCase()] = priceData[id].usd;
            }
        });

        return priceMap;
    } catch (error) {
        console.error("⚠️ getCoinPrices error:", error);
        return {};
    }
}


// Health check
app.get("/", (req, res) => {
    res.send("Crypto Manager API is running...");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
