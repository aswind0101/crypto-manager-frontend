// components/TitleCaseText.js
export default function TitleCaseText({ text, className = "" }) {
    if (!text) return null;
  
    const toTitleCase = (str) =>
      str
        .replace(/-/g, ' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
  
    const emojiMap = {
      expense: "💸",
      income: "💰",
      credit: "💳",
      "credit spending": "💳",
      "credit-spending": "💳",
      "credit spending": "💳",
      debts: "💳",
      salary: "💼",
      food: "🍔",
    };
  
    const clean = text.toLowerCase().replace(/-/g, ' ');
    const emoji = emojiMap[clean] || "";
  
    return (
      <span className={className}>
        {emoji && <span className="mr-1">{emoji}</span>}
        {toTitleCase(text)}
      </span>
    );
  }
  