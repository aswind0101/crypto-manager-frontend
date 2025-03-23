const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// ======================== API ========================

// 📌 Get all transactions for user
app.get("/api/transactions", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

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

// 📌 Add new transaction
app.post("/api/transactions", async (req, res) => {
    const { coin_symbol, quantity, price, transaction_type, user_id } = req.body;

    if (!coin_symbol || !quantity || !price || !transaction_type || !user_id) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO transactions (coin_symbol, quantity, price, transaction_type, user_id) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [coin_symbol, quantity, price, transaction_type, user_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Error adding transaction:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 📌 Delete transaction
app.delete("/api/transactions/:id", async (req, res) => {
    const transactionId = req.params.id;

    try {
        const result = await pool.query(
            "DELETE FROM transactions WHERE id = $1 RETURNING *",
            [transactionId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Transaction not found" });
        }

        res.json({ message: "Transaction deleted successfully", deletedTransaction: result.rows[0] });
    } catch (error) {
        console.error("Error deleting transaction:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 📌 Get prices from CoinGecko
async function getCoinPrices() {
    try {
        const response = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd");
        const data = await response.json();

        let priceMap = {};
        data.forEach(coin => {
            priceMap[coin.symbol.toUpperCase()] = coin.current_price;
        });

        return priceMap;
    } catch (error) {
        console.error("Error fetching CoinGecko prices:", error);
        return {};
    }
}

// 📌 Get portfolio for user
app.get("/api/portfolio", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    try {
        const result = await pool.query(`
            SELECT 
              coin_symbol, 
              SUM(CASE WHEN transaction_type = 'buy' THEN quantity ELSE -quantity END) AS total_quantity,
              SUM(CASE WHEN transaction_type = 'buy' THEN quantity * price ELSE 0 END) AS total_invested,
              SUM(CASE WHEN transaction_type = 'sell' THEN quantity * price ELSE 0 END) AS total_sold
            FROM transactions
            WHERE user_id = $1
            GROUP BY coin_symbol
            ORDER BY total_invested DESC;
        `, [userId]);

        if (result.rows.length === 0) {
            return res.json({ portfolio: [], totalInvested: 0, totalProfitLoss: 0 });
        }

        const coinPrices = await getCoinPrices();

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

// ✅ Health check
app.get("/", (req, res) => {
    res.send("Crypto Manager API is running...");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
