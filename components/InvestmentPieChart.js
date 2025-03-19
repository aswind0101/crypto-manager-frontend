// components/InvestmentPieChart.js
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const InvestmentPieChart = ({ data }) => {
    const colors = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"];

    return (
        <PieChart width={350} height={350}>
            <Pie
                data={data}
                dataKey="total_invested"
                nameKey="coin_symbol"
                cx="50%"
                cy="50%"
                outerRadius={110}
                fill="#8884d8"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
            >
                {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
            </Pie>
            <Tooltip />
            <Legend />
        </PieChart>
    );
};

export default InvestmentPieChart;
