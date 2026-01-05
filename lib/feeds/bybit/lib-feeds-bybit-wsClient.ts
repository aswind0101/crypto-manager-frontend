type WSState = "idle" | "connecting" | "open" | "closed" | "error";

export type WsCallbacks = {
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onMessage?: (data: any) => void;
  onState?: (s: WSState) => void;
};

export class BybitWsClient {
  private ws: WebSocket | null = null;
  private state: WSState = "idle";
  private reconnectAttempt = 0;
  private heartbeatTimer: any = null;

  constructor(private url: string, private cb: WsCallbacks) {}

  connect() {
    if (this.ws && (this.state === "connecting" || this.state === "open")) return;
    this.setState("connecting");

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState("open");
      this.cb.onOpen?.();
      this.startHeartbeat();
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        this.cb.onMessage?.(data);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onerror = (ev) => {
      this.setState("error");
      this.cb.onError?.(ev);
    };

    this.ws.onclose = (ev) => {
      this.stopHeartbeat();
      this.setState("closed");
      this.cb.onClose?.(ev);
      this.scheduleReconnect();
    };
  }

  close() {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setState("closed");
  }

  send(obj: any) {
    if (!this.ws || this.state !== "open") return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  subscribe(topics: string[]) {
    // Bybit V5 WS op: "subscribe"
    this.send({ op: "subscribe", args: topics });
  }

  private startHeartbeat() {
    // Bybit thường dùng ping/pong; nếu server tự ping thì không cần.
    // Ở đây chủ động ping mỗi 20s để giữ kết nối ổn định qua VPN.
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: "ping" });
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect() {
    // exponential backoff, max 30s
    const base = 500;
    const delay = Math.min(30000, base * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  private setState(s: WSState) {
    this.state = s;
    this.cb.onState?.(s);
  }
}
