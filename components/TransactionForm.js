// components/TransactionForm.js
const TransactionForm = () => {
    return (
        <form className="space-y-4">
            <input type="text" placeholder="Coin Symbol (e.g., BTC)" className="w-full border px-4 py-2 rounded-md focus:ring focus:ring-blue-300" />
            <input type="number" placeholder="Quantity" className="w-full border px-4 py-2 rounded-md focus:ring focus:ring-blue-300" />
            <input type="number" placeholder="Price" className="w-full border px-4 py-2 rounded-md focus:ring focus:ring-blue-300" />
            <select className="w-full border px-4 py-2 rounded-md focus:ring focus:ring-blue-300">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
            </select>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md w-full hover:bg-blue-700 transition">Add</button>
        </form>
    );
};

export default TransactionForm;
