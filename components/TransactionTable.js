// components/TransactionTable.js
const TransactionTable = ({ transactions }) => {
    return (
        <div className="max-h-96 overflow-y-auto rounded-lg shadow-md border">
            <table className="w-full border-collapse border border-gray-300">
                <thead className="bg-gray-200 sticky top-0">
                    <tr>
                        <th className="border border-gray-300 px-4 py-2">Coin</th>
                        <th className="border border-gray-300 px-4 py-2">Quantity</th>
                        <th className="border border-gray-300 px-4 py-2">Price</th>
                        <th className="border border-gray-300 px-4 py-2">Type</th>
                        <th className="border border-gray-300 px-4 py-2">Date</th>
                        <th className="border border-gray-300 px-4 py-2">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((tx, index) => (
                        <tr key={index} className="text-center hover:bg-gray-100 transition">
                            <td className="border border-gray-300 px-4 py-2">{tx.coin_symbol}</td>
                            <td className="border border-gray-300 px-4 py-2">{tx.total_quantity.toLocaleString()}</td>
                            <td className="border border-gray-300 px-4 py-2">${tx.current_price.toLocaleString()}</td>
                            <td className={`border border-gray-300 px-4 py-2 font-semibold ${tx.transaction_type === "buy" ? "text-green-600" : "text-red-600"}`}>
                                {tx.transaction_type.toUpperCase()}
                            </td>
                            <td className="border border-gray-300 px-4 py-2">{new Date(tx.date).toLocaleDateString()}</td>
                            <td className="border border-gray-300 px-4 py-2">
                                <button className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition">Delete</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default TransactionTable;
