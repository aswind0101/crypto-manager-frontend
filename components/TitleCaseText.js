// components/TitleCaseText.js
export default function TitleCaseText({ text, className = "", showEmoji = false }) {
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
    "credit-spending": "💳",
  };

  const clean = text.toLowerCase().replace(/-/g, ' ');
  const emoji = showEmoji ? (emojiMap[clean] || "") : "";

  return (
    <span className={className}>
      {emoji && <span className="mr-1">{emoji}</span>}
      {toTitleCase(text)}
    </span>
  );
}
