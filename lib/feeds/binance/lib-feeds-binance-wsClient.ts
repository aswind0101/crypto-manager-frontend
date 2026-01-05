type WSState = "idle" | "connecting" | "open" | "closed" | "error";

export type WsCallbacks = {
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onMessage?: (data: any) => void;
  onState?: (s: WSState) => void;
};

export class BinanceWsClient {
  private ws: WebSocket | null = null;
  private state: WSState = "idle";
  private reconnectAttempt = 0;

  constructor(private url: string, private cb: WsCallbacks) {}

  connect() {
    if (this.ws && (this.state === "connecting" || this.state === "open")) return;
    this.setState("connecting");

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState("open");
      this.cb.onOpen?.();
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        this.cb.onMessage?.(data);
      } catch {
        // ignore
      }
    };

    this.ws.onerror = (ev) => {
      this.setState("error");
      this.cb.onError?.(ev);
    };

    this.ws.onclose = (ev) => {
      this.setState("closed");
      this.cb.onClose?.(ev);
      this.scheduleReconnect();
    };
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.setState("closed");
  }

  send(obj: any) {
    if (!this.ws || this.state !== "open") return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private scheduleReconnect() {
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
