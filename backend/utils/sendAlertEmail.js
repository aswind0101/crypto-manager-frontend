// utils/sendAlertEmail.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function formatMoney(number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number);
}

export async function sendAlertEmail(toEmail, newProfitLoss, changePercent, portfolio) {
  const isProfit = newProfitLoss >= 0;
  const emoji = isProfit ? "🟢" : "🔴";
  const statusText = isProfit ? "Profit" : "Loss";
  const sign = isProfit ? "+" : "-";

  const subject = `${emoji} ${statusText} Alert: ${formatMoney(newProfitLoss)} (${sign}${Math.abs(changePercent)}%)`;

  const coinDetails = portfolio
    .map(coin => {
      const profit = coin.profit_loss.toFixed(2);
      const emoji = coin.profit_loss >= 0 ? "🟢" : "🔴";
      return `<li>${emoji} <strong>${coin.coin_symbol.toUpperCase()}</strong>: ${formatMoney(profit)} USD</li>`;
    })
    .join("");

  const html = `
    <h2>${emoji} ${statusText} Alert</h2>
    <p>
      You are currently <strong>${isProfit ? 'making a profit' : 'at a loss'}</strong> of <strong>${formatMoney(newProfitLoss)}</strong>
      (${sign}${Math.abs(changePercent)}%).
    </p>
    <h3>📊 Breakdown:</h3>
    <ul>${coinDetails}</ul>
    <p style="font-size: 12px; color: #666;">— Sent by Crypto Manager (resend.com)</p>
  `;

  try {
    const data = await resend.emails.send({
      from: 'Crypto Manager <onboarding@resend.dev>',
      to: toEmail,
      subject,
      html
    });

    console.log("✅ Resend email sent:", data.id);
  } catch (error) {
    console.error("❌ Resend error:", error.message || error);
  }
}
