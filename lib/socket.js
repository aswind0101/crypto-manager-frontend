import { io } from "socket.io-client";
const socket = io("https://crypto-manager-backend.onrender.com", { autoConnect: false });
export default socket;
